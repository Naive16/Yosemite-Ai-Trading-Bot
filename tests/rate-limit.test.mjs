import test from "node:test";
import assert from "node:assert/strict";
import { consumeRateLimit, RateLimitUnavailableError } from "../api/_lib/rate-limit.js";
import { FakeDatabase } from "./support/fake-database.mjs";

test("shared rate limiter enforces a concurrent window atomically", async () => {
  const db = new FakeDatabase();
  const results = await Promise.all(Array.from({ length: 5 }, () => consumeRateLimit(db, { key: "concurrent", windowSeconds: 60, maxRequests: 3 })));
  assert.equal(results.filter((result) => result.allowed).length, 3);
  assert.equal(results.filter((result) => !result.allowed).length, 2);
});

test("shared rate limiter resets an expired bucket", async () => {
  const db = new FakeDatabase();
  const first = await consumeRateLimit(db, { key: "expiry", windowSeconds: 60, maxRequests: 1 });
  assert.equal(first.allowed, true);
  const bucket = [...db.rateLimitBuckets.values()][0];
  bucket.expiresAt = Date.now() - 1;
  const afterExpiry = await consumeRateLimit(db, { key: "expiry", windowSeconds: 60, maxRequests: 1 });
  assert.equal(afterExpiry.allowed, true);
});

test("shared rate limiter fails closed when the database is unavailable", async () => {
  const db = new FakeDatabase();
  db.failQueries = true;
  await assert.rejects(() => consumeRateLimit(db, { key: "failure", windowSeconds: 60, maxRequests: 1 }), RateLimitUnavailableError);
});
