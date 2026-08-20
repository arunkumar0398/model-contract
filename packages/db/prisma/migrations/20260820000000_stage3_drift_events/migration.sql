-- CreateTable
CREATE TABLE "DriftEvent" (
    "id" TEXT NOT NULL,
    "modelRecordId" TEXT NOT NULL,
    "observationId" TEXT,
    "previousContractId" TEXT,
    "driftType" TEXT NOT NULL,
    "reasonCodes" JSONB NOT NULL,
    "explanations" JSONB NOT NULL,
    "fieldDiffs" JSONB NOT NULL,
    "previousHash" TEXT,
    "currentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriftEvent_observationId_key" ON "DriftEvent"("observationId");

-- CreateIndex
CREATE INDEX "DriftEvent_modelRecordId_idx" ON "DriftEvent"("modelRecordId");

-- CreateIndex
CREATE INDEX "DriftEvent_driftType_idx" ON "DriftEvent"("driftType");

-- CreateIndex
CREATE INDEX "DriftEvent_createdAt_idx" ON "DriftEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "DriftEvent" ADD CONSTRAINT "DriftEvent_modelRecordId_fkey" FOREIGN KEY ("modelRecordId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftEvent" ADD CONSTRAINT "DriftEvent_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriftEvent" ADD CONSTRAINT "DriftEvent_previousContractId_fkey" FOREIGN KEY ("previousContractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
