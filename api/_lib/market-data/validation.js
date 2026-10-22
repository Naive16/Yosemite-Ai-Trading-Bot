import { DEFAULT_SYMBOL, DEFAULT_TIMEFRAME, getSymbolDefinition, getTimeframeDefinition } from "./symbols.js";

export class MarketDataValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "MarketDataValidationError";
  }
}

function oneValue(value, key) {
  if (Array.isArray(value)) throw new MarketDataValidationError(`${key} is invalid`);
  return typeof value === "string" ? value.trim() : value;
}

export function parseMarketDataQuery(request) {
  const url = request?.url ? new URL(request.url, "http://localhost") : null;
  const source = request?.query && typeof request.query === "object" ? request.query : Object.fromEntries(url?.searchParams || []);
  const kind = oneValue(source.kind ?? "quote", "kind");
  const symbol = oneValue(source.symbol ?? DEFAULT_SYMBOL, "symbol");
  const timeframe = oneValue(source.timeframe ?? DEFAULT_TIMEFRAME, "timeframe");
  const rawLimit = oneValue(source.limit ?? "90", "limit");

  if (!new Set(["quote", "candles"]).has(kind)) throw new MarketDataValidationError("kind must be quote or candles");
  if (typeof symbol !== "string" || !getSymbolDefinition(symbol)) throw new MarketDataValidationError("symbol is unavailable");
  if (typeof timeframe !== "string" || !getTimeframeDefinition(timeframe)) throw new MarketDataValidationError("timeframe is unsupported");
  if (!/^\d+$/.test(String(rawLimit))) throw new MarketDataValidationError("limit must be an integer");
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 10 || limit > 300) throw new MarketDataValidationError("limit must be between 10 and 300");
  return Object.freeze({ kind, symbol, timeframe, limit });
}

export function parsePositiveDecimal(value, field = "value") {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string" || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) throw new MarketDataValidationError(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new MarketDataValidationError(`${field} is invalid`);
  return parsed;
}

export function parseMarketTimestamp(value, field = "timestamp") {
  let date;
  if (typeof value === "number" && Number.isFinite(value)) date = new Date(value > 10_000_000_000 ? value : value * 1_000);
  else if (typeof value === "string" && value.trim()) {
    const candidate = value.includes("T") ? (/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`) : `${value.replace(" ", "T")}Z`;
    date = new Date(candidate);
  }
  if (!date || Number.isNaN(date.getTime())) throw new MarketDataValidationError(`${field} is invalid`);
  return date;
}
