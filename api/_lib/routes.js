import authConfigHandler from "../auth/config.js";
import healthHandler from "../health.js";
import loginHandler from "../auth/login.js";
import meHandler from "../auth/me.js";
import logoutHandler from "../auth/logout.js";
import statusHandler from "../private/status.js";
import operationsHandler from "../private/operations.js";
import marketDataHandler from "../private/market-data.js";
import strategyHandler from "../private/strategy.js";
import analysisHandler from "../private/analysis.js";
import riskHandler from "../private/risk.js";
import proposalsHandler from "../private/proposals.js";
import backtestHandler from "../private/backtest.js";
import paperHandler from "../private/paper.js";

export const MAX_REQUEST_BODY_BYTES = 64 * 1024;
export const routes = Object.freeze([
  ["GET /api/auth/config", authConfigHandler], ["GET /api/health", healthHandler], ["POST /api/auth/login", loginHandler], ["GET /api/auth/me", meHandler], ["POST /api/auth/logout", logoutHandler],
  ["GET /api/private/status", statusHandler], ["GET /api/private/operations", operationsHandler], ["GET /api/private/market-data", marketDataHandler], ["GET /api/private/strategy", strategyHandler],
  ["GET /api/private/analysis", analysisHandler], ["GET /api/private/risk", riskHandler], ["GET /api/private/proposals", proposalsHandler], ["POST /api/private/proposals", proposalsHandler],
  ["GET /api/private/backtest", backtestHandler], ["POST /api/private/backtest", backtestHandler], ["GET /api/private/paper", paperHandler], ["POST /api/private/paper", paperHandler]
]);
