const DIRECTIONS = new Set(["BUY", "SELL", "NO TRADE"]);
const MAX_TEXT = 1_000;

// Sent to Anthropic when supported. Runtime validation below remains mandatory
// because provider responses are untrusted even when structured output is used.
export const CLAUDE_ANALYSIS_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    symbol: { type: "string" }, timeframe: { type: "string" }, analysisTimestamp: { type: "string" },
    recommendation: { type: "string", enum: ["BUY", "SELL", "NO TRADE"] }, summary: { type: "string" },
    technicalEvidence: { type: "array", items: { type: "string" } }, newsAndEconomicContext: { type: "array", items: { type: "string" } },
    supportingEvidence: { type: "array", items: { type: "string" } }, opposingEvidence: { type: "array", items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" } }, invalidationConditions: { type: "array", items: { type: "string" } },
    eventRisks: { type: "array", items: { type: "string" } }, newsReferences: { type: "array", items: { type: "string" } },
    proposedEntry: { type: ["number", "null"] }, stopLoss: { type: ["number", "null"] }, takeProfit: { type: ["number", "null"] }, rewardRisk: { type: ["number", "null"] },
    dataQualityWarnings: { type: "array", items: { type: "string" } }, expiry: { type: "string" }, model: { type: "object", properties: { id: { type: "string" }, requestId: { type: "string" } }, required: ["id", "requestId"], additionalProperties: true }
  },
  required: ["symbol", "timeframe", "analysisTimestamp", "recommendation", "summary", "technicalEvidence", "newsAndEconomicContext", "supportingEvidence", "opposingEvidence", "uncertainties", "invalidationConditions", "eventRisks", "newsReferences", "proposedEntry", "stopLoss", "takeProfit", "rewardRisk", "dataQualityWarnings", "expiry", "model"]
});

export class ClaudeResponseError extends Error {
  constructor(message) { super(message); this.name = "ClaudeResponseError"; }
}

function requiredText(value, field, max = MAX_TEXT) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ClaudeResponseError(`${field} is invalid`);
  return value.trim();
}

function textList(value, field, maxItems = 8) {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_TEXT)) throw new ClaudeResponseError(`${field} is invalid`);
  return value.map((item) => item.trim());
}

function iso(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ClaudeResponseError(`${field} is invalid`);
  return date.toISOString();
}

function optionalLevel(value, field) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new ClaudeResponseError(`${field} is invalid`);
  return Number(value.toFixed(8));
}

export function validateClaudeAnalysis(value, { symbol, timeframe, now = new Date(), allowedSourceIds = new Set() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClaudeResponseError("Claude response must be an object");
  if (value.symbol !== symbol || value.timeframe !== timeframe) throw new ClaudeResponseError("Claude response scope does not match the request");
  const analysisTimestamp = iso(value.analysisTimestamp, "analysisTimestamp");
  if (new Date(analysisTimestamp).getTime() > new Date(now).getTime() + 60_000) throw new ClaudeResponseError("analysisTimestamp cannot be in the future");
  if (!DIRECTIONS.has(value.recommendation)) throw new ClaudeResponseError("recommendation is invalid");
  const newsReferences = Array.isArray(value.newsReferences) ? value.newsReferences : [];
  if (newsReferences.length > 8 || newsReferences.some((id) => typeof id !== "string" || !allowedSourceIds.has(id))) throw new ClaudeResponseError("newsReferences contain unverified sources");
  const entry = optionalLevel(value.proposedEntry, "proposedEntry");
  const stopLoss = optionalLevel(value.stopLoss, "stopLoss");
  const takeProfit = optionalLevel(value.takeProfit, "takeProfit");
  const rewardRisk = value.rewardRisk == null ? null : optionalLevel(value.rewardRisk, "rewardRisk");
  if (value.recommendation === "NO TRADE" && (entry != null || stopLoss != null || takeProfit != null || rewardRisk != null)) throw new ClaudeResponseError("NO TRADE cannot contain proposed trade levels");
  if (rewardRisk != null && rewardRisk > 20) throw new ClaudeResponseError("rewardRisk is out of range");
  const expiry = iso(value.expiry, "expiry");
  if (new Date(expiry).getTime() <= new Date(analysisTimestamp).getTime()) throw new ClaudeResponseError("expiry must follow analysisTimestamp");
  const result = {
    symbol, timeframe, analysisTimestamp, recommendation: value.recommendation,
    summary: requiredText(value.summary, "summary"), technicalEvidence: textList(value.technicalEvidence, "technicalEvidence"),
    newsAndEconomicContext: textList(value.newsAndEconomicContext, "newsAndEconomicContext"), supportingEvidence: textList(value.supportingEvidence, "supportingEvidence"),
    opposingEvidence: textList(value.opposingEvidence, "opposingEvidence"), uncertainties: textList(value.uncertainties, "uncertainties"),
    invalidationConditions: textList(value.invalidationConditions, "invalidationConditions"), eventRisks: textList(value.eventRisks, "eventRisks"),
    newsReferences, proposedEntry: entry, stopLoss, takeProfit, rewardRisk,
    dataQualityWarnings: textList(value.dataQualityWarnings, "dataQualityWarnings"), expiry,
    model: { id: requiredText(value.model?.id, "model.id", 128), requestId: requiredText(value.model?.requestId, "model.requestId", 128), confidence: null },
    metadata: { source: "claude", status: "analysis_only", calibratedProbability: false }
  };
  return Object.freeze(result);
}
