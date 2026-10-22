import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { simpleMovingAverage, relativeStrengthIndex, averageTrueRange } from "../api/_lib/strategy/indicators.js";
import { evaluateBaselineStrategy, STRATEGY_NAME, StrategyInputError } from "../api/_lib/strategy/engine.js";
import strategyHandler from "../api/private/strategy.js";
import { hashPassword, clearAuthState } from "../api/_lib/auth.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { clearMarketDataRateLimit } from "../api/_lib/market-data/rate-limit.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import loginHandler from "../api/auth/login.js";

const now = new Date("2026-10-21T12:00:00.000Z");
const strategyConfig = Object.freeze({ fastMaPeriod: 10, slowMaPeriod: 30, rsiPeriod: 14, atrPeriod: 14, minRewardRisk: 1.5, maxSpreadPips: 3, minAtrPips: 2, stopAtrMultiplier: 1.5, quoteMaxAgeSeconds: 120 });

function makeCandles(direction = 1, count = 60) {
  let price = 1.1;
  const candles = [];
  for (let index = 0; index < count; index += 1) {
    const phase = index % 14;
    const change = direction * (phase < 7 ? 0.001 : -0.0005);
    const open = price;
    price += change;
    candles.push({ timestamp: new Date(now.getTime() - (count - index) * 900_000).toISOString(), open, high: Math.max(open, price) + 0.0005, low: Math.min(open, price) - 0.0005, close: price });
  }
  return candles;
}

function makeQuote(candles, overrides = {}) {
  return { price: candles.at(-1).close + 0.0001, timestamp: "2026-10-21T11:59:00.000Z", source: "fixture", dataMode: "live", spread: 0.0001, freshness: { status: "fresh" }, ...overrides };
}

test("indicators have deterministic values and explicit warm-up periods", () => {
  assert.deepEqual(simpleMovingAverage([1, 2, 3, 4], 3), [null, null, 2, 3]);
  const rsi = relativeStrengthIndex([1, 2, 1, 2, 1, 2, 1, 2, 1, 2], 5);
  assert.deepEqual(rsi.slice(0, 5), [null, null, null, null, null]);
  assert.equal(typeof rsi[5], "number");
  const candles = makeCandles();
  const atr = averageTrueRange(candles, 14);
  assert.equal(atr.slice(0, 13).every((value) => value === null), true);
  assert.equal(atr[13] > 0, true);
});

test("baseline strategy produces deterministic BUY and SELL candidates with evidence", () => {
  for (const [direction, expected] of [[1, "BUY"], [-1, "SELL"]]) {
    const candles = makeCandles(direction);
    const candidate = evaluateBaselineStrategy({ symbol: "EUR/USD", timeframe: "M15", candles, quote: makeQuote(candles), strategyConfig, now });
    assert.equal(candidate.direction, expected);
    assert.equal(candidate.status, "informational");
    assert.equal(candidate.approvalState, "not_approved");
    assert.equal(candidate.executionState, "not_executed");
    assert.equal(candidate.signalStatus, "confirmed");
    assert.equal(candidate.strategy.name, STRATEGY_NAME);
    assert.equal(candidate.reasons.length >= 3, true);
    assert.equal(candidate.stopLoss.value > 0, true);
    assert.equal(candidate.takeProfit.value > 0, true);
    assert.equal(candidate.rewardRisk, 1.5);
  }
});

test("strategy returns NO TRADE for insufficient, stale, delayed, wide-spread, and gapped inputs", () => {
  const candles = makeCandles();
  const cases = [
    [candles.slice(0, 20), makeQuote(candles), "insufficient_history"],
    [candles, makeQuote(candles, { timestamp: "2026-10-21T10:00:00.000Z", freshness: { status: "stale" } }), "stale_quote"],
    [candles, makeQuote(candles, { spread: 0.001 }), "spread_too_wide"],
    [candles, makeQuote(candles, { dataMode: "delayed" }), "delayed_quote"]
  ];
  for (const [inputCandles, quote, expectedReason] of cases) {
    const candidate = evaluateBaselineStrategy({ symbol: "EUR/USD", timeframe: "M15", candles: inputCandles, quote, strategyConfig, now });
    assert.equal(candidate.direction, "NO TRADE");
    assert.equal(candidate.reasons.some((reason) => reason.code === expectedReason), true);
  }
  const gapped = makeCandles();
  for (let index = 30; index < gapped.length; index += 1) gapped[index].timestamp = new Date(new Date(gapped[index].timestamp).getTime() + 3_600_000).toISOString();
  const gapCandidate = evaluateBaselineStrategy({ symbol: "EUR/USD", timeframe: "M15", candles: gapped, quote: makeQuote(gapped), strategyConfig, now });
  assert.equal(gapCandidate.direction, "NO TRADE");
  assert.equal(gapCandidate.dataQuality.warnings.includes("missing_periods_detected"), true);
});

test("strategy distinguishes a forming candle, rejects future leakage, and remains deterministic", () => {
  const base = makeCandles();
  const formingClose = base.at(-1).close + 0.02;
  const forming = [...base, { ...base.at(-1), timestamp: "2026-10-21T12:00:00.000Z", high: formingClose + 0.001, close: formingClose, isComplete: false }];
  const provisional = evaluateBaselineStrategy({ symbol: "EUR/USD", timeframe: "M15", candles: forming, quote: makeQuote(forming), strategyConfig, now });
  const baseline = evaluateBaselineStrategy({ symbol: "EUR/USD", timeframe: "M15", candles: base, quote: makeQuote(base), strategyConfig, now });
  assert.equal(provisional.referencePrice.timestamp, baseline.referencePrice.timestamp);
  assert.equal(provisional.signalStatus, "provisional");
  assert.equal(provisional.direction, baseline.direction);
  const repeat = evaluateBaselineStrategy({ symbol: "EUR/USD", timeframe: "M15", candles: base, quote: makeQuote(base), strategyConfig, now });
  assert.deepEqual(repeat, baseline);
  assert.throws(() => evaluateBaselineStrategy({ symbol: "EUR/USD", timeframe: "M15", candles: [...base].reverse(), quote: makeQuote(base), strategyConfig, now }), StrategyInputError);
});

test("invalid candidate inputs do not create protective levels", () => {
  const candles = makeCandles();
  const invalidQuote = evaluateBaselineStrategy({ symbol: "EUR/USD", timeframe: "M15", candles, quote: makeQuote(candles, { spread: null }), strategyConfig, now });
  assert.equal(invalidQuote.direction, "NO TRADE");
  assert.equal(invalidQuote.stopLoss, null);
  assert.equal(invalidQuote.takeProfit, null);
});

function responseDouble() {
  return { statusCode: null, headers: {}, body: null, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } };
}

const password = "correct horse battery staple";
const passwordHash = await hashPassword(password, { N: 1_024, r: 1, p: 1 });
const originalEnv = { ...process.env };
const database = new FakeDatabase();

function configureAuth() {
  Object.assign(process.env, { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false", AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: passwordHash, SESSION_SECRET: "c".repeat(32), DATABASE_URL: "postgresql://test:test@example.test/test", MARKET_DATA_PROVIDER: "none" });
}

function request({ cookie = "", url = "/api/private/strategy?symbol=EUR%2FUSD&timeframe=M15" } = {}) {
  const headers = { origin: "http://localhost:3000", "x-real-ip": "strategy-test" };
  if (cookie) headers.cookie = cookie;
  return { method: "GET", url, headers };
}

before(async () => {
  configureAuth();
  database.reset();
  clearAuthState();
  clearMarketDataRateLimit();
  setDatabaseForTests(database);
  const login = responseDouble();
  await loginHandler({ method: "POST", headers: { origin: "http://localhost:3000", "x-real-ip": "strategy-login", "content-type": "application/json" }, body: { username: "operator", password } }, login);
  database.testCookie = login.headers["Set-Cookie"].split(";", 1)[0];
});

after(() => { clearAuthState(); clearMarketDataRateLimit(); clearDatabaseTestOverride(); for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });

test("strategy API protects access, validates input, and reports unavailable data safely", async () => {
  const anonymous = responseDouble();
  await strategyHandler(request(), anonymous);
  assert.equal(anonymous.statusCode, 401);
  const invalid = responseDouble();
  await strategyHandler(request({ cookie: database.testCookie, url: "/api/private/strategy?symbol=BTC%2FUSD" }), invalid);
  assert.equal(invalid.statusCode, 400);
  const unavailable = responseDouble();
  await strategyHandler(request({ cookie: database.testCookie }), unavailable);
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body.direction, "NO TRADE");
  assert.equal(unavailable.body.dataMode, "unavailable");
  assert.equal(Object.hasOwn(unavailable.body, "price"), false);
});
