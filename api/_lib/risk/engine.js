import { randomUUID } from "node:crypto";
import { calculatePositionSize, PositionSizingError } from "./position-sizing.js";

export const RISK_ENGINE_NAME = "independent-risk-engine";
export const RISK_ENGINE_VERSION = "1.0.0";

export class RiskInputError extends Error { constructor(message, code = "invalid_risk_input") { super(message); this.name = "RiskInputError"; this.code = code; } }

function iso(value, field) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new RiskInputError(`${field} is invalid`); return date.toISOString(); }
function positive(value, field) { if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new RiskInputError(`${field} is invalid`); return value; }
function finite(value, field) { if (typeof value !== "number" || !Number.isFinite(value)) throw new RiskInputError(`${field} is invalid`); return value; }
function check(code, status, message) { return { code, status, message }; }
function tradingDayKey(value, timeZone) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }

export function evaluateRisk({ candidate, account, instrument, quote, exposure, riskConfig, now = new Date(), simulationContext = false }) {
  const evaluatedAt = iso(now, "evaluation timestamp");
  const checks = []; const reasons = []; const blocked = []; const rejected = [];
  const block = (code, message) => { blocked.push(code); checks.push(check(code, "BLOCKED", message)); };
  const reject = (code, message) => { rejected.push(code); checks.push(check(code, "REJECT", message)); };
  const pass = (code, message) => checks.push(check(code, "PASS", message));
  if (!riskConfig || riskConfig.version !== "risk-baseline-v1") block("risk_config_unavailable", "A recognized risk configuration is required");
  if (!candidate || typeof candidate !== "object") block("candidate_unavailable", "A deterministic candidate is required");
  if (candidate && !["BUY", "SELL"].includes(candidate.direction)) reject("candidate_not_tradeable", "Only a BUY or SELL candidate can be evaluated");
  if (candidate && (candidate.status !== "informational" || candidate.approvalState === "approved" || candidate.executionState === "executed")) reject("candidate_state_invalid", "Candidate state is not an informational, unexecuted proposal");
  if (candidate?.expiry && new Date(candidate.expiry).getTime() <= new Date(evaluatedAt).getTime()) reject("candidate_expired", "Candidate expiry has passed");
  if (candidate?.symbol && instrument?.symbol && candidate.symbol !== instrument.symbol) reject("symbol_conflict", "Candidate and instrument symbols conflict");
  if (!account || typeof account !== "object") block("account_unavailable", "Trusted account state is unavailable");
  if (!instrument || typeof instrument !== "object") block("instrument_specs_unavailable", "Trusted instrument specifications are unavailable");
  if (!quote || typeof quote !== "object") block("quote_unavailable", "A trusted current quote is required");
  if (!exposure || typeof exposure !== "object") block("exposure_unavailable", "Trusted exposure state is unavailable");
  if (account?.isSimulated && !simulationContext) block("simulated_account_state", "Simulated account state cannot authorize a live risk evaluation");
  if (account && (typeof account.currency !== "string" || !/^[A-Z]{3}$/.test(account.currency))) block("account_currency_invalid", "Account currency is invalid");
  if (account && (typeof account.equity !== "number" || account.equity <= 0 || typeof account.dailyStartEquity !== "number" || account.dailyStartEquity <= 0)) block("equity_state_invalid", "Current and daily-start equity are required");
  if (account && account.tradingDayKey !== tradingDayKey(evaluatedAt, riskConfig?.timeZone || "UTC")) block("trading_day_state_invalid", "Daily-start equity does not match the configured trading day");
  if (exposure && (typeof exposure.openPositions !== "number" || exposure.openPositions < 0 || typeof exposure.lossStreak !== "number" || exposure.lossStreak < 0)) block("exposure_state_invalid", "Position and loss-streak state is invalid");
  if (riskConfig && exposure && exposure.openPositions >= riskConfig.maxOpenPositions) reject("max_open_positions", "Maximum simultaneous open positions reached"); else if (riskConfig && exposure) pass("max_open_positions", "Open-position count is within the configured limit");
  if (riskConfig && account && typeof account.lossToday === "number") { if (account.lossToday >= account.dailyStartEquity * riskConfig.dailyLossHaltFraction) reject("daily_loss_halt", "Daily loss halt has been reached"); else pass("daily_loss_halt", "Daily loss is below the configured halt"); } else block("daily_loss_unavailable", "Reliable daily loss state is required");
  if (riskConfig && exposure && exposure.lossStreak >= riskConfig.coolingAfterLosses && (!exposure.coolingUntil || new Date(exposure.coolingUntil).getTime() > new Date(evaluatedAt).getTime())) reject("loss_streak_cooling", "Cooling period after consecutive losses is active"); else if (riskConfig && exposure) pass("loss_streak_cooling", "No active loss-streak cooling period");
  if (quote?.timestamp) { const age = (new Date(evaluatedAt) - new Date(quote.timestamp)) / 1_000; if (!Number.isFinite(age) || age < -5 || age > riskConfig.maxQuoteAgeSeconds) block("quote_stale", "Quote is stale or has an invalid timestamp"); else pass("quote_freshness", "Quote is within the configured age limit"); } else block("quote_timestamp_missing", "Quote timestamp is required");
  if (candidate?.rewardRisk != null && candidate.rewardRisk < riskConfig.minRewardRisk) reject("reward_risk_below_minimum", "Candidate reward:risk is below the configured minimum"); else if (candidate?.rewardRisk == null) block("reward_risk_unavailable", "Candidate reward:risk is required"); else pass("reward_risk", "Candidate reward:risk meets the configured minimum");
  let sizing = null;
  if (candidate && account && instrument && quote && exposure && !blocked.length && !rejected.length) {
    try {
      const entry = candidate.referencePrice?.value; const stopLoss = candidate.stopLoss?.value; const takeProfit = candidate.takeProfit?.value;
      positive(entry, "candidate entry"); positive(stopLoss, "candidate stop-loss"); positive(takeProfit, "candidate take-profit");
      if ((candidate.direction === "BUY" && takeProfit <= entry) || (candidate.direction === "SELL" && takeProfit >= entry)) reject("invalid_take_profit_side", "Take-profit is on the wrong side of entry");
      if (quote.price != null && Math.abs(quote.price - entry) / instrument.pipSize > riskConfig.maxPriceDriftPips) reject("price_drift", "Current quote has drifted beyond the configured limit");
      sizing = calculatePositionSize({ equity: account.equity, riskFraction: riskConfig.maxEquityRiskFraction, entry, stopLoss, direction: candidate.direction, instrument, accountCurrency: account.currency, conversionRates: account.conversionRates, spreadPips: quote.spreadPips || 0, commissionPerLot: instrument.commissionPerLot || 0, existingExposure: exposure.totalExposure || 0, maxTotalExposure: instrument.maxTotalExposure || Number.POSITIVE_INFINITY });
      pass("position_sizing", "Position size fits the configured risk budget and exposure limits");
    } catch (error) { if (error instanceof PositionSizingError) block(error.code, error.message); else throw error; }
  }
  const decision = rejected.length ? "REJECT" : blocked.length ? "BLOCKED" : "PASS";
  return Object.freeze({ riskEvaluationId: `risk_${randomUUID()}`, evaluatedAt, engine: { name: RISK_ENGINE_NAME, version: RISK_ENGINE_VERSION }, decision, isApproval: false, executionAllowed: false, tradingEnabled: false, tradingDayKey: riskConfig ? tradingDayKey(evaluatedAt, riskConfig.timeZone) : null, reasonCodes: [...new Set([...rejected, ...blocked])], checks, positionSizing: sizing, warnings: ["PASS is risk validation only; it is not approval or authorization", "Estimated stop loss can be exceeded by gaps and slippage"] });
}
