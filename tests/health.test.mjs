import test from "node:test";
import assert from "node:assert/strict";
import handler, { foundationResponse } from "../api/health.js";
import { clearDatabaseTestOverride, setDatabaseForTests } from "../api/_lib/database.js";

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

test("health endpoint supports optional database connectivity probe without leaking secrets", async () => {
  const runtimeEnv = {
    APP_ENV: "test",
    DATABASE_URL: "postgresql://postgres.ref:top-secret-pass@395fd2032d8441759f4a8d6a641e7eec.hyperdrive.local:5432/postgres?sslmode=disable"
  };
  let pingCalls = 0;
  setDatabaseForTests({
    async ping() {
      pingCalls += 1;
      return true;
    }
  });
  try {
    const okRes = responseDouble();
    await handler({ method: "GET", url: "http://localhost/api/health?probe=database", runtimeEnv }, okRes);
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.body.services.database, "operational");
    assert.equal(pingCalls, 1);

    setDatabaseForTests({
      async ping() {
        throw new Error("postgresql://postgres.ref:top-secret-pass@host/postgres connection refused");
      }
    });
    const failRes = responseDouble();
    await handler({ method: "GET", url: "http://localhost/api/health?probe=database", runtimeEnv }, failRes);
    assert.equal(failRes.statusCode, 200);
    assert.equal(failRes.body.services.database, "unavailable");
    assert.equal(JSON.stringify(failRes.body).includes("top-secret-pass"), false);
  } finally {
    clearDatabaseTestOverride();
  }
});
