import { inspectDeploymentConfig } from "../api/_lib/deployment.js";

const result = inspectDeploymentConfig(process.env);
for (const failure of result.failures) console.error(`FAIL: ${failure}`);
for (const warning of result.warnings) console.warn(`WARN: ${warning}`);

if (!result.ready) {
  console.error("Deployment preflight failed. No secrets were printed.");
  process.exitCode = 1;
} else {
  console.log("Deployment preflight passed. No secrets were printed.");
}
