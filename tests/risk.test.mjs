import test from "node:test";
import assert from "node:assert/strict";
import { calculatePositionSize, PositionSizingError } from "../api/_lib/risk/position-sizing.js";
import { evaluateRisk } from "../api/_lib/risk/engine.js";
import { loadConfig } from "../api/_lib/config.js";

const now = new Date("2026-10-21T12:00:00.000Z");
const riskConfig = { version: "risk-baseline-v1", maxEquityRiskFraction: 0.0025, dailyLossHaltFraction: 0.01, maxOpenPositions: 2, minRewardRisk: 1.5, coolingAfterLosses: 3, coolingSeconds: 86_400, maxQuoteAgeSeconds: 120, maxPriceDriftPips: 5, timeZone: "UTC" };
const instrument = { symbol: "EUR/USD", baseCurrency: "EUR", quoteCurrency: "USD", contractSize: 100_000, pipSize: 0.0001, pipValuePerLot: 10, minVolume: 0.01, maxVolume: 5, volumeStep: 0.01, commissionPerLot: 2, maxTotalExposure: 50_000 };
const candidate = { candidateId: "cand-test", symbol: "EUR/USD", direction: "BUY", status: "informational", approvalState: "not_approved", executionState: "not_executed", rewardRisk: 2, referencePrice: { value: 1.1 }, stopLoss: { value: 1.095 }, takeProfit: { value: 1.11 }, expiry: "2026-10-21T12:15:00.000Z" };
const account = { currency: "USD", equity: 10_000, dailyStartEquity: 10_000, lossToday: 20, tradingDayKey: "2026-10-21", isSimulated: false, conversionRates: {} };
const exposure = { openPositions: 0, totalExposure: 0, lossStreak: 0 };
const quote = { price: 1.1, timestamp: "2026-10-21T11:59:30.000Z", spreadPips: 1 };

test("position sizing converts currencies, includes costs, and rounds down", () => {
  const usd = calculatePositionSize({ equity: 10_000, riskFraction: 0.0025, entry: 1.1, stopLoss: 1.095, direction: "BUY", instrument, accountCurrency: "USD", conversionRates: { "EUR/USD": 1.1 }, spreadPips: 1, commissionPerLot: 2, existingExposure: 0, maxTotalExposure: 50_000 });
  assert.equal(usd.volume, 0.04);
  const zar = calculatePositionSize({ equity: 100_000, riskFraction: 0.0025, entry: 20, stopLoss: 19.9, direction: "BUY", instrument: { ...instrument, baseCurrency: "USD", quoteCurrency: "ZAR", pipValuePerLot: 10, maxTotalExposure: 2_000_000 }, accountCurrency: "ZAR", conversionRates: { "USD/ZAR": 18 }, spreadPips: 1, commissionPerLot: 2, existingExposure: 0, maxTotalExposure: 2_000_000 });
  assert.equal(zar.accountCurrency, "ZAR"); assert.equal(zar.baseToAccountRate, 18);
  assert.throws(() => calculatePositionSize({ equity: 10_000, riskFraction: 0.0025, entry: 1.1, stopLoss: 1.095, direction: "BUY", instrument, accountCurrency: "ZAR", conversionRates: {}, maxTotalExposure: 50_000 }), PositionSizingError);
});

test("risk engine returns PASS only for complete trusted evidence and rejects violations", () => {
  const pass = evaluateRisk({ candidate, account: { ...account, conversionRates: { "EUR/USD": 1.1 } }, instrument, quote, exposure, riskConfig, now });
  assert.equal(pass.decision, "PASS"); assert.equal(pass.executionAllowed, false); assert.equal(pass.isApproval, false); assert.equal(pass.positionSizing.volume > 0, true);
  const wrongSide = evaluateRisk({ candidate: { ...candidate, stopLoss: { value: 1.105 } }, account, instrument, quote, exposure, riskConfig, now });
  assert.equal(wrongSide.decision, "BLOCKED"); assert.match(wrongSide.reasonCodes.join(" "), /invalid_stop_side/);
  const daily = evaluateRisk({ candidate, account: { ...account, lossToday: 100 }, instrument, quote, exposure, riskConfig, now });
  assert.equal(daily.decision, "REJECT"); assert.match(daily.reasonCodes.join(" "), /daily_loss_halt/);
  const cooling = evaluateRisk({ candidate, account, instrument, quote, exposure: { ...exposure, lossStreak: 3, coolingUntil: "2026-10-21T13:00:00Z" }, riskConfig, now });
  assert.equal(cooling.decision, "REJECT"); assert.match(cooling.reasonCodes.join(" "), /loss_streak_cooling/);
});

test("risk engine blocks simulated, stale, missing, drifted, and inconsistent state", () => {
  const missing = evaluateRisk({ candidate, account: null, instrument: null, quote: null, exposure: null, riskConfig, now });
  assert.equal(missing.decision, "BLOCKED"); assert.match(missing.reasonCodes.join(" "), /account_unavailable/);
  const simulated = evaluateRisk({ candidate, account: { ...account, isSimulated: true }, instrument, quote, exposure, riskConfig, now });
  assert.equal(simulated.decision, "BLOCKED"); assert.match(simulated.reasonCodes.join(" "), /simulated_account_state/);
  const stale = evaluateRisk({ candidate, account, instrument, quote: { ...quote, timestamp: "2026-10-21T11:00:00Z" }, exposure, riskConfig, now });
  assert.equal(stale.decision, "BLOCKED"); assert.match(stale.reasonCodes.join(" "), /quote_stale/);
  const drift = evaluateRisk({ candidate, account, instrument, quote: { ...quote, price: 1.2 }, exposure, riskConfig, now });
  assert.equal(drift.decision, "REJECT"); assert.match(drift.reasonCodes.join(" "), /price_drift/);
});

test("risk day convention is explicit and risk defaults are hard-bounded", () => {
  const config = loadConfig({ APP_ENV: "test", RISK_TIME_ZONE: "Africa/Blantyre", RISK_MAX_EQUITY_FRACTION: "0.0025" });
  assert.equal(config.risk.timeZone, "Africa/Blantyre"); assert.equal(config.risk.tradingDayConvention, "calendar_day_in_configured_time_zone");
  assert.throws(() => loadConfig({ APP_ENV: "test", RISK_MAX_EQUITY_FRACTION: "0.02" }));
});

test("risk engine blocks malformed account currency identifiers", () => {
  const result = evaluateRisk({ candidate, account: { ...account, currency: "usd" }, instrument, quote, exposure, riskConfig, now });
  assert.equal(result.decision, "BLOCKED");
  assert.equal(result.reasonCodes.includes("account_currency_invalid"), true);
});
