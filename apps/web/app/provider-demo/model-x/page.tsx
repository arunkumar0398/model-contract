import {
  demoVariants,
  resolveVariantId,
} from "../../../../../fixtures/provider-demo/shared";

export const metadata = {
  title: "Provider demo — model-x",
  description: "Controlled demo provider for ModelContract extraction tests",
};

/**
 * Stable controlled provider URL. The rendered HTML changes deterministically
 * based on the `variant` query parameter (default: HEALTHY). This is the page
 * Bright Data scrapes for the extraction-drift demo.
 */
export default async function ProviderDemoModelXPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = typeof params.variant === "string" ? params.variant : undefined;
  const variantId = resolveVariantId(raw);
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
