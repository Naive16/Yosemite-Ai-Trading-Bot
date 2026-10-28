import { createHash } from "node:crypto";

export const PAPER_ENGINE_VERSION = "1.0.0";
export class PaperInputError extends Error { constructor(message, code = "invalid_paper_event") { super(message); this.name = "PaperInputError"; this.code = code; } }

export class PaperSimulator {
  constructor({ startingEquity, accountCurrency, assumptions = {} } = {}) { if (typeof startingEquity !== "number" || !Number.isFinite(startingEquity) || startingEquity <= 0) throw new PaperInputError("Starting simulated equity is invalid"); this.state = { mode: "paper_simulation", engineVersion: PAPER_ENGINE_VERSION, accountCurrency, equity: startingEquity, startingEquity, positions: [], orders: [], trades: [], processedEvents: new Set(), assumptions: { spreadPips: 0, slippagePips: 0, commissionPerUnit: 0, ...assumptions } }; }
  processEvent({ eventId, proposal, quote, now = new Date() } = {}) {
    if (typeof eventId !== "string" || !eventId || eventId.length > 200) throw new PaperInputError("Event ID is invalid");
    if (this.state.processedEvents.has(eventId)) return { status: "duplicate", eventId, state: this.snapshot() };
    this.state.processedEvents.add(eventId);
    if (!proposal || proposal.status !== "approved" || proposal.immutableContent?.risk?.decision !== "PASS") return { status: "skipped", eventId, reason: "proposal_not_approved_or_risk_passed", state: this.snapshot() };
    if (!quote || typeof quote.price !== "number" || !Number.isFinite(quote.price) || quote.dataMode === "unavailable") return { status: "skipped", eventId, reason: "quote_unavailable", state: this.snapshot() };
    const content = proposal.immutableContent; const direction = content.direction; const entry = content.proposedEntry?.value; const stop = content.stopLoss?.value; const target = content.takeProfit?.value; if (!["BUY", "SELL"].includes(direction) || ![entry, stop, target].every((value) => typeof value === "number" && Number.isFinite(value))) return { status: "skipped", eventId, reason: "proposal_parameters_invalid", state: this.snapshot() };
    const price = quote.price + (direction === "BUY" ? this.state.assumptions.slippagePips : -this.state.assumptions.slippagePips); const position = { paperPositionId: `paper_${createHash("sha256").update(eventId).digest("hex").slice(0, 24)}`, eventId, proposalId: proposal.proposalId, proposalVersion: proposal.proposalVersion, symbol: content.symbol, direction, entryPrice: price, stopLoss: stop, takeProfit: target, openedAt: new Date(now).toISOString(), simulated: true };
    this.state.positions.push(position); this.state.orders.push({ orderId: position.paperPositionId, status: "filled_simulated", simulated: true, eventId }); return { status: "opened_simulated", eventId, position, state: this.snapshot() };
  }
  snapshot() { return { ...this.state, processedEvents: this.state.processedEvents.size, positions: this.state.positions.map((item) => ({ ...item })), orders: this.state.orders.map((item) => ({ ...item })), trades: this.state.trades.map((item) => ({ ...item })) }; }
}
