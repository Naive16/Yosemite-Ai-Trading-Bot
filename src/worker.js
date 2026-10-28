import { routes, MAX_REQUEST_BODY_BYTES } from "../api/_lib/routes.js";

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
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BODY_BYTES) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
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

