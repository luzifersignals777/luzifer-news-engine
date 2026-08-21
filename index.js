import express from "express";

const app = express();

app.use(express.json({ limit: "50kb" }));

const PORT = process.env.PORT || 10000;

const CALENDAR_BASE_URL =
  process.env.CALENDAR_BASE_URL ||
  "https://economic-calendar-api-h9hr.onrender.com";

const NEWS_WINDOW_MIN =
  Number(process.env.NEWS_WINDOW_MIN || 90);

const POLL_SECONDS =
  Number(process.env.POLL_SECONDS || 30);

let calendar = [];
let rawCalendar = [];
let lastUpdate = null;
let lastError = null;


// =====================================================
// 🇺🇸 SOLO NOTICIAS DE ESTADOS UNIDOS
// =====================================================

const USA_KEYWORDS = [
  "fomc",
  "fed",
  "federal reserve",
  "interest rate",
  "cpi",
  "core cpi",
  "ppi",
  "core ppi",
  "non farm",
  "nonfarm",
  "payroll",
  "unemployment",
  "jobless",
  "retail sales",
  "gdp",
  "pce",
  "core pce",
  "ism",
  "consumer confidence",
  "jolts",
  "adp",
  "powell",
  "fed chair",
  "treasury",
  "durable goods",
  "housing",
  "existing home sales",
  "new home sales",
  "initial jobless claims",
  "continuing jobless claims",
  "pmi",
  "s&p global",
  "baker hughes",
  "cftc",
  "auction",
  "api weekly crude",
  "eia",
  "jackson hole",
  "chicago fed",
  "goods trade balance",
  "wholesale inventories",
  "natural gas",
  "kansas fed"
];


// =====================================================
// ACTIVOS: USD / ORO / WTI / BTC
// =====================================================

const GOLD_KEYWORDS = [
  "gold",
  "bullion",
  "precious metal",
  "safe haven",
  "real yields"
];

const WTI_KEYWORDS = [
  "oil",
  "crude",
  "wti",
  "brent",
  "opec",
  "supply",
  "inventory",
  "production",
  "energy"
];

const BTC_KEYWORDS = [
  "bitcoin",
  "btc",
  "crypto",
  "cryptocurrency",
  "digital asset",
  "digital assets",
  "crypto market"
];

function containsAny(name, keywords) {
  return keywords.some(keyword => name.includes(keyword));
}

function assetFromEvent(event) {
  const name = String(event.event || "").toLowerCase();

  const assets = ["USD"];

  if (containsAny(name, GOLD_KEYWORDS)) {
    assets.push("ORO");
  }

  if (containsAny(name, WTI_KEYWORDS)) {
    assets.push("WTI");
  }

  if (containsAny(name, BTC_KEYWORDS)) {
    assets.push("BTC");
  }

  return assets;
}

function assetState(score) {
  if (score > 0) return "FAVORABLE";
  if (score < 0) return "DESFAVORABLE";
  return "NEUTRAL";
}

function evaluateAssets() {
  const recent = recentNews().slice(0, 20);

  const scores = {
    USD: 0,
    ORO: 0,
    WTI: 0,
    BTC: 0
  };

  const reasons = {
    USD: [],
    ORO: [],
    WTI: [],
    BTC: []
  };

  for (const event of recent) {
    const dir = direction(
      event.event,
      event.actual,
      event.forecast
    );

    const assets = assetFromEvent(event);
    const name =
      String(
        event.event || "Noticia"
      ).trim();

    const impact =
      event.importance >= 3
        ? "ALTO"
        : event.importance === 2
          ? "MEDIO"
          : "BAJO";

    if (dir === "USD_BULLISH") {
      scores.USD += 1;
      scores.ORO -= 1;
      scores.WTI -= 1;
      scores.BTC -= 1;

      reasons.USD.push(
        `${name}: USD fuerte`
      );
      reasons.ORO.push(
        `${name}: presion por USD fuerte`
      );
      reasons.WTI.push(
        `${name}: USD fuerte puede presionar commodities`
      );
      reasons.BTC.push(
        `${name}: USD fuerte / presion sobre riesgo`
      );

      continue;
    }

    if (dir === "USD_BEARISH") {
      scores.USD -= 1;
      scores.ORO += 1;
      scores.WTI += 1;
      scores.BTC += 1;

      reasons.USD.push(
        `${name}: USD debil`
      );
      reasons.ORO.push(
        `${name}: apoyo por USD debil`
      );
      reasons.WTI.push(
        `${name}: USD debil puede apoyar commodities`
      );
      reasons.BTC.push(
        `${name}: USD debil / contexto favorable a riesgo`
      );

      continue;
    }

    if (assets.includes("USD")) {
      reasons.USD.push(
        `${name}: evento ${impact}, sin resultado numerico`
      );
    }

    if (assets.includes("ORO")) {
      reasons.ORO.push(
        `${name}: contexto relevante para oro, sin resultado numerico`
      );
    }

    if (assets.includes("WTI")) {
      reasons.WTI.push(
        `${name}: noticia WTI/energia ${impact}, sin resultado numerico`
      );
    }

    if (assets.includes("BTC")) {
      reasons.BTC.push(
        `${name}: contexto crypto ${impact}, sin resultado numerico`
      );
    }
  }

  return {
    USD: {
      state: assetState(scores.USD),
      reason: reasons.USD[0] || "Sin dato economico reciente suficiente"
    },
    ORO: {
      state: assetState(scores.ORO),
      reason: reasons.ORO[0] || "Sin dato economico reciente suficiente"
    },
    WTI: {
      state: assetState(scores.WTI),
      reason: reasons.WTI[0] || "Sin noticia WTI directa suficiente"
    },
    BTC: {
      state: assetState(scores.BTC),
      reason: reasons.BTC[0] || "Sin dato economico reciente suficiente"
    }
  };
}


// =====================================================
// FUNCIONES AUXILIARES
// =====================================================

function pick(obj, names) {

  for (const name of names) {

    if (
      obj &&
      obj[name] !== undefined &&
      obj[name] !== null
    ) {

      return obj[name];

    }

  }

  return null;

}


function num(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;

  }

  const n = Number(
    String(value)
      .replace(/,/g, "")
      .replace("%", "")
  );

  return Number.isFinite(n) ? n : null;

}


function importance(value) {

  if (typeof value === "number") {

    return value;

  }

  const s =
    String(value ?? "").toLowerCase();


  if (
    s.includes("high") ||
    s.includes("red")
  ) {

    return 3;

  }


  if (
    s.includes("medium") ||
    s.includes("orange")
  ) {

    return 2;

  }


  if (
    s.includes("low") ||
    s.includes("yellow")
  ) {

    return 1;

  }


  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : 0;

}


// =====================================================
// NORMALIZAR NOTICIA
// =====================================================

function normalize(event) {

  return {

    date: pick(event, [
      "date",
      "Date",
      "datetime",
      "Datetime",
      "time",
      "Time",
      "Start",
      "start",
      "startDate",
      "StartDate"
    ]),

    country:
      pick(event, [
        "country",
        "Country",
        "country_code",
        "CountryCode"
      ]) ||
      "United States",

    currency:
      pick(event, [
        "currency",
        "Currency"
      ]) ||
      "USD",

    event:
      pick(event, [
        "event",
        "Event",
        "title",
        "Title",
        "name",
        "Name",
        "category",
        "Category"
      ]) ||
      "",

    actual:
      pick(event, [
        "actual",
        "Actual"
      ]),

    forecast:
      pick(event, [
        "forecast",
        "Forecast",
        "consensus",
        "Consensus"
      ]),

    previous:
      pick(event, [
        "previous",
        "Previous"
      ]),

    importance:
      importance(
        pick(event, [
          "importance",
          "Importance",
          "impact",
          "Impact"
        ])
      ),

    macroCategory:
      pick(event, [
        "macroCategory",
        "MacroCategory",
        "MacroCateg"
      ]),

    impactScore:
      num(
        pick(event, [
          "impactScore",
          "ImpactScore",
          "Impact_score"
        ])
      ),

    release:
      pick(event, [
        "release",
        "Release"
      ]),

    id:
      pick(event, [
        "id",
        "Id"
      ]),

    eventType:
      pick(event, [
        "eventType",
        "EventType",
        "Event_Type"
      ])

  };

}


// =====================================================
// EXTRAER EVENTOS DE LA RESPUESTA
// =====================================================

function unwrap(data) {

  if (Array.isArray(data)) {

    return data;

  }


  if (Array.isArray(data?.events)) {

    return data.events;

  }


  if (Array.isArray(data?.data)) {

    return data.data;

  }


  if (Array.isArray(data?.results)) {

    return data.results;

  }


  return [];

}


// =====================================================
// FILTRO USA
// =====================================================

function isUSA(event) {

  const country =
    String(
      event.country || ""
    ).toLowerCase();


  const currency =
    String(
      event.currency || ""
    ).toUpperCase();


  return (

    country.includes(
      "united states"
    ) ||

    country === "usa" ||

    country === "us" ||

    currency === "USD"

  );

}


// =====================================================
// FILTRO NOTICIAS IMPORTANTES PARA USD / ORO
// =====================================================

function isRelevant(event) {

  const name =
    String(
      event.event || ""
    ).toLowerCase();


  return USA_KEYWORDS.some(
    keyword =>
      name.includes(keyword)
  );

}


// =====================================================
// FECHA
// =====================================================

function eventTime(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return NaN;
  }

  if (typeof value === "number") {
    const ms =
      value < 100000000000
        ? value * 1000
        : value;

    return Number.isFinite(ms)
      ? ms
      : NaN;
  }

  const s =
    String(value).trim();

  if (/^\d+$/.test(s)) {
    const n = Number(s);

    const ms =
      n < 100000000000
        ? n * 1000
        : n;

    return Number.isFinite(ms)
      ? ms
      : NaN;
  }

  const m =
    s.match(
      /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/
    );

  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6]);

    const t =
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute,
        second
      );

    return Number.isFinite(t)
      ? t
      : NaN;
  }

  const t =
    Date.parse(s);

  return Number.isFinite(t)
    ? t
    : NaN;

}


// =====================================================
// DESCARGAR CALENDARIO
// =====================================================

async function fetchCalendar() {

  try {

    const url =
      `${CALENDAR_BASE_URL}/events?country=USA`;


    console.log(
      "Consultando calendario USA..."
    );


    const response =
      await fetch(

        url,

        {
          headers: {
            Accept:
              "application/json"
          }
        }

      );


    if (!response.ok) {

      throw new Error(
        `Calendar HTTP ${response.status}`
      );

    }


    const data =
      await response.json();


    const merged =
      unwrap(data)

        .map(normalize)

        .filter(isUSA)

        .filter(isRelevant);


    const seen =
      new Set();


    calendar =
      merged.filter(event => {

        const key = [

          event.date,
          event.event,
          event.currency,
          event.actual,
          event.forecast,
          event.previous

        ].join("|");


        if (seen.has(key)) {

          return false;

        }


        seen.add(key);

        return true;

      });


    lastUpdate =
      new Date().toISOString();


    lastError = null;


    console.log(
      `Noticias USA cargadas: ${calendar.length}`
    );


  } catch (error) {

    lastError =
      error.message;


    console.error(
      "Calendar update error:",
      error.message
    );

  }

}


// =====================================================
// PRÓXIMAS NOTICIAS
// =====================================================

function upcomingNews() {

  const now =
    Date.now();


  const end =
    now +
    NEWS_WINDOW_MIN *
    60 *
    1000;


  return calendar

    .filter(event => {

      const t =
        eventTime(
          event.date
        );


      return (

        Number.isFinite(t) &&

        t >= now &&

        t <= end

      );

    })

    .sort(

      (a, b) =>

        eventTime(a.date) -
        eventTime(b.date)

    );

}


// =====================================================
// NOTICIAS RECIENTES
// =====================================================

function recentNews() {

  const now =
    Date.now();


  const start =
    now -
    NEWS_WINDOW_MIN *
    60 *
    1000;


  return calendar

    .filter(event => {

      const t =
        eventTime(
          event.date
        );


      return (

        Number.isFinite(t) &&

        t >= start &&

        t <= now

      );

    })

    .sort(

      (a, b) =>

        eventTime(b.date) -
        eventTime(a.date)

    );

}


// =====================================================
// INTERPRETAR NOTICIA
// =====================================================

function direction(
  event,
  actual,
  forecast
) {

  const name =
    String(
      event || ""
    ).toLowerCase();


  const a =
    num(actual);


  const f =
    num(forecast);


  if (
    a === null ||
    f === null
  ) {

    return "UNKNOWN";

  }


  // Datos normalmente USD positivos
  const usdPositive = [

    "non farm",
    "nonfarm",
    "payroll",
    "retail sales",
    "gdp",
    "ism",
    "adp",
    "consumer confidence",
    "durable goods"

  ].some(

    keyword =>
      name.includes(keyword)

  );


  // Datos donde un número menor
  // normalmente significa USD más débil
  const usdNegative = [

    "unemployment",
    "jobless claims",
    "initial jobless",
    "continuing jobless"

  ].some(

    keyword =>
      name.includes(keyword)

  );


  if (usdPositive) {

    if (a > f) {

      return "USD_BULLISH";

    }


    if (a < f) {

      return "USD_BEARISH";

    }


    return "NEUTRAL";

  }


  if (usdNegative) {

    if (a < f) {

      return "USD_BULLISH";

    }


    if (a > f) {

      return "USD_BEARISH";

    }


    return "NEUTRAL";

  }


  return "UNKNOWN";

}


// =====================================================
// EVALUAR SEÑAL EXISTENTE
// =====================================================

function evaluateSignal(signal) {

  const s =
    String(
      signal || ""
    ).toUpperCase();


  const recent =
    recentNews()
      .slice(0, 10);


  const upcoming =
    upcomingNews()
      .slice(0, 10);


  let score = 0;


  const reasons = [];


  for (
    const event of recent
  ) {

    const dir =
      direction(

        event.event,

        event.actual,

        event.forecast

      );


    // ================================================
    // BUY DE LUZIFER
    // ================================================

    if (s === "BUY") {

      if (
        dir ===
        "USD_BEARISH"
      ) {

        score += 2;


        reasons.push(

          `${event.event}: USD débil / favorece BUY`

        );

      }


      else if (
        dir ===
        "USD_BULLISH"
      ) {

        score -= 2;


        reasons.push(

          `${event.event}: USD fuerte / contrario a BUY`

        );

      }

    }


    // ================================================
    // SELL DE LUZIFER
    // ================================================

    if (s === "SELL") {

      if (
        dir ===
        "USD_BULLISH"
      ) {

        score += 2;


        reasons.push(

          `${event.event}: USD fuerte / favorece SELL`

        );

      }


      else if (
        dir ===
        "USD_BEARISH"
      ) {

        score -= 2;


        reasons.push(

          `${event.event}: USD débil / contrario a SELL`

        );

      }

    }

  }


  let confirmation =
    "NEUTRAL";


  if (score >= 2) {

    confirmation =
      "CONFIRMA";

  }


  if (score <= -2) {

    confirmation =
      "CONTRARIA";

  }


  return {

    signal: s,

    confirmation,

    score,

    reasons,

    upcomingHighImpact:

      upcoming.filter(

        event =>
          event.importance >= 3

      ),

    recentNews:
      recent

  };

}


// =====================================================
// HOME
// =====================================================

app.get(
  "/",
  (_req, res) => {

    res.json({

      service:
        "Luzifer 5.8 USA Live News Engine",

      status:
        "running",

      source:
        "public economic calendar",

      country:
        "United States",

      currency:
        "USD",

      lastUpdate,

      lastError

    });

  }

);


// =====================================================
// HEALTH
// =====================================================

app.get(
  "/health",
  (_req, res) => {

    res.json({

      ok: true,

      lastUpdate,

      lastError

    });

  }

);


// =====================================================
// NEWS
// =====================================================

app.get(
  "/news",
  (_req, res) => {

    res.json({

      country:
        "United States",

      currency:
        "USD",

      updatedAt:
        lastUpdate,

      upcoming:
        upcomingNews(),

      recent:
        recentNews(),

      assets:
        evaluateAssets(),

      rawEventCount:
        rawCalendar.length,

      filteredEventCount:
        calendar.length,

      error:
        lastError

    });

  }

);


// =====================================================
// RAW NEWS
// =====================================================

app.get(
  "/news/raw",
  (_req, res) => {
    res.json({
      ok: true,
      updatedAt: lastUpdate,
      totalRawEvents: rawCalendar.length,
      totalFilteredEvents: calendar.length,
      events: calendar.slice(0, 50),
      error: lastError
    });
  }
);


// =====================================================
// DIAGNOSTICO DE LA API ORIGINAL
// =====================================================

app.get(
  "/news/api-raw",
  async (_req, res) => {
    try {
      const url =
        `${CALENDAR_BASE_URL}/events?country=USA`;

      const response =
        await fetch(
          url,
          {
            headers: {
              Accept: "application/json"
            }
          }
        );

      if (!response.ok) {
        return res.status(
          response.status
        ).json({
          ok: false,
          status: response.status,
          error:
            `Calendar HTTP ${response.status}`
        });
      }

      const data =
        await response.json();

      const events =
        unwrap(data);

      res.json({
        ok: true,
        source: url,
        responseType:
          Array.isArray(data)
            ? "array"
            : typeof data,
        totalEvents:
          events.length,
        firstEvents:
          events.slice(0, 10)
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// =====================================================
// NEWS DE 4 ACTIVOS + MOTIVO
// =====================================================

app.get(
  "/news/assets",
  (_req, res) => {
    res.json({
      ok: true,
      indicator: "Luzifer 5.8",
      updatedAt: lastUpdate,
      assets: evaluateAssets(),
      recent: recentNews().slice(0, 20),
      upcoming: upcomingNews().slice(0, 20),
      rawEventCount: rawCalendar.length,
      filteredEventCount: calendar.length,
      error: lastError
    });
  }
);

// =====================================================
// WEBHOOK PARA LUZIFER
// =====================================================

app.post(
  "/webhook",
  (req, res) => {

    const payload =
      req.body || {};


    const signal =
      payload.signal ||
      payload.action ||
      "";


    const result =
      evaluateSignal(
        signal
      );


    res.json({

      ok: true,

      indicator:
        "Luzifer 5.8",

      signal,

      news:
        result,

      assets:
        evaluateAssets()

    });

  }

);


// =====================================================
// INICIAR SERVIDOR
// =====================================================

app.listen(
  PORT,

  async () => {

    console.log(
      `Luzifer USA News Engine listening on ${PORT}`
    );


    await fetchCalendar();


    setInterval(

      fetchCalendar,

      Math.max(
        POLL_SECONDS,
        15
      ) * 1000

    );

  }
);
