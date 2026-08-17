import type { DemoVariant } from "./shared";

export const brokenSelectorVariant: DemoVariant = {
  id: "BROKEN_SELECTOR",
  label: "Broken selector (structural break)",
  semantics: {
    modelId: "model-x",
    status: "Active",
    contextWindow: "128k",
    inputPrice: "$4 / 1M tokens",
    outputPrice: "$12 / 1M tokens",
  },
  html: `
<section id="model-sheet" data-provider="demo-ai" data-model="model-x">
  <h2 class="sheet-title">model-x</h2>
  <table class="sheet-table">
    <tbody>
      <tr class="sheet-row sheet-status"><th scope="row">Status</th><td class="sheet-value">Active</td></tr>
      <tr class="sheet-row sheet-context"><th scope="row">Context window</th><td class="sheet-value">128k</td></tr>
      <tr class="sheet-row sheet-input-price"><th scope="row">Input price</th><td class="sheet-value">$4 / 1M tokens</td></tr>
      <tr class="sheet-row sheet-output-price"><th scope="row">Output price</th><td class="sheet-value">$12 / 1M tokens</td></tr>
    </tbody>
  </table>
</section>`,
};
