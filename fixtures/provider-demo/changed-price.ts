import type { DemoVariant } from "./shared";

export const changedPriceVariant: DemoVariant = {
  id: "CHANGED_PRICE",
  label: "Changed price ($4 → $6)",
  semantics: {
    modelId: "model-x",
    status: "Active",
    contextWindow: "128k",
    inputPrice: "$6 / 1M tokens",
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
    <div class="spec spec-input-price">
      <dt>Input price</dt>
      <dd id="input-price">$6 / 1M tokens</dd>
    </div>
    <div class="spec spec-output-price">
      <dt>Output price</dt>
      <dd id="output-price">$12 / 1M tokens</dd>
    </div>
  </dl>
</article>`,
};
