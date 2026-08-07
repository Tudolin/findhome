-- Two unrelated batches that happen to land together: hardening the login for a
-- server that is now on the public internet, and the signals the app was
-- throwing away.
--
-- Safe to apply to a live database: everything is additive except the
-- alert_deliveries unique key, which is widened rather than narrowed.

-- ===========================================================================
-- 1. Authentication
-- ===========================================================================

ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "totp_secret" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "totp_last_step" INTEGER;
ALTER TABLE "users" ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);

-- A signed-in browser. The session used to be a bare stateless JWT: signed,
-- 30-day expiry, and impossible to revoke. Signing out deleted the cookie and
-- nothing else, so a captured token kept working for a month and changing your
-- password did not help. See the note on the model in schema.prisma.
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    -- SHA-256 of the token's jti, never the jti. A dump of this table hands out
    -- no working sessions.
    "token_hash" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(300),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Single-use way back in when the authenticator app is gone. Without these,
-- 2FA on a self-hosted app with no email delivery is a loaded gun.
CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recovery_codes_user_id_used_at_idx" ON "recovery_codes"("user_id", "used_at");

ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every sign-in attempt. Drives lockout that survives a container restart (the
-- in-memory limiter resets to zero on every deploy), and gives the account owner
-- the "recent activity" list that is the only way anyone notices someone else
-- has their password. Keyed on the submitted email, not a user id, so failures
-- against an address that does not exist are recorded identically.
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "success" BOOLEAN NOT NULL,
    "reason" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_email_created_at_idx" ON "login_attempts"("email", "created_at");
CREATE INDEX "login_attempts_created_at_idx" ON "login_attempts"("created_at");

-- Existing accounts predate the column. Stamped with their creation date so the
-- "sessions issued before your last password change are invalid" check has a
-- baseline instead of treating NULL as "never changed, allow everything".
UPDATE "users" SET "password_changed_at" = "created_at" WHERE "password_changed_at" IS NULL;

-- ===========================================================================
-- 2. Price history
-- ===========================================================================

CREATE TABLE "property_price_events" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "rent_price" INTEGER NOT NULL,
    "condo_fee" INTEGER NOT NULL,
    "total_price" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL DEFAULT 0,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_price_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "property_price_events_property_id_seen_at_idx"
  ON "property_price_events"("property_id", "seen_at");
CREATE INDEX "property_price_events_seen_at_idx" ON "property_price_events"("seen_at");

ALTER TABLE "property_price_events" ADD CONSTRAINT "property_price_events_property_id_fkey"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed one event per listing at its current price, dated from when the listing
-- was first seen. It is not real history — that only starts accumulating now —
-- but it gives every chart a baseline instead of an empty state, and it makes
-- the first genuine price change render as a change rather than as a first point.
INSERT INTO "property_price_events" ("id", "property_id", "rent_price", "condo_fee", "total_price", "delta", "seen_at")
SELECT md5(p.id || '|seed'), p.id, p."rent_price", p."condo_fee", p."total_price", 0, p."created_at"
FROM "properties" p;

-- ===========================================================================
-- 3. Duplicate ads for the same flat
-- ===========================================================================

ALTER TABLE "properties" ADD COLUMN "cluster_key" VARCHAR(64);
CREATE INDEX "properties_cluster_key_idx" ON "properties"("cluster_key");

-- ===========================================================================
-- 4. Commute
-- ===========================================================================

ALTER TABLE "properties" ADD COLUMN "commute_min" INTEGER;
ALTER TABLE "properties" ADD COLUMN "commute_checked_at" TIMESTAMP(3);
CREATE INDEX "properties_commute_checked_at_idx" ON "properties"("commute_checked_at");

ALTER TABLE "preference_profiles" ADD COLUMN "commute_address" VARCHAR(300);
ALTER TABLE "preference_profiles" ADD COLUMN "commute_lat" DOUBLE PRECISION;
ALTER TABLE "preference_profiles" ADD COLUMN "commute_lng" DOUBLE PRECISION;
ALTER TABLE "preference_profiles" ADD COLUMN "commute_mode" VARCHAR(20) NOT NULL DEFAULT 'driving';
ALTER TABLE "preference_profiles" ADD COLUMN "max_commute_min" INTEGER;

-- ===========================================================================
-- 5. Alerts about listings you already know
-- ===========================================================================

-- Widened, not narrowed: (scope, property) becomes (scope, property, kind), so a
-- price cut is no longer suppressed by the "already told you about this flat"
-- rule. Every existing row is a NEW announcement, which the default records.
ALTER TABLE "alert_deliveries" ADD COLUMN "kind" VARCHAR(20) NOT NULL DEFAULT 'NEW';

ALTER TABLE "alert_deliveries" DROP CONSTRAINT IF EXISTS "alert_deliveries_scope_key_property_id_key";
DROP INDEX IF EXISTS "alert_deliveries_scope_key_property_id_key";

CREATE UNIQUE INDEX "alert_deliveries_scope_key_property_id_kind_key"
  ON "alert_deliveries"("scope_key", "property_id", "kind");
