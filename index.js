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
let lastWebhook = null;


// =====================================================
// 🇺🇸 SOLO NOTICIAS DE ESTADOS UNIDOS
// =====================================================

const USA_KEYWORDS = [
  "consumer price index",
  "core consumer price index",
  "cpi",
  "producer price index",
  "core producer price index",
  "ppi",
  "nonfarm payrolls",
  "non farm payrolls",
  "nonfarm",
  "unemployment rate",
  "average hourly earnings",
  "jolts job openings",
  "retail sales",
  "ism manufacturing pmi",
  "ism services pmi",
  "ism",
  "federal funds rate",
  "interest rate decision",
  "fed interest rate decision",
  "s&p global composite pmi",
  "s&p global manufacturing pmi",
  "s&p global services pmi",
  "baker hughes us oil rig count",
  "cftc gold nc net positions",
  "cftc oil nc net positions",
  "cftc s&p 500 nc net positions",
  "3-month bill auction",
  "6-month bill auction",
  "adp employment change 4-week average",
  "redbook index",
  "housing price index",
  "case-shiller",
  "consumer confidence",
  "new home sales",
  "richmond fed manufacturing index",
  "2-year note auction",
  "api weekly crude oil stock",
  "mba mortgage applications",
  "core personal consumption expenditures",
  "personal consumption expenditures - price index",
  "personal consumption expenditures prices",
  "durable goods orders",
  "gross domestic product",
  "gdp price index",
  "nondefense capital goods orders ex aircraft",
  "personal income",
  "personal spending",
  "eia crude oil stocks change",
  "eia distillate stocks change",
  "eia gasoline stocks change",
  "eia heating oil stocks change",
  "5-year note auction",
  "jackson hole symposium",
  "chicago fed national activity index",
  "continuing jobless claims",
  "goods trade balance",
  "initial jobless claims",
  "wholesale inventories",
  "eia natural gas storage change",
  "kansas fed manufacturing activity",
  "4-week bill auction",
  "7-year note auction"
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
    DXY: 0,
    ORO: 0,
    WTI: 0,
    BTC: 0
  };

  const reasons = {
    USD: [],
    DXY: [],
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
      scores.DXY += 1;
      scores.ORO -= 1;
      scores.WTI -= 1;
      scores.BTC -= 1;

      reasons.USD.push(
        `${name}: USD fuerte`
      );

      reasons.DXY.push(
        `${name}: USD fuerte / favorece DXY`
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
      scores.DXY -= 1;
      scores.ORO += 1;
      scores.WTI += 1;
      scores.BTC += 1;

      reasons.USD.push(
        `${name}: USD debil`
      );

      reasons.DXY.push(
        `${name}: USD debil / presiona DXY`
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

      reasons.DXY.push(
        `${name}: evento USD ${impact}, sin resultado numerico`
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

    DXY: {
      state: assetState(scores.DXY),
      reason: reasons.DXY[0] || "Sin dato economico reciente suficiente para DXY"
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


    const normalized =
      unwrap(data).map(normalize);

    rawCalendar = normalized.slice();

    const merged =
      normalized
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

  // Datos donde un resultado MAYOR al forecast
  // suele apoyar al USD/DXY.
  const usdPositive = [
    "non farm",
    "nonfarm",
    "payroll",
    "average hourly earnings",
    "jolts",
    "retail sales",
    "gdp",
    "ism",
    "pmi",
    "adp",
    "consumer confidence",
    "durable goods",
    "personal income",
    "personal spending",
    "cpi",
    "consumer price index",
    "ppi",
    "producer price index",
    "personal consumption expenditures",
    "pce",
    "interest rate",
    "federal funds rate"
  ].some(
    keyword =>
      name.includes(keyword)
  );

  // Datos donde un resultado MENOR al forecast
  // suele apoyar al USD/DXY.
  const usdInverse = [
    "unemployment",
    "jobless claims",
    "initial jobless",
    "continuing jobless"
  ].some(
    keyword =>
      name.includes(keyword)
  );

  if (usdPositive) {
    if (a > f) return "USD_BULLISH";
    if (a < f) return "USD_BEARISH";
    return "NEUTRAL";
  }

  if (usdInverse) {
    if (a < f) return "USD_BULLISH";
    if (a > f) return "USD_BEARISH";
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

  // =====================================================
  // CONFIRMACION POR NOTICIAS RECIENTES
  // =====================================================
  for (const event of recent) {

    const dir =
      direction(
        event.event,
        event.actual,
        event.forecast
      );

    if (s === "BUY") {
      if (dir === "USD_BEARISH") {
        score += 2;
        reasons.push(
          `${event.event}: USD debil / favorece BUY`
        );
      } else if (dir === "USD_BULLISH") {
        score -= 2;
        reasons.push(
          `${event.event}: USD fuerte / contrario a BUY`
        );
      }
    }

    if (s === "SELL") {
      if (dir === "USD_BULLISH") {
        score += 2;
        reasons.push(
          `${event.event}: USD fuerte / favorece SELL`
        );
      } else if (dir === "USD_BEARISH") {
        score -= 2;
        reasons.push(
          `${event.event}: USD debil / contrario a SELL`
        );
      }
    }
  }

  // =====================================================
  // CONTEXTO DXY
  // Se deriva de las mismas noticias USD y por eso NO
  // vuelve a sumar/restar al score para evitar doble conteo.
  // =====================================================
  const assetContext = evaluateAssets();
  const dxyState =
    assetContext?.DXY?.state || "NEUTRAL";

  if (s === "BUY") {
    if (dxyState === "DESFAVORABLE") {
      reasons.push(
        "DXY por noticias: debil / contexto favorable a BUY"
      );
    } else if (dxyState === "FAVORABLE") {
      reasons.push(
        "DXY por noticias: fuerte / contexto contrario a BUY"
      );
    }
  }

  if (s === "SELL") {
    if (dxyState === "FAVORABLE") {
      reasons.push(
        "DXY por noticias: fuerte / contexto favorable a SELL"
      );
    } else if (dxyState === "DESFAVORABLE") {
      reasons.push(
        "DXY por noticias: debil / contexto contrario a SELL"
      );
    }
  }

  let confirmation = "NEUTRAL";

  if (score >= 2) {
    confirmation = "CONFIRMA";
  }

  if (score <= -2) {
    confirmation = "CONTRARIA";
  }

  let dxyEffect = "NEUTRAL";

  if (s === "BUY") {
    if (dxyState === "DESFAVORABLE") {
      dxyEffect = "CONFIRMA_BUY";
    } else if (dxyState === "FAVORABLE") {
      dxyEffect = "CONTRADICE_BUY";
    }
  }

  if (s === "SELL") {
    if (dxyState === "FAVORABLE") {
      dxyEffect = "CONFIRMA_SELL";
    } else if (dxyState === "DESFAVORABLE") {
      dxyEffect = "CONTRADICE_SELL";
    }
  }

  return {
    signal: s,
    confirmation,
    score,
    dxy: {
      state: dxyState,
      effect: dxyEffect
    },
    reasons,
    upcomingHighImpact:
      upcoming.filter(
        event => event.importance >= 3
      ),
    recentNews: recent
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
      error: lastError
    });
  }
);

// =====================================================
// PRUEBAS RAPIDAS BUY / SELL
// =====================================================

app.get(
  "/test/buy",
  (_req, res) => {
    const result = evaluateSignal("BUY");

    res.json({
      ok: true,
      indicator: "Luzifer 5.8",
      test: "BUY",
      result,
      assets: evaluateAssets()
    });
  }
);

app.get(
  "/test/sell",
  (_req, res) => {
    const result = evaluateSignal("SELL");

    res.json({
      ok: true,
      indicator: "Luzifer 5.8",
      test: "SELL",
      result,
      assets: evaluateAssets()
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

    lastWebhook = {
      receivedAt:
        new Date().toISOString(),

      signal:
        String(signal || "").toUpperCase(),

      payload,

      result,

      assets:
        evaluateAssets()
    };

    res.json({

      ok: true,

      indicator:
        "Luzifer 5.8",

      signal,

      news:
        result,

      assets:
        lastWebhook.assets

    });

  }

);


// =====================================================
// ULTIMA SENAL RECIBIDA DESDE TRADINGVIEW
// =====================================================

app.get(
  "/webhook/last",
  (_req, res) => {

    if (!lastWebhook) {
      return res.json({
        ok: true,
        indicator: "Luzifer 5.8",
        message: "Todavia no se ha recibido ninguna senal por /webhook",
        lastWebhook: null
      });
    }

    res.json({
      ok: true,
      indicator: "Luzifer 5.8",
      lastWebhook
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
