-- Harden pass 2026-09-02: missing indexes on hot lookup paths + PromptVersion uniqueness.
-- TrustedContact(email) is the caregiver-inbox join key; (userId, status) covers
-- active-journey / open-assistance lookups; the rest remove full scans on
-- per-user lists and the audit feed.

-- @@index([userId]) / @@index([email]) on TrustedContact
CREATE INDEX "TrustedContact_userId_idx" ON "TrustedContact"("userId");
CREATE INDEX "TrustedContact_email_idx" ON "TrustedContact"("email");

-- @@index([userId]) on ConsentGrant
CREATE INDEX "ConsentGrant_userId_idx" ON "ConsentGrant"("userId");

-- @@index([userId]) on SavedPlace
CREATE INDEX "SavedPlace_userId_idx" ON "SavedPlace"("userId");

-- @@index([userId, status]) on Journey
CREATE INDEX "Journey_userId_status_idx" ON "Journey"("userId", "status");

-- @@index([sessionId]) on EmergencyAcknowledgement
CREATE INDEX "EmergencyAcknowledgement_sessionId_idx" ON "EmergencyAcknowledgement"("sessionId");

-- @@index([userId]) on ReadingEntry
CREATE INDEX "ReadingEntry_userId_idx" ON "ReadingEntry"("userId");

-- @@index([userId, status]) on AssistanceRequest
CREATE INDEX "AssistanceRequest_userId_status_idx" ON "AssistanceRequest"("userId", "status");

-- @@index([createdAt]) / @@index([reporterId]) on IncidentReport
CREATE INDEX "IncidentReport_createdAt_idx" ON "IncidentReport"("createdAt");
CREATE INDEX "IncidentReport_reporterId_idx" ON "IncidentReport"("reporterId");

-- @@unique([mode, version]) on PromptVersion — prevents duplicate version
-- numbers from concurrent admin creates.
CREATE UNIQUE INDEX "PromptVersion_mode_version_key" ON "PromptVersion"("mode", "version");
