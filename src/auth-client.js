// Supabase owns session storage and refresh. The API remains the authority for
// application access; a browser session alone never unlocks the dashboard.
export class AuthenticationError extends Error {
  constructor(message, status = 503) { super(message); this.name = "AuthenticationError"; this.status = status; }
}

function sdkError(error, operation) {
  if (["email_provider_disabled", "provider_disabled", "invalid_api_key"].includes(error?.code) || /(?:invalid|missing|no) api key|api key (?:is )?(?:invalid|missing)/i.test(String(error?.message || ""))) return new AuthenticationError("Supabase authentication configuration is unavailable. Check the project settings.");
  if (error?.status === 429) return new AuthenticationError("Too many attempts. Try again shortly.", 429);
  if (operation === "signin" && [400, 401, 422].includes(error?.status)) return new AuthenticationError("Invalid email or password.", 401);
  return new AuthenticationError(operation === "password" ? "The password could not be updated. Request a new recovery link and try again." : "The authentication service is unavailable. Try again shortly.");
}

export function createAuthentication({ createClient, fetchImpl = globalThis.fetch, onStateChange = () => {} }) {
  let client;
  let recoveryActive = false;
  let subscription;
  let requestGeneration = 0;

  async function session() {
    if (!client) throw new AuthenticationError("Authentication has not been initialized.");
    const { data, error } = await client.auth.getSession();
    if (error) throw sdkError(error);
    return data?.session || null;
  }

  async function request(url, options = {}) {
    // A bearer token must never be attached to an arbitrary URL.
    if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) throw new AuthenticationError("Invalid application request.", 400);
    const generation = requestGeneration;
    const headers = new Headers(options.headers || {});
    headers.delete("Authorization");
    if (url.startsWith("/api/private/") || ["/api/auth/me", "/api/auth/logout"].includes(url)) {
      const current = await session();
      if (!current?.access_token) {
        onStateChange("SIGNED_OUT");
        return { response: new Response(null, { status: 401 }), data: { status: "error", message: "Authentication required" } };
      }
      headers.set("Authorization", `Bearer ${current.access_token}`);
    }
    const response = await fetchImpl(url, { ...options, headers, credentials: "omit", cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (generation !== requestGeneration) return { response: new Response(null, { status: 409 }), data: {} };
    if ([401, 403].includes(response.status) && url.startsWith("/api/private/")) onStateChange(response.status === 403 ? "ACCESS_DENIED" : "SESSION_REJECTED");
    return { response, data };
  }

  return {
    async initialize() {
      const response = await fetchImpl("/api/auth/config", { headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.supabase?.url || !data.supabase?.publishableKey || data.registrationEnabled !== false) throw new AuthenticationError(data.message || "Authentication is not configured for this environment.");
      client = createClient(data.supabase.url, data.supabase.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, flowType: "pkce", detectSessionInUrl: true } });
      subscription = client.auth.onAuthStateChange((event) => {
        // Keep this callback synchronous: calling Supabase auth methods from it
        // can wait on the SDK's own storage lock.
        if (["SIGNED_IN", "SIGNED_OUT", "PASSWORD_RECOVERY"].includes(event)) requestGeneration += 1;
        if (event === "PASSWORD_RECOVERY") recoveryActive = true;
        onStateChange(event);
      }).data.subscription;
      await session();
    },
    request,
    async verifySession() {
      if (!(await session())) return { response: new Response(null, { status: 401 }), data: {} };
      return request("/api/auth/me", { headers: { Accept: "application/json" } });
    },
    async signIn(email, password) {
      requestGeneration += 1;
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw sdkError(error, "signin");
      const verified = await request("/api/auth/me", { headers: { Accept: "application/json" } });
      if (!verified.response.ok) throw new AuthenticationError(verified.data.message || (verified.response.status === 403 ? "This account is not authorized for this workspace." : "The authentication service is unavailable."), verified.response.status);
      return verified.data;
    },
    async signOut() {
      // Revoke on Supabase before clearing browser state. A failed network
      // request must remain retryable and must not claim successful revocation.
      requestGeneration += 1;
      const current = await session();
      if (current) {
        const revoked = await request("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
        if (!revoked.response.ok) throw new AuthenticationError("Sign-out could not be confirmed. Protected views are hidden. Retry sign-out.", revoked.response.status);
      }
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw new AuthenticationError("The server session was revoked, but browser cleanup failed. Retry sign-out.");
      recoveryActive = false;
    },
    async sendRecovery(email, origin) {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/?recovery=1` });
      if (error) throw sdkError(error);
    },
    async updatePassword(password) {
      if (!recoveryActive) throw new AuthenticationError("Open a valid password recovery link first.", 403);
      const { error } = await client.auth.updateUser({ password });
      if (error) throw sdkError(error, "password");
      await this.signOut();
    },
    isRecoveryActive() { return recoveryActive; },
    dispose() { subscription?.unsubscribe(); }
  };
}
