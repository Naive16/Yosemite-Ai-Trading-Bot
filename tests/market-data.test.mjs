import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createMarketDataProvider, MarketDataProviderError, TwelveDataProvider } from "../api/_lib/market-data/provider.js";
import { normalizeCandles, normalizeQuote, MarketDataResponseError } from "../api/_lib/market-data/normalize.js";
import { MarketDataValidationError, parseMarketDataQuery } from "../api/_lib/market-data/validation.js";
import { loadConfig } from "../api/_lib/config.js";
import marketDataHandler, { clearMarketDataCache } from "../api/private/market-data.js";
import { clearMarketDataRateLimit } from "../api/_lib/market-data/rate-limit.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { hashPassword, clearAuthState } from "../api/_lib/auth.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import loginHandler from "../api/auth/login.js";

function responseDouble() {
  return { statusCode: null, headers: {}, body: null, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } };
}

function providerResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

test("provider parses quotes and candles without exposing credentials in the request result", async () => {
  const calls = [];
  const provider = new TwelveDataProvider({ apiKey: "server-secret", baseUrl: "https://provider.example", maxRetries: 0, fetchImpl: async (url) => {
    calls.push(String(url));
    if (url.pathname.endsWith("/quote")) return providerResponse({ symbol: "EUR/USD", bid: "1.08420", ask: "1.08430", datetime: "2026-10-21 10:00:00", status: "ok" });
    return providerResponse({ status: "ok", values: [{ datetime: "2026-10-21 10:15:00", open: "1.1", high: "1.2", low: "1.0", close: "1.15" }] });
  } });
  const quote = await provider.getQuote("EUR/USD");
  assert.equal(quote.spread, 0.00009999999999998899);
  assert.equal(quote.source, "Twelve Data");
  assert.equal(new URL(calls[0]).searchParams.get("apikey"), "server-secret");
  const candles = await provider.getCandles("EUR/USD", "M15", 10);
  assert.equal(candles.candles.length, 1);
  assert.equal(candles.candles[0].timestamp, "2026-10-21T10:15:00.000Z");
});

test("candle normalization orders data, keeps the last duplicate, and rejects invalid OHLC", () => {
  const result = normalizeCandles([
    { datetime: "2026-10-21 10:15:00", open: "1.1", high: "1.2", low: "1.0", close: "1.15" },
    { datetime: "2026-10-21 10:00:00", open: "1.0", high: "1.1", low: "0.9", close: "1.05" },
    { datetime: "2026-10-21 10:15:00", open: "1.12", high: "1.22", low: "1.1", close: "1.2" }
  ], { symbol: "EUR/USD", timeframe: "M15", timeframeSeconds: 900, source: "fixture", maxCandles: 10 });
  assert.deepEqual(result.candles.map((candle) => candle.timestamp), ["2026-10-21T10:00:00.000Z", "2026-10-21T10:15:00.000Z"]);
  assert.equal(result.candles[1].open, 1.12);
  assert.throws(() => normalizeCandles([{ datetime: "2026-10-21 10:00:00", open: "1.1", high: "1.0", low: "0.9", close: "1.05" }], { symbol: "EUR/USD", timeframe: "M15", timeframeSeconds: 900, source: "fixture" }), MarketDataResponseError);
});

test("market-data query validation rejects unsupported symbols and limits", () => {
  assert.deepEqual(parseMarketDataQuery({ url: "/api/private/market-data?kind=candles&symbol=EUR%2FUSD&timeframe=M15&limit=20" }), { kind: "candles", symbol: "EUR/USD", timeframe: "M15", limit: 20 });
  assert.throws(() => parseMarketDataQuery({ url: "/api/private/market-data?symbol=BTC%2FUSD" }), MarketDataValidationError);
  assert.throws(() => parseMarketDataQuery({ url: "/api/private/market-data?kind=candles&limit=301" }), MarketDataValidationError);
});

test("provider marks stale data, handles malformed data, retries rate limits, and times out", async () => {
  const stale = normalizeQuote({ price: "1.1", timestamp: "2020-01-01T00:00:00Z" }, { symbol: "EUR/USD", source: "fixture", receivedAt: Date.parse("2020-01-01T00:02:01Z"), staleAfterSeconds: 120 });
  assert.equal(stale.freshness.status, "stale");
  assert.throws(() => normalizeQuote({ price: "1.1" }, { symbol: "EUR/USD", source: "fixture" }), /timestamp/);

  let attempts = 0;
  const rateLimited = new TwelveDataProvider({ apiKey: "key", baseUrl: "https://provider.example", maxRetries: 1, sleep: async () => {}, fetchImpl: async () => {
    attempts += 1;
    return attempts === 1 ? providerResponse({ message: "limit" }, 429, { "retry-after": "2" }) : providerResponse({ price: "1.1", timestamp: "2026-10-21T10:00:00Z" });
  } });
  const retriedQuote = await rateLimited.getQuote("EUR/USD");
  assert.equal(retriedQuote.price, 1.1);
  assert.equal(attempts, 2);

  const rateError = new TwelveDataProvider({ apiKey: "key", baseUrl: "https://provider.example", maxRetries: 0, fetchImpl: async () => providerResponse({ message: "limit" }, 429, { "retry-after": "2" }) });
  await assert.rejects(() => rateError.getQuote("EUR/USD"), (error) => error instanceof MarketDataProviderError && error.code === "rate_limit");

  const timeout = new TwelveDataProvider({ apiKey: "key", baseUrl: "https://provider.example", timeoutMs: 5, maxRetries: 0, fetchImpl: (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error); })) });
  await assert.rejects(() => timeout.getQuote("EUR/USD"), (error) => error instanceof MarketDataProviderError && error.code === "timeout");
});

test("missing credentials create a safe unavailable provider and config keeps provider disabled by default", () => {
  const config = loadConfig({ APP_ENV: "test", MARKET_DATA_PROVIDER: "none" });
  const provider = createMarketDataProvider(config);
  assert.equal(provider.configured, false);
  assert.equal(provider.reason, "provider_disabled");
});

const password = "correct horse battery staple";
const passwordHash = await hashPassword(password, { N: 1_024, r: 1, p: 1 });
const originalEnv = { ...process.env };
const database = new FakeDatabase();

function configureAuth() {
  Object.assign(process.env, { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false", AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: passwordHash, SESSION_SECRET: "b".repeat(32), DATABASE_URL: "postgresql://test:test@example.test/test", MARKET_DATA_PROVIDER: "none" });
}

function request({ method = "GET", cookie = "", url = "/api/private/market-data?kind=quote&symbol=EUR%2FUSD", ip = "market-test" } = {}) {
  const headers = { origin: "http://localhost:3000", "x-real-ip": ip };
  if (cookie) headers.cookie = cookie;
  return { method, url, headers };
}

function cookieFrom(response) { return response.headers["Set-Cookie"].split(";", 1)[0]; }

before(async () => {
  configureAuth();
  clearAuthState();
  clearMarketDataRateLimit();
  clearMarketDataCache();
  setDatabaseForTests(database);
  const login = responseDouble();
  await loginHandler({ method: "POST", headers: { origin: "http://localhost:3000", "x-real-ip": "market-login", "content-type": "application/json" }, body: { username: "operator", password } }, login);
  database.testCookie = cookieFrom(login);
});

after(() => { clearAuthState(); clearMarketDataRateLimit(); clearMarketDataCache(); clearDatabaseTestOverride(); for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });

test("private market-data API requires authentication and safely reports unavailable data", async () => {
  const anonymous = responseDouble();
  await marketDataHandler(request({}), anonymous);
  assert.equal(anonymous.statusCode, 401);
  const authorized = responseDouble();
  await marketDataHandler(request({ cookie: database.testCookie }), authorized);
  assert.equal(authorized.statusCode, 503);
  assert.equal(authorized.body.status, "unavailable");
  assert.equal(authorized.body.dataMode, "unavailable");
  assert.equal(Object.hasOwn(authorized.body, "apiKey"), false);
});

test("private market-data API validates query parameters and methods", async () => {
  const invalid = responseDouble();
  await marketDataHandler(request({ cookie: database.testCookie, url: "/api/private/market-data?symbol=NOT-A-SYMBOL" }), invalid);
  assert.equal(invalid.statusCode, 400);
  const method = responseDouble();
  await marketDataHandler(request({ method: "POST", cookie: database.testCookie }), method);
  assert.equal(method.statusCode, 405);
});
