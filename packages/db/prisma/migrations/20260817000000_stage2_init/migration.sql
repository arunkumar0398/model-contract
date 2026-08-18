-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Model" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "contextWindow" INTEGER,
    "inputPrice" DOUBLE PRECISION,
    "outputPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pricingUnit" TEXT NOT NULL DEFAULT 'per_1m_tokens',
    "deprecationDate" TEXT,
    "semanticHash" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "collectorVersion" TEXT NOT NULL,
    "observedAt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB,
    "schemaValid" BOOLEAN NOT NULL,
    "validationErrors" JSONB NOT NULL,
    "validationWarnings" JSONB NOT NULL,
    "semanticHash" TEXT,
    "collectorId" TEXT NOT NULL,
    "collectorVersion" TEXT,
    "runId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "observedAt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorVersion" (
    "id" TEXT NOT NULL,
    "collectorId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectorVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoState" (
    "id" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_slug_key" ON "Provider"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Model_providerId_modelId_key" ON "Model"("providerId", "modelId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_modelId_key" ON "Contract"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectorVersion_collectorId_version_key" ON "CollectorVersion"("collectorId", "version");

-- AddForeignKey
ALTER TABLE "Model" ADD CONSTRAINT "Model_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

