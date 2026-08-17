import { NextResponse } from "next/server";
import { createPrismaClient } from "@modelcontract/db";

/** GET /api/contracts — current contracts with provider/model provenance. */
export async function GET() {
  const db = createPrismaClient();
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured; persistence unavailable" },
      { status: 503 },
    );
  }

  const contracts = await db.contract.findMany({
    include: { model: { include: { provider: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    contracts: contracts.map((c) => ({
      id: c.id,
      provider: c.model.provider.name,
      modelId: c.model.modelId,
      status: c.status,
      contextWindow: c.contextWindow,
      inputPrice: c.inputPrice,
      outputPrice: c.outputPrice,
      currency: c.currency,
      pricingUnit: c.pricingUnit,
      deprecationDate: c.deprecationDate,
      semanticHash: c.semanticHash,
      sourceUrl: c.sourceUrl,
      collectorId: c.collectorId,
      collectorVersion: c.collectorVersion,
      observedAt: c.observedAt,
      createdAt: c.createdAt,
    })),
  });
}
