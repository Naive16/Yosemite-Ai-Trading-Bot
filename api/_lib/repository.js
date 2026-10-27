import { createHash, createHmac, randomUUID } from "node:crypto";

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

export function hashSessionToken(token, secret) {
  return base64Url(createHmac("sha256", secret).update(`session:${token}`).digest());
}

export function deriveCsrfToken(token, secret) {
  return base64Url(createHmac("sha256", secret).update(`csrf:${token}`).digest());
}

export function hashCsrfToken(csrfToken, secret) {
  return base64Url(createHmac("sha256", secret).update(`csrf-value:${csrfToken}`).digest());
}

const SUPABASE_PLACEHOLDER_PASSWORD_HASH = "supabase-auth-managed$external-password-disabled";

export function supabaseFallbackUsername(ownerUserId) {
  return `supabase:${String(ownerUserId).toLowerCase()}`;
}

export async function resolveSupabaseOwnerUser(db, { ownerUserId, email }) {
  const existing = await db.query(
    `SELECT id, username
     FROM app_users
     WHERE id = $1`,
    [ownerUserId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const fallbackUsername = supabaseFallbackUsername(ownerUserId);
  const candidates = normalizedEmail.length >= 3 && normalizedEmail.length <= 64
    ? [normalizedEmail, fallbackUsername]
    : [fallbackUsername];

  for (const candidateUsername of candidates) {
    const inserted = await db.query(
      `INSERT INTO app_users (id, username, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id, username`,
      [ownerUserId, candidateUsername, SUPABASE_PLACEHOLDER_PASSWORD_HASH]
    );
    if (inserted.rows[0]) return inserted.rows[0];

    const raced = await db.query(
      `SELECT id, username
       FROM app_users
       WHERE id = $1`,
      [ownerUserId]
    );
    if (raced.rows[0]) return raced.rows[0];
  }

  return null;
}

export async function createSessionWithAudit(db, { userId, token, csrfToken, sessionSecret, expiresAt, metadata = {} }) {
  const result = await db.query(
    `WITH inserted_session AS (
       INSERT INTO auth_sessions (token_hash, user_id, csrf_token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id
     )
     INSERT INTO audit_events (id, user_id, event_type, metadata)
     SELECT $5, user_id, 'auth.login.succeeded', $6::jsonb
     FROM inserted_session
     RETURNING id`,
    [hashSessionToken(token, sessionSecret), userId, hashCsrfToken(csrfToken, sessionSecret), expiresAt, randomUUID(), JSON.stringify(metadata)]
  );
  return result.rows[0] || null;
}

export async function findActiveSession(db, { token, sessionSecret }) {
  const result = await db.query(
    `SELECT s.user_id, u.username, s.csrf_token_hash, s.created_at, s.expires_at
     FROM auth_sessions AS s
     INNER JOIN app_users AS u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > CURRENT_TIMESTAMP`,
    [hashSessionToken(token, sessionSecret)]
  );
  return result.rows[0] || null;
}

export async function revokeSessionWithAudit(db, { token, sessionSecret, metadata = {} }) {
  const result = await db.query(
    `WITH revoked_session AS (
       UPDATE auth_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING user_id
     )
     INSERT INTO audit_events (id, user_id, event_type, metadata)
     SELECT $2, user_id, 'auth.logout', $3::jsonb
     FROM revoked_session
     RETURNING id`,
    [hashSessionToken(token, sessionSecret), randomUUID(), JSON.stringify(metadata)]
  );
  return Boolean(result.rows[0]);
}

export async function insertAuditEvent(db, { userId = null, eventType, metadata = {} }) {
  await db.query(
    `INSERT INTO audit_events (id, user_id, event_type, metadata)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [randomUUID(), userId, eventType, JSON.stringify(metadata)]
  );
}

export function auditClientIdentifier(clientIdentifier) {
  return createHash("sha256").update(String(clientIdentifier)).digest("hex").slice(0, 32);
}
