import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("dashboard exposes every Milestone 4 workspace screen", () => {
  for (const view of ["overview", "markets", "chart", "approvals", "positions", "history", "risk", "health", "audit"]) {
    assert.match(html, new RegExp(`data-view-panel=\"${view}\"`));
    assert.match(html, new RegExp(`data-view=\"${view}\"`));
  }
});

test("approvals screen is connected to protected proposal workflow with explicit review", () => {
  assert.match(app, /\/api\/private\/proposals/);
  assert.match(app, /Approve exact proposal/);
  assert.match(html, /proposal-list/);
  assert.match(app, /exact immutable proposal version/);
});

test("simulation surfaces remain clearly separated from live trading", () => {
  assert.match(app, /\/api\/private\/backtest/);
  assert.match(app, /\/api\/private\/paper/);
  assert.match(html, /historical simulation|paper simulation|Simulation/i);
  assert.match(html, /NO LIVE ORDERS|No persistent worker|fixture-driven/i);
});

test("dashboard integrates protected market data without browser credentials", () => {
  assert.match(app, /\/api\/private\/market-data\?kind=quote/);
  assert.match(app, /\/api\/private\/market-data\?kind=candles/);
  for (const symbol of ["EUR\/USD", "GBP\/USD", "USD\/ZAR", "EUR\/ZAR"]) assert.match(html, new RegExp(symbol));
  assert.match(html, /Data unavailable/);
  assert.doesNotMatch(app, /TWELVE_DATA_API_KEY|DATABASE_URL|SESSION_SECRET/);
});

test("dashboard exposes informational candidate analysis without execution controls", () => {
  assert.match(app, /\/api\/private\/strategy\?/);
  assert.match(html, /Deterministic strategy/);
  assert.match(html, /candidate-direction/);
  assert.match(html, /informational|Candidate analysis is unavailable/i);
  assert.match(html, /NO TRADE/);
  assert.doesNotMatch(app, /approveCandidate|approveTrade|executeOrder|placeOrder|submitOrder/);
});

test("dashboard exposes separate read-only Claude analysis with honest unavailable states", () => {
  assert.match(app, /\/api\/private\/analysis\?/);
  assert.match(html, /AI interpretation/);
  assert.match(html, /AI analysis unavailable/);
  assert.match(app, /no current result is available/);
  assert.match(app, /cannot approve or execute trades or authorize risk/);
  assert.match(app, /aiRequestId/);
  assert.doesNotMatch(app, /ANTHROPIC_API_KEY|x-api-key|DATABASE_URL|authentication\.request/);
});

test("dashboard labels unavailable data and keeps execution disabled", () => {
  assert.match(html, /Prices are intentionally blank/);
  assert.match(html, /No mock trades, balances, returns, win rates, or performance metrics/);
  assert.match(html, /Live trading disabled/);
  assert.match(html, /TRADING DISABLED/);
  assert.match(app, /\/api\/health/);
  assert.match(app, /\/api\/private\/status/);
  assert.match(app, /\/api\/private\/operations/);
  assert.match(app, /Operational diagnostics/);
});

test("dashboard labels the MT5 account as unverified until a server connector confirms it", () => {
  assert.match(html, /MT5 demo account/);
  assert.match(html, /Account classification.*Unverified/s);
  assert.match(html, /Connect demo account unavailable/);
});

test("dashboard includes responsive and reduced-motion accessibility affordances", () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /aria-label=\"Primary navigation\"/);
  assert.match(html, /aria-live=\"polite\"/);
});

test("both deployment frontends load the dashboard directly without authentication screens", async () => {
  const workerHtml = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  for (const page of [html, workerHtml]) {
    assert.match(page, /id="app-shell"/);
    assert.doesNotMatch(page, /id="app-shell" hidden/);
    assert.doesNotMatch(page, /login-screen/);
    assert.doesNotMatch(page, /login-submit|sign-out-button|recovery-form/);
    assert.doesNotMatch(page, /name="username"|name="password"|Sign up|Create account/);
  }
  assert.doesNotMatch(app, /createAuthentication|authentication\.signIn|authentication\.signOut|showLogin|Sign-out could not be confirmed/);
  assert.doesNotMatch(app, /yosemite_session|csrfToken|localStorage|sessionStorage/);
});

