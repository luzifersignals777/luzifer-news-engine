import { createHash, timingSafeEqual } from "node:crypto";

// Official Reuters news via LSEG Data Platform. No public RSS or scraping.
const API_ORIGIN = "https://api.refinitiv.com";
const asArray = value => Array.isArray(value) ? value : value ? [value] : [];
const scalar = value => typeof value === "string" ? value : value?.$;
const bounded = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

export function reutersConfig(env = process.env) {
  const authVersion = env.LSEG_AUTH_VERSION || (env.LSEG_CLIENT_ID && env.LSEG_CLIENT_SECRET ? "v2" : "v1");
  const required = authVersion === "v2"
    ? ["LSEG_CLIENT_ID", "LSEG_CLIENT_SECRET"]
    : ["LSEG_USERNAME", "LSEG_PASSWORD", "LSEG_APP_KEY"];
  return {
    enabled: env.REUTERS_ENABLED === "true",
    authVersion,
    credentials: Object.fromEntries(required.map(key => [key, String(env[key] || "")])),
    missingCredentials: required.filter(key => !String(env[key] || "").trim()),
    readerToken: env.REUTERS_READER_TOKEN || "",
    pollSeconds: bounded(env.REUTERS_POLL_SECONDS, 60, 30, 3600),
    staleSeconds: bounded(env.REUTERS_STALE_SECONDS, 180, 60, 86400),
    windowMinutes: bounded(env.REUTERS_WINDOW_MIN, 90, 1, 1440),
    timeoutMs: bounded(env.REUTERS_TIMEOUT_MS, 10000, 1000, 30000),
    query: `Source:RTRS AND (${env.LSEG_NEWS_QUERY || "Language:LEN"})`
  };
}

export function readerAuthorized(header, token) {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const digest = value => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}

export function normalizeHeadline(row, now, windowMinutes) {
  const item = row?.newsItem;
  const meta = item?.contentMeta;
  const sources = [...asArray(meta?.creator), ...asArray(meta?.infoSource)];
  if (!sources.some(source => source?._qcode === "NS:RTRS" && source?._role === "sRole:source")) return null;
  const status = item?.itemMeta?.pubStatus?._qcode;
  if (status && status !== "stat:usable") return null;
  const id = item?._guid || (typeof row.storyId === "string" ? row.storyId.replace(/:\d+$/, "") : "");
  const title = scalar(asArray(item?.itemMeta?.title)[0]) || scalar(asArray(meta?.headline)[0]);
  const published = Date.parse(scalar(item?.itemMeta?.versionCreated));
  if (!id || !title || !Number.isFinite(published) || published > now + 60000 || published < now - windowMinutes * 60000) return null;
  return {
    id,
    storyId: row.storyId,
    headline: title,
    source: "Reuters",
    sourceCode: "NS:RTRS",
    publishedAt: new Date(published).toISOString(),
    version: Number(item?._version) || 1,
    urgency: Number(scalar(meta?.urgency)) || null,
    topics: asArray(meta?.subject).map(subject => subject?._qcode).filter(code => typeof code === "string")
  };
}

export function createReutersClient({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const config = reutersConfig(env);
  let headlines = [];
  let lastAttemptAt = null;
  let lastSuccessAt = null;
  let errorCode = null;
  let coverageIncomplete = false;
  let requestInFlight = null;
  let timer = null;
  let accessToken = null;
  let refreshToken = null;
  let tokenExpiresAt = 0;
  let retryAfter = 0;

  function status() {
    let state = "starting";
    if (!config.enabled) state = "disabled";
    else if (!["v1", "v2"].includes(config.authVersion)) state = "invalid_config";
    else if (config.missingCredentials.length) state = "not_configured";
    else if (errorCode) state = "unavailable";
    else if (lastSuccessAt !== null) state = now() - lastSuccessAt > config.staleSeconds * 1000 ? "stale" : "connected";
    return {
      provider: "Reuters via LSEG Data Platform",
      state,
      connected: state === "connected",
      configured: ["v1", "v2"].includes(config.authVersion) && !config.missingCredentials.length,
      missingCredentials: config.missingCredentials,
      authVersion: config.authVersion,
      lastAttemptAt: lastAttemptAt === null ? null : new Date(lastAttemptAt).toISOString(),
      lastSuccessAt: lastSuccessAt === null ? null : new Date(lastSuccessAt).toISOString(),
      pollSeconds: config.pollSeconds,
      staleSeconds: config.staleSeconds,
      headlineCount: headlines.filter(item => Date.parse(item.publishedAt) >= now() - config.windowMinutes * 60000).length,
      coverageIncomplete,
      errorCode,
      readerTokenConfigured: Boolean(config.readerToken),
      signalAuthority: "CONTEXT_ONLY"
    };
  }

  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, redirect: "error", signal: controller.signal });
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = Number(response.headers?.get("retry-after"));
          retryAfter = now() + bounded(seconds, config.pollSeconds, 30, 3600) * 1000;
        }
        throw new Error(`LSEG_HTTP_${response.status}`);
      }
      if (Number(response.headers?.get("content-length")) > 2000000) throw new Error("LSEG_RESPONSE_TOO_LARGE");
      const text = await response.text();
      if (Buffer.byteLength(text) > 2000000) throw new Error("LSEG_RESPONSE_TOO_LARGE");
      try { return JSON.parse(text); } catch { throw new Error("LSEG_INVALID_JSON"); }
    } catch (error) {
      if (controller.signal.aborted) throw new Error("LSEG_TIMEOUT");
      if (/^LSEG_[A-Z0-9_]+$/.test(error.message)) throw error;
      throw new Error("LSEG_NETWORK_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function token() {
    if (accessToken && now() < tokenExpiresAt) return accessToken;
    const c = config.credentials;
    const body = new URLSearchParams(config.authVersion === "v2"
      ? { grant_type: "client_credentials", client_id: c.LSEG_CLIENT_ID, client_secret: c.LSEG_CLIENT_SECRET, scope: "trapi" }
      : refreshToken
        ? { grant_type: "refresh_token", client_id: c.LSEG_APP_KEY, refresh_token: refreshToken }
        : { grant_type: "password", username: c.LSEG_USERNAME, password: c.LSEG_PASSWORD, client_id: c.LSEG_APP_KEY, scope: "trapi", takeExclusiveSignOnControl: "false" });
    const result = await requestJson(`${API_ORIGIN}/auth/oauth2/${config.authVersion}/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body
    });
    const expiry = Number(result.expires_in);
    if (typeof result.access_token !== "string" || !result.access_token || !Number.isFinite(expiry) || expiry <= 0) throw new Error("LSEG_INVALID_TOKEN");
    accessToken = result.access_token;
    refreshToken = result.refresh_token || null;
    tokenExpiresAt = now() + Math.max(1, expiry - Math.min(30, expiry / 10)) * 1000;
    return accessToken;
  }

  async function fetchHeadlines() {
    const auth = await token();
    const entries = [];
    let cursor = null;
    const seenCursors = new Set();
    for (let page = 0; page < 3; page++) {
      const url = new URL(`${API_ORIGIN}/data/news/v1/headlines`);
      url.search = cursor
        ? new URLSearchParams({ cursor }).toString()
        : new URLSearchParams({ query: config.query, limit: "100", sort: "newToOld", dateFrom: new Date(now() - config.windowMinutes * 60000).toISOString() }).toString();
      const data = await requestJson(url, { headers: { Authorization: `Bearer ${auth}`, Accept: "application/json" } });
      if (!Array.isArray(data?.data)) throw new Error("LSEG_INVALID_HEADLINES");
      if (data.data.some(row => !row?.newsItem?.itemMeta || !row?.newsItem?.contentMeta)) throw new Error("LSEG_UNSUPPORTED_HEADLINE_SCHEMA");
      entries.push(...data.data);
      cursor = data.data.length && typeof data.meta?.next === "string" ? data.meta.next : null;
      if (!cursor) break;
      if (seenCursors.has(cursor)) throw new Error("LSEG_REPEATED_CURSOR");
      seenCursors.add(cursor);
    }
    coverageIncomplete = Boolean(cursor);
    if (entries.length && !entries.some(row => [...asArray(row.newsItem.contentMeta.creator), ...asArray(row.newsItem.contentMeta.infoSource)].some(source => source?._qcode === "NS:RTRS" && source?._role === "sRole:source"))) throw new Error("LSEG_REUTERS_SOURCE_UNVERIFIED");
    const byId = new Map();
    for (const row of entries) {
      // Cancellation/removal updates remove a cached version of the same story.
      const item = row?.newsItem;
      const id = item?._guid || (typeof row?.storyId === "string" ? row.storyId.replace(/:\d+$/, "") : "");
      const normalized = normalizeHeadline(row, now(), config.windowMinutes);
      const version = Number(item?._version) || 1;
      const previous = byId.get(id);
      if (id && (!previous || version > previous.version)) byId.set(id, { version, normalized });
    }
    headlines = [...byId.values()].map(item => item.normalized).filter(Boolean).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    lastSuccessAt = now();
    errorCode = null;
    return status();
  }

  function poll() {
    if (requestInFlight) return requestInFlight;
    if (!config.enabled || config.missingCredentials.length || !["v1", "v2"].includes(config.authVersion) || now() < retryAfter) return Promise.resolve(status());
    lastAttemptAt = now();
    requestInFlight = fetchHeadlines().catch(error => {
      errorCode = error.message;
      if (errorCode === "LSEG_HTTP_401") {
        accessToken = null;
        refreshToken = null;
        tokenExpiresAt = 0;
      }
      return status();
    }).finally(() => { requestInFlight = null; });
    return requestInFlight;
  }

  function snapshot() {
    const current = status();
    return {
      ...current,
      headlines: headlines.filter(item => Date.parse(item.publishedAt) >= now() - config.windowMinutes * 60000).map(item => ({ ...item, ageSeconds: Math.max(0, Math.floor((now() - Date.parse(item.publishedAt)) / 1000)), stale: !current.connected }))
    };
  }

  return {
    status,
    snapshot,
    poll,
    authorize: header => readerAuthorized(header, config.readerToken),
    start() {
      if (timer) return;
      void poll();
      timer = setInterval(() => { void poll(); }, config.pollSeconds * 1000);
      timer.unref();
    },
    stop() { clearInterval(timer); timer = null; }
  };
}
