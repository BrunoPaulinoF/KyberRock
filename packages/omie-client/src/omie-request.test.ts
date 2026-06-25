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
});

describe("OMIE_ENDPOINTS", () => {
  it("contains the sales order endpoint", () => {
    expect(OMIE_ENDPOINTS.salesOrders).toBe("/produtos/pedido/");
  });
});
