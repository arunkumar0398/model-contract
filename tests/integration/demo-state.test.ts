import { describe, expect, it } from "vitest";
import { semanticHash } from "@modelcontract/core";
import { demoVariants } from "../../fixtures/provider-demo/shared";
import { contractFromVariant } from "../helpers/contract-from-variant";
import { createFakeDb } from "../helpers/fake-prisma";
import { getDemoState, resolveProviderVariant, setDemoState } from "../../apps/web/lib/demo-state";

// The canonical URL is a filesystem-fixed route; the scraper always fetches
// this exact path while the rendered representation changes server-side.
const CANONICAL_URL = "/provider-demo/model-x";

describe("same-URL demo state", () => {
  it("keeps the canonical URL unchanged while variant state changes", async () => {
    const db = createFakeDb();
    await setDemoState(db, "BROKEN_SELECTOR");
    expect(CANONICAL_URL).toBe("/provider-demo/model-x");
    // Persisted state wins regardless of any query parameter — the URL does
    // not need to change to mutate the DOM under the scraper.
    expect(resolveProviderVariant(await getDemoState(db), "CHANGED_PRICE")).toBe("BROKEN_SELECTOR");
  });

  it("persists and reads back the demo variant", async () => {
    const db = createFakeDb();
    expect(await getDemoState(db)).toBeNull();
    await setDemoState(db, "BROKEN_SELECTOR");
    expect(await getDemoState(db)).toBe("BROKEN_SELECTOR");
    await setDemoState(db, "HEALTHY");
    expect(await getDemoState(db)).toBe("HEALTHY");
  });

  it("HEALTHY -> BROKEN_SELECTOR preserves semantic values under the same URL", async () => {
    const db = createFakeDb();
    await setDemoState(db, "BROKEN_SELECTOR");
    const variantId = resolveProviderVariant(await getDemoState(db), undefined);
    const healthy = contractFromVariant(demoVariants.HEALTHY);
    const broken = contractFromVariant(demoVariants[variantId]);
    expect(healthy).not.toBeNull();
    expect(broken).not.toBeNull();
    expect(healthy!.pricing).toEqual(broken!.pricing);
    expect(healthy!.status).toBe(broken!.status);
    expect(healthy!.contextWindow).toBe(broken!.contextWindow);
    expect(semanticHash(healthy!)).toBe(semanticHash(broken!));
  });

  it("HEALTHY -> CHANGED_PRICE changes the semantic value under the same URL", async () => {
    const db = createFakeDb();
    await setDemoState(db, "CHANGED_PRICE");
    const variantId = resolveProviderVariant(await getDemoState(db), undefined);
    const healthy = contractFromVariant(demoVariants.HEALTHY);
    const changed = contractFromVariant(demoVariants[variantId]);
    expect(healthy).not.toBeNull();
    expect(changed).not.toBeNull();
    expect(changed!.pricing?.inputPrice).toBe(6);
    expect(semanticHash(healthy!)).not.toBe(semanticHash(changed!));
  });

  it("falls back to HEALTHY when no state is persisted", async () => {
    const db = createFakeDb();
    expect(resolveProviderVariant(await getDemoState(db), undefined)).toBe("HEALTHY");
  });
});
