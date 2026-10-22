import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, clearAuthState } from "../api/_lib/auth.js";
import { setDatabaseForTests, clearDatabaseTestOverride } from "../api/_lib/database.js";
import { clearRiskRateLimit } from "../api/_lib/risk/rate-limit.js";
import { FakeDatabase } from "./support/fake-database.mjs";
import loginHandler from "../api/auth/login.js";
import riskHandler from "../api/private/risk.js";

function responseDouble() { return { statusCode: null, headers: {}, body: null, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } }; }
const password = "correct horse battery staple";
const passwordHash = await hashPassword(password, { N: 1_024, r: 1, p: 1 });
const originalEnv = { ...process.env }; const database = new FakeDatabase(); let cookie = "";
const req = (withCookie = cookie) => ({ method: "GET", url: "/api/private/risk", headers: { origin: "http://localhost:3000", "x-real-ip": "risk-api", ...(withCookie ? { cookie: withCookie } : {}) } });

before(async () => { Object.assign(process.env, { APP_ENV: "test", APP_ORIGIN: "http://localhost:3000", TRADING_MODE: "disabled", LIVE_TRADING_ENABLED: "false", AUTH_USERNAME: "operator", AUTH_PASSWORD_HASH: passwordHash, SESSION_SECRET: "e".repeat(32), DATABASE_URL: "postgresql://test:test@example.test/test", MARKET_DATA_PROVIDER: "none" }); database.reset(); clearAuthState(); clearRiskRateLimit(); setDatabaseForTests(database); const login = responseDouble(); await loginHandler({ method: "POST", headers: { origin: "http://localhost:3000", "x-real-ip": "risk-login", "content-type": "application/json" }, body: { username: "operator", password } }, login); cookie = login.headers["Set-Cookie"].split(";", 1)[0]; });
after(() => { clearAuthState(); clearRiskRateLimit(); clearDatabaseTestOverride(); for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });

test("risk endpoint requires auth and returns an auditable BLOCKED state without trusted account data", async () => { const anonymous = responseDouble(); await riskHandler(req(""), anonymous); assert.equal(anonymous.statusCode, 401); const response = responseDouble(); await riskHandler(req(), response); assert.equal(response.statusCode, 200); assert.equal(response.body.evaluation.decision, "BLOCKED"); assert.equal(response.body.evaluation.executionAllowed, false); assert.equal(database.auditEvents.some((event) => event.event_type === "risk.evaluation.blocked"), true); });
