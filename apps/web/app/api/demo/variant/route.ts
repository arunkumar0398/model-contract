import { NextResponse } from "next/server";
import { createPrismaClient } from "@modelcontract/db";
import { DEMO_VARIANT_IDS, resolveVariantId } from "../../../../../../fixtures/provider-demo/shared";
import { isValidVariantId, setDemoState } from "../../../../lib/demo-state";

/**
 * POST /api/demo/variant  { "variant": "BROKEN_SELECTOR" }
 * Persists the controlled provider's demo state so the canonical
 * /provider-demo/model-x URL mutates underneath the scraper.
 */
export async function POST(request: Request) {
  const db = createPrismaClient();
  if (!db) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured; persistence unavailable" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const variant = (body as { variant?: unknown } | null)?.variant;
  if (!isValidVariantId(variant)) {
    return NextResponse.json(
      { error: `variant must be one of: ${DEMO_VARIANT_IDS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const resolved = resolveVariantId(typeof variant === "string" ? variant : undefined);
    const row = await setDemoState(db, resolved);
    return NextResponse.json({ variant: row.variant, updatedAt: row.updatedAt });
  } catch (err) {
    console.error("failed to persist demo state", err);
    return NextResponse.json({ error: "failed to persist demo state" }, { status: 500 });
  }
}
