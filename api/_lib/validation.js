import { header } from "./http.js";

export class InputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputValidationError";
  }
}

export function parseJsonBody(request, maximumBytes = 4_096) {
  const contentType = header(request, "content-type").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new InputValidationError("JSON content type required");
  }

  const rawBody = request.body;
  if (rawBody && typeof rawBody === "object" && !Buffer.isBuffer(rawBody)) {
    let serialized;
    try { serialized = JSON.stringify(rawBody); } catch { throw new InputValidationError("Request body is invalid or too large"); }
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > maximumBytes) throw new InputValidationError("Request body is invalid or too large");
    return rawBody;
  }
  if (typeof rawBody !== "string" || Buffer.byteLength(rawBody, "utf8") > maximumBytes) {
    throw new InputValidationError("Request body is invalid or too large");
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new InputValidationError("Request body must be valid JSON");
  }
}

export function parseLoginPayload(request) {
  const payload = parseJsonBody(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InputValidationError("Request body must be an object");
  }

  const keys = Object.keys(payload);
  if (keys.some((key) => !["username", "password"].includes(key))) {
    throw new InputValidationError("Unexpected request field");
  }
  if (typeof payload.username !== "string" || payload.username.length < 3 || payload.username.length > 64 || /[\u0000-\u001f\u007f]/.test(payload.username)) {
    throw new InputValidationError("Username is invalid");
  }
  if (typeof payload.password !== "string" || payload.password.length < 12 || payload.password.length > 256) {
    throw new InputValidationError("Password is invalid");
  }
  return { username: payload.username, password: payload.password };
}

export function assertSameOrigin(request, expectedOrigin) {
  const origin = header(request, "origin");
  if (origin && origin !== expectedOrigin) throw new InputValidationError("Origin is not allowed");
  const referer = header(request, "referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) throw new InputValidationError("Referer is not allowed");
    } catch (error) {
      if (error instanceof InputValidationError) throw error;
      throw new InputValidationError("Referer is not allowed");
    }
  }
  if (!origin && !referer) throw new InputValidationError("Origin is required");
}
