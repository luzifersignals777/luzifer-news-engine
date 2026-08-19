import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '32kb' }));

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.WEBHOOK_TOKEN || '';
const TE_KEY = process.env.TRADING_ECONOMICS_API_KEY || '';
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 30);
const LOOKAHEAD_MINUTES = Number(process.env.LOOKAHEAD_MINUTES || 180);
const RECENT_MINUTES = Number(process.env.RECENT_MINUTES || 45);
const MIN_IMPORTANCE = Number(process.env.MIN_IMPORTANCE || 2);
const COUNTRIES = (process.env.COUNTRIES || 'United States').split(',').map(x => x.trim()).filter(Boolean);

let calendar = [];
let lastRefresh = null;
let lastRefreshError = null;
let lastSignals = [];

function isoDate(d) { return d.toISOString().slice(0, 10); }

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).replace(/,/g, '').replace(/%/g, '').trim();
  const m = s.match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function eventDirection(event) {
  const name = `${event.Event || ''} ${event.Category || ''}`.toLowerCase();
  const actual = cleanNumber(event.Actual);
  const forecast = cleanNumber(event.Forecast ?? event.TEForecast);
  if (actual === null || forecast === null) return { bias: 0, surprise: null, reason: 'Sin actual/forecast' };
  const diff = actual - forecast;
  if (Math.abs(diff) < 1e-12) return { bias: 0, surprise: 0, reason: 'En línea con forecast' };

  // For XAUUSD: stronger USD macro data is generally bearish for gold;
  // weaker USD data is generally bullish. This is intentionally used only
  // to CONFIRM/WEAKEN an already-existing Luzifer BUY/SELL.
  const lowerIsBullGold = [
    'inflation', 'cpi', 'consumer price', 'ppi', 'producer price',
    'interest rate', 'fed', 'policy rate', 'retail sales', 'gdp',
    'manufacturing pmi', 'services pmi', 'composite pmi', 'consumer confidence',
    'business confidence', 'durable goods', 'industrial production', 'ism'
  ];
  const higherIsBullGold = [
    'unemployment', 'jobless claims'
  ];

  let goldBias = 0;
  if (higherIsBullGold.some(k => name.includes(k))) {
    goldBias = diff > 0 ? 1 : -1;
  } else if (name.includes('non farm') || name.includes('payroll')) {
    goldBias = diff < 0 ? 1 : -1;
  } else if (lowerIsBullGold.some(k => name.includes(k))) {
    goldBias = diff < 0 ? 1 : -1;
  }

  return { bias: goldBias, surprise: diff, reason: goldBias > 0 ? 'Dato favorece oro' : goldBias < 0 ? 'Dato favorece USD / presiona oro' : 'Sin sesgo configurado' };
}

async function refreshCalendar() {
  if (!TE_KEY) {
    lastRefreshError = 'Falta TRADING_ECONOMICS_API_KEY';
    return;
  }
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const rows = [];
    for (const country of COUNTRIES) {
      const url = `https://api.tradingeconomics.com/calendar/country/${encodeURIComponent(country)}/${isoDate(now)}/${isoDate(end)}?c=${encodeURIComponent(TE_KEY)}&f=json`;
      const r = await axios.get(url, { timeout: 8000 });
      if (Array.isArray(r.data)) rows.push(...r.data);
    }
    calendar = rows.filter(e => Number(e.Importance || 0) >= MIN_IMPORTANCE);
    lastRefresh = new Date().toISOString();
    lastRefreshError = null;
  } catch (err) {
    lastRefreshError = err?.response?.data || err.message;
  }
}

function relevantEvents() {
  const now = Date.now();
  const from = now - RECENT_MINUTES * 60_000;
  const to = now + LOOKAHEAD_MINUTES * 60_000;
  return calendar
    .map(e => ({ e, date: parseDate(e.Date) }))
    .filter(x => x.date && x.date.getTime() >= from && x.date.getTime() <= to)
    .sort((a, b) => Math.abs(a.date - now) - Math.abs(b.date - now));
}

function evaluateSignal(signal) {
  const action = signal.action;
  const now = Date.now();
  const events = relevantEvents();
  const scored = events.map(({ e, date }) => {
    const mins = (date.getTime() - now) / 60000;
    const released = mins <= 0;
    const direction = released ? eventDirection(e) : { bias: 0, surprise: null, reason: 'Evento futuro' };
    const weight = Math.max(1, Number(e.Importance || 1));
    return {
      event: e.Event,
      category: e.Category,
      country: e.Country,
      currency: e.Currency || (String(e.Country || '').toLowerCase().includes('united states') ? 'USD' : ''),
      importance: Number(e.Importance || 0),
      time: e.Date,
      minutesFromNow: Number(mins.toFixed(1)),
      actual: e.Actual ?? null,
      forecast: e.Forecast ?? e.TEForecast ?? null,
      previous: e.Previous ?? null,
      surprise: direction.surprise,
      goldBias: direction.bias,
      reason: direction.reason,
      released
    };
  });

  const released = scored.filter(x => x.released && x.goldBias !== 0);
  const upcomingHigh = scored.filter(x => !x.released && x.importance >= 3).sort((a,b) => a.minutesFromNow-b.minutesFromNow)[0] || null;
  const recentHigh = released.filter(x => x.importance >= 3).sort((a,b) => Math.abs(a.minutesFromNow)-Math.abs(b.minutesFromNow))[0] || null;

  let newsScore = 0;
  for (const e of released.slice(0, 10)) newsScore += e.goldBias * e.importance;

  let confirmation = 'NEUTRAL';
  if (action === 'BUY' && newsScore > 0) confirmation = 'CONFIRMED';
  if (action === 'BUY' && newsScore < 0) confirmation = 'CONTRARY';
  if (action === 'SELL' && newsScore < 0) confirmation = 'CONFIRMED';
  if (action === 'SELL' && newsScore > 0) confirmation = 'CONTRARY';

  return {
    action,
    symbol: signal.symbol,
    price: signal.price,
    confirmation,
    newsScore,
    upcomingHighImpact: upcomingHigh,
    recentHighImpact: recentHigh,
    events: scored.slice(0, 10),
    generatedAt: new Date().toISOString(),
    note: 'Las noticias confirman o debilitan una señal existente; no generan BUY/SELL.'
  };
}

app.get('/health', (_req, res) => res.json({ ok: true, lastRefresh, lastRefreshError, events: calendar.length }));
app.get('/api/status', (_req, res) => res.json({ lastRefresh, lastRefreshError, events: relevantEvents().slice(0, 20), lastSignals }));

app.post('/webhook/tradingview', (req, res) => {
  if (!TOKEN || req.body?.token !== TOKEN) return res.status(401).json({ ok: false, error: 'Invalid token' });
  const result = evaluateSignal(req.body);
  lastSignals.unshift(result);
  lastSignals = lastSignals.slice(0, 20);
  console.log(JSON.stringify(result));
  res.json({ ok: true, ...result });
});

app.listen(PORT, async () => {
  console.log(`Luzifer 5.8 News Engine listening on :${PORT}`);
  await refreshCalendar();
  setInterval(refreshCalendar, POLL_SECONDS * 1000);
});
