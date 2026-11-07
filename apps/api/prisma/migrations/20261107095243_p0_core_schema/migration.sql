/*
  Warnings:

  - You are about to drop the column `emailVerified` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('STUDENT_SIGNUP', 'COMPANY_REQUEST', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('SENT', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('MARKSHEET', 'RESUME', 'PHOTO', 'JD', 'OFFER_LETTER', 'IMPORT_SHEET', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('APPROVED', 'FROZEN', 'BANNED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "CompanyMemberRole" AS ENUM ('HR', 'INTERVIEWER');

-- CreateEnum
CREATE TYPE "CompanyRequestStatus" AS ENUM ('PENDING_EMAIL', 'PENDING_CHECKS', 'IN_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PASS', 'WARN', 'FAIL', 'ERROR');

-- CreateEnum
CREATE TYPE "CallbackOutcome" AS ENUM ('CONFIRMED', 'NOT_CONFIRMED', 'NO_ANSWER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('PROFILE_INCOMPLETE', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlacementStatus" AS ENUM ('NOT_PLACED', 'PLACED');

-- CreateEnum
CREATE TYPE "AcademicSource" AS ENUM ('SELF', 'OFFICIAL_SHEET', 'TPO');

-- CreateEnum
CREATE TYPE "AcademicStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('MARKSHEET_10', 'MARKSHEET_12', 'DIPLOMA', 'SEMESTER_MARKSHEET', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'CHECKING', 'MATCHED', 'MISMATCH', 'UNREADABLE', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('OFFICIAL_STUDENTS', 'ROUND_RESULTS', 'HISTORY');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'MAPPING', 'PREVIEW', 'APPLYING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowResult" AS ENUM ('MATCHED', 'MISMATCH', 'NOT_REGISTERED', 'NOT_IN_SHEET', 'INVALID');

-- CreateEnum
CREATE TYPE "ImportResolution" AS ENUM ('ACCEPT_SHEET', 'KEEP_PROFILE', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('STUDENT_VERIFICATION', 'ACADEMIC_UPDATE', 'IMPORT_MISMATCH', 'DUPLICATE_DOCUMENT', 'COMPANY_REVIEW', 'COMPANY_REPORT', 'SECOND_CHECK', 'FEEDBACK_REVIEW', 'RESULT_CONCERN');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'CLAIMED', 'DECIDED', 'AWAITING_SECOND_CHECK', 'ESCALATED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "TaskDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FULL_TIME', 'INTERNSHIP', 'INTERNSHIP_PPO');

-- CreateEnum
CREATE TYPE "DriveStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'ONGOING', 'RESULTS_DECLARED', 'CLOSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoundType" AS ENUM ('PPT', 'OA', 'GD', 'TECHNICAL_INTERVIEW', 'HR_INTERVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "RoundMode" AS ENUM ('OFFLINE', 'ONLINE');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'RESULTS_PENDING', 'RESULTS_PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('INVITED', 'OPTED_IN', 'OPTED_OUT', 'EXPIRED', 'ELIMINATED', 'NO_SHOW', 'SELECTED', 'OFFERED', 'PLACED', 'OFFER_DECLINED', 'REMOVED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('QR', 'MANUAL');

-- CreateEnum
CREATE TYPE "ResultValue" AS ENUM ('PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "ResultSource" AS ENUM ('MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'CALLED', 'IN_INTERVIEW', 'DONE', 'SKIPPED', 'ABSENT');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('SELECT', 'REJECT', 'HOLD');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('PENDING_REVIEW', 'RELEASED', 'EDITED_AND_RELEASED', 'WITHHELD');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('APP', 'HISTORY_IMPORT');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'DESKTOP', 'WEB');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('QUEUE', 'DRIVES', 'OFFERS', 'GENERAL');

-- CreateEnum
CREATE TYPE "Audience" AS ENUM ('ALL_STUDENTS', 'DRIVE_PARTICIPANTS');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'RETRYING', 'FAILED');

-- AlterTable
ALTER TABLE "RoleGrant" ADD COLUMN     "grantedById" UUID;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "emailVerified",
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "pledgeAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "totpSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOtp" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "capabilities" TEXT[],
    "scope" JSONB,
    "companyId" UUID,
    "tokenHash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'SENT',
    "invitedById" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" UUID NOT NULL,
    "ownerId" UUID,
    "kind" "FileKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "blockPlacedStudents" BOOLEAN NOT NULL DEFAULT true,
    "dreamOfferMinCtcLpa" DOUBLE PRECISION,
    "noShowWarnAfter" INTEGER NOT NULL DEFAULT 1,
    "noShowBlockAfter" INTEGER NOT NULL DEFAULT 2,
    "showSelectedListByDefault" BOOLEAN NOT NULL DEFAULT false,
    "offerResponseDays" INTEGER NOT NULL DEFAULT 7,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlacementPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "domain" TEXT,
    "industry" TEXT,
    "about" TEXT,
    "address" TEXT,
    "cin" TEXT,
    "gstin" TEXT,
    "officialPhone" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMember" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "CompanyMemberRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "invitedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRequest" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "domain" TEXT,
    "industry" TEXT,
    "about" TEXT,
    "address" TEXT,
    "cin" TEXT,
    "gstin" TEXT,
    "officialPhone" TEXT,
    "hrName" TEXT NOT NULL,
    "hrDesignation" TEXT,
    "hrEmail" TEXT NOT NULL,
    "hrPhone" TEXT,
    "roleTitle" TEXT NOT NULL,
    "ctcLpa" DOUBLE PRECISION,
    "stipendMonthly" INTEGER,
    "location" TEXT,
    "eligibilityNotes" TEXT,
    "tentativeDates" TEXT,
    "jdFileId" UUID,
    "status" "CompanyRequestStatus" NOT NULL DEFAULT 'PENDING_EMAIL',
    "emailVerifiedAt" TIMESTAMP(3),
    "risk" "RiskLevel",
    "trustScore" INTEGER,
    "decisionReason" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyCheck" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "result" "CheckResult" NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyCallback" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "calledNumber" TEXT NOT NULL,
    "outcome" "CallbackOutcome" NOT NULL,
    "notes" TEXT,
    "staffId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyCallback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyReport" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rollNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "batch" INTEGER NOT NULL,
    "degree" TEXT,
    "gender" TEXT,
    "status" "StudentStatus" NOT NULL DEFAULT 'PROFILE_INCOMPLETE',
    "rejectionReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "cgpa" DOUBLE PRECISION,
    "activeBacklogs" INTEGER,
    "totalBacklogs" INTEGER,
    "tenthPercent" DOUBLE PRECISION,
    "twelfthPercent" DOUBLE PRECISION,
    "diplomaPercent" DOUBLE PRECISION,
    "skills" TEXT[],
    "links" JSONB,
    "photoFileId" UUID,
    "resumeFileId" UUID,
    "placementStatus" "PlacementStatus" NOT NULL DEFAULT 'NOT_PLACED',
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicRecord" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "cgpa" DOUBLE PRECISION NOT NULL,
    "activeBacklogs" INTEGER NOT NULL,
    "totalBacklogs" INTEGER NOT NULL,
    "tenthPercent" DOUBLE PRECISION,
    "twelfthPercent" DOUBLE PRECISION,
    "diplomaPercent" DOUBLE PRECISION,
    "semester" INTEGER,
    "source" "AcademicSource" NOT NULL DEFAULT 'SELF',
    "status" "AcademicStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentDocument" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "semester" INTEGER,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "flags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "fileId" UUID NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "columnMapping" JSONB,
    "summary" JSONB,
    "roundId" UUID,
    "jobId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "rollNo" TEXT,
    "studentId" UUID,
    "result" "ImportRowResult" NOT NULL,
    "mismatches" JSONB,
    "resolution" "ImportResolution",
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" UUID NOT NULL,
    "type" "TaskType" NOT NULL,
    "risk" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "studentId" UUID,
    "branch" TEXT,
    "batch" INTEGER,
    "claimedById" UUID,
    "claimedUntil" TIMESTAMP(3),
    "decidedById" UUID,
    "decision" "TaskDecision",
    "reasonCode" TEXT,
    "note" TEXT,
    "escalationNote" TEXT,
    "parentTaskId" UUID,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drive" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL DEFAULT 'FULL_TIME',
    "ctcLpa" DOUBLE PRECISION,
    "stipendMonthly" INTEGER,
    "location" TEXT,
    "bondMonths" INTEGER,
    "jdFileId" UUID,
    "status" "DriveStatus" NOT NULL DEFAULT 'DRAFT',
    "optInDeadline" TIMESTAMP(3),
    "showSelectedList" BOOLEAN NOT NULL DEFAULT false,
    "eligibility" JSONB,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveCoordinator" (
    "driveId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveCoordinator_pkey" PRIMARY KEY ("driveId","userId")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" UUID NOT NULL,
    "driveId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "RoundType" NOT NULL,
    "title" TEXT NOT NULL,
    "mode" "RoundMode" NOT NULL DEFAULT 'OFFLINE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "venue" TEXT,
    "venueLat" DOUBLE PRECISION,
    "venueLng" DOUBLE PRECISION,
    "venueRadiusM" INTEGER DEFAULT 150,
    "onlineLink" TEXT,
    "instructions" TEXT,
    "status" "RoundStatus" NOT NULL DEFAULT 'SCHEDULED',
    "resultsPublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participation" (
    "id" UUID NOT NULL,
    "driveId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "ParticipationStatus" NOT NULL DEFAULT 'INVITED',
    "invitedById" UUID,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "eliminatedAtRoundId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "qrSecret" TEXT NOT NULL,
    "venueLat" DOUBLE PRECISION,
    "venueLng" DOUBLE PRECISION,
    "radiusM" INTEGER,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "sessionId" UUID,
    "method" "AttendanceMethod" NOT NULL,
    "markedById" UUID,
    "reason" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "distanceM" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundResult" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "result" "ResultValue" NOT NULL DEFAULT 'PENDING',
    "source" "ResultSource" NOT NULL DEFAULT 'MANUAL',
    "setById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoundResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Panel" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Panel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelMember" (
    "panelId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "PanelMember_pkey" PRIMARY KEY ("panelId","userId")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" UUID NOT NULL,
    "panelId" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
    "skipCount" INTEGER NOT NULL DEFAULT 0,
    "calledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewSession" (
    "id" UUID NOT NULL,
    "queueEntryId" UUID NOT NULL,
    "panelId" UUID NOT NULL,
    "interviewerId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "privateNotes" TEXT,
    "recommendation" "Recommendation",

    CONSTRAINT "InterviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "roundId" UUID,
    "authorId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "releasedText" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "driveId" UUID NOT NULL,
    "participationId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "ctcLpa" DOUBLE PRECISION,
    "joiningDate" TIMESTAMP(3),
    "status" "OfferStatus" NOT NULL DEFAULT 'SENT',
    "respondBy" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "uploadedById" UUID NOT NULL,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementRecord" (
    "id" UUID NOT NULL,
    "studentId" UUID,
    "companyId" UUID,
    "offerId" UUID,
    "studentRollNo" TEXT,
    "companyName" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "ctcLpa" DOUBLE PRECISION,
    "branch" TEXT NOT NULL,
    "batch" INTEGER NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "source" "RecordSource" NOT NULL DEFAULT 'APP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyFaq" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyFaq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPrefs" (
    "userId" UUID NOT NULL,
    "channels" JSONB,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "whatsappConsentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPrefs_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" UUID NOT NULL,
    "driveId" UUID,
    "authorId" UUID NOT NULL,
    "audience" "Audience" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "eventTypes" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "EmailOtp_email_purpose_createdAt_idx" ON "EmailOtp"("email", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "FileObject_storageKey_key" ON "FileObject"("storageKey");

-- CreateIndex
CREATE INDEX "FileObject_sha256_idx" ON "FileObject"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMember_companyId_userId_key" ON "CompanyMember"("companyId", "userId");

-- CreateIndex
CREATE INDEX "CompanyRequest_status_createdAt_idx" ON "CompanyRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CompanyCheck_requestId_idx" ON "CompanyCheck"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_rollNo_key" ON "StudentProfile"("rollNo");

-- CreateIndex
CREATE INDEX "StudentProfile_branch_batch_status_idx" ON "StudentProfile"("branch", "batch", "status");

-- CreateIndex
CREATE INDEX "StudentProfile_cgpa_idx" ON "StudentProfile"("cgpa");

-- CreateIndex
CREATE INDEX "AcademicRecord_studentId_createdAt_idx" ON "AcademicRecord"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "StudentDocument_studentId_idx" ON "StudentDocument"("studentId");

-- CreateIndex
CREATE INDEX "ImportRow_importId_result_idx" ON "ImportRow"("importId", "result");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_importId_rowNumber_key" ON "ImportRow"("importId", "rowNumber");

-- CreateIndex
CREATE INDEX "ReviewTask_status_priority_createdAt_idx" ON "ReviewTask"("status", "priority" DESC, "createdAt");

-- CreateIndex
CREATE INDEX "ReviewTask_subjectType_subjectId_idx" ON "ReviewTask"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ReviewTask_claimedById_idx" ON "ReviewTask"("claimedById");

-- CreateIndex
CREATE INDEX "Drive_companyId_status_idx" ON "Drive"("companyId", "status");

-- CreateIndex
CREATE INDEX "Drive_status_optInDeadline_idx" ON "Drive"("status", "optInDeadline");

-- CreateIndex
CREATE INDEX "Round_startsAt_idx" ON "Round"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Round_driveId_sequence_key" ON "Round"("driveId", "sequence");

-- CreateIndex
CREATE INDEX "Participation_studentId_status_idx" ON "Participation"("studentId", "status");

-- CreateIndex
CREATE INDEX "Participation_driveId_status_idx" ON "Participation"("driveId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_driveId_studentId_key" ON "Participation"("driveId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_roundId_participationId_key" ON "Attendance"("roundId", "participationId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundResult_roundId_participationId_key" ON "RoundResult"("roundId", "participationId");

-- CreateIndex
CREATE INDEX "QueueEntry_panelId_status_position_idx" ON "QueueEntry"("panelId", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_panelId_participationId_key" ON "QueueEntry"("panelId", "participationId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewSession_queueEntryId_key" ON "InterviewSession"("queueEntryId");

-- CreateIndex
CREATE INDEX "Feedback_status_idx" ON "Feedback"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_participationId_key" ON "Offer"("participationId");

-- CreateIndex
CREATE INDEX "Offer_studentId_status_idx" ON "Offer"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlacementRecord_offerId_key" ON "PlacementRecord"("offerId");

-- CreateIndex
CREATE INDEX "PlacementRecord_batch_branch_idx" ON "PlacementRecord"("batch", "branch");

-- CreateIndex
CREATE INDEX "PlacementRecord_companyName_idx" ON "PlacementRecord"("companyName");

-- CreateIndex
CREATE UNIQUE INDEX "Device_token_key" ON "Device"("token");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_subscriptionId_eventId_key" ON "WebhookDelivery"("subscriptionId", "eventId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRequest" ADD CONSTRAINT "CompanyRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCheck" ADD CONSTRAINT "CompanyCheck_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CompanyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCallback" ADD CONSTRAINT "CompanyCallback_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CompanyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyReport" ADD CONSTRAINT "CompanyReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyReport" ADD CONSTRAINT "CompanyReport_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicRecord" ADD CONSTRAINT "AcademicRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentDocument" ADD CONSTRAINT "StudentDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "ReviewTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drive" ADD CONSTRAINT "Drive_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveCoordinator" ADD CONSTRAINT "DriveCoordinator_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveCoordinator" ADD CONSTRAINT "DriveCoordinator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundResult" ADD CONSTRAINT "RoundResult_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundResult" ADD CONSTRAINT "RoundResult_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Panel" ADD CONSTRAINT "Panel_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelMember" ADD CONSTRAINT "PanelMember_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanelMember" ADD CONSTRAINT "PanelMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSession" ADD CONSTRAINT "InterviewSession_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "QueueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSession" ADD CONSTRAINT "InterviewSession_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "Panel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "Participation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementRecord" ADD CONSTRAINT "PlacementRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementRecord" ADD CONSTRAINT "PlacementRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementRecord" ADD CONSTRAINT "PlacementRecord_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFaq" ADD CONSTRAINT "CompanyFaq_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPrefs" ADD CONSTRAINT "NotificationPrefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_driveId_fkey" FOREIGN KEY ("driveId") REFERENCES "Drive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
