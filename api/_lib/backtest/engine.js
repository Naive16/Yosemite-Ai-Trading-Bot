import { createHash } from "node:crypto";
import { evaluateBaselineStrategy } from "../strategy/engine.js";
import { evaluateRisk } from "../risk/engine.js";
import { calculateBacktestMetrics } from "./metrics.js";

export const BACKTEST_ENGINE_VERSION = "1.0.0";
export class BacktestInputError extends Error { constructor(message, code = "invalid_backtest_input") { super(message); this.name = "BacktestInputError"; this.code = code; } }
function positive(value, field) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new BacktestInputError(`${field} is invalid`); return value; }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function validateCandles(candles, timeframeSeconds, maximum) {
  if (!Array.isArray(candles) || candles.length < 2 || candles.length > maximum) throw new BacktestInputError("Historical candle coverage is insufficient or exceeds the bound", "candle_limit");
  for (let index = 0; index < candles.length; index += 1) { const candle = candles[index]; if (!candle || typeof candle !== "object") throw new BacktestInputError("Historical candle is invalid", "invalid_candle"); const timestamp = new Date(candle.timestamp); if (Number.isNaN(timestamp.getTime()) || ![candle.open, candle.high, candle.low, candle.close].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) throw new BacktestInputError("Historical candle is invalid", "invalid_candle"); if (index && timestamp <= new Date(candles[index - 1].timestamp)) throw new BacktestInputError("Historical candles must be chronological", "non_chronological"); if (index && (timestamp - new Date(candles[index - 1].timestamp)) / 1_000 > timeframeSeconds * 2.5) throw new BacktestInputError("Historical coverage contains an unhandled gap", "missing_candles"); }
}

function executeTrade({ position, candle, assumptions }) {
  const direction = position.direction; const stop = position.stopLoss; const target = position.takeProfit; const open = candle.open; const high = candle.high; const low = candle.low; let exitPrice = null; let exitReason = null;
  const stopHit = direction === "BUY" ? low <= stop : high >= stop; const targetHit = direction === "BUY" ? high >= target : low <= target;
  if (direction === "BUY" && open <= stop || direction === "SELL" && open >= stop) { exitPrice = open; exitReason = "gap_stop"; }
  else if (direction === "BUY" && open >= target || direction === "SELL" && open <= target) { exitPrice = open; exitReason = "gap_target"; }
  else if (stopHit && targetHit) { exitPrice = stop; exitReason = "ambiguous_intrabar_stop_first"; }
  else if (stopHit) { exitPrice = stop; exitReason = "stop_loss"; }
  else if (targetHit) { exitPrice = target; exitReason = "take_profit"; }
  if (exitPrice == null) return null;
  const rawPnl = direction === "BUY" ? (exitPrice - position.entryPrice) * position.units : (position.entryPrice - exitPrice) * position.units;
  const costs = assumptions.commissionPerUnit * position.units + assumptions.swapPerUnit * position.units * position.daysHeld;
  return { ...position, exitTimestamp: candle.timestamp, exitPrice, exitReason, grossPnl: rawPnl, costs, netPnl: rawPnl - costs };
}

export function runBacktest({ symbol, timeframe, candles, strategyConfig, riskConfig, instrument, startingEquity, accountCurrency, conversionRates, assumptions = {}, now = new Date(), maximumCandles = 500 }) {
  positive(startingEquity, "startingEquity"); if (!instrument || instrument.symbol !== symbol) throw new BacktestInputError("Instrument specification does not match symbol", "instrument_mismatch");
  const timeframeSeconds = { M5: 300, M15: 900, H1: 3600 }[timeframe]; if (!timeframeSeconds) throw new BacktestInputError("Unsupported backtest timeframe", "timeframe_unsupported");
  validateCandles(candles, timeframeSeconds, maximumCandles);
  const execution = { spreadPips: 0, commissionPerUnit: 0, swapPerUnit: 0, slippagePips: 0, executionDelayCandles: 1, ...assumptions }; if (!["spreadPips", "commissionPerUnit", "swapPerUnit", "slippagePips"].every((key) => typeof execution[key] === "number" && execution[key] >= 0) || execution.executionDelayCandles !== 1) throw new BacktestInputError("Execution assumptions are invalid", "assumptions_invalid");
  let equity = startingEquity; let position = null; const trades = []; let skipped = 0; let rejected = 0; let totalCosts = 0; const decisionLog = [];
  const runConfig = { symbol, timeframe, strategyConfig, riskConfig, instrument, startingEquity, accountCurrency, conversionRates, assumptions: execution, engineVersion: BACKTEST_ENGINE_VERSION };
  for (let index = Math.max(strategyConfig.slowMaPeriod, strategyConfig.rsiPeriod + 1, strategyConfig.atrPeriod); index < candles.length - execution.executionDelayCandles; index += 1) {
    const history = candles.slice(0, index + 1); const decisionCandle = candles[index]; const decisionTime = new Date(new Date(decisionCandle.timestamp).getTime() + timeframeSeconds * 1_000); const quote = { price: decisionCandle.close, timestamp: decisionTime.toISOString(), source: "validated_historical_candle", dataMode: "historical", spread: execution.spreadPips * instrument.pipSize, spreadPips: execution.spreadPips, freshness: { status: "fresh" } };
    if (position) { const closed = executeTrade({ position: { ...position, daysHeld: Math.max(0, (new Date(decisionCandle.timestamp) - new Date(position.entryTimestamp)) / 86_400_000) }, candle: decisionCandle, assumptions: execution }); if (closed) { equity += closed.netPnl; totalCosts += closed.costs; trades.push(closed); position = null; } }
    if (position) continue;
    const candidate = evaluateBaselineStrategy({ symbol, timeframe, candles: history, quote, strategyConfig, now: decisionTime });
    if (candidate.direction === "NO TRADE") { skipped += 1; continue; }
    const risk = evaluateRisk({ candidate, account: { currency: accountCurrency, equity, dailyStartEquity: startingEquity, lossToday: Math.max(0, startingEquity - equity), tradingDayKey: decisionTime.toISOString().slice(0, 10), isSimulated: true, conversionRates }, instrument, quote, exposure: { openPositions: 0, totalExposure: 0, lossStreak: trades.slice(-3).filter((trade) => trade.netPnl < 0).length }, riskConfig, now: decisionTime, simulationContext: true });
    decisionLog.push({ timestamp: decisionTime.toISOString(), candidateDirection: candidate.direction, riskDecision: risk.decision, reasonCodes: risk.reasonCodes });
    if (risk.decision !== "PASS") { rejected += 1; continue; }
    const entryCandle = candles[index + execution.executionDelayCandles]; const direction = candidate.direction; const slip = execution.slippagePips * instrument.pipSize; const entryPrice = direction === "BUY" ? entryCandle.open + slip : entryCandle.open - slip; const units = risk.positionSizing.volume * instrument.contractSize;
    position = { tradeId: `bt_${hash({ symbol, timeframe, index, direction }).slice(0, 20)}`, symbol, timeframe, direction, entryTimestamp: entryCandle.timestamp, entryPrice, stopLoss: candidate.stopLoss.value, takeProfit: candidate.takeProfit.value, units, daysHeld: 0 };
  }
  if (position) { const last = candles.at(-1); const closePnl = position.direction === "BUY" ? (last.close - position.entryPrice) * position.units : (position.entryPrice - last.close) * position.units; const costs = execution.commissionPerUnit * position.units; trades.push({ ...position, exitTimestamp: last.timestamp, exitPrice: last.close, exitReason: "end_of_test", grossPnl: closePnl, costs, netPnl: closePnl - costs }); equity += closePnl - costs; totalCosts += costs; }
  const coverage = { firstTimestamp: candles[0].timestamp, lastTimestamp: candles.at(-1).timestamp, candleCount: candles.length, warnings: ["historical_simulation", "no_lookahead", "ambiguous_intrabar_hits_stop_first", "fills_use_next_candle_open", "estimated_costs"] };
  return Object.freeze({ runId: `bt_${hash(runConfig).slice(0, 24)}`, engineVersion: BACKTEST_ENGINE_VERSION, status: "completed", configuration: runConfig, assumptions: execution, results: calculateBacktestMetrics({ startingEquity, endingEquity: equity, trades, skipped, rejected, totalCosts, coverage }), trades, decisionLog, warnings: coverage.warnings });
}
