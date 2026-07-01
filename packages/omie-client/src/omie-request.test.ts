import { describe, expect, it } from "vitest";

import {
  OMIE_ENDPOINTS,
  buildOmieIntegrationCode,
  createOmieRequestBody
} from "./omie-request";

describe("createOmieRequestBody", () => {
  it("wraps the OMIE call and param without credentials", () => {
    expect(createOmieRequestBody("ListarClientes", { pagina: 1 })).toEqual({
      call: "ListarClientes",
      param: [{ pagina: 1 }]
    });
  });
});

describe("buildOmieIntegrationCode", () => {
  it("builds a stable code for OMIE idempotency", () => {
    expect(buildOmieIntegrationCode("unit-1", "op-1", "create_sales_order")).toBe(
      "kyberrock:unit-1:op-1:create_sales_order"
    );
  });

  it("never exceeds 60 characters", () => {
    const longUnitId = "unit-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const longEntityId = "op-11111111-2222-3333-4444-555555555555";
    const longAction = "create_service_order_with_long_suffix";
    const code = buildOmieIntegrationCode(longUnitId, longEntityId, longAction);
    expect(code.length).toBeLessThanOrEqual(60);
  });

  it("is deterministic for long inputs", () => {
    const longUnitId = "unit-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const longEntityId = "op-11111111-2222-3333-4444-555555555555";
    const longAction = "create_service_order_with_long_suffix";
    const a = buildOmieIntegrationCode(longUnitId, longEntityId, longAction);
    const b = buildOmieIntegrationCode(longUnitId, longEntityId, longAction);
    expect(a).toBe(b);
  });
});

describe("OMIE_ENDPOINTS", () => {
  it("contains the sales order endpoint", () => {
    expect(OMIE_ENDPOINTS.salesOrders).toBe("/produtos/pedido/");
  });
});
