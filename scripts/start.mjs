import { loadEnvFile } from "node:process";

// Node does not read .env automatically. Platform environment values take precedence.
try { loadEnvFile(".env"); } catch (error) { if (error?.code !== "ENOENT") throw new Error("Local environment file could not be loaded"); }
const { startServer, installShutdownHandlers } = await import("../server.js");
try {
  const server = await startServer();
  installShutdownHandlers(server);
  console.log(`Yosemite server listening on ${server.address().address}:${server.address().port}`);
} catch (error) {
  console.error(error?.message?.startsWith("Production configuration is invalid:") ? error.message : "Server could not start");
  process.exitCode = 1;
}
