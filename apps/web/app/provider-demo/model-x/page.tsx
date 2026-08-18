import { createPrismaClient } from "@modelcontract/db";
import { demoVariants } from "../../../../../fixtures/provider-demo/shared";
import { getDemoState, resolveProviderVariant } from "../../../lib/demo-state";

export const metadata = {
  title: "Provider demo — model-x",
  description: "Controlled demo provider for ModelContract extraction tests",
};

export const dynamic = "force-dynamic";

/**
 * Stable controlled provider URL. The rendered HTML changes via persisted
 * DemoState (POST /api/demo/variant), so the SAME URL mutates underneath the
 * scraper. Without a database (or before any state is set) it falls back to
 * the ?variant= query parameter / HEALTHY for development.
 */
export default async function ProviderDemoModelXPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const params = await searchParams;
  const queryVariant = typeof params.variant === "string" ? params.variant : undefined;

  const db = createPrismaClient();
  let state = null as Awaited<ReturnType<typeof getDemoState>>;
  if (db) {
    try {
      state = await getDemoState(db);
    } catch (err) {
      console.error("demo state read failed; falling back to query/default", err);
    }
  }

  const variantId = resolveProviderVariant(state, queryVariant);
  const variant = demoVariants[variantId];

  return (
    <main
      data-provider-demo
      data-variant={variant.id}
      style={{ padding: "2rem", maxWidth: "60rem", margin: "0 auto" }}
    >
      <h1>Provider demo — model-x</h1>
      <p>
        Variant: <strong data-variant-name>{variant.id}</strong>{" "}
        <span data-variant-label>({variant.label})</span>
      </p>
      <div data-variant-markup dangerouslySetInnerHTML={{ __html: variant.html }} />
    </main>
  );
}
