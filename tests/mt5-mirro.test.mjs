import test from "node:test";
import assert from "node:assert/strict";
import { MirroMt5Transport } from "../api/_lib/mt5/mirro.js";

const now = new Date("2026-10-28T12:00:00Z");
const metadata = () => ({ id: "acc_demo", platform: "mt5", login: "12345", server: "Broker-Demo", environment: "demo", state: "DEPLOYED", connection: "CONNECTED", executionCertified: true, roles: { follower: true }, password: "must-not-return" });
const information = () => ({ broker: "Broker", currency: "USD", server: "Broker-Demo", balance: "10000.00", equity: "9999.00", margin: "0.00", freeMargin: "9999.00", dayStartEquity: "10000.00", brokerConnected: true, tradeAllowed: true, updatedAt: now.toISOString() });
const quote = () => ({ symbol: "EURUSD", bid: "1.10000", ask: "1.10010", time: "2026-10-28T11:59:58Z", timeBasis: "utc", source: "terminal", ageSeconds: 2, stale: false, observedAt: "2026-10-28T11:59:59Z", receivedAt: now.toISOString() });
const specification = () => ({ symbol: "EURUSD", contractSize: "100000", volumeMin: "0.01", volumeMax: "10", volumeStep: "0.01", tickSize: null, tickValue: null, tradeMode: "4", tradable: true, source: "account-catalogue", verifiedAt: now.toISOString() });
function harness(overrides = {}) {
  const calls = [];
  const transport = new MirroMt5Transport({ apiKey: "mk_test_synthetic_secret", accountId: "acc_demo", now: () => now, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    const path = url.pathname;
    if (overrides.fetch) return overrides.fetch(url, options);
    const body = path.endsWith("/information") ? { ...information(), ...overrides.information } : path.endsWith("/specification") ? { ...specification(), ...overrides.specification } : path.endsWith("/price") ? { ...quote(), ...overrides.quote } : path.endsWith("/history/deals") ? { items: [], nextCursor: "opaque-cursor" } : path.endsWith("/positions") || path.endsWith("/orders") ? [] : { ...metadata(), ...overrides.metadata };
    return Response.json(body);
  }, ...overrides.options });
  return { transport, calls };
}

test("Mirro reads preserve the configured /v1 base and credentials never enter URLs or returned snapshots", async () => {
  const { transport, calls } = harness();
  const snapshot = await transport.getAccountSnapshot();
  assert.deepEqual(calls.map((call) => call.url), ["https://api.mirroapi.cloud/v1/accounts/acc_demo", "https://api.mirroapi.cloud/v1/accounts/acc_demo/information"]);
  for (const call of calls) { assert.equal(call.options.method, "GET"); assert.equal(call.options.redirect, "error"); assert.equal(call.options.headers.Authorization, "Bearer mk_test_synthetic_secret"); assert.equal(call.url.includes("synthetic_secret"), false); }
  assert.equal(snapshot.equity, 9999); assert.equal(snapshot.balance, 10000);
  assert.equal(snapshot.verification, "unverified"); assert.equal(snapshot.executionAllowed, false);
  assert.equal(JSON.stringify(snapshot).includes("must-not-return"), false);
  assert.equal(JSON.stringify(transport).includes("synthetic_secret"), false);
});

test("provisioning environment and certification never become broker-verified MT5 trade mode", async () => {
  const { transport } = harness({ metadata: { environment: "demo", trade_mode: 0, executionCertified: true } });
  const snapshot = await transport.getAccountSnapshot();
  assert.equal(snapshot.declaredEnvironment, "demo"); assert.equal(snapshot.verification, "unverified"); assert.equal(Object.hasOwn(snapshot, "trade_mode"), false);
  await assert.rejects(() => transport.getAccountInfo(), (error) => error.code === "account_classification_unverified");
});

test("Mirro rejects different accounts, hosts, mutation routes and every mutating method before fetch", async () => {
  const { transport, calls } = harness();
  for (const path of ["https://attacker.example/accounts/acc_demo", "//attacker.example/accounts/acc_demo", "/accounts/other", "/accounts/acc_demo/trades", "/accounts/acc_demo/deploy", "/accounts/acc_demo/../other", "/accounts/acc_demo/symbols/%2e%2e/price", "/accounts/acc_demo/positions?redirect=https://attacker.example"])
    await assert.rejects(() => transport.request(path), (error) => error.code === "provider_read_path_invalid");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) await assert.rejects(() => transport.request("/accounts/acc_demo", { method }), (error) => error.code === "provider_read_only");
  await assert.rejects(() => transport.request("/accounts/acc_demo", { body: {} }), (error) => error.code === "provider_read_only");
  assert.equal(calls.length, 0); assert.equal(transport.submitOrder, undefined);
});

test("Mirro validates its HTTPS base and preserves custom base paths", async () => {
  for (const baseUrl of ["http://api.mirroapi.cloud/v1", "https://user:password@api.mirroapi.cloud/v1", "https://api.mirroapi.cloud/v1?key=x", "https://api.mirroapi.cloud/v1#fragment"]) assert.throws(() => harness({ options: { baseUrl } }), (error) => error.code === "provider_configuration_invalid");
  const { transport, calls } = harness({ options: { baseUrl: "https://provider.example/nested/v1/" } });
  await transport.getAccountSnapshot();
  assert.equal(new URL(calls[0].url).pathname, "/nested/v1/accounts/acc_demo");
});

test("Mirro snapshot requires matching identity and broker financials; balance never substitutes for equity", async () => {
  for (const overrides of [{ metadata: { id: "other" } }, { metadata: { platform: "mt4" } }, { information: { server: "Other-Server" } }, { information: { equity: null, balance: "10000" } }]) await assert.rejects(() => harness(overrides).transport.getAccountSnapshot());
  const snapshot = await harness({ information: { updatedAt: null } }).transport.getAccountSnapshot();
  assert.equal(snapshot.capturedAt, null); assert.equal(snapshot.freshness.status, "unverified");
});

test("Mirro quote uses actual UTC terminal timestamps and refuses stale, ambiguous or malformed prices", async () => {
  const { transport, calls } = harness(); const result = await transport.getQuote("EURUSD");
  assert.equal(result.bid, 1.1); assert.equal(result.timestamp, "2026-10-28T11:59:58.000Z");
  assert.equal(calls[0].url, "https://api.mirroapi.cloud/v1/accounts/acc_demo/symbols/EURUSD/price?maxAgeSeconds=15");
  for (const bad of [{ timeBasis: "broker" }, { stale: true }, { ageSeconds: null }, { symbol: "OTHER" }, { time: "2020-01-01T00:00:00Z" }, { bid: "1.2", ask: "1.1" }, { observedAt: null }]) await assert.rejects(() => harness({ quote: bad }).transport.getQuote("EURUSD"));
});

test("Mirro uses the specification endpoint and preserves unsupported native risk fields as missing", async () => {
  const { transport, calls } = harness(); const result = await transport.getSymbolSpecification("EURUSD");
  assert.equal(result.tickValue, null); assert.equal(result.tickSize, null); assert.equal(result.executionAllowed, false); assert.equal(result.verification, "incomplete");
  assert.equal(calls[0].url, "https://api.mirroapi.cloud/v1/accounts/acc_demo/symbols/EURUSD/specification");
  await assert.rejects(() => transport.getSymbolInfo("EURUSD"), (error) => error.code === "symbol_specs_incomplete");
});

test("Mirro books and paginated history preserve unavailable-versus-empty semantics", async () => {
  const { transport, calls } = harness();
  assert.deepEqual(await transport.getPositions(), []); assert.deepEqual(await transport.getOrders(), []);
  assert.deepEqual(await transport.getHistory({ cursor: "next/page", ticket: "00123", from: "2026-10-28T00:00:00Z" }), { items: [], nextCursor: "opaque-cursor" });
  const url = new URL(calls.at(-1).url); assert.equal(url.searchParams.get("cursor"), "next/page"); assert.equal(url.searchParams.get("ticket"), "00123");
  const bad = harness({ fetch: () => Response.json({ error: { code: "BOOK_UNAVAILABLE", message: "private-provider-detail" } }, { status: 503 }) });
  await assert.rejects(() => bad.transport.getPositions(), (error) => error.code === "BOOK_UNAVAILABLE" && !error.message.includes("private-provider-detail"));
  await assert.rejects(() => harness({ fetch: () => Response.json(null) }).transport.getPositions(), (error) => error.code === "provider_response_invalid");
});

test("Mirro bounds responses and hides provider details, secret-like error codes and transport failures", async () => {
  const oversized = harness({ fetch: () => new Response("x".repeat(512 * 1024 + 1)) });
  await assert.rejects(() => oversized.transport.getCapabilities(), (error) => error.code === "provider_response_too_large");
  const rejected = harness({ fetch: () => Response.json({ error: { code: "PRIVATE_SECRET_VALUE", message: "private-provider-detail" } }, { status: 500 }) });
  await assert.rejects(() => rejected.transport.getCapabilities(), (error) => error.status === 503 && error.code === "provider_error" && !error.message.includes("private"));
  const unavailable = harness({ fetch: () => { throw new Error("private-provider-detail"); } });
  await assert.rejects(() => unavailable.transport.getCapabilities(), (error) => error.code === "provider_unavailable" && !error.message.includes("private"));
});

test("Mirro timeouts abort reads; missing credentials never call fetch", async () => {
  const timed = harness({ options: { timeoutMs: 5 }, fetch: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("abort-detail")))) });
  await assert.rejects(() => timed.transport.getCapabilities(), (error) => error.code === "provider_timeout");
  const { transport, calls } = harness({ options: { apiKey: "" } });
  await assert.rejects(() => transport.getAccountSnapshot(), (error) => error.code === "provider_unconfigured");
  assert.equal(calls.length, 0);
});
