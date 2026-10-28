import { loadEnvFile } from "node:process";
import { inspectDemoPreflight } from "../api/_lib/mt5/demo-preflight.js";

// No remote requests, database writes, terminal startup or broker SDK calls.
try {
  try { loadEnvFile(".env"); } catch (error) { if (error?.code !== "ENOENT") throw new Error("env_file_unavailable"); }
  console.log(JSON.stringify(inspectDemoPreflight(process.env), null, 2));
  // Exit 2 means the release is blocked; this command never activates trading.
  process.exitCode = 2;
} catch {
  console.error(JSON.stringify({ status: "blocked", executionAllowed: false, code: "local_preflight_unavailable" }));
  process.exitCode = 1;
}
