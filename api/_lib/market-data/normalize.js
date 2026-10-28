import { MarketDataValidationError, parseMarketTimestamp, parsePositiveDecimal } from "./validation.js";

export class MarketDataResponseError extends Error {
  constructor(message, code = "invalid_response") {
    super(message);
    this.name = "MarketDataResponseError";
    this.code = code;
  }
}

function toIso(value, field) {
  try {
    return parseMarketTimestamp(value, field).toISOString();
  } catch (error) {
    if (error instanceof MarketDataValidationError) throw new MarketDataResponseError(error.message, "invalid_data");
    throw error;
  }
}

function freshness(timestamp, staleAfterSeconds, now = Date.now()) {
  const ageSeconds = Math.round((now - new Date(timestamp).getTime()) / 1_000);
  if (ageSeconds < -300) return { status: "invalid", ageSeconds };
  return { status: ageSeconds <= staleAfterSeconds ? "fresh" : "stale", ageSeconds };
}

export function normalizeQuote(raw, { symbol, source, dataMode = "live", staleAfterSeconds = 120, receivedAt = Date.now() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MarketDataResponseError("Provider quote is malformed");
  const timestamp = toIso(raw.timestamp ?? raw.datetime ?? raw.time ?? raw.updatedAt, "quote timestamp");
  const bid = raw.bid == null ? null : parsePositiveDecimal(raw.bid, "bid");
  const ask = raw.ask == null ? null : parsePositiveDecimal(raw.ask, "ask");
  if ((bid == null) !== (ask == null)) throw new MarketDataResponseError("Provider quote has an incomplete bid/ask pair", "invalid_data");
  if (bid != null && ask < bid) throw new MarketDataResponseError("Provider quote has an invalid spread", "invalid_data");
  const price = parsePositiveDecimal(raw.price ?? raw.close ?? raw.last ?? (bid != null && ask != null ? (bid + ask) / 2 : null), "price");
  const quoteFreshness = freshness(timestamp, staleAfterSeconds, receivedAt);
  if (quoteFreshness.status === "invalid") throw new MarketDataResponseError("Provider quote timestamp is in the future", "invalid_data");
  const delayed = raw.delayed === true || raw.isDelayed === true || raw.dataMode === "delayed";
  return Object.freeze({
    symbol,
    price,
    bid,
    ask,
    spread: bid != null && ask != null ? ask - bid : null,
    timestamp,
    source,
    dataMode: delayed ? "delayed" : dataMode,
    freshness: quoteFreshness
  });
}

function normalizeCandle(raw, symbol, timeframe, source, dataMode) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MarketDataResponseError("Provider candle is malformed");
  const open = parsePositiveDecimal(raw.open, "open");
  const high = parsePositiveDecimal(raw.high, "high");
  const low = parsePositiveDecimal(raw.low, "low");
  const close = parsePositiveDecimal(raw.close, "close");
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) throw new MarketDataResponseError("Provider candle violates OHLC bounds", "invalid_data");
  const timestamp = toIso(raw.timestamp ?? raw.datetime ?? raw.time, "candle timestamp");
  if (new Date(timestamp).getTime() > Date.now() + 300_000) throw new MarketDataResponseError("Provider candle timestamp is in the future", "invalid_data");
  const volume = raw.volume == null ? null : Number(raw.volume);
  if (volume != null && (!Number.isFinite(volume) || volume < 0)) throw new MarketDataResponseError("Provider candle volume is invalid", "invalid_data");
  return { symbol, timeframe, timestamp, open, high, low, close, volume, source, dataMode };
}

export function detectCandleGaps(candles, timeframeSeconds) {
  const warnings = [];
  for (let index = 1; index < candles.length; index += 1) {
    const gapSeconds = (new Date(candles[index].timestamp).getTime() - new Date(candles[index - 1].timestamp).getTime()) / 1_000;
    if (gapSeconds > timeframeSeconds * 2.5) warnings.push({ from: candles[index - 1].timestamp, to: candles[index].timestamp, gapSeconds });
  }
  return warnings;
}

export function normalizeCandles(rawValues, { symbol, timeframe, timeframeSeconds, source, dataMode = "live", maxCandles = 300 } = {}) {
  if (!Array.isArray(rawValues)) throw new MarketDataResponseError("Provider candles are malformed");
  if (rawValues.length > maxCandles) throw new MarketDataResponseError("Provider returned too many candles", "response_too_large");
  if (rawValues.length === 0) return { candles: [], qualityWarnings: ["no_candles"] };
  const byTimestamp = new Map();
  for (const raw of rawValues) {
    const candle = normalizeCandle(raw, symbol, timeframe, source, dataMode);
    byTimestamp.set(candle.timestamp, candle);
  }
  const candles = [...byTimestamp.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return { candles, qualityWarnings: detectCandleGaps(candles, timeframeSeconds) };
}

export function latestCandleFreshness(candles, timeframeSeconds, now = Date.now()) {
  if (!candles.length) return { status: "unknown", ageSeconds: null };
  const timestamp = candles[candles.length - 1].timestamp;
  return freshness(timestamp, Math.max(timeframeSeconds * 3, 300), now);
}
