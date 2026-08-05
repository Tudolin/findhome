-- CreateEnum
CREATE TYPE "PartyRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('DISCOVERED', 'INTERESTED', 'FAVORITE', 'VISIT_SCHEDULED', 'APPLIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('RENT', 'SALE');

-- CreateEnum
CREATE TYPE "PropertySource" AS ENUM ('ZAP', 'VIVA_REAL', 'QUINTO_ANDAR', 'OLX', 'MANUAL', 'DEMO');

-- CreateEnum
CREATE TYPE "ScrapeStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_members" (
    "id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "PartyRole" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preference_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "party_id" TEXT,
    "city" TEXT NOT NULL,
    "neighborhoods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "listing_type" "ListingType" NOT NULL DEFAULT 'RENT',
    "min_price" INTEGER,
    "max_price" INTEGER,
    "include_condo_in_max_price" BOOLEAN NOT NULL DEFAULT true,
    "min_bedrooms" INTEGER NOT NULL DEFAULT 0,
    "min_bathrooms" INTEGER NOT NULL DEFAULT 0,
    "min_parking_spots" INTEGER NOT NULL DEFAULT 0,
    "min_sqm" INTEGER NOT NULL DEFAULT 0,
    "pet_friendly" BOOLEAN NOT NULL DEFAULT false,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preference_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "source" "PropertySource" NOT NULL DEFAULT 'MANUAL',
    "external_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "rent_price" INTEGER NOT NULL,
    "condo_fee" INTEGER NOT NULL DEFAULT 0,
    "tax_fee" INTEGER NOT NULL DEFAULT 0,
    "total_price" INTEGER NOT NULL,
    "bedrooms" INTEGER NOT NULL DEFAULT 0,
    "bathrooms" INTEGER NOT NULL DEFAULT 0,
    "parking_spots" INTEGER NOT NULL DEFAULT 0,
    "sqm" INTEGER NOT NULL DEFAULT 0,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pet_friendly" BOOLEAN,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "listing_type" "ListingType" NOT NULL DEFAULT 'RENT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_interactions" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "party_id" TEXT,
    "scope_key" TEXT NOT NULL,
    "status" "InteractionStatus" NOT NULL DEFAULT 'DISCOVERED',
    "rating" INTEGER,
    "pros" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_comments" (
    "id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "party_id" TEXT,
    "scope_key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_runs" (
    "id" TEXT NOT NULL,
    "source" "PropertySource" NOT NULL,
    "status" "ScrapeStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "listings_found" INTEGER NOT NULL DEFAULT 0,
    "listings_created" INTEGER NOT NULL DEFAULT 0,
    "listings_updated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "scrape_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "parties_invite_code_key" ON "parties"("invite_code");

-- CreateIndex
CREATE INDEX "parties_created_by_user_id_idx" ON "parties"("created_by_user_id");

-- CreateIndex
CREATE INDEX "party_members_user_id_idx" ON "party_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "party_members_party_id_user_id_key" ON "party_members"("party_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "preference_profiles_user_id_key" ON "preference_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "preference_profiles_party_id_key" ON "preference_profiles"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "properties_source_url_key" ON "properties"("source_url");

-- CreateIndex
CREATE INDEX "properties_city_neighborhood_idx" ON "properties"("city", "neighborhood");

-- CreateIndex
CREATE INDEX "properties_total_price_idx" ON "properties"("total_price");

-- CreateIndex
CREATE INDEX "properties_created_at_idx" ON "properties"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "properties_source_external_id_key" ON "properties"("source", "external_id");

-- CreateIndex
CREATE INDEX "property_interactions_scope_key_status_idx" ON "property_interactions"("scope_key", "status");

-- CreateIndex
CREATE INDEX "property_interactions_party_id_idx" ON "property_interactions"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_interactions_property_id_user_id_scope_key_key" ON "property_interactions"("property_id", "user_id", "scope_key");

-- CreateIndex
CREATE INDEX "property_comments_property_id_scope_key_idx" ON "property_comments"("property_id", "scope_key");

-- CreateIndex
CREATE INDEX "scrape_runs_source_started_at_idx" ON "scrape_runs"("source", "started_at");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_members" ADD CONSTRAINT "party_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preference_profiles" ADD CONSTRAINT "preference_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preference_profiles" ADD CONSTRAINT "preference_profiles_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_interactions" ADD CONSTRAINT "property_interactions_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_interactions" ADD CONSTRAINT "property_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_interactions" ADD CONSTRAINT "property_interactions_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_comments" ADD CONSTRAINT "property_comments_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_comments" ADD CONSTRAINT "property_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_comments" ADD CONSTRAINT "property_comments_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
