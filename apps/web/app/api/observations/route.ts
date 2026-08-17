import { NextResponse } from "next/server";
import { createPrismaClient } from "@modelcontract/db";
import { ingestObservation, type RawObservation } from "../../../lib/ingest";

/**
 * POST /api/observations
 * Receive a raw collector observation, persist it, normalize + validate with
 * packages/core, hash when valid, and promote the current contract only for
 * schema-valid observations.
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

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "body must be a single raw observation object" },
      { status: 400 },
    );
  }

  const raw = body as RawObservation;
  // provider/modelId are labels required to attach the observation; their
  // absence is a caller error, not scrape content.
  for (const field of ["provider", "modelId", "sourceUrl", "collectorId"] as const) {
    if (typeof raw[field] !== "string" || raw[field].trim() === "") {
      return NextResponse.json({ error: `${field} is required` }, { status: 400 });
    }
  }

  try {
    const result = await ingestObservation(db, raw);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("observation ingestion failed", err);
    return NextResponse.json({ error: "observation ingestion failed" }, { status: 500 });
  }
}
