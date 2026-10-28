import { randomUUID } from "node:crypto";

export async function recordRiskEvaluation(db, { userId = null, candidateId = null, decision, reasonCodes = [], inputs = {}, configurationVersion }) {
  const rows = await db.execute(db.client.from("risk_evaluations").insert({ id: randomUUID(), user_id: userId, candidate_id: candidateId, decision, reason_codes: reasonCodes, inputs, configuration_version: configurationVersion }).select("id,created_at"));
  return rows?.[0] || null;
}
export async function loadRiskConfiguration(db, version) {
  const rows = await db.execute(db.client.from("risk_configurations").select("version,configuration,active").eq("version", version).eq("active", true));
  return rows?.[0] || null;
}
