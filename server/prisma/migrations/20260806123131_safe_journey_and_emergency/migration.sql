-- AlterTable
ALTER TABLE "Journey" ADD COLUMN     "checkInIntervalMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "deviationThresholdMeters" DOUBLE PRECISION NOT NULL DEFAULT 80,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "eta" TIMESTAMP(3),
ADD COLUMN     "lastAccuracy" DOUBLE PRECISION,
ADD COLUMN     "lastBearing" DOUBLE PRECISION,
ADD COLUMN     "lastCheckInAt" TIMESTAMP(3),
ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "lastLocationAt" TIMESTAMP(3),
ADD COLUMN     "lastPromptAt" TIMESTAMP(3),
ADD COLUMN     "promptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shareLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "trustedContactId" TEXT;

-- CreateTable
CREATE TABLE "JourneyLocation" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "battery" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "battery" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "mapsUrl" TEXT,
    "journeyId" TEXT,

    CONSTRAINT "EmergencySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAcknowledgement" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "contactUserId" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "EmergencyAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JourneyLocation_journeyId_recordedAt_idx" ON "JourneyLocation"("journeyId", "recordedAt");

-- CreateIndex
CREATE INDEX "EmergencySession_userId_triggeredAt_idx" ON "EmergencySession"("userId", "triggeredAt");

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_trustedContactId_fkey" FOREIGN KEY ("trustedContactId") REFERENCES "TrustedContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyLocation" ADD CONSTRAINT "JourneyLocation_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencySession" ADD CONSTRAINT "EmergencySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyAcknowledgement" ADD CONSTRAINT "EmergencyAcknowledgement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EmergencySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
