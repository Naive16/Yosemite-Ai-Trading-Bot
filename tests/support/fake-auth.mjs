import { randomUUID } from "node:crypto";
import { setAuthClientFactoryForTests } from "../../api/_lib/auth.js";

export const testSupabaseEnv = { SUPABASE_URL: "https://txdjozotaxpthpnfikqx.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-only" };
export const fakeTokens = new Map();
export function issueFakeSession(overrides = {}) {
  const id = overrides.authUserId || "11111111-1111-4111-8111-111111111111";
  const expiresAt = overrides.expiresAt || Date.now() + 3600_000;
  const claims = { sub: id, session_id: randomUUID(), iss: testSupabaseEnv.SUPABASE_URL + "/auth/v1", exp: Math.floor(expiresAt / 1000) };
  const token = Buffer.from('{"alg":"RS256"}').toString("base64url") + "." + Buffer.from(JSON.stringify(claims)).toString("base64url") + ".fixtureSignature";
  const entry = { user: { id, email: "operator@example.test" }, userId: "legacy-operator", username: "operator", active: true, authorized: true, expiresAt, ...overrides };
  fakeTokens.set(token, entry);
  return { access_token: token, refresh_token: randomUUID(), token_type: "bearer", expires_in: 3600, expires_at: claims.exp, user: entry.user };
}
export function installFakeAuth(database) {
  fakeTokens.clear();
  const state = { authUnavailable: false, logoutUnavailable: false, signInError: null, signOutError: null };
  database.authState = state;
  setAuthClientFactoryForTests(() => ({ auth: {
    async signInWithPassword({ email, password }) {
      if (state.authUnavailable) throw new Error("synthetic provider failure");
      if (state.signInError) return { data: {}, error: state.signInError };
      if (email !== "operator@example.test" || password !== "correct horse battery staple") return { data: {}, error: { status: 400, code: "invalid_credentials" } };
      return { data: { session: issueFakeSession(), user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null };
    },
    async getUser(token) {
      if (state.authUnavailable) throw new Error("synthetic provider failure");
      const entry = fakeTokens.get(token);
      // Intentionally accepts a revoked access token: the database session check must reject it.
      if (!entry || entry.expiresAt <= Date.now()) return { data: {}, error: { status: 401 } };
      return { data: { user: entry.user }, error: null };
    },
    admin: { async signOut(token, scope) {
      if (state.logoutUnavailable) return { error: { status: 503 } };
      if (state.signOutError) return { error: state.signOutError };
      if (scope !== "local") throw new Error("Unexpected sign-out scope");
      const entry = fakeTokens.get(token);
      if (!entry) return { error: { status: 401 } };
      entry.active = false;
      return { error: null };
    } }
  } }));
  return state;
}
