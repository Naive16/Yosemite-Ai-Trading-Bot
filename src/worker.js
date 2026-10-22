import healthHandler from "../api/health.js";
import loginHandler from "../api/auth/login.js";
import meHandler from "../api/auth/me.js";
import logoutHandler from "../api/auth/logout.js";
import statusHandler from "../api/private/status.js";
import operationsHandler from "../api/private/operations.js";
import marketDataHandler from "../api/private/market-data.js";
import strategyHandler from "../api/private/strategy.js";
import analysisHandler from "../api/private/analysis.js";
import riskHandler from "../api/private/risk.js";
import proposalsHandler from "../api/private/proposals.js";
import backtestHandler from "../api/private/backtest.js";
import paperHandler from "../api/private/paper.js";

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const routes = Object.freeze([
  ["GET /api/health", healthHandler], ["POST /api/auth/login", loginHandler], ["GET /api/auth/me", meHandler], ["POST /api/auth/logout", logoutHandler],
  ["GET /api/private/status", statusHandler], ["GET /api/private/operations", operationsHandler], ["GET /api/private/market-data", marketDataHandler], ["GET /api/private/strategy", strategyHandler],
  ["GET /api/private/analysis", analysisHandler], ["GET /api/private/risk", riskHandler], ["GET /api/private/proposals", proposalsHandler], ["POST /api/private/proposals", proposalsHandler],
  ["GET /api/private/backtest", backtestHandler], ["POST /api/private/backtest", backtestHandler], ["GET /api/private/paper", paperHandler], ["POST /api/private/paper", paperHandler]
]);

function responseAdapter() {
  let statusCode = 200; const headers = new Headers(); let body = null;
  return { status(code) { statusCode = code; return this; }, setHeader(name, value) { headers.set(name, String(value)); }, json(value) { body = JSON.stringify(value); return this; }, toResponse() { return new Response(body, { status: statusCode, headers }); } };
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ status: "error", message }), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function readBody(request) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return "";
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  return new TextDecoder().decode(body);
}

function requestHeaders(request) {
  const headers = Object.fromEntries(request.headers.entries()); const cloudflareIp = request.headers.get("cf-connecting-ip");
  if (cloudflareIp) headers["x-real-ip"] = cloudflareIp;
  delete headers["x-forwarded-for"];
  return headers;
}

function routeFor(request) { return routes.find(([key]) => key === `${request.method} ${new URL(request.url).pathname}`)?.[1] || null; }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const handler = routeFor(request);
      if (!handler) {
        const allowed = routes.filter(([key]) => key.endsWith(` ${url.pathname}`));
        return allowed.length ? errorResponse(405, "Method not allowed") : errorResponse(404, "API route not found");
      }
      try {
        const adaptedRequest = { method: request.method, url: request.url, headers: requestHeaders(request), body: await readBody(request), runtimeEnv: env };
        const adaptedResponse = responseAdapter(); await handler(adaptedRequest, adaptedResponse); return adaptedResponse.toResponse();
      } catch (error) { return error?.message === "BODY_TOO_LARGE" ? errorResponse(413, "Request body is too large") : errorResponse(500, "Internal server error"); }
    }
    if (request.method !== "GET" && request.method !== "HEAD") return errorResponse(405, "Method not allowed");
    if (!env.ASSETS?.fetch) return errorResponse(503, "Static assets are unavailable");
    const assetResponse = await env.ASSETS.fetch(request);
    return assetResponse.status === 404 ? errorResponse(404, "Resource not found") : assetResponse;
  }
};

export { routes, MAX_REQUEST_BODY_BYTES };
