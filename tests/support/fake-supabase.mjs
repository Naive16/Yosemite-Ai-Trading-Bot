import { randomBytes } from "node:crypto";

export const TEST_SUPABASE_URL = "https://example-project.supabase.co";
export const TEST_SUPABASE_ANON_KEY = "sb_publishable_test_anon_key_1234567890";
export const TEST_SUPABASE_OWNER_ID = "11111111-2222-4333-8444-555555555555";
export const TEST_INTRUDER_USER_ID = "99999999-8888-4777-8666-555555555555";
export const TEST_OWNER_EMAIL = "owner@example.test";
export const TEST_OWNER_PASSWORD = "correct horse battery staple";

export const TEST_SUPABASE_ENV = Object.freeze({
  SUPABASE_URL: TEST_SUPABASE_URL,
  SUPABASE_ANON_KEY: TEST_SUPABASE_ANON_KEY,
  SUPABASE_OWNER_USER_ID: TEST_SUPABASE_OWNER_ID
});

export function createFakeSupabaseFetch({
  expectedAnonKey = TEST_SUPABASE_ANON_KEY,
  accounts = [
    {
      id: TEST_SUPABASE_OWNER_ID,
      email: TEST_OWNER_EMAIL,
      password: TEST_OWNER_PASSWORD,
      email_confirmed_at: "2026-10-20T00:00:00.000Z"
    },
    {
      id: TEST_INTRUDER_USER_ID,
      email: "intruder@example.test",
      password: "intruder-valid-password",
      email_confirmed_at: "2026-10-20T00:00:00.000Z"
    }
  ]
} = {}) {
  const issuedTokens = new Map();
  const calls = [];

  async function fakeFetch(url, options = {}) {
    const parsedUrl = new URL(url);
    const headers = Object.fromEntries(
      Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])
    );
    calls.push({ url: parsedUrl.toString(), pathname: parsedUrl.pathname, method: options.method || "GET", headers });

    if (headers.apikey !== expectedAnonKey) {
      return new Response(JSON.stringify({ error_code: "invalid_api_key", message: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (parsedUrl.pathname === "/auth/v1/token" && parsedUrl.searchParams.get("grant_type") === "password") {
      const body = JSON.parse(String(options.body || "{}"));
      const email = String(body.email || "").trim().toLowerCase();
      const account = accounts.find((candidate) => candidate.email.toLowerCase() === email && candidate.password === body.password);
      if (!account) {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      const accessToken = `sbp_test_${randomBytes(24).toString("base64url")}`;
      issuedTokens.set(accessToken, account);
      return new Response(JSON.stringify({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        user: {
          id: account.tokenUserIdOverride || account.id,
          aud: account.aud ?? "authenticated",
          email: account.email,
          email_confirmed_at: account.email_confirmed_at
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (parsedUrl.pathname === "/auth/v1/user" && (options.method || "GET") === "GET") {
      const authHeader = headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
      const account = issuedTokens.get(token);
      if (!account) {
        return new Response(JSON.stringify({ message: "Invalid JWT" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({
        id: account.id,
        aud: account.aud ?? "authenticated",
        role: "authenticated",
        email: account.email,
        email_confirmed_at: account.email_confirmed_at
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (parsedUrl.pathname === "/auth/v1/logout" && options.method === "POST") {
      const authHeader = headers.authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
      issuedTokens.delete(token);
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({ message: "Not found" }), { status: 404 });
  }

  fakeFetch.calls = calls;
  fakeFetch.issuedTokens = issuedTokens;
  return fakeFetch;
}
