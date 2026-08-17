import type { PrismaClient } from "@modelcontract/db";
import {
  DEMO_VARIANT_IDS,
  resolveVariantId,
  type DemoVariantId,
} from "../../../fixtures/provider-demo/shared";

export const DEMO_STATE_ID = "singleton";

/** Structural subset of PrismaClient used by the demo-state helpers. */
export type DemoStateDb = Pick<PrismaClient, "demoState">;

export function isValidVariantId(value: unknown): boolean {
  return typeof value === "string" && (DEMO_VARIANT_IDS as readonly string[]).includes(value.toUpperCase());
}

/** Resolve the variant the provider page must render.
 *  Persisted DemoState wins so the canonical URL can mutate underneath the
 *  scraper; the query parameter is only a fallback when no state is stored. */
export function resolveProviderVariant(
  state: DemoVariantId | null,
  queryVariant: unknown,
): DemoVariantId {
  if (state) return state;
  return resolveVariantId(typeof queryVariant === "string" ? queryVariant : undefined);
}

export async function getDemoState(db: DemoStateDb): Promise<DemoVariantId | null> {
  const row = await db.demoState.findUnique({ where: { id: DEMO_STATE_ID } });
  if (!row) return null;
  return resolveVariantId(row.variant);
}

export async function setDemoState(db: DemoStateDb, variant: DemoVariantId) {
  return db.demoState.upsert({
    where: { id: DEMO_STATE_ID },
    create: { id: DEMO_STATE_ID, variant },
    update: { variant },
  });
}
