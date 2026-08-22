-- Stage 4: Self-healing persistence
-- Adds Model.healthState + HealAttempt model

-- AlterTable: Model
ALTER TABLE "Model" ADD COLUMN "healthState" TEXT NOT NULL DEFAULT 'HEALTHY';

-- CreateTable: HealAttempt
CREATE TABLE "HealAttempt" (
    "id" TEXT NOT NULL,
    "driftEventId" TEXT NOT NULL,
    "modelRecordId" TEXT NOT NULL,
    "previousCollectorId" TEXT,
    "previousHash" TEXT,
    "candidateRunId" TEXT,
    "candidateOutput" JSONB,
    "candidateHash" TEXT,
    "candidateSchemaValid" BOOLEAN,
    "semanticMatch" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "HealAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: HealAttempt
CREATE INDEX "HealAttempt_driftEventId_idx" ON "HealAttempt"("driftEventId");
CREATE INDEX "HealAttempt_modelRecordId_idx" ON "HealAttempt"("modelRecordId");
CREATE INDEX "HealAttempt_status_idx" ON "HealAttempt"("status");

-- AddForeignKey: HealAttempt -> DriftEvent
ALTER TABLE "HealAttempt" ADD CONSTRAINT "HealAttempt_driftEventId_fkey" FOREIGN KEY ("driftEventId") REFERENCES "DriftEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: HealAttempt -> Model
ALTER TABLE "HealAttempt" ADD CONSTRAINT "HealAttempt_modelRecordId_fkey" FOREIGN KEY ("modelRecordId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
