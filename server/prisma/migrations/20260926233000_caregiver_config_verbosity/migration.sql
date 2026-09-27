-- The caretaker-configures-the-ward model: the voice detail level (verbosity)
-- must be remotely settable by a granted caregiver and must survive the ward
-- switching devices, so it moves from browser-localStorage-only to the server
-- preferences row. Default 1 (Standard) matches the previous local default.
ALTER TABLE "AccessibilityPrefs" ADD COLUMN "verbosity" INTEGER NOT NULL DEFAULT 1;
