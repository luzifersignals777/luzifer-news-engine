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
  "continuing jobless claims"


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

function eventBias(event) {

  const name =
    String(event.event || "").toLowerCase();

  const macro =
    String(event.macroCategory || "").toLowerCase();

  // Estos son BIASES PREVIOS, no resultados publicados.
  // La API actual no entrega actual/forecast/previous.

  if (
    name.includes("unemployment") ||
    name.includes("jobless claims") ||
    name.includes("initial jobless") ||
    name.includes("continuing jobless")
  ) {
    return {
      usd: "FAVORABLE",
      reason: "Mercado laboral: un dato mejor de lo esperado tendería a favorecer al USD; falta el resultado real."
    };
  }

  if (
    name.includes("non farm") ||
    name.includes("nonfarm") ||
    name.includes("payroll") ||
    name.includes("adp")
  ) {
    return {
      usd: "FAVORABLE",
      reason: "Empleo de EE.UU.: un resultado fuerte tendería a favorecer al USD; falta el resultado real."
    };
  }

  if (
    name.includes("cpi") ||
    name.includes("ppi") ||
    name.includes("pce") ||
    macro.includes("inflation")
  ) {
    return {
      usd: "FAVORABLE",
      reason: "Inflación: una lectura alta puede reforzar expectativas de tasas; falta el resultado real."
    };
  }

  if (
    name.includes("fomc") ||
    name.includes("fed") ||
    name.includes("interest rate") ||
    macro.includes("monetary policy") ||
    name.includes("powell")
  ) {
    return {
      usd: "NEUTRAL",
      reason: "Evento de política monetaria: el sesgo depende del tono y del resultado; falta información del comunicado."
    };
  }

  if (
    name.includes("gdp") ||
    name.includes("pmi") ||
    name.includes("retail sales") ||
    name.includes("durable goods") ||
    name.includes("consumer confidence") ||
    macro.includes("growth") ||
    macro.includes("confidence")
  ) {
    return {
      usd: "FAVORABLE",
      reason: "Crecimiento/confianza: un resultado fuerte tendería a favorecer al USD; falta el resultado real."
    };
  }

  return {
    usd: "NEUTRAL",
    reason: "Evento USA sin resultado publicado suficiente para determinar dirección."
  };
}


function biasStateForAsset(event, asset) {

  const bias = eventBias(event);

  if (asset === "USD") {
    return {
      state: bias.usd,
      reason: bias.reason
    };
  }

  if (asset === "ORO") {

    if (bias.usd === "FAVORABLE") {
      return {
        state: "DESFAVORABLE",
        reason: "Sesgo previo de USD favorable; normalmente representa presión para el oro, pero falta el resultado real."
      };
    }

    if (bias.usd === "DESFAVORABLE") {
      return {
        state: "FAVORABLE",
        reason: "Sesgo previo de USD débil; normalmente puede apoyar al oro, pero falta el resultado real."
      };
    }

    return {
      state: "NEUTRAL",
      reason: bias.reason
    };
  }

  if (asset === "WTI") {

    const name =
      String(event.event || "").toLowerCase();

    if (
      name.includes("crude oil") ||
      name.includes("oil rig") ||
      name.includes("oil stock") ||
      name.includes("oil") ||
      name.includes("opec")
    ) {
      return {
        state: "NEUTRAL",
        reason: "Evento directo de petróleo detectado; esta fuente no entrega el resultado para determinar dirección."
      };
    }

    return {
      state: bias.usd === "FAVORABLE"
        ? "DESFAVORABLE"
        : bias.usd === "DESFAVORABLE"
          ? "FAVORABLE"
          : "NEUTRAL",
      reason: "Contexto USD para commodity; no sustituye datos directos de petróleo."
    };
  }

  if (asset === "BTC") {

    if (bias.usd === "FAVORABLE") {
      return {
        state: "DESFAVORABLE",
        reason: "Sesgo previo de USD favorable puede ejercer presión sobre activos de riesgo; falta el resultado real."
      };
    }

    if (bias.usd === "DESFAVORABLE") {
      return {
        state: "FAVORABLE",
        reason: "Sesgo previo de USD débil puede favorecer activos de riesgo; falta el resultado real."
      };
    }

    return {
      state: "NEUTRAL",
      reason: "Sin evento específico de BTC suficiente en este calendario."
    };
  }

  return {
    state: "NEUTRAL",
    reason: "Sin información suficiente."
  };
}


function evaluateAssets() {

  const events =
    [...upcomingNews(), ...recentNews()]
      .sort(
        (a, b) =>
          eventTime(a.date) -
          eventTime(b.date)
      );

  const assets = [
    "USD",
    "ORO",
    "WTI",
    "BTC"
  ];

  const result = {};

  for (const asset of assets) {

    const candidates =
      events
        .map(event => ({
          event,
          bias:
            biasStateForAsset(
              event,
              asset
            )
        }))
        .filter(item =>
          item.bias.state !== "NEUTRAL"
        );

    if (candidates.length > 0) {

      const item =
        candidates[0];

      result[asset] = {
        state:
          item.bias.state,
        reason:
          item.bias.reason,
        event:
          item.event.event,
        date:
          item.event.date,
        impact:
          item.event.importance,
        macroCategory:
          item.event.macroCategory
      };

    } else {

      result[asset] = {
        state: "NEUTRAL",
        reason:
          asset === "BTC"
            ? "Sin evento específico de BTC suficiente en este calendario."
            : "Sin información direccional suficiente."
      };
    }
  }

  return result;

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
// API REAL: Start / Name / Impact / Currency / MacroCateg
// =====================================================

function normalize(event) {

  const start =
    pick(event, [
      "Start",
      "start",
      "date",
      "Date",
      "datetime",
      "Datetime",
      "time",
      "Time"
    ]);

  const name =
    pick(event, [
      "Name",
      "name",
      "event",
      "Event",
      "title",
      "Title",
      "category",
      "Category"
    ]) || "";

  const impactValue =
    pick(event, [
      "Impact",
      "impact",
      "importance",
      "Importance"
    ]);

  return {

    id:
      pick(event, ["Id", "id"]),

    date: start,

    country:
      pick(event, [
        "Country",
        "country",
        "country_code",
        "CountryCode"
      ]) || "USA",

    currency:
      pick(event, [
        "Currency",
        "currency"
      ]) || "USD",

    event: name,

    actual:
      pick(event, [
        "Actual",
        "actual"
      ]),

    forecast:
      pick(event, [
        "Forecast",
        "forecast",
        "Consensus",
        "consensus"
      ]),

    previous:
      pick(event, [
        "Previous",
        "previous"
      ]),

    release:
      pick(event, [
        "Release",
        "release"
      ]),

    eventType:
      pick(event, [
        "Event_Type",
        "EventType",
        "Type",
        "type"
      ]),

    macroCategory:
      pick(event, [
        "MacroCateg",
        "macroCateg",
        "MacroCategory",
        "category"
      ]) || "",

    impactScore:
      num(
        pick(event, [
          "Impact_score",
          "impact_score",
          "ImpactScore"
        ])
      ),

    importance:
      importance(impactValue)

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
// FECHA ROBUSTA DE LA API
// Formato real: MM/DD/YYYY HH:mm:ss
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

  const s = String(value).trim();

  // ISO / formatos reconocidos por Date.parse
  const direct = Date.parse(s);

  if (Number.isFinite(direct)) {
    return direct;
  }

  // API real: MM/DD/YYYY HH:mm:ss
  const m =
    s.match(
      /^(\\d{2})\\/(\\d{2})\\/(\\d{4})\\s+(\\d{2}):(\\d{2})(?::(\\d{2}))?$/
    );

  if (m) {

    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    const hour = Number(m[4]);
    const minute = Number(m[5]);
    const second = Number(m[6] || 0);

    return new Date(
      year,
      month - 1,
      day,
      hour,
      minute,
      second
    ).getTime();
  }

  return NaN;

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

    // Guardamos la respuesta original para diagnóstico.
    rawCalendar = unwrap(data);

    const merged =
      rawCalendar
        .map(normalize)
        .filter(isUSA)
        .filter(isRelevant);

    const seen = new Set();

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
      `Eventos crudos: ${rawCalendar.length}`
    );

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

      error:
        lastError

    });

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
// DIAGNOSTICO DE API ORIGINAL
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
              Accept:
                "application/json"
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
// NEWS RAW NORMALIZADA
// =====================================================

app.get(
  "/news/raw",
  (_req, res) => {

    res.json({
      ok: true,
      updatedAt: lastUpdate,
      totalRawEvents:
        rawCalendar.length,
      totalFilteredEvents:
        calendar.length,
      events:
        calendar.slice(0, 50),
      error:
        lastError
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
