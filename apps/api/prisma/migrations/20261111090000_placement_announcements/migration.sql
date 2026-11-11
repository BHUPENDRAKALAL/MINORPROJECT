-- Placement announcements: the TPO announces a drive's selected students; students may opt out of being named.
ALTER TABLE "Drive" ADD COLUMN "announcedAt" TIMESTAMP(3);
ALTER TABLE "StudentProfile" ADD COLUMN "hideInAnnouncements" BOOLEAN NOT NULL DEFAULT false;
