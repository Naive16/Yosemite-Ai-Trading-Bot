import authConfigHandler from "./api/auth/config.js";
import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ConfigurationError } from "./api/_lib/config.js";

import healthHandler from "./api/health.js";
import loginHandler from "./api/auth/login.js";
import meHandler from "./api/auth/me.js";
import logoutHandler from "./api/auth/logout.js";
import statusHandler from "./api/private/status.js";
import operationsHandler from "./api/private/operations.js";
import marketDataHandler from "./api/private/market-data.js";
import strategyHandler from "./api/private/strategy.js";
import analysisHandler from "./api/private/analysis.js";
import riskHandler from "./api/private/risk.js";
import proposalsHandler from "./api/private/proposals.js";
import backtestHandler from "./api/private/backtest.js";
import paperHandler from "./api/private/paper.js";

const DEFAULT_PORT = 3000;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const PROJECT_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));

export const routeRegistry = Object.freeze([
  { method: "GET", path: "/api/auth/config", handler: authConfigHandler },
  { method: "GET", path: "/api/health", handler: healthHandler },
  { method: "POST", path: "/api/auth/login", handler: loginHandler },
  { method: "GET", path: "/api/auth/me", handler: meHandler },
  { method: "POST", path: "/api/auth/logout", handler: logoutHandler },
  { method: "GET", path: "/api/private/status", handler: statusHandler },
  { method: "GET", path: "/api/private/operations", handler: operationsHandler },
  { method: "GET", path: "/api/private/market-data", handler: marketDataHandler },
  { method: "GET", path: "/api/private/strategy", handler: strategyHandler },
  { method: "GET", path: "/api/private/analysis", handler: analysisHandler },
  { method: "GET", path: "/api/private/risk", handler: riskHandler },
  { method: "GET", path: "/api/private/proposals", handler: proposalsHandler },
  { method: "POST", path: "/api/private/proposals", handler: proposalsHandler },
  { method: "GET", path: "/api/private/backtest", handler: backtestHandler },
  { method: "POST", path: "/api/private/backtest", handler: backtestHandler },
  { method: "GET", path: "/api/private/paper", handler: paperHandler },
  { method: "POST", path: "/api/private/paper", handler: paperHandler }
]);

const staticFiles = Object.freeze(new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/src/app.js", "src/app.js"],
  ["/src/auth-client.js", "src/auth-client.js"],
  ["/src/vendor/supabase.js", "src/vendor/supabase.js"],
  ["/src/styles.css", "src/styles.css"]
]));

const contentTypes = Object.freeze({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" });

function securityHeaders(response, { includeHsts = false } = {}) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://txdjozotaxpthpnfikqx.supabase.co; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (includeHsts) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function jsonResponse(response, status, body, extraHeaders = {}) {
  securityHeaders(response, { includeHsts: process.env.APP_ENV === "production" });
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function safeErrorResponse(response, status, message) {
  if (response.writableEnded) return;
  jsonResponse(response, status, { status: "error", message });
}

function responseAdapter(response) {
  return {
    status(code) { response.statusCode = code; return this; },
    setHeader(name, value) { response.setHeader(name, value); },
    json(body) { if (!response.writableEnded) response.end(JSON.stringify(body)); return this; }
  };
}

function requestHeaders(request) {
  return Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] || "" : String(value || "")]));
}

export async function readBody(request, maximumBytes = MAX_REQUEST_BODY_BYTES) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return "";
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw Object.assign(new Error("Request body is too large"), { code: "BODY_TOO_LARGE" });
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw Object.assign(new Error("Request body is too large"), { code: "BODY_TOO_LARGE" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function findRoute(pathname, method) {
  const candidates = routeRegistry.filter((route) => route.path === pathname);
  return { route: candidates.find((candidate) => candidate.method === method), candidates };
}

function staticPath(pathname) {
  const relative = staticFiles.get(pathname);
  if (!relative) return null;
  const target = resolve(PROJECT_ROOT, relative);
  if (target !== PROJECT_ROOT && !target.startsWith(`${PROJECT_ROOT}${sep}`)) return null;
  return target;
}

async function serveStatic(pathname, response) {
  const target = staticPath(pathname);
  if (!target) return false;
  try {
    const contents = await readFile(target);
    securityHeaders(response, { includeHsts: process.env.APP_ENV === "production" });
    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypes[extname(target)] || "application/octet-stream");
    response.setHeader("Cache-Control", pathname === "/" || pathname === "/index.html" ? "no-store" : "public, max-age=60");
    response.end(contents);
  } catch {
    safeErrorResponse(response, 404, "Resource not found");
  }
  return true;
}

export function validateStartupConfig(env = process.env) {
  if (String(env.APP_ENV || "development").toLowerCase() !== "production") return true;
  try {
    loadConfig(env);
    return true;
  } catch (error) {
    if (error instanceof ConfigurationError) throw new Error(`Production configuration is invalid: ${error.message}`);
    throw new Error("Production configuration could not be loaded");
  }
}

export function createServer({ maxBodyBytes = MAX_REQUEST_BODY_BYTES } = {}) {
  return createHttpServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const { route, candidates } = findRoute(url.pathname, request.method || "GET");
        if (!route) {
          if (candidates.length) { response.setHeader("Allow", [...new Set(candidates.map((candidate) => candidate.method))].join(", ")); return safeErrorResponse(response, 405, "Method not allowed"); }
          return safeErrorResponse(response, 404, "API route not found");
        }
        const body = await readBody(request, maxBodyBytes);
        const handlerRequest = { method: request.method, url: request.url, headers: requestHeaders(request), body, socket: request.socket };
        await route.handler(handlerRequest, responseAdapter(response));
        if (!response.writableEnded) response.end();
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") return safeErrorResponse(response, 405, "Method not allowed");
      if (await serveStatic(url.pathname, response)) return;
      return safeErrorResponse(response, 404, "Resource not found");
    } catch (error) {
      if (error?.code === "BODY_TOO_LARGE") return safeErrorResponse(response, 413, "Request body is too large");
      console.error("Request handling failed", { code: "request_error" });
      return safeErrorResponse(response, 500, "Internal server error");
    }
  });
}

export async function startServer({ port = Number(process.env.PORT) || DEFAULT_PORT, host = "0.0.0.0" } = {}) {
  validateStartupConfig();
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(port, host, resolveListen); });
  return server;
}

export function installShutdownHandlers(server, logger = console) {
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logger.log(`Received ${signal}; shutting down`);
    server.close((error) => { if (error) { logger.error("Server shutdown failed", error.message); process.exitCode = 1; } });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  return shutdown;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().then((server) => { installShutdownHandlers(server); console.log(`Yosemite server listening on ${server.address().address}:${server.address().port}`); }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
