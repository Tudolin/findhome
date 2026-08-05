-- Visit agenda (with calendar-feed subscription) and geocoding bookkeeping.

-- AlterTable: stamped whether or not the lookup found anything, so an
-- unresolvable address is attempted once rather than on every run.
ALTER TABLE "properties" ADD COLUMN "geocoded_at" TIMESTAMP(3);

-- No index for the geocoder's "no coordinates, never tried" query on purpose: a
-- partial index cannot be expressed in schema.prisma, so it would show up as
-- schema drift forever, and `properties_created_at_idx` already covers the scan
-- at home-server scale.

-- AlterTable: the secret in the calendar-feed URL. Apple and Google Calendar
-- fetch that URL with no cookies, so the token is the only credential available.
ALTER TABLE "users" ADD COLUMN "calendar_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_calendar_token_key" ON "users"("calendar_token");

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "party_id" TEXT,
    "scope_key" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visits_scope_key_scheduled_at_idx" ON "visits"("scope_key", "scheduled_at");

-- CreateIndex
CREATE INDEX "visits_property_id_idx" ON "visits"("property_id");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
