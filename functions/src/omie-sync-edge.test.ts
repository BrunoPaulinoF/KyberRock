import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sourcePath = resolve(process.cwd(), "supabase/functions/omie-sync/index.ts");
const corePath = resolve(process.cwd(), "supabase/functions/omie-sync/omie-sync-core.ts");

function getOmieSyncSource(): string {
  return `${readFileSync(sourcePath, "utf8")}\n${readFileSync(corePath, "utf8")}`;
}

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
    const source = getOmieSyncSource();

    expect(source).toContain("listProductsPage(credentials, productsPage)");
    expect(source).toContain("listOptionalPaymentTermsPage(credentials, paymentTermsPage)");
    expect(block).not.toContain("const productsResult = emptyPage<OmieProduct>(1)");
    expect(block).not.toContain("const paymentTermsResult = emptyPage<OmiePaymentTerm>(1)");
  });

  it("does not abort pull_reference_data when payment terms endpoint is unavailable", () => {
    const source = getOmieSyncSource();

    expect(source).toContain("function isPaymentTermsUnavailableError");
    expect(source).toContain("return emptyPage<OmiePaymentTerm>(page)");
  });

  it("classifies OMIE customers strictly by tag in the cloud path", () => {
    const source = getOmieSyncSource();

    expect(source).toContain('return hasOmieTag(customer.tagsJson, "cliente");');
    expect(source).not.toContain("getOmieTagValues(customer.tagsJson).length === 0");
  });

  it("uses a resilient queue manager with throttling and backoff for OMIE calls", () => {
    const source = getOmieSyncSource();

    expect(source).toContain("class OmieQueueManager");
    expect(source).toContain("isOmieLimitError");
    expect(source).toContain("error.status === 429");
    expect(source).toContain("await this.sleepFn(retryDelayMs)");
    expect(source).toContain("Math.pow(2, attempt)");
  });

  it("supports a paginated pull/push sync action", () => {
    const source = getOmieSyncSource();

    expect(source).toContain('if (action === "sync") {');
    expect(source).toContain("pullReferenceDataPage(credentials, resume)");
    expect(source).toContain("pushLocalQueuePage(credentials, body.payload as SyncPayload)");
    expect(source).toContain("takePushPage(payload.customers)");
    expect(source).toContain("takePushPage(payload.carriers)");
    expect(source).toContain("takePushPage(payload.orders).sort(comparePushOrdersChronologically)");
  });

  it("forces the transportadora tag when pushing carriers", () => {
    const source = getOmieSyncSource();

    expect(source).toContain("function pushCarrierToOmie");
    expect(source).toContain('forceOmieTag(payload.tags, "transportadora")');
    expect(source).toContain("buildCarrierPayload(payload)");
  });

  it("uses the account selected on desktop before falling back to the first tenant account", () => {
    const source = getOmieSyncSource();

    // Payload carrega o meio e a conta escolhidos na operacao do desktop.
    expect(source).toContain("paymentMethodOmieCode?: string;");
    expect(source).toContain("accountOmieCode?: string | number;");
    // A conta selecionada tem precedencia sobre resolveOmieAccountCode (fallback historico).
    expect(source).toContain("const selectedAccountCode = toNumber(payload.accountOmieCode ?? null);");
    expect(source).toContain("? selectedAccountCode");
    expect(source).toContain(": await resolveOmieAccountCode(credentials);");
  });

  it("ensures the operation's payment condition exists in the OMIE parcelas cadastro", () => {
    const source = getOmieSyncSource();

    // Sem codigo vinculado, a condicao e localizada/criada no cadastro (/geral/parcelas/).
    expect(source).toContain("async function ensureOmieParcelaCode");
    expect(source).toContain("installmentDays?: number[];");
    expect(source).toContain('"IncluirParcela"');
    expect(source).toContain("await ensureOmieParcelaCode(credentials, payload)");
    // A vista continua caindo no padrao "000" (comportamento historico).
    expect(source).toContain("normalizeParcelaCode(payload.paymentTermOmieCode) ??");
    expect(source).toContain('"000";');
  });
});
