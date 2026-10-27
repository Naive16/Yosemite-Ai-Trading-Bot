import { header } from "./http.js";

export class InputValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "InputValidationError";
  }
}

export class SpoofedUserIdentityError extends InputValidationError {
  constructor(message = "Client-supplied user identifiers are not allowed") {
    super(message);
    this.name = "SpoofedUserIdentityError";
    this.code = "spoofed_user_id_rejected";
  }
}

const FORBIDDEN_IDENTITY_HEADERS = Object.freeze([
  "x-user-id",
  "x-supabase-user-id",
  "x-owner-user-id",
  "x-authenticated-user-id"
]);

const FORBIDDEN_IDENTITY_KEYS = new Set([
  "userId",
  "user_id",
  "ownerUserId",
  "owner_user_id",
  "supabaseUserId",
  "supabase_user_id"
]);

export function assertNoSpoofedUserIdentity(request) {
  for (const headerName of FORBIDDEN_IDENTITY_HEADERS) {
    if (header(request, headerName).trim() !== "") {
      throw new SpoofedUserIdentityError();
    }
  }

  if (request?.url) {
    const parsedUrl = new URL(request.url, "http://localhost");
    for (const key of parsedUrl.searchParams.keys()) {
      if (FORBIDDEN_IDENTITY_KEYS.has(key)) throw new SpoofedUserIdentityError();
    }
  }

  if (request?.query && typeof request.query === "object") {
    for (const key of Object.keys(request.query)) {
      if (FORBIDDEN_IDENTITY_KEYS.has(key)) throw new SpoofedUserIdentityError();
    }
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request?.method) && request?.body !== undefined && request?.body !== "") {
    let parsedBody = null;
    if (typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
      parsedBody = request.body;
    } else if (typeof request.body === "string") {
      try { parsedBody = JSON.parse(request.body); } catch { /* handled by route body parser */ }
    }
    if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
      for (const key of Object.keys(parsedBody)) {
        if (FORBIDDEN_IDENTITY_KEYS.has(key)) throw new SpoofedUserIdentityError();
      }
    }
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

const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

export function parseLoginPayload(request) {
  assertNoSpoofedUserIdentity(request);
  const payload = parseJsonBody(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new InputValidationError("Request body must be an object");
  }

  const keys = Object.keys(payload);
  if (keys.some((key) => !["email", "password"].includes(key))) {
    throw new InputValidationError("Unexpected request field");
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (email.length < 5 || email.length > 254 || /[\s\u0000-\u001f\u007f]/.test(email) || !EMAIL_PATTERN.test(email)) {
    throw new InputValidationError("Email is invalid");
  }
  if (typeof payload.password !== "string" || payload.password.length < 6 || payload.password.length > 256) {
    throw new InputValidationError("Password is invalid");
  }
  return { email, password: payload.password };
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
