export class PositionSizingError extends Error {
  constructor(message, code = "position_sizing_blocked") { super(message); this.name = "PositionSizingError"; this.code = code; }
}

function positive(value, field) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new PositionSizingError(`${field} is invalid`); return value; }
function nonNegative(value, field) { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new PositionSizingError(`${field} is invalid`); return value; }

export function findConversionRate(from, to, rates = {}) {
  if (from === to) return 1;
  const direct = rates[`${from}/${to}`];
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  const inverse = rates[`${to}/${from}`];
  if (typeof inverse === "number" && Number.isFinite(inverse) && inverse > 0) return 1 / inverse;
  throw new PositionSizingError("A reliable account-currency conversion rate is unavailable", "conversion_unavailable");
}

export function calculatePositionSize({ equity, riskFraction, entry, stopLoss, direction, instrument, accountCurrency, conversionRates = {}, spreadPips = 0, commissionPerLot = 0, existingExposure = 0, maxTotalExposure = Number.POSITIVE_INFINITY }) {
  positive(equity, "equity"); positive(riskFraction, "riskFraction"); positive(entry, "entry"); positive(stopLoss, "stopLoss");
  if (!["BUY", "SELL"].includes(direction)) throw new PositionSizingError("direction is invalid");
  if ((direction === "BUY" && stopLoss >= entry) || (direction === "SELL" && stopLoss <= entry)) throw new PositionSizingError("stop-loss is on the wrong side", "invalid_stop_side");
  if (!instrument || typeof instrument !== "object") throw new PositionSizingError("instrument specifications are unavailable", "instrument_specs_unavailable");
  const pipSize = positive(instrument.pipSize, "pipSize");
  const pipValuePerLot = positive(instrument.pipValuePerLot, "pipValuePerLot");
  const contractSize = positive(instrument.contractSize, "contractSize");
  const minVolume = positive(instrument.minVolume, "minVolume");
  const maxVolume = positive(instrument.maxVolume, "maxVolume");
  const volumeStep = positive(instrument.volumeStep, "volumeStep");
  const quoteToAccount = findConversionRate(instrument.quoteCurrency, accountCurrency, conversionRates);
  nonNegative(spreadPips, "spreadPips"); nonNegative(commissionPerLot, "commissionPerLot"); nonNegative(existingExposure, "existingExposure"); positive(maxTotalExposure, "maxTotalExposure");
  const riskBudget = equity * riskFraction;
  const stopDistancePips = Math.abs(entry - stopLoss) / pipSize;
  const estimatedLossPerLot = (stopDistancePips + spreadPips) * pipValuePerLot * quoteToAccount + commissionPerLot;
  if (!Number.isFinite(estimatedLossPerLot) || estimatedLossPerLot <= 0) throw new PositionSizingError("Estimated stop loss is invalid");
  const remainingExposure = maxTotalExposure - existingExposure;
  if (remainingExposure <= 0) throw new PositionSizingError("Aggregate exposure limit is exhausted", "exposure_limit");
  const baseToAccount = findConversionRate(instrument.baseCurrency, accountCurrency, conversionRates);
  const notionalPerLot = contractSize * entry * baseToAccount;
  const rawVolume = Math.min(riskBudget / estimatedLossPerLot, remainingExposure / notionalPerLot, maxVolume);
  const roundedVolume = Math.floor((rawVolume + 1e-12) / volumeStep) * volumeStep;
  const volume = Number(roundedVolume.toFixed(8));
  if (volume < minVolume) throw new PositionSizingError("Calculated volume is below the instrument minimum", "minimum_volume");
  if (volume > maxVolume) throw new PositionSizingError("Calculated volume exceeds the instrument maximum", "maximum_volume");
  return Object.freeze({ volume, volumeUnit: instrument.volumeUnit || "lots", riskBudget: Number(riskBudget.toFixed(8)), estimatedLossAtStop: Number((volume * estimatedLossPerLot).toFixed(8)), estimatedLossPerLot: Number(estimatedLossPerLot.toFixed(8)), stopDistancePips: Number(stopDistancePips.toFixed(4)), quoteToAccountRate: Number(quoteToAccount.toFixed(8)), baseToAccountRate: Number(baseToAccount.toFixed(8)), notionalPerLot: Number(notionalPerLot.toFixed(8)), costAssumptions: { spreadPips, commissionPerLot }, accountCurrency, estimateCaveat: "Estimated loss can be exceeded by gaps, slippage, spread changes, and other costs" });
}
