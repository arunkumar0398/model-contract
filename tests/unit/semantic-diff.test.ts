import { describe, expect, it } from "vitest";
import { semanticDiff } from "../../packages/core/src/semantic-diff";
import type { SemanticFields } from "../../packages/core/src/semantic-hash";

function fields(overrides: Partial<SemanticFields> = {}): SemanticFields {
  return {
    provider: "demo-ai",
    modelId: "model-x",
    status: "active",
    contextWindow: 128000,
    inputPrice: 4,
    outputPrice: 12,
    ...overrides,
  };
}

describe("semanticDiff", () => {
  it("returns empty array when identical", () => {
    expect(semanticDiff(fields(), fields())).toEqual([]);
  });

  it("inputPrice $4 -> $6 uses dotted path pricing.inputPrice", () => {
    expect(semanticDiff(fields(), fields({ inputPrice: 6 }))).toEqual([
      { field: "pricing.inputPrice", previous: 4, current: 6 },
    ]);
  });

  it("status active -> deprecated", () => {
    expect(semanticDiff(fields(), fields({ status: "deprecated" }))).toEqual([
      { field: "status", previous: "active", current: "deprecated" },
    ]);
  });

  it("multiple diffs in canonical order", () => {
    const d = semanticDiff(fields(), fields({ inputPrice: 6, status: "deprecated" }));
    expect(d.map((x) => x.field)).toEqual(["status", "pricing.inputPrice"]);
  });

  it("undefined -> value transition", () => {
    expect(
      semanticDiff(fields({ deprecationDate: undefined }), fields({ deprecationDate: "2027-03-01" })),
    ).toEqual([{ field: "deprecationDate", previous: null, current: "2027-03-01" }]);
  });

  it("value -> undefined transition", () => {
    expect(
      semanticDiff(fields({ contextWindow: 128000 }), fields({ contextWindow: undefined })),
    ).toEqual([{ field: "contextWindow", previous: 128000, current: null }]);
  });

  it("canonical order preserved", () => {
    const d = semanticDiff(
      fields(),
      fields({ status: "deprecated", inputPrice: 6, contextWindow: 256000 }),
    );
    expect(d.map((x) => x.field)).toEqual(["status", "contextWindow", "pricing.inputPrice"]);
  });

  it("deterministic", () => {
    const a = semanticDiff(fields(), fields({ inputPrice: 6 }));
    expect(a).toEqual(semanticDiff(fields(), fields({ inputPrice: 6 })));
  });
});
