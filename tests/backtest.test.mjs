import test from "node:test";
import assert from "node:assert/strict";
import { runBacktest, BacktestInputError } from "../api/_lib/backtest/engine.js";
import { calculateBacktestMetrics } from "../api/_lib/backtest/metrics.js";
import { PaperSimulator } from "../api/_lib/paper/simulator.js";

const strategyConfig = { fastMaPeriod: 4, slowMaPeriod: 8, rsiPeriod: 5, atrPeriod: 5, minRewardRisk: 1.5, maxSpreadPips: 3, minAtrPips: 0.1, stopAtrMultiplier: 1.5, quoteMaxAgeSeconds: 120 };
const riskConfig = { version: "risk-baseline-v1", maxEquityRiskFraction: 0.0025, dailyLossHaltFraction: 0.01, maxOpenPositions: 2, minRewardRisk: 1.5, coolingAfterLosses: 3, coolingSeconds: 86400, maxQuoteAgeSeconds: 120, maxPriceDriftPips: 100, timeZone: "UTC" };
const instrument = { symbol: "EUR/USD", baseCurrency: "EUR", quoteCurrency: "USD", contractSize: 100_000, pipSize: 0.0001, pipValuePerLot: 10, minVolume: 0.01, maxVolume: 1, volumeStep: 0.01, commissionPerLot: 1, maxTotalExposure: 100_000 };
function candles(count = 45) { let price = 1.1; return Array.from({ length: count }, (_, index) => { const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString(); const open = price; price += index < 20 ? 0.0005 : -0.0002; return { timestamp, open, high: Math.max(open, price) + 0.0004, low: Math.min(open, price) - 0.0004, close: price }; }); }

test("backtest replays chronologically, is reproducible, and rejects look-ahead inputs", () => {
  const input = { symbol: "EUR/USD", timeframe: "M15", candles: candles(), strategyConfig, riskConfig, instrument, startingEquity: 10_000, accountCurrency: "USD", conversionRates: { "EUR/USD": 1.1 }, assumptions: { spreadPips: 1, commissionPerUnit: 0.00001, swapPerUnit: 0.000001, slippagePips: 0.2 }, maximumCandles: 100 };
  const first = runBacktest(input); const second = runBacktest(input); assert.deepEqual(first, second); assert.equal(first.results.label, "historical simulation"); assert.equal(first.warnings.includes("no_lookahead"), true); assert.throws(() => runBacktest({ ...input, candles: [...input.candles].reverse() }), BacktestInputError); assert.throws(() => runBacktest({ ...input, candles: input.candles.map((candle, i) => i === 20 ? { ...candle, timestamp: "2027-01-01T00:00:00Z" } : candle) }), BacktestInputError);
});

test("backtest metrics define zero-trade cases without misleading values", () => { const metrics = calculateBacktestMetrics({ startingEquity: 1000, endingEquity: 1000, trades: [] }); assert.equal(metrics.tradeCount, 0); assert.equal(metrics.profitFactor, null); assert.equal(metrics.expectancyPerTrade, null); assert.equal(metrics.maximumDrawdown, 0); });

test("paper simulator separates simulated records and is idempotent across duplicate events", () => {
  const simulator = new PaperSimulator({ startingEquity: 10_000, accountCurrency: "USD" }); const proposal = { proposalId: "prop-test", proposalVersion: 1, status: "approved", immutableContent: { symbol: "EUR/USD", direction: "BUY", proposedEntry: { value: 1.1 }, stopLoss: { value: 1.09 }, takeProfit: { value: 1.12 }, risk: { decision: "PASS" } } }; const quote = { price: 1.101, dataMode: "historical" };
  const first = simulator.processEvent({ eventId: "event-1", proposal, quote }); const duplicate = simulator.processEvent({ eventId: "event-1", proposal, quote }); assert.equal(first.status, "opened_simulated"); assert.equal(first.position.simulated, true); assert.equal(duplicate.status, "duplicate"); assert.equal(simulator.snapshot().positions.length, 1);
  const skipped = simulator.processEvent({ eventId: "event-2", proposal: { ...proposal, status: "rejected" }, quote }); assert.equal(skipped.status, "skipped"); assert.equal(skipped.reason, "proposal_not_approved_or_risk_passed");
});
