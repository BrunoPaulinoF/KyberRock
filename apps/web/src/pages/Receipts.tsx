import "./receipts.css";

import { Printer, ReceiptText, Search } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { DeskPanel, PlateBadge } from "../components/desk";
import {
  Alert,
  EmptyState,
  PageHeader,
  Pill,
  SkeletonRows,
  Tabs,
  type PillTone
} from "../components/ui";
import { errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { operationStatusLabel } from "../lib/customer-report";
import { getFreightModalityInfo } from "../lib/desktop/freight";
import { formatDateTime, formatDocument, formatMoney, formatPlate } from "../lib/format";
import {
  copyLabel,
  findReceipts,
  invoiceStampLines,
  loadReceiptDetail,
  operationCodeLabel,
  parseReceiptQuery,
  permanenceLabel,
  receiptLines,
  receiptNumberLabel,
  receiptPrintHtml,
  type ReceiptDetail,
  type ReceiptMatch
} from "../lib/receipt-lookup";
import { printReportHtml } from "../lib/report-output";

function kg(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${value.toLocaleString("pt-BR")} kg`;
}

function statusTone(status: string): PillTone {
  if (status === "cancelled" || status === "sync_error") return "danger";
  if (status === "synced") return "success";
  if (["closed_local", "pending_cloud", "pending_omie"].includes(status)) return "info";
  return "warning";
}

/**
 * Tela "Cupons": digita o COD ou o numero da via que esta no papel e ve o cupom como saiu na
 * balanca, com os dados da pesagem organizados ao lado. Ver `lib/receipt-lookup.ts`.
 */
export function Receipts() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const initial = params.get("codigo") ?? "";
  const [text, setText] = useState(initial);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<ReceiptMatch[] | null>(null);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [copyIndex, setCopyIndex] = useState(0);

  const open = useCallback(
    async (operationId: string) => {
      setSearching(true);
      setError(null);
      try {
        const next = await loadReceiptDetail(user.companyId, operationId);
        setDetail(next);
        setCopyIndex(0);
      } catch (loadError) {
        setError(errorMessage(loadError, "Não foi possível abrir o cupom."));
      } finally {
        setSearching(false);
      }
    },
    [user.companyId]
  );

  const search = useCallback(
    async (value: string) => {
      const query = parseReceiptQuery(value);
      setDetail(null);
      setMatches(null);
      if (query.kind === "invalid") {
        setError(query.message);
        return;
      }
      setSearching(true);
      setError(null);
      try {
        const found = await findReceipts(user.companyId, query);
        setMatches(found);
        if (found.length === 1) await open(found[0].operation.id);
      } catch (searchError) {
        setError(errorMessage(searchError, "Não foi possível buscar o cupom."));
      } finally {
        setSearching(false);
      }
    },
    [user.companyId, open]
  );

  // Endereco com ?codigo= (link compartilhado) ja abre buscando.
  useEffect(() => {
    if (initial) void search(initial);
    // So na abertura da tela: depois quem busca e o formulario.
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    setParams(value ? { codigo: value } : {}, { replace: true });
    void search(value);
  }

  return (
    <DeskPanel>
      <PageHeader
        kicker="Operacional"
        title="Cupons"
        description={
          <>
            Digite o <strong>COD</strong> que aparece no topo do cupom (ex.: 3249) ou o número da
            via (ex.: 4038-4) para ver o cupom e as informações da pesagem.
          </>
        }
      />
      <div className="rc">
        <form className="rc-search" onSubmit={submit} role="search">
          <label className="rc-search-field">
            <Search size={16} aria-hidden="true" />
            <input
              className="input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="COD 003249 ou 000004038-4"
              aria-label="Código do cupom"
              inputMode="text"
              autoFocus
            />
          </label>
          <button type="submit" className="btn primary" disabled={searching}>
            {searching ? "Buscando..." : "Buscar cupom"}
          </button>
        </form>

        {error && <Alert kind="error">{error}</Alert>}

        {matches && matches.length === 0 && !error && (
          <EmptyState
            title="Nenhum cupom com esse código"
            hint="Confira o número no papel. O cupom aparece aqui depois que a balança envia a pesagem para a nuvem."
          />
        )}

        {matches && matches.length > 1 && (
          <section className="rc-matches" aria-label="Pesagens encontradas">
            <p className="rc-matches-title">
              {matches.length} pesagens com esse número. Escolha uma:
            </p>
            <div className="rc-match-list">
              {matches.map((match) => (
                <button
                  type="button"
                  key={match.operation.id}
                  className={`rc-match${detail?.operation.id === match.operation.id ? " active" : ""}`}
                  onClick={() => void open(match.operation.id)}
                >
                  <span className="rc-match-code">
                    {match.foundBy === "receipt" && match.receiptLabel
                      ? `Via ${match.receiptLabel}`
                      : operationCodeLabel(match.operation.operation_code)}
                  </span>
                  <strong>{match.operation.customer_name ?? "Sem cliente"}</strong>
                  <span>
                    {match.operation.product_description ?? "—"} ·{" "}
                    {formatPlate(match.operation.plate) || "sem placa"}
                  </span>
                  <span className="rc-match-date">
                    {formatDateTime(match.operation.closed_at ?? match.operation.created_at)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {detail ? (
          <ReceiptView detail={detail} copyIndex={copyIndex} onCopyChange={setCopyIndex} />
        ) : (
          searching && <SkeletonRows rows={6} columns={3} />
        )}

        {!matches && !detail && !error && !searching && (
          <EmptyState
            title="Busque um cupom"
            hint="O cupom aparece como saiu na impressora da balança, com a pesagem, os valores e o pedido do OMIE."
          />
        )}
      </div>
    </DeskPanel>
  );
}

function ReceiptView({
  detail,
  copyIndex,
  onCopyChange
}: {
  detail: ReceiptDetail;
  copyIndex: number;
  onCopyChange: (index: number) => void;
}) {
  const { operation, copies, customer } = detail;
  const copy = copies[copyIndex] ?? copies[0] ?? null;
  const lines = receiptLines(copy?.content_snapshot_json);
  // A NF-e sai depois da impressao: o numero entra no fim da via virtual, separado do papel.
  const stamp = invoiceStampLines(operation.omie_invoice_number, lines);
  const invoiceNumber = (operation.omie_invoice_number ?? "").trim();
  const cancelled = operation.status === "cancelled";
  const freight = getFreightModalityInfo(operation.freight_type);
  const code = operationCodeLabel(operation.operation_code);
  const city = [customer?.city, customer?.state].filter(Boolean).join("/");

  function print() {
    const title = `cupom ${code}${copy ? ` via ${receiptNumberLabel(copy.receipt_number, copy.device_number)}` : ""}`;
    void printReportHtml(receiptPrintHtml([...lines, ...stamp], title), title);
  }

  return (
    <div className="rc-grid">
      <section className="rc-paper-card" aria-label="Cupom impresso">
        <div className="rc-paper-head">
          {copies.length > 0 ? (
            <Tabs
              label="Vias impressas"
              variant="pill"
              active={String(copyIndex)}
              onChange={(id) => onCopyChange(Number(id))}
              tabs={copies.map((item, index) => ({
                id: String(index),
                label: copyLabel(item.copy_number)
              }))}
            />
          ) : (
            <span />
          )}
          <button type="button" className="btn" onClick={print} disabled={lines.length === 0}>
            <Printer size={15} />
            Imprimir
          </button>
        </div>
        {lines.length > 0 ? (
          <pre className={`rc-paper${cancelled ? " cancelled" : ""}`} translate="no">
            {lines.join("\n")}
            {stamp.length > 0 && (
              <span
                className="rc-paper-nf"
                title="A nota fiscal saiu depois da impressão: o número não está no papel."
              >
                {`\n${stamp.join("\n")}`}
              </span>
            )}
          </pre>
        ) : (
          <div className="rc-paper-empty">
            <EmptyState
              icon={ReceiptText}
              title={
                copies.length === 0
                  ? "Esta pesagem ainda não tem cupom impresso."
                  : "A balança não guardou a cópia desta via. As informações ao lado são da pesagem."
              }
            />
          </div>
        )}
      </section>

      <div className="rc-info">
        <div className="rc-summary">
          <div>
            <span className="rc-summary-code">
              {code}
              {invoiceNumber && ` · NF ${invoiceNumber}`}
            </span>
            <strong className="rc-summary-name">{operation.customer_name ?? "Sem cliente"}</strong>
          </div>
          <div className="rc-summary-side">
            <Pill tone={statusTone(operation.status)}>
              {operationStatusLabel(operation.status)}
            </Pill>
            <span className="rc-summary-total">{formatMoney(operation.total_cents)}</span>
          </div>
        </div>

        {cancelled && (
          <Alert kind="warn">
            Pesagem cancelada{operation.cancel_reason ? `: ${operation.cancel_reason}` : "."}
          </Alert>
        )}

        <InfoCard title="Cliente">
          <Item label="Nome" value={operation.customer_name} wide />
          <Item label="Documento" value={formatDocument(customer?.document)} />
          <Item label="Telefone" value={customer?.phone} />
          <Item label="Cidade" value={city} />
          <Item label="E-mail" value={customer?.email} />
        </InfoCard>

        <InfoCard title="Carga">
          <Item
            label="Produto"
            value={[detail.productCode, operation.product_description].filter(Boolean).join(" - ")}
            wide
          />
          <Item
            label="Placa"
            value={operation.plate ? <PlateBadge plate={formatPlate(operation.plate)} /> : null}
          />
          <Item label="Motorista" value={operation.driver_name} />
          <Item label="Transportadora" value={operation.carrier_name} />
          <Item label="Frete" value={freight.label} />
        </InfoCard>

        <InfoCard title="Pesagem">
          <Item label="Entrada" value={kg(operation.entry_weight_kg)} />
          <Item label="Saída" value={kg(operation.exit_weight_kg)} />
          <Item label="Peso líquido" value={kg(operation.net_weight_kg)} strong />
          <Item label="Chegou" value={formatDateTime(operation.created_at)} />
          <Item label="Saiu" value={formatDateTime(operation.closed_at)} />
          <Item
            label="Tempo na pedreira"
            value={permanenceLabel(operation.created_at, operation.closed_at)}
          />
          <Item label="Unidade" value={detail.unitName} />
        </InfoCard>

        <InfoCard title="Valores">
          <Item
            label="Preço por tonelada"
            value={
              operation.unit_price_cents === null ? null : formatMoney(operation.unit_price_cents)
            }
          />
          <Item label="Produto" value={formatMoney(operation.product_total_cents)} />
          <Item label="Frete" value={formatMoney(operation.freight_total_cents)} />
          <Item label="Total" value={formatMoney(operation.total_cents)} strong />
          <Item label="Forma de pagamento" value={detail.paymentMethodName} />
          <Item label="Condição" value={detail.paymentTermName} />
          <Item label="Tabela de preço" value={operation.applied_price_table_name} />
        </InfoCard>

        <InfoCard title="Nota e OMIE">
          <Item
            label="Pedido OMIE"
            value={operation.omie_sales_order_id ? String(operation.omie_sales_order_id) : null}
          />
          <Item label="Nota fiscal" value={operation.omie_invoice_number} />
          <Item label="Faturamento" value={operation.omie_billing_status} />
          <Item label="NF de entrega futura" value={operation.future_billing_nfe_number} />
          <Item label="Mensagem" value={operation.omie_billing_message} wide />
        </InfoCard>

        {copies.length > 0 && (
          <InfoCard title="Impressões">
            <div className="rc-prints">
              {copies.map((item) => (
                <div key={item.id} className="rc-print">
                  <span>{copyLabel(item.copy_number)}</span>
                  <span className="rc-mono">
                    {receiptNumberLabel(item.receipt_number, item.device_number)}
                  </span>
                  <span>{formatDateTime(item.printed_at ?? item.created_at)}</span>
                  <span className="rc-muted">
                    {item.status === "printed"
                      ? (item.printer_name ?? "Impresso")
                      : (item.error_message ?? item.status)}
                  </span>
                </div>
              ))}
            </div>
          </InfoCard>
        )}
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rc-card">
      <h2>{title}</h2>
      <dl className="rc-items">{children}</dl>
    </section>
  );
}

function Item({
  label,
  value,
  wide,
  strong
}: {
  label: string;
  value: ReactNode;
  wide?: boolean;
  strong?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={`rc-item${wide ? " wide" : ""}${strong ? " strong" : ""}`}>
      <dt>{label}</dt>
      <dd>{empty ? "—" : value}</dd>
    </div>
  );
}
