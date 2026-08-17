import type { DemoVariant } from "./shared";

export const deprecatedVariant: DemoVariant = {
  id: "DEPRECATED",
  label: "Deprecated (active → deprecated)",
  semantics: {
    modelId: "model-x",
    status: "Deprecated",
    contextWindow: "128k",
    inputPrice: "$4 / 1M tokens",
    outputPrice: "$12 / 1M tokens",
  },
  html: `
<article id="model-card" data-provider="demo-ai" data-model="model-x">
  <header class="model-header">
    <h1 class="model-name">model-x</h1>
    <span class="model-status" id="model-status">Deprecated</span>
  </header>
  <dl class="model-specs">
    <div class="spec spec-context">
      <dt>Context window</dt>
      <dd id="context-window">128k</dd>
    </div>
    <div class="spec spec-input-price">
      <dt>Input price</dt>
      <dd id="input-price">$4 / 1M tokens</dd>
    </div>
    <div class="spec spec-output-price">
      <dt>Output price</dt>
      <dd id="output-price">$12 / 1M tokens</dd>
    </div>
  </dl>
</article>`,
};
