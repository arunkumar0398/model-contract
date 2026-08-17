import { NextResponse } from "next/server";
import { createPrismaClient } from "@modelcontract/db";

/** GET /api/contracts/:id — a single current contract with provenance. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const db = createPrismaClient();
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured; persistence unavailable" },
      { status: 503 },
    );
  }

  const { id } = await params;
  const contract = await db.contract.findUnique({
    where: { id },
    include: { model: { include: { provider: true } } },
  });

  if (!contract) {
    return NextResponse.json({ error: "contract not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: contract.id,
    provider: contract.model.provider.name,
    modelId: contract.model.modelId,
    status: contract.status,
    contextWindow: contract.contextWindow,
    inputPrice: contract.inputPrice,
    outputPrice: contract.outputPrice,
    currency: contract.currency,
    pricingUnit: contract.pricingUnit,
    deprecationDate: contract.deprecationDate,
    semanticHash: contract.semanticHash,
    sourceUrl: contract.sourceUrl,
    collectorId: contract.collectorId,
    collectorVersion: contract.collectorVersion,
    observedAt: contract.observedAt,
    createdAt: contract.createdAt,
  });
}
