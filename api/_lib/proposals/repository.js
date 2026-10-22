import { randomUUID } from "node:crypto";

export async function insertProposal(db, { userId, proposal }) {
  const result = await db.query(`INSERT INTO trade_proposals (id, user_id, version, status, content_digest, payload, expires_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id, version, status, content_digest, payload, expires_at, created_at`, [proposal.proposalId, userId, proposal.proposalVersion, proposal.status, proposal.contentDigest, JSON.stringify(proposal), proposal.immutableContent.expiresAt]);
  return result.rows[0] || null;
}

export async function listProposals(db, userId, { limit = 50 } = {}) {
  const result = await db.query(`SELECT id, version, status, content_digest, payload, expires_at, created_at, updated_at FROM trade_proposals WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
  return result.rows;
}

export async function findProposal(db, userId, proposalId, version) {
  const result = await db.query(`SELECT id, version, status, content_digest, payload, expires_at, created_at, updated_at FROM trade_proposals WHERE user_id = $1 AND id = $2 AND version = $3`, [userId, proposalId, version]);
  return result.rows[0] || null;
}

export async function transitionProposal(db, { userId, proposalId, version, contentDigest, nextStatus, actor, reason = null }) {
  if (!["approved", "rejected", "invalidated", "expired", "superseded"].includes(nextStatus)) throw new Error("Invalid proposal transition");
  const result = await db.query(`WITH changed AS (UPDATE trade_proposals SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 AND id = $3 AND version = $4 AND content_digest = $5 AND status = 'pending_approval' AND expires_at > CURRENT_TIMESTAMP RETURNING id, version, status, content_digest, payload) INSERT INTO trade_proposal_decisions (id, proposal_id, proposal_version, actor_user_id, decision, reason, content_digest) SELECT $6, id, version, $7, $1, $8, content_digest FROM changed RETURNING proposal_id, proposal_version, decision`, [nextStatus, userId, proposalId, version, contentDigest, randomUUID(), actor, reason]);
  return result.rows[0] || null;
}
