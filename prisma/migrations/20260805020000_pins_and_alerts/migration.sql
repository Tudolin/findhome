-- Pins, and WhatsApp alerts for newly discovered listings.

-- AlterTable: pinning is scoped exactly like the rest of the interaction row,
-- so a pin in Solo Mode is private and one made inside a party is the party's.
ALTER TABLE "property_interactions" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "property_interactions_scope_key_pinned_idx" ON "property_interactions"("scope_key", "pinned");

-- AlterTable: alert opt-in lives with the search it belongs to. Only the
-- destination and the switch are per-workspace; the provider credentials are
-- server-wide environment config.
ALTER TABLE "preference_profiles"
  ADD COLUMN "alerts_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "alert_whatsapp" VARCHAR(20),
  ADD COLUMN "alert_max_per_run" INTEGER NOT NULL DEFAULT 5;

-- CreateTable: the ledger that makes "notify once" true. The scraper asks which
-- matching listings have no row here, so a crash between sending and recording
-- costs a duplicate at worst, and a failed send is retried next run.
CREATE TABLE "alert_deliveries" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" VARCHAR(30) NOT NULL,

    CONSTRAINT "alert_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alert_deliveries_scope_key_property_id_key" ON "alert_deliveries"("scope_key", "property_id");

-- CreateIndex
CREATE INDEX "alert_deliveries_sent_at_idx" ON "alert_deliveries"("sent_at");

-- AddForeignKey
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
