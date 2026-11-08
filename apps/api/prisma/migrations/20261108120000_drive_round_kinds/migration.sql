-- Round kinds: Technical and Interview are separate kinds and can repeat in a drive
-- ("Technical round 2", "Interview round 3"); the shown name is Round.title.
ALTER TYPE "RoundType" RENAME VALUE 'TECHNICAL_INTERVIEW' TO 'TECHNICAL';
ALTER TYPE "RoundType" RENAME VALUE 'HR_INTERVIEW' TO 'HR';
ALTER TYPE "RoundType" ADD VALUE 'INTERVIEW' BEFORE 'HR';

-- A round's date can be "to be announced"
ALTER TABLE "Round" ALTER COLUMN "startsAt" DROP NOT NULL;
