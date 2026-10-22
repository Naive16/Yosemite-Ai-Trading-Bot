import test from "node:test";
import assert from "node:assert/strict";
import handler, { foundationResponse } from "../api/health.js";

function responseDouble() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; return this; }
  };
}

test("health foundation reports safe disabled trading state", () => {
  const body = foundationResponse();
  assert.equal(body.status, "ok");
  assert.equal(body.tradingEnabled, false);
  assert.equal(body.liveTradingEnabled, false);
  assert.equal(body.services.broker, "not_configured");
  assert.match(body.checkedAt, /^20\d\d-/);
});

test("health endpoint accepts GET and sends no-store response", () => {
  const response = responseDouble();
  handler({ method: "GET" }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.body.mode, "foundation");
});

test("health endpoint rejects non-GET requests", () => {
  const response = responseDouble();
  handler({ method: "POST" }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "GET");
  assert.equal(response.body.status, "error");
});
