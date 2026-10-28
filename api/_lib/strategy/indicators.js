export class IndicatorInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "IndicatorInputError";
  }
}

function assertPeriod(period) {
  if (!Number.isSafeInteger(period) || period < 2) throw new IndicatorInputError("Indicator period must be at least 2");
}

function assertValues(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new IndicatorInputError("Indicator values must be finite numbers");
}

export function simpleMovingAverage(values, period) {
  assertPeriod(period);
  assertValues(values);
  const result = Array(values.length).fill(null);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) result[index] = sum / period;
  }
  return result;
}

export function relativeStrengthIndex(closes, period) {
  assertPeriod(period);
  assertValues(closes);
  const result = Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  result[period] = rsiValue(averageGain, averageLoss);
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    averageGain = ((averageGain * (period - 1)) + gain) / period;
    averageLoss = ((averageLoss * (period - 1)) + loss) / period;
    result[index] = rsiValue(averageGain, averageLoss);
  }
  return result;
}

function rsiValue(averageGain, averageLoss) {
  if (averageLoss === 0 && averageGain === 0) return 50;
  if (averageLoss === 0) return 100;
  return 100 - (100 / (1 + (averageGain / averageLoss)));
}

export function averageTrueRange(candles, period) {
  assertPeriod(period);
  if (!Array.isArray(candles) || candles.some((candle) => !candle || ![candle.open, candle.high, candle.low, candle.close].every((value) => typeof value === "number" && Number.isFinite(value)))) throw new IndicatorInputError("ATR candles are invalid");
  const result = Array(candles.length).fill(null);
  if (candles.length < period) return result;
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  let sum = 0;
  for (let index = 0; index < trueRanges.length; index += 1) {
    sum += trueRanges[index];
    if (index >= period) sum -= trueRanges[index - period];
    if (index >= period - 1) result[index] = sum / period;
  }
  return result;
}
