-- Add global-vs-nearby discovery toggle.
--
-- When true (default), discovery is worldwide and ignores saved location/distance.
-- When false, the user's location and maxDistanceKm preference influence ranking.

ALTER TABLE "discovery_preferences"
  ADD COLUMN IF NOT EXISTS "globalDiscovery" BOOLEAN NOT NULL DEFAULT true;
