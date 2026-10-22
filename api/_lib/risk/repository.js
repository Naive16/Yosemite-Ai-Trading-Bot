import { randomUUID } from "node:crypto";

export async function recordRiskEvaluation(db, { userId = null, candidateId = null, decision, reasonCodes = [], inputs = {}, configurationVersion }) {
  const result = await db.query(
    `INSERT INTO risk_evaluations (id, user_id, candidate_id, decision, reason_codes, inputs, configuration_version)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     RETURNING id, created_at`,
    [randomUUID(), userId, candidateId, decision, JSON.stringify(reasonCodes), JSON.stringify(inputs), configurationVersion]
  );
  return result.rows[0] || null;
}

export async function loadRiskConfiguration(db, version) {
  const result = await db.query("SELECT version, configuration, active FROM risk_configurations WHERE version = $1 AND active = TRUE", [version]);
  return result.rows[0] || null;
}
