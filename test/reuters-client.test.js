import test from "node:test";
import assert from "node:assert/strict";
import { createReutersClient, normalizeHeadline, readerAuthorized } from "../reuters-client.js";

const NOW = Date.parse("2026-10-08T13:00:00Z");
const credentials = { REUTERS_ENABLED: "true", LSEG_USERNAME: "machine-id", LSEG_PASSWORD: " leading+tail ", LSEG_APP_KEY: "test-key", REUTERS_READER_TOKEN: "test-reader-token" };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const story = (id = "gold-story", version = 1, overrides = {}) => ({
  storyId: `urn:newsml:reuters.com:20261008:${id}:${version}`,
  newsItem: {
    _guid: id, _version: version,
    itemMeta: { title: [{ $: "Gold rises ahead of Fed remarks" }], versionCreated: { $: new Date(NOW - 30000).toISOString() }, pubStatus: { _qcode: "stat:usable" } },
    contentMeta: { creator: [{ _qcode: "NS:RTRS", _role: "sRole:source" }], subject: [{ _qcode: "N2:GOL" }], urgency: { $: 3 } },
    ...overrides
  }
});

test("Missing credentials and disabled mode never contact the provider", async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error("unexpected call"); };
  const missing = createReutersClient({ env: { REUTERS_ENABLED: "true" }, fetchImpl });
  assert.equal((await missing.poll()).state, "not_configured");
  assert.deepEqual(missing.status().missingCredentials, ["LSEG_USERNAME", "LSEG_PASSWORD", "LSEG_APP_KEY"]);
  const disabled = createReutersClient({ env: { ...credentials, REUTERS_ENABLED: "false" }, fetchImpl });
  assert.equal((await disabled.poll()).state, "disabled");
  assert.equal(calls, 0);
});

test("V1 authenticates without taking control of existing sessions and requests only Reuters", async () => {
  const calls = [];
  const client = createReutersClient({ env: credentials, now: () => NOW, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? json({ access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 300 }) : json({ data: [story()] });
  } });
  assert.equal((await client.poll()).state, "connected");
  const body = calls[0].options.body;
  assert.equal(body.get("grant_type"), "password");
  assert.equal(body.get("password"), credentials.LSEG_PASSWORD);
  assert.equal(body.get("takeExclusiveSignOnControl"), "false");
  assert.equal(calls[0].options.redirect, "error");
  const request = new URL(calls[1].url);
  assert.equal(request.pathname, "/data/news/v1/headlines");
  assert.equal(request.searchParams.get("query"), "Source:RTRS AND (Language:LEN)");
  assert.equal(request.searchParams.get("limit"), "100");
  assert.equal(calls[1].options.headers.Authorization, "Bearer access-secret");
  assert.equal(client.snapshot().headlines[0].source, "Reuters");
  assert.equal(client.snapshot().headlines[0].ageSeconds, 30);
  assert.equal(JSON.stringify(client.status()).includes("access-secret"), false);
});

test("V2 uses service credentials rather than a desktop app key", async () => {
  let body;
  const client = createReutersClient({ env: { REUTERS_ENABLED: "true", LSEG_CLIENT_ID: "service-id", LSEG_CLIENT_SECRET: "service-secret" }, now: () => NOW, fetchImpl: async (url, options) => {
    if (String(url).includes("/token")) { body = options.body; assert.match(String(url), /\/v2\/token$/); return json({ access_token: "token", expires_in: 300 }); }
    return json({ data: [] });
  } });
  assert.equal((await client.poll()).state, "connected");
  assert.equal(body.get("grant_type"), "client_credentials");
  assert.equal(body.get("client_id"), "service-id");
  assert.equal(body.get("client_secret"), "service-secret");
  assert.equal(body.has("username"), false);
});

test("Expired V1 tokens are renewed with refresh tokens", async () => {
  let current = NOW;
  const grants = [];
  const client = createReutersClient({ env: credentials, now: () => current, fetchImpl: async (url, options) => {
    if (String(url).includes("/token")) { grants.push(options.body.get("grant_type")); return json({ access_token: "token", refresh_token: "refresh", expires_in: 300 }); }
    return json({ data: [] });
  } });
  await client.poll();
  current += 301000;
  await client.poll();
  assert.deepEqual(grants, ["password", "refresh_token"]);
});

test("Only verified Reuters items with valid recent timestamps survive normalization", () => {
  assert.equal(normalizeHeadline(story(), NOW, 90).sourceCode, "NS:RTRS");
  const unrelated = story("other", 1, { contentMeta: { creator: [{ _qcode: "NS:OTHER", _role: "sRole:source" }] } });
  assert.equal(normalizeHeadline(unrelated, NOW, 90), null);
  const invalid = story(); invalid.newsItem.itemMeta.versionCreated = { $: "unknown" };
  assert.equal(normalizeHeadline(invalid, NOW, 90), null);
  invalid.newsItem.itemMeta.versionCreated = { $: new Date(NOW + 120000).toISOString() };
  assert.equal(normalizeHeadline(invalid, NOW, 90), null);
  invalid.newsItem.itemMeta.versionCreated = { $: new Date(NOW - 91 * 60000).toISOString() };
  assert.equal(normalizeHeadline(invalid, NOW, 90), null);
});

test("Newer versions replace duplicates and cancellation updates remove old headlines", async () => {
  const removed = story("withdrawn", 2); removed.newsItem.itemMeta.pubStatus = { _qcode: "stat:canceled" };
  const client = createReutersClient({ env: credentials, now: () => NOW, fetchImpl: async url => String(url).includes("/token") ? json({ access_token: "token", expires_in: 300 }) : json({ data: [story("updated", 1), story("updated", 2), story("withdrawn", 1), removed] }) });
  await client.poll();
  assert.deepEqual(client.snapshot().headlines.map(item => [item.id, item.version]), [["updated", 2]]);
});

test("Failed refreshes retain cached headlines as stale and never expose provider error bodies", async () => {
  let fail = false;
  const client = createReutersClient({ env: credentials, now: () => NOW, fetchImpl: async url => {
    if (String(url).includes("/token")) return json({ access_token: "token", expires_in: 300 });
    return fail ? json({ secret: "do-not-expose-this-provider-body" }, 403) : json({ data: [story()] });
  } });
  await client.poll();
  fail = true;
  const status = await client.poll();
  assert.equal(status.state, "unavailable");
  assert.equal(status.errorCode, "LSEG_HTTP_403");
  assert.equal(client.snapshot().headlines[0].stale, true);
  assert.equal(JSON.stringify(client.snapshot()).includes("do-not-expose"), false);
});

test("A stale connection cannot be represented as current", async () => {
  let current = NOW;
  const client = createReutersClient({ env: credentials, now: () => current, fetchImpl: async url => String(url).includes("/token") ? json({ access_token: "token", expires_in: 300 }) : json({ data: [story()] }) });
  await client.poll();
  current += 181000;
  assert.equal(client.status().state, "stale");
  assert.equal(client.status().connected, false);
});

test("A malformed response cannot establish a news connection", async () => {
  const client = createReutersClient({ env: credentials, now: () => NOW, fetchImpl: async url => String(url).includes("/token") ? json({ access_token: "token", expires_in: 300 }) : json({ wrongShape: [] }) });
  assert.equal((await client.poll()).errorCode, "LSEG_INVALID_HEADLINES");
  assert.equal(client.status().connected, false);
});

test("An unsupported schema or unrelated news provider cannot masquerade as Reuters", async () => {
  for (const [data, code] of [[[{ headline: "Unknown format" }], "LSEG_UNSUPPORTED_HEADLINE_SCHEMA"], [[story("other", 1, { contentMeta: { creator: [{ _qcode: "NS:OTHER", _role: "sRole:source" }] } })], "LSEG_REUTERS_SOURCE_UNVERIFIED"]]) {
    const client = createReutersClient({ env: credentials, now: () => NOW, fetchImpl: async url => String(url).includes("/token") ? json({ access_token: "token", expires_in: 300 }) : json({ data }) });
    assert.equal((await client.poll()).errorCode, code);
    assert.equal(client.status().connected, false);
  }
});

test("Rate limits delay the next request", async () => {
  let calls = 0;
  const client = createReutersClient({ env: credentials, now: () => NOW, fetchImpl: async () => { calls++; return json({}, 429, { "retry-after": "120" }); } });
  assert.equal((await client.poll()).errorCode, "LSEG_HTTP_429");
  await client.poll();
  assert.equal(calls, 1);
});

test("Pagination is bounded and incomplete coverage remains visible", async () => {
  let page = 0;
  const client = createReutersClient({ env: credentials, now: () => NOW, fetchImpl: async url => {
    if (String(url).includes("/token")) return json({ access_token: "token", expires_in: 300 });
    page++;
    return json({ data: [story(`page-${page}`)], meta: { next: `cursor-${page}` } });
  } });
  const status = await client.poll();
  assert.equal(page, 3);
  assert.equal(status.coverageIncomplete, true);
  assert.equal(status.headlineCount, 3);
});

test("Concurrent polls share one request and reader authentication requires a separate token", async () => {
  let resolveAuth;
  const client = createReutersClient({ env: credentials, now: () => NOW, fetchImpl: async url => String(url).includes("/token") ? new Promise(resolve => { resolveAuth = resolve; }) : json({ data: [] }) });
  const first = client.poll();
  const second = client.poll();
  assert.equal(first, second);
  resolveAuth(json({ access_token: "token", expires_in: 300 }));
  await first;
  assert.equal(client.authorize("Bearer test-reader-token"), true);
  assert.equal(client.authorize("Bearer access-secret"), false);
  assert.equal(readerAuthorized(undefined, "test"), false);
  assert.equal(readerAuthorized("Bearer test", ""), false);
});
