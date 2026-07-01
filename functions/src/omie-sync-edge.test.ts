import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourcePath = resolve(process.cwd(), "supabase/functions/omie-sync/index.ts");

function getPullReferenceDataBlock(): string {
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf('if (action === "pull_reference_data") {');
  const end = source.indexOf('if (action === "create_order") {', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe("omie-sync Edge Function", () => {
  it("pull_reference_data fetches products and payment terms from OMIE", () => {
    const block = getPullReferenceDataBlock();

    expect(block).toContain("listProductsPage(credentials, productsPage)");
    expect(block).toContain("listOptionalPaymentTermsPage(credentials, paymentTermsPage)");
    expect(block).not.toContain("const productsResult = emptyPage<OmieProduct>(1)");
    expect(block).not.toContain("const paymentTermsResult = emptyPage<OmiePaymentTerm>(1)");
  });

  it("does not abort pull_reference_data when payment terms endpoint is unavailable", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("function isPaymentTermsUnavailableError");
    expect(source).toContain("return emptyPage<OmiePaymentTerm>(page)");
  });

  it("classifies OMIE customers strictly by tag in the cloud path", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('return hasOmieTag(customer.tagsJson, "cliente");');
    expect(source).not.toContain('getOmieTagValues(customer.tagsJson).length === 0');
  });
});
