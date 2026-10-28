export function header(request, name) {
  const headers = request?.headers || {};
  const expected = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === expected);
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

export function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}

export function sendJson(response, status, body, extraHeaders = {}) {
  setSecurityHeaders(response);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  Object.entries(extraHeaders).forEach(([name, value]) => response.setHeader(name, value));
  return response.status(status).json(body);
}

export function methodNotAllowed(response, allowed) {
  response.setHeader("Allow", allowed);
  return sendJson(response, 405, { status: "error", message: "Method not allowed" });
}

