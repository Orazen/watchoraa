-- Community reports gain optional coordinates so blind users can ask
-- "what's reported near me?" and caregivers get a spatial view later.
-- Coordinates are OPTIONAL and only ever exposed through the aggregated
-- near-me endpoint (privacy: raw coordinates are never serialized back).

ALTER TABLE "IncidentReport" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "IncidentReport" ADD COLUMN "lng" DOUBLE PRECISION;

CREATE INDEX "IncidentReport_lat_lng_idx" ON "IncidentReport"("lat", "lng");
