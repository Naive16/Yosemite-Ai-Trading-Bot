import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertSameOrigin, InputValidationError, parseJsonBody } from "../api/_lib/validation.js";
import { sendJson } from "../api/_lib/http.js";

function responseDouble() { return { headers: {}, statusCode: null, body: null, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

test("state-changing requests fail closed without an origin or referer", () => {
  assert.throws(() => assertSameOrigin({ headers: {} }, "http://localhost:3000"), InputValidationError);
  assert.throws(() => assertSameOrigin({ headers: { origin: "https://attacker.example" } }, "http://localhost:3000"), InputValidationError);
  assert.doesNotThrow(() => assertSameOrigin({ headers: { origin: "http://localhost:3000" } }, "http://localhost:3000"));
});

test("parsed JSON objects remain bounded after framework parsing", () => {
  assert.throws(() => parseJsonBody({ headers: { "content-type": "application/json" }, body: { value: "x".repeat(100) } }, 32), InputValidationError);
});

test("API responses and static deployment include baseline security headers", async () => {
  const response = responseDouble();
  sendJson(response, 200, { status: "ok" });
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(response.headers["Content-Security-Policy"], "default-src 'none'; frame-ancestors 'none'");
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const headers = Object.fromEntries(vercel.headers[0].headers.map((entry) => [entry.key, entry.value]));
  assert.match(headers["Content-Security-Policy"], /script-src 'self'/);
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
});
