import type { DemoVariant } from "./shared";

export const missingFieldVariant: DemoVariant = {
  id: "MISSING_FIELD",
  label: "Missing field (input price removed)",
  semantics: {
    modelId: "model-x",
    status: "Active",
    contextWindow: "128k",
    inputPrice: null,
    outputPrice: "$12 / 1M tokens",
  },
  html: `
<article id="model-card" data-provider="demo-ai" data-model="model-x">
  <header class="model-header">
    <h1 class="model-name">model-x</h1>
    <span class="model-status" id="model-status">Active</span>
  </header>
  <dl class="model-specs">
    <div class="spec spec-context">
      <dt>Context window</dt>
      <dd id="context-window">128k</dd>
    </div>
    <div class="spec spec-output-price">
      <dt>Output price</dt>
      <dd id="output-price">$12 / 1M tokens</dd>
    </div>
  </dl>
</article>`,
};
