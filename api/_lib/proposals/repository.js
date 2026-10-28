export async function insertProposal(db, { userId, proposal }) {
  // Reserved for a separately approved trusted writer. Ordinary authenticated
  // clients intentionally have no INSERT grant on proposals.
  const rows = await db.execute(db.client.from("trade_proposals").insert({ id: proposal.proposalId, user_id: userId, version: proposal.proposalVersion, status: proposal.status, content_digest: proposal.contentDigest, payload: proposal, expires_at: proposal.immutableContent.expiresAt }).select("id,version,status,content_digest,payload,expires_at,created_at"));
  return rows?.[0] || null;
}
const PROPOSAL_FIELDS = "id,version,status,content_digest,payload,expires_at,created_at,updated_at";
export async function listProposals(db, userId, { limit = 50 } = {}) {
  return (await db.execute(db.client.from("trade_proposals").select(PROPOSAL_FIELDS).eq("user_id", userId).order("created_at", { ascending: false }).limit(Math.min(50, Math.max(1, limit))))) || [];
}
export async function findProposal(db, userId, proposalId, version) {
  const rows = await db.execute(db.client.from("trade_proposals").select(PROPOSAL_FIELDS).eq("user_id", userId).eq("id", proposalId).eq("version", version).limit(1));
  return rows?.[0] || null;
}
export async function transitionProposal(db, { userId, proposalId, version, contentDigest, nextStatus, actor, reason = null }) {
  if (!["approved", "rejected"].includes(nextStatus)) throw new Error("Invalid proposal transition");
  if (actor !== userId) throw new Error("Proposal actor must match its verified owner");
  const rows = await db.execute(db.client.rpc("yosemite_transition_proposal", { p_proposal_id: proposalId, p_version: version, p_content_digest: contentDigest, p_next_status: nextStatus, p_reason: reason }));
  return rows?.[0] || null;
}
