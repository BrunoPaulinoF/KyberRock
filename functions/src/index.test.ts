import { describe, expect, it } from "vitest";

import { getFunctionsFoundationCapabilities } from "./index";

describe("getFunctionsFoundationCapabilities", () => {
  it("includes server-side OMIE integration", () => {
    expect(getFunctionsFoundationCapabilities()).toContain("omie-server-side-integration");
  });
});
