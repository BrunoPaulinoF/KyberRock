import { describe, expect, it } from "vitest";

import { buildExternalId } from "./ids";

describe("buildExternalId", () => {
  it("builds a stable KyberRock external id", () => {
    expect(buildExternalId(["unit-1", "operation-1", "create_sales_order"])).toBe(
      "kyberrock:unit-1:operation-1:create_sales_order"
    );
  });

  it("rejects empty parts", () => {
    expect(() => buildExternalId(["unit-1", " "])).toThrow("cannot be empty");
  });
});
