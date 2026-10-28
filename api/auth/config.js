import { loadConfig, ConfigurationError } from "../_lib/config.js";
import { methodNotAllowed, sendJson } from "../_lib/http.js";
import { runtimeEnv } from "../_lib/runtime.js";
export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  try {
    const config = loadConfig(runtimeEnv(request));
    if (!config.supabase.configured) return sendJson(response, 503, { status: "error", code: "configuration_invalid", message: "Supabase authentication is not configured" });
    return sendJson(response, 200, { status: "ok", supabase: { url: config.supabase.url, publishableKey: config.supabase.publishableKey }, registrationEnabled: false });
  } catch (error) {
    if (error instanceof ConfigurationError) return sendJson(response, 503, { status: "error", code: "configuration_invalid", message: "Application configuration is unavailable" });
    throw error;
  }
}

