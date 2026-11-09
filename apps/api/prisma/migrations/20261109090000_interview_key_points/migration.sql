-- Structured key points for an interview: ratings per criterion, strengths and concerns
ALTER TABLE "InterviewSession" ADD COLUMN "ratings" JSONB;
ALTER TABLE "InterviewSession" ADD COLUMN "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "InterviewSession" ADD COLUMN "concerns" TEXT[] DEFAULT ARRAY[]::TEXT[];
