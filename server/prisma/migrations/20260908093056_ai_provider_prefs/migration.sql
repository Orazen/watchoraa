-- DropIndex
DROP INDEX "IncidentReport_lat_lng_idx";

-- CreateTable
CREATE TABLE "AiProviderPref" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GEMINI',
    "model" TEXT,
    "baseUrl" TEXT,
    "apiKeyEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderPref_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderPref_userId_key" ON "AiProviderPref"("userId");

-- AddForeignKey
ALTER TABLE "AiProviderPref" ADD CONSTRAINT "AiProviderPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
