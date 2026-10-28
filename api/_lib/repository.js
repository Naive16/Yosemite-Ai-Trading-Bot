import { createHash, randomUUID } from "node:crypto";

export async function insertAuditEvent(db, { userId = null, eventType, metadata = {} }) {
  await db.execute(db.client.from("audit_events").insert({ id: randomUUID(), user_id: userId, event_type: eventType, metadata }));
}
export function auditClientIdentifier(clientIdentifier) {
  return createHash("sha256").update(String(clientIdentifier)).digest("hex").slice(0, 32);
}
