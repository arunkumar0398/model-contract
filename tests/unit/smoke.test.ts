import { describe, expect, it } from "vitest";
import * as core from "@modelcontract/core";
import * as brightdata from "@modelcontract/brightdata";
import * as db from "@modelcontract/db";
import * as cli from "@modelcontract/cli";

describe("workspace boundary", () => {
  it("resolves all workspace packages from tests", () => {
    expect(core).toBeDefined();
    expect(brightdata).toBeDefined();
    expect(db).toBeDefined();
    expect(cli).toBeDefined();
  });
});
