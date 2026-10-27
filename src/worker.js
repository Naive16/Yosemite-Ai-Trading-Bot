import { ConfigurationError, loadConfig } from "../api/_lib/config.js";
import { MAX_REQUEST_BODY_BYTES, routes } from "../api/_lib/worker/routes.js";

const REQUIRED_PRODUCTION_KEYS = Object.freeze([
  "APP_ORIGIN",
  "DATABASE_URL",
  "SESSION_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_OWNER_USER_ID",
  "SUPABASE_URL"
]);

function responseAdapter() {
  let statusCode = 200; const headers = new Headers(); let body = null; let jsonPayload = null;
  return {
    status(code) { statusCode = code; return this; },
    setHeader(name, value) { headers.set(name, String(value)); },
    json(value) { jsonPayload = value; body = JSON.stringify(value); return this; },
    statusCode() { return statusCode; },
    payloadCode() { return typeof jsonPayload?.code === "string" ? jsonPayload.code : ""; },
    toResponse() { return new Response(body, { status: statusCode, headers }); }
  };
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

function extractHyperdriveConnectionString(value) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && typeof value.connectionString === "string") {
    return value.connectionString.trim();
  }
  return "";
}

async function resolveRuntimeEnv(env) {
  if (!env || typeof env !== "object") return { runtimeEnv: {}, failedSecretBindings: [] };
  const resolved = {};
  const failedSecretBindings = [];
  let hyperdriveConnectionString = "";

  for (const [key, value] of Object.entries(env)) {
    if (key === "HYPERDRIVE") {
      const connStr = extractHyperdriveConnectionString(value);
      if (connStr) {
        hyperdriveConnectionString = connStr;
        resolved.HYPERDRIVE = connStr;
      }
    } else if (key !== "ASSETS" && value && typeof value === "object" && typeof value.get === "function") {
      try {
        const secretValue = await value.get();
        if (typeof secretValue === "string") resolved[key] = secretValue;
      } catch {
        failedSecretBindings.push(key);
      }
    } else if (key !== "ASSETS" && value && typeof value === "object" && typeof value.connectionString === "string") {
      const connStr = value.connectionString.trim();
      if (connStr) resolved[key] = connStr;
    } else {
      resolved[key] = value;
    }
  }

  if (hyperdriveConnectionString) {
    resolved.DATABASE_URL = hyperdriveConnectionString;
  }

  return { runtimeEnv: resolved, failedSecretBindings: failedSecretBindings.sort() };
}

function logSafeConfigDiagnostics(resolvedEnv, pathname, failedSecretBindings = [], responseCode = "") {
  try {
    loadConfig(resolvedEnv);
    console.error(JSON.stringify({
      event: "worker.service_unavailable",
      path: pathname,
      code: responseCode || "service_unavailable",
      hyperdriveBound: Boolean(resolvedEnv.HYPERDRIVE)
    }));
  } catch (error) {
    if (error instanceof ConfigurationError) {
      const configuredKeys = Object.keys(resolvedEnv)
        .filter((key) => key !== "ASSETS" && typeof resolvedEnv[key] === "string" && resolvedEnv[key].trim() !== "")
        .sort();
      const isProduction = typeof resolvedEnv.APP_ENV === "string" && resolvedEnv.APP_ENV.trim() === "production";
      const missingRequiredKeys = isProduction
        ? REQUIRED_PRODUCTION_KEYS.filter((key) => !configuredKeys.includes(key))
        : [];
      console.error(JSON.stringify({
        event: "worker.config_validation_failed",
        path: pathname,
        reason: error.message,
        configuredKeys,
        missingRequiredKeys,
        failedSecretBindings
      }));
    }
  }
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
        const { runtimeEnv, failedSecretBindings } = await resolveRuntimeEnv(env);
        const adaptedRequest = { method: request.method, url: request.url, headers: requestHeaders(request), body: await readBody(request), runtimeEnv };
        const adaptedResponse = responseAdapter();
        await handler(adaptedRequest, adaptedResponse);
        if (adaptedResponse.statusCode() === 503) {
          logSafeConfigDiagnostics(runtimeEnv, url.pathname, failedSecretBindings, adaptedResponse.payloadCode());
        }
        return adaptedResponse.toResponse();
      } catch (error) { return error?.message === "BODY_TOO_LARGE" ? errorResponse(413, "Request body is too large") : errorResponse(500, "Internal server error"); }
    }
    if (request.method !== "GET" && request.method !== "HEAD") return errorResponse(405, "Method not allowed");
    if (!env.ASSETS?.fetch) return errorResponse(503, "Static assets are unavailable");
    const assetResponse = await env.ASSETS.fetch(request);
    return assetResponse.status === 404 ? errorResponse(404, "Resource not found") : assetResponse;
  }
};
