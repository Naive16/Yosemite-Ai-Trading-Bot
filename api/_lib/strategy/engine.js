import { createHash } from "node:crypto";
import { getSymbolDefinition, getTimeframeDefinition } from "../market-data/symbols.js";
import { averageTrueRange, relativeStrengthIndex, simpleMovingAverage } from "./indicators.js";

export const STRATEGY_NAME = "baseline-trend-momentum-v1";
export const STRATEGY_VERSION = "1.0.0";
const DEFAULT_PIP_SIZE = 0.0001;

export class StrategyInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "StrategyInputError";
  }
}

function round(value, places = 8) {
  return value == null ? null : Number(value.toFixed(places));
}

function iso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new StrategyInputError("Evaluation timestamp is invalid");
  return date.toISOString();
}

function finitePositive(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new StrategyInputError(`${field} must be a positive finite number`);
  return value;
}

function validateCandles(candles, timeframeSeconds, nowMs) {
  if (!Array.isArray(candles)) throw new StrategyInputError("Candles must be an array");
  const normalized = [];
  let provisional = false;
  let incompleteHistory = false;
  let gapDetected = false;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle || typeof candle !== "object") throw new StrategyInputError("Candle is malformed");
    const timestamp = new Date(candle.timestamp);
    if (Number.isNaN(timestamp.getTime())) throw new StrategyInputError("Candle timestamp is invalid");
    const values = [candle.open, candle.high, candle.low, candle.close].map((value) => finitePositive(value, "Candle price"));
    const [open, high, low, close] = values;
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) throw new StrategyInputError("Candle violates OHLC bounds");
    if (index > 0) {
      const previous = normalized[index - 1];
      const gapSeconds = (timestamp.getTime() - new Date(previous.timestamp).getTime()) / 1_000;
      if (gapSeconds <= 0) throw new StrategyInputError("Candles must be strictly chronological without duplicate timestamps");
      if (gapSeconds > timeframeSeconds * 2.5) gapDetected = true;
    }
    const explicitlyIncomplete = candle.isComplete === false || candle.complete === false;
    const stillForming = timestamp.getTime() + timeframeSeconds * 1_000 > nowMs;
    if (explicitlyIncomplete || stillForming) {
      if (index === candles.length - 1) provisional = true;
      else incompleteHistory = true;
    }
    normalized.push({ timestamp: timestamp.toISOString(), open, high, low, close });
  }
  return { normalized, provisional, incompleteHistory, gapDetected };
}

function noTradeReason(code, message) {
  return { code, message };
}

function candidateId(input) {
  return `cand_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function makeCandidate({ symbol, timeframe, evaluatedAt, referenceCandle, quote, direction, indicators, reasons, counterconditions, dataQuality, spreadStatus, expiry, entryConditions = [], stopLoss = null, takeProfit = null, rewardRisk = null }) {
  const idInput = { symbol, timeframe, strategy: STRATEGY_NAME, version: STRATEGY_VERSION, direction, evaluationTimestamp: evaluatedAt, referenceTimestamp: referenceCandle?.timestamp || null };
  return Object.freeze({
    candidateId: candidateId(idInput),
    createdAt: evaluatedAt,
    symbol,
    strategy: { name: STRATEGY_NAME, version: STRATEGY_VERSION },
    direction,
    signalStatus: dataQuality.warnings.includes("latest_candle_is_forming") ? "provisional" : dataQuality.status === "validated" ? "confirmed" : "not_confirmed",
    status: "informational",
    approvalState: "not_approved",
    executionState: "not_executed",
    timeframe,
    evaluatedAt,
    referencePrice: referenceCandle ? { value: round(referenceCandle.close), timestamp: referenceCandle.timestamp, source: "validated_candle_close" } : null,
    quoteSnapshot: quote ? { price: round(quote.price), timestamp: quote.timestamp, source: quote.source, dataMode: quote.dataMode } : null,
    entryConditions,
    stopLoss: stopLoss == null ? null : { value: round(stopLoss), basis: "ATR" },
    takeProfit: takeProfit == null ? null : { value: round(takeProfit), basis: "reward_to_risk" },
    rewardRisk: rewardRisk == null ? null : round(rewardRisk, 4),
    indicators: indicators ? Object.fromEntries(Object.entries(indicators).map(([key, value]) => [key, round(value, 6)])) : null,
    reasons,
    counterconditions,
    dataQuality,
    spreadStatus,
    expiry,
    invalidation: ["A new candle changes the validated indicator snapshot", "Quote becomes stale or delayed", "Spread exceeds the configured maximum", "The reference entry condition is not met"],
    inputSnapshot: { candleCount: dataQuality.candleCount, firstCandleTimestamp: dataQuality.firstCandleTimestamp, lastCandleTimestamp: dataQuality.lastCandleTimestamp }
  });
}

function baseDataQuality({ candleCount = 0, firstCandleTimestamp = null, lastCandleTimestamp = null, status = "unavailable", warnings = [] } = {}) {
  return { status, candleCount, firstCandleTimestamp, lastCandleTimestamp, warnings };
}

export function evaluateBaselineStrategy({ symbol, timeframe, candles, quote, strategyConfig, now = new Date() }) {
  const symbolDefinition = getSymbolDefinition(symbol);
  const timeframeDefinition = getTimeframeDefinition(timeframe);
  if (!symbolDefinition) throw new StrategyInputError("symbol is unavailable");
  if (!timeframeDefinition) throw new StrategyInputError("timeframe is unsupported");
  if (!strategyConfig || !Number.isSafeInteger(strategyConfig.fastMaPeriod) || !Number.isSafeInteger(strategyConfig.slowMaPeriod)) throw new StrategyInputError("strategy configuration is invalid");
  if (strategyConfig.slowMaPeriod <= strategyConfig.fastMaPeriod) throw new StrategyInputError("slow moving average period must exceed fast period");
  const evaluatedAt = iso(now);
  const nowMs = new Date(evaluatedAt).getTime();
  const validated = validateCandles(candles, timeframeDefinition.seconds, nowMs);
  const closedCandles = validated.provisional ? validated.normalized.slice(0, -1) : validated.normalized;
  const last = closedCandles.at(-1);
  const expiry = new Date(nowMs + timeframeDefinition.seconds * 2_000).toISOString();
  const dataWarnings = [];
  if (validated.provisional) dataWarnings.push("latest_candle_is_forming");
  if (validated.incompleteHistory) dataWarnings.push("incomplete_candle_history");
  if (validated.gapDetected) dataWarnings.push("missing_periods_detected");
  const dataQuality = baseDataQuality({ candleCount: closedCandles.length, firstCandleTimestamp: closedCandles[0]?.timestamp || null, lastCandleTimestamp: last?.timestamp || null, status: dataWarnings.length ? "degraded" : "validated", warnings: dataWarnings });
  const noTrade = (reasons, extra = {}) => makeCandidate({ symbol, timeframe, evaluatedAt, referenceCandle: last, quote, direction: "NO TRADE", indicators: extra.indicators || null, reasons, counterconditions: extra.counterconditions || [], dataQuality, spreadStatus: extra.spreadStatus || { status: "unavailable", spreadPips: null, maximumPips: strategyConfig.maxSpreadPips }, expiry });

  if (validated.incompleteHistory || validated.gapDetected) return noTrade([noTradeReason("data_quality", "Candle history contains incomplete periods and cannot support a reliable evaluation")]);
  const minimumCandles = Math.max(strategyConfig.slowMaPeriod, strategyConfig.rsiPeriod + 1, strategyConfig.atrPeriod);
  if (closedCandles.length < minimumCandles) return noTrade([noTradeReason("insufficient_history", `At least ${minimumCandles} closed candles are required for the configured warm-up periods`)]);
  if (!quote || typeof quote !== "object") return noTrade([noTradeReason("quote_unavailable", "A validated current quote is required")]);
  if ([quote.price, quote.timestamp].some((value) => value == null)) return noTrade([noTradeReason("quote_malformed", "The current quote is incomplete")]);
  const quoteTimestamp = new Date(quote.timestamp);
  if (Number.isNaN(quoteTimestamp.getTime())) return noTrade([noTradeReason("quote_timestamp_invalid", "The current quote timestamp is invalid")]);
  const quoteAgeSeconds = (nowMs - quoteTimestamp.getTime()) / 1_000;
  const quoteMaxAge = strategyConfig.quoteMaxAgeSeconds || 120;
  if (typeof quote.price !== "number" || !Number.isFinite(quote.price) || quote.price <= 0) return noTrade([noTradeReason("quote_malformed", "The current quote price is invalid")]);
  if (quoteAgeSeconds < -300 || quoteAgeSeconds > quoteMaxAge || quote.freshness?.status === "stale") return noTrade([noTradeReason("stale_quote", "The current quote is stale")], { spreadStatus: { status: "stale", spreadPips: null, maximumPips: strategyConfig.maxSpreadPips } });
  if (quote.dataMode === "delayed") return noTrade([noTradeReason("delayed_quote", "Delayed data cannot support a current candidate")]);
  if (quoteTimestamp.getTime() < new Date(last.timestamp).getTime()) return noTrade([noTradeReason("quote_older_than_candles", "The current quote predates the latest closed candle")]);
  const spreadPips = quote.spread == null ? null : quote.spread / DEFAULT_PIP_SIZE;
  const spreadStatus = { status: spreadPips == null ? "unavailable" : spreadPips <= strategyConfig.maxSpreadPips ? "acceptable" : "too_wide", spreadPips: spreadPips == null ? null : round(spreadPips, 4), maximumPips: strategyConfig.maxSpreadPips };
  if (spreadPips == null) return noTrade([noTradeReason("spread_unavailable", "Bid/ask spread is unavailable")], { spreadStatus });
  if (spreadPips > strategyConfig.maxSpreadPips) return noTrade([noTradeReason("spread_too_wide", "Spread exceeds the configured candidate threshold")], { spreadStatus });
  const closes = closedCandles.map((candle) => candle.close);
  const fastMa = simpleMovingAverage(closes, strategyConfig.fastMaPeriod).at(-1);
  const slowMa = simpleMovingAverage(closes, strategyConfig.slowMaPeriod).at(-1);
  const rsi = relativeStrengthIndex(closes, strategyConfig.rsiPeriod).at(-1);
  const atr = averageTrueRange(closedCandles, strategyConfig.atrPeriod).at(-1);
  const indicators = { fastMa, slowMa, rsi, atr, atrPips: atr / DEFAULT_PIP_SIZE, spreadPips };
  if (![fastMa, slowMa, rsi, atr].every((value) => typeof value === "number" && Number.isFinite(value))) return noTrade([noTradeReason("indicator_warmup", "Indicators have not completed their deterministic warm-up period")], { indicators, spreadStatus });
  if (indicators.atrPips < strategyConfig.minAtrPips) return noTrade([noTradeReason("volatility_too_low", "ATR is below the configured minimum volatility threshold")], { indicators, spreadStatus });
  const bullish = fastMa > slowMa && rsi >= 50 && rsi <= 70;
  const bearish = fastMa < slowMa && rsi >= 30 && rsi <= 50;
  if (!bullish && !bearish) return noTrade([noTradeReason("conditions_unclear", "Trend and RSI do not align for a baseline setup")], { indicators, spreadStatus, counterconditions: ["Fast and slow moving averages are not aligned with the RSI confirmation band"] });
  const direction = bullish ? "BUY" : "SELL";
  const referencePrice = last.close;
  const riskDistance = atr * strategyConfig.stopAtrMultiplier;
  const stopLoss = direction === "BUY" ? referencePrice - riskDistance : referencePrice + riskDistance;
  const takeProfit = direction === "BUY" ? referencePrice + riskDistance * strategyConfig.minRewardRisk : referencePrice - riskDistance * strategyConfig.minRewardRisk;
  if (stopLoss <= 0 || takeProfit <= 0 || !Number.isFinite(stopLoss) || !Number.isFinite(takeProfit)) return noTrade([noTradeReason("invalid_levels", "Calculated protective levels are invalid")], { indicators, spreadStatus });
  return makeCandidate({ symbol, timeframe, evaluatedAt, referenceCandle: last, quote, direction, indicators, reasons: [noTradeReason("trend_confirmed", `${direction === "BUY" ? "Fast MA is above slow MA" : "Fast MA is below slow MA"}`), noTradeReason("momentum_confirmed", `RSI is within the ${direction === "BUY" ? "bullish" : "bearish"} confirmation band`), noTradeReason("volatility_acceptable", "ATR meets the configured minimum")], counterconditions: ["A future candle must satisfy the entry condition; this evaluation does not assume a fill"], dataQuality, spreadStatus, expiry, entryConditions: [{ type: "confirmation_required", description: `${direction} only if a subsequent closed candle confirms beyond the reference price`, referencePrice: round(referencePrice) }], stopLoss, takeProfit, rewardRisk: strategyConfig.minRewardRisk });
}
