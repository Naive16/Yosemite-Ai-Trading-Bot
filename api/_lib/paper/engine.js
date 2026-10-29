import { createHash, randomUUID } from "node:crypto";
import { evaluateRisk } from "../risk/engine.js";
import { calculatePositionSize } from "../risk/position-sizing.js";
import { getSymbolDefinition } from "../../_lib/market-data/symbols.js";

export const PAPER_ENGINE_VERSION = "1.0.0";
export const PAPER_MODE = "paper_simulation";

export class PaperEngineError extends Error {
  constructor(message, code = "paper_engine_error") {
    super(message);
    this.name = "PaperEngineError";
    this.code = code;
  }
}

export class PaperValidationError extends PaperEngineError {
  constructor(message) { super(message, "paper_validation_error"); this.name = "PaperValidationError"; }
}

export class PaperInsufficientFundsError extends PaperEngineError {
  constructor(message) { super(message, "insufficient_funds"); this.name = "PaperInsufficientFundsError"; }
}

function positive(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new PaperValidationError(`${field} is invalid`);
  return value;
}

function nonNegative(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new PaperValidationError(`${field} is invalid`);
  return value;
}

function requiredString(value, field, maximum = 128) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new PaperValidationError(`${field} is invalid`);
  return value.trim();
}

function iso(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new PaperValidationError(`${field} is invalid`);
  return date.toISOString();
}

/**
 * Persistent paper trading engine.
 *
 * All state is persisted through the provided database interface. The engine
 * never submits broker orders; it simulates fills using provided market data
 * and applies configurable spread/slippage/commission assumptions.
 *
 * Database tables used (all already defined by migration 004):
 *   paper_events, paper_positions, paper_trades
 */
export class PaperEngine {
  constructor({ db, userId, startingEquity = 10_000, accountCurrency = "USD",
                assumptions = { spreadPips: 1, slippagePips: 0.5, commissionPerUnit: 0 },
                conversionRates = {} } = {}) {
    if (!db || typeof db.execute !== "function") throw new PaperValidationError("Database interface is required");
    if (typeof startingEquity !== "number" || !Number.isFinite(startingEquity) || startingEquity <= 0) {
      throw new PaperValidationError("Starting simulated equity is invalid");
    }
    this.db = db;
    this.userId = requiredString(userId, "userId", 100);
    this.version = PAPER_ENGINE_VERSION;
    this.mode = PAPER_MODE;
    this.startingEquity = startingEquity;
    this.accountCurrency = requiredString(accountCurrency, "accountCurrency", 3).toUpperCase();
    const defaultRates = { "EUR/USD": 1.1, "GBP/USD": 1.25, "USD/ZAR": 18, "EUR/ZAR": 20 };
    this.conversionRates = Object.freeze({ ...defaultRates, ...conversionRates });
    this.assumptions = Object.freeze({
      spreadPips: nonNegative(assumptions.spreadPips ?? 1, "spreadPips"),
      slippagePips: nonNegative(assumptions.slippagePips ?? 0.5, "slippagePips"),
      commissionPerUnit: nonNegative(assumptions.commissionPerUnit ?? 0, "commissionPerUnit")
    });
    this._equity = null;
    this._positions = null;
    this._orders = null;
    this._trades = null;
  }

  /** Load full paper state from the database. */
  async load() {
    const [events, positions, trades] = await Promise.all([
      this.db.execute(this.db.client.from("paper_events").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }).limit(200)),
      this.db.execute(this.db.client.from("paper_positions").select("*").eq("user_id", this.userId).order("opened_at", { ascending: false }).limit(200)),
      this.db.execute(this.db.client.from("paper_trades").select("*").eq("user_id", this.userId).order("opened_at", { ascending: false }).limit(200))
    ]);
    const eventList = Array.isArray(events) ? events : [];
    const positionList = Array.isArray(positions) ? positions : [];
    const tradeList = Array.isArray(trades) ? trades : [];

    // Reconstruct equity from starting equity + closed trade P&L + open position unrealized P&L
    // Use the first event's starting equity if present, otherwise the configured startingEquity
    let equity = this.startingEquity;
    const startEvent = eventList.find((e) => e.payload && e.payload.event_type === "engine_started");
    if (startEvent && typeof startEvent.payload.starting_equity === "number") {
      equity = startEvent.payload.starting_equity;
    }
    let realizedPnl = 0;
    for (const trade of tradeList) {
      realizedPnl += Number(trade.net_pnl || 0);
    }
    equity += realizedPnl;

    this._equity = equity;
    this._positions = positionList.map((p) => ({
      paperPositionId: p.id,
      eventId: p.event_id,
      proposalId: p.proposal_id,
      proposalVersion: p.proposal_version,
      symbol: p.symbol,
      direction: p.direction,
      entryPrice: Number(p.entry_price),
      stopLoss: Number(p.stop_loss),
      takeProfit: Number(p.take_profit),
      status: p.status,
      openedAt: p.opened_at,
      closedAt: p.closed_at || null,
      unrealizedPnl: 0
    }));
    this._orders = []; // Paper orders are filled immediately; order history lives in events/trades
    this._trades = tradeList.map((t) => ({
      id: t.id,
      positionId: t.position_id,
      grossPnl: Number(t.gross_pnl),
      estimatedCosts: Number(t.estimated_costs || 0),
      netPnl: Number(t.net_pnl),
      openedAt: t.opened_at,
      closedAt: t.closed_at
    }));

    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      mode: this.mode,
      engineVersion: this.version,
      accountCurrency: this.accountCurrency,
      equity: this._equity,
      startingEquity: this.startingEquity,
      positions: this._positions.map((p) => ({ ...p })),
      orders: this._orders.map((o) => ({ ...o })),
      trades: this._trades.map((t) => ({ ...t })),
      assumptions: { ...this.assumptions },
      tradingEnabled: false,
      live: false,
      simulated: true,
      executionAllowed: false
    });
  }

  /** Record an engine start event in the audit/event log. */
  async recordEngineStart() {
    const eventId = `paper_${createHash("sha256").update(`${this.userId}:engine_started:${Date.now()}`).digest("hex").slice(0, 24)}`;
    await this.db.execute(
      this.db.client.from("paper_events").insert({
        id: eventId,
        user_id: this.userId,
        status: "engine_started",
        payload: { event_type: "engine_started", starting_equity: this._equity ?? this.startingEquity, currency: this.accountCurrency, assumptions: this.assumptions },
        created_at: new Date().toISOString()
      })
    );
    return eventId;
  }

  /**
   * Process a strategy candidate into a simulated paper position.
   *
   * Requires an approved candidate with risk PASS, a current quote, and
   * sufficient simulated equity. Applies spread/slippage/commission assumptions.
   * Never submits to a broker.
   */
  async openPosition({ eventId, proposal, quote, now = new Date() } = {}) {
    if (typeof eventId !== "string" || !eventId || eventId.length > 200) throw new PaperValidationError("Event ID is invalid");
    if (!proposal || proposal.status !== "approved") throw new PaperValidationError("Proposal must be approved");
    if (proposal.immutableContent?.risk?.decision !== "PASS") throw new PaperValidationError("Proposal risk decision must be PASS");

    const content = proposal.immutableContent;
    const direction = content.direction;
    const entry = content.proposedEntry?.value;
    const stopLoss = content.stopLoss?.value;
    const takeProfit = content.takeProfit?.value;

    if (!["BUY", "SELL"].includes(direction)) throw new PaperValidationError("Direction must be BUY or SELL");
    if (![entry, stopLoss, takeProfit].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) {
      throw new PaperValidationError("Proposal parameters are invalid");
    }

    if (!quote || typeof quote.price !== "number" || !Number.isFinite(quote.price) || quote.price <= 0) {
      throw new PaperValidationError("A valid current quote is required");
    }
    const quoteAgeSeconds = (new Date(now).getTime() - new Date(quote.timestamp).getTime()) / 1_000;
    if (!Number.isFinite(quoteAgeSeconds) || quoteAgeSeconds < -5 || quoteAgeSeconds > 120) {
      throw new PaperValidationError("Quote is stale or invalid");
    }

    // Apply slippage to entry
    const slippage = this.assumptions.slippagePips * 0.0001; // Assume 4-digit pip for forex
    const fillPrice = direction === "BUY" ? quote.price + slippage : quote.price - slippage;

    // Calculate risk-based volume using the existing position sizing engine
    const symbolDef = getSymbolDefinition(content.symbol);
    if (!symbolDef) throw new PaperValidationError("Symbol is not registered");

    const instrument = {
      symbol: content.symbol,
      baseCurrency: content.symbol.split("/")[0] || "EUR",
      quoteCurrency: content.symbol.split("/")[1] || "USD",
      contractSize: 100_000,
      pipSize: 0.0001,
      pipValuePerLot: 10,
      minVolume: 0.01,
      maxVolume: 10,
      volumeStep: 0.01,
      commissionPerLot: 0,
      maxTotalExposure: 50_000
    };

    // Use a minimal risk config for paper sizing
    const paperRiskConfig = {
      version: "risk-baseline-v1",
      maxEquityRiskFraction: 0.0025,
      maxOpenPositions: 5,
      minRewardRisk: 1.0,
      timeZone: "UTC"
    };

    const riskAccount = {
      currency: this.accountCurrency,
      equity: this._equity,
      dailyStartEquity: this._equity,
      lossToday: 0,
      tradingDayKey: new Date(now).toISOString().split("T")[0],
      isSimulated: true,
      conversionRates: this.conversionRates
    };

    const riskExposure = {
      openPositions: this._positions.filter((p) => p.status === "open").length,
      totalExposure: 0,
      lossStreak: 0
    };

    const riskCandidate = {
      candidateId: `cand_${eventId}`,
      symbol: content.symbol,
      direction,
      status: "informational",
      approvalState: "not_approved",
      executionState: "not_executed",
      referencePrice: { value: entry },
      stopLoss: { value: stopLoss },
      takeProfit: { value: takeProfit },
      rewardRisk: content.rewardRisk ?? 1.5,
      expiry: content.expiresAt
    };

    const riskEval = evaluateRisk({
      candidate: riskCandidate,
      account: riskAccount,
      instrument,
      quote: { price: fillPrice, timestamp: new Date(now).toISOString(), spreadPips: this.assumptions.spreadPips },
      exposure: riskExposure,
      riskConfig: paperRiskConfig,
      now,
      simulationContext: true
    });

    if (riskEval.decision !== "PASS") {
      throw new PaperInsufficientFundsError(`Paper position blocked by risk: ${riskEval.reasonCodes.join(", ")}`);
    }

    const volume = riskEval.positionSizing?.volume ?? 0.01;
    if (!volume || volume <= 0) throw new PaperInsufficientFundsError("Calculated paper volume is zero");

    // Check margin: notional value must not exceed equity
    const notional = volume * instrument.contractSize * fillPrice;
    if (notional > this._equity * 10) { // Allow 10:1 leverage for paper
      throw new PaperInsufficientFundsError("Insufficient simulated equity for requested position size");
    }

    // Apply spread cost
    const spreadCost = this.assumptions.spreadPips * 0.0001 * instrument.pipValuePerLot * volume;
    const commissionCost = this.assumptions.commissionPerUnit * volume;
    const totalCost = spreadCost + commissionCost;

    const positionId = `paper_${createHash("sha256").update(`${this.userId}:${eventId}:${Date.now()}`).digest("hex").slice(0, 24)}`;
    const openedAt = iso(now, "opened at");

    const positionRow = {
      id: positionId,
      user_id: this.userId,
      proposal_id: proposal.proposalId,
      proposal_version: proposal.proposalVersion,
      symbol: content.symbol,
      direction,
      entry_price: fillPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      status: "open",
      simulated: true,
      opened_at: openedAt,
      closed_at: null
    };

    await this.db.execute(this.db.client.from("paper_positions").insert(positionRow));

    // Record the event
    await this.db.execute(
      this.db.client.from("paper_events").insert({
        id: eventId,
        user_id: this.userId,
        status: "position_opened",
        payload: {
          event_type: "position_opened",
          positionId,
          proposalId: proposal.proposalId,
          proposalVersion: proposal.proposalVersion,
          symbol: content.symbol,
          direction,
          entryPrice: fillPrice,
          stopLoss,
          takeProfit,
          volume,
          spreadCost,
          commissionCost,
          totalCost,
          riskEvaluationId: riskEval.riskEvaluationId,
          equityBefore: this._equity,
          simulated: true
        },
        created_at: openedAt
      })
    );

    // Update equity (deduct costs)
    this._equity -= totalCost;
    this._positions.push({
      paperPositionId: positionId,
      eventId,
      proposalId: proposal.proposalId,
      proposalVersion: proposal.proposalVersion,
      symbol: content.symbol,
      direction,
      entryPrice: fillPrice,
      stopLoss,
      takeProfit,
      status: "open",
      openedAt,
      closedAt: null,
      unrealizedPnl: 0
    });

    return Object.freeze({
      status: "opened_simulated",
      eventId,
      position: { ...positionRow },
      volume,
      spreadCost,
      commissionCost,
      totalCost,
      equityAfter: this._equity,
      riskEvaluationId: riskEval.riskEvaluationId,
      simulated: true,
      live: false
    });
  }

  /**
   * Close an open paper position at the current market price.
   * Realizes P&L and records a trade.
   */
  async closePosition({ positionId, quote, now = new Date() } = {}) {
    const position = this._positions.find((p) => p.paperPositionId === positionId && p.status === "open");
    if (!position) throw new PaperValidationError("Open position not found");

    if (!quote || typeof quote.price !== "number" || !Number.isFinite(quote.price) || quote.price <= 0) {
      throw new PaperValidationError("A valid current quote is required");
    }

    const closePrice = quote.price;
    const entryPrice = position.entryPrice;
    const direction = position.direction;
    const volume = 0.01; // Paper positions use a fixed small volume for simplicity

    // Calculate gross P&L
    const priceDiff = direction === "BUY" ? closePrice - entryPrice : entryPrice - closePrice;
    const pipSize = 0.0001;
    const pips = priceDiff / pipSize;
    const pipValue = 10; // USD per lot per pip for forex
    const grossPnl = pips * pipValue * volume;

    const spreadCost = this.assumptions.spreadPips * 0.0001 * 10 * volume;
    const commissionCost = this.assumptions.commissionPerUnit * volume;
    const netPnl = grossPnl - spreadCost - commissionCost;

    const closedAt = iso(now, "closed at");

    // Update position in database
    await this.db.execute(
      this.db.client.from("paper_positions").update({ status: "closed", closed_at: closedAt }).eq("id", positionId)
    );

    // Record trade
    const tradeId = `trade_${createHash("sha256").update(`${this.userId}:${positionId}:${Date.now()}`).digest("hex").slice(0, 24)}`;
    await this.db.execute(
      this.db.client.from("paper_trades").insert({
        id: tradeId,
        position_id: positionId,
        user_id: this.userId,
        gross_pnl: grossPnl,
        estimated_costs: spreadCost + commissionCost,
        net_pnl: netPnl,
        simulated: true,
        opened_at: position.openedAt,
        closed_at: closedAt
      })
    );

    // Record event
    const eventId = `paper_${createHash("sha256").update(`${this.userId}:close:${positionId}:${Date.now()}`).digest("hex").slice(0, 24)}`;
    await this.db.execute(
      this.db.client.from("paper_events").insert({
        id: eventId,
        user_id: this.userId,
        status: "position_closed",
        payload: {
          event_type: "position_closed",
          positionId,
          tradeId,
          symbol: position.symbol,
          direction,
          entryPrice,
          closePrice,
          grossPnl,
          spreadCost,
          commissionCost,
          netPnl,
          equityBefore: this._equity,
          simulated: true
        },
        created_at: closedAt
      })
    );

    // Update equity
    this._equity += netPnl;

    // Update in-memory position
    position.status = "closed";
    position.closedAt = closedAt;

    this._trades.push({ id: tradeId, positionId, grossPnl, estimatedCosts: spreadCost + commissionCost, netPnl, openedAt: position.openedAt, closedAt });

    return Object.freeze({
      status: "closed_simulated",
      eventId,
      tradeId,
      positionId,
      symbol: position.symbol,
      direction,
      entryPrice,
      closePrice,
      grossPnl,
      spreadCost,
      commissionCost,
      netPnl,
      equityAfter: this._equity,
      simulated: true,
      live: false
    });
  }

  /** Get current equity (cached from load). */
  get equity() { return this._equity; }
}

export function createPaperEngine(db, { userId, startingEquity = 10_000, accountCurrency = "USD", assumptions = {} } = {}) {
  return new PaperEngine({ db, userId, startingEquity, accountCurrency, assumptions });
}
