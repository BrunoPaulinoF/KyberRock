import "./customer-panels.css";

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useUser } from "../lib/auth";
import {
  creditLabel,
  customerAddress,
  customerCityLine,
  groupWeighingsByProduct,
  loadCustomerInfo,
  loadCustomerWeighings,
  sumWeighings,
  type CustomerRef,
  type WeighingTotals
} from "../lib/customer-weighings";
import {
  formatDate,
  formatDateTime,
  formatDocument,
  formatMoney,
  formatPlate,
  formatTons,
  periodToIso
} from "../lib/format";
import { canSee } from "../lib/permissions";
import { operationCodeLabel } from "../lib/receipt-lookup";
import { saleInstant } from "../lib/reports";
import { useAsync } from "../lib/use-async";
import { EmptyState, Pill, PlateBadge } from "./desk";
import { Alert, Modal } from "./ui";

function kg(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("pt-BR");
}

/** "27/09/2026 18:13" — a lista e longa, os segundos so ocupam espaco. */
function shortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function perTon(cents: number): string {
  return cents > 0 ? `${formatMoney(cents)}/t` : "—";
}

function TotalsStrip({ totals }: { totals: WeighingTotals }) {
  const items = [
    { label: "Pesagens", value: totals.operations.toLocaleString("pt-BR") },
    { label: "Toneladas", value: formatTons(totals.netWeightKg) },
    { label: "Preco medio", value: perTon(totals.avgPriceCentsPerTon) },
    { label: "Produto", value: formatMoney(totals.productTotalCents) },
    { label: "Frete", value: formatMoney(totals.freightTotalCents) },
    { label: "Total", value: formatMoney(totals.totalCents) }
  ];
  return (
    <div className="cp-totals">
      {items.map((item) => (
        <div key={item.label} className="cp-total">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * Todas as pesagens do cliente, separadas por produto, com o proprio filtro de periodo (comeca
 * no periodo do relatorio). Ver `lib/customer-weighings.ts`.
 */
export function CustomerWeighingsModal({
  customer,
  start: initialStart,
  end: initialEnd,
  unitId,
  onInfo,
  onClose
}: {
  customer: CustomerRef;
  start: string;
  end: string;
  /** `""` = todas as unidades (o filtro do relatorio). */
  unitId: string;
  onInfo: () => void;
  onClose: () => void;
}) {
  const user = useUser();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [openProducts, setOpenProducts] = useState<Set<string> | null>(null);
  const validRange = Boolean(start && end && start <= end);
  const period = useMemo(() => periodToIso(start, end), [start, end]);
  const ops = useAsync(
    () =>
      validRange
        ? loadCustomerWeighings(user.companyId, customer, period.startIso, period.endIso)
        : Promise.resolve([]),
    [user.companyId, customer.id, customer.name, period.startIso, period.endIso, validRange]
  );
  const rows = useMemo(
    () => (ops.data ?? []).filter((op) => !unitId || op.unit_id === unitId),
    [ops.data, unitId]
  );
  const groups = useMemo(() => groupWeighingsByProduct(rows), [rows]);
  const totals = useMemo(() => sumWeighings(rows), [rows]);
  const showReceipts = canSee(user.role, "cupons");

  // Todos os produtos comecam abertos; o clique no titulo fecha/abre.
  const isOpen = (key: string) => !openProducts || openProducts.has(key);
  function toggle(key: string) {
    const current = openProducts ?? new Set(groups.map((group) => group.key));
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpenProducts(next);
  }

  return (
    <Modal
      wide
      title={customer.name}
      description="Pesagens concluidas do cliente, separadas por produto (pela data de fechamento)."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onInfo}>
            Info do cliente
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="cp cp-weighings">
        <div className="cp-filters">
          <label className="op-filter">
            De
            <input
              className="input"
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="op-filter">
            Ate
            <input
              className="input"
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          {ops.loading && <span className="cp-muted">Carregando...</span>}
        </div>

        {!validRange && <Alert kind="error">A data inicial precisa ser anterior a final.</Alert>}
        {ops.error && <Alert kind="error">{ops.error}</Alert>}

        <TotalsStrip totals={totals} />

        {!ops.loading && groups.length === 0 && validRange && (
          <EmptyState title="Nenhuma pesagem deste cliente no periodo." />
        )}

        {groups.map((group) => (
          <section key={group.key} className="cp-product">
            <button
              type="button"
              className="cp-product-head"
              aria-expanded={isOpen(group.key)}
              onClick={() => toggle(group.key)}
            >
              <span className="cp-product-name">
                <span className="cp-caret" aria-hidden="true">
                  {isOpen(group.key) ? "▾" : "▸"}
                </span>
                {group.productDescription}
              </span>
              <span className="cp-product-sum">
                <span>{group.totals.operations} pesagens</span>
                <span>{formatTons(group.totals.netWeightKg)}</span>
                <span>{perTon(group.totals.avgPriceCentsPerTon)}</span>
                <strong>{formatMoney(group.totals.totalCents)}</strong>
              </span>
            </button>
            {isOpen(group.key) && (
              <div className="table-wrap cp-table">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>COD</th>
                      <th>Placa</th>
                      <th>Motorista</th>
                      <th className="num">Peso (kg)</th>
                      <th className="num">R$/t</th>
                      <th className="num">Produto</th>
                      <th className="num">Frete</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.weighings.map((op) => (
                      <tr key={op.id}>
                        <td>{shortDateTime(saleInstant(op))}</td>
                        <td className="cp-code">
                          {showReceipts && op.operation_code ? (
                            <Link to={`/cupons?codigo=${op.operation_code}`} title="Ver o cupom">
                              {operationCodeLabel(op.operation_code)}
                            </Link>
                          ) : (
                            operationCodeLabel(op.operation_code)
                          )}
                        </td>
                        <td>{op.plate ? <PlateBadge plate={formatPlate(op.plate)} /> : "—"}</td>
                        <td>{op.driver_name || "—"}</td>
                        <td className="num">{kg(op.net_weight_kg)}</td>
                        <td className="num">
                          {op.unit_price_cents ? formatMoney(op.unit_price_cents) : "—"}
                        </td>
                        <td className="num">{formatMoney(op.product_total_cents)}</td>
                        <td className="num">{formatMoney(op.freight_total_cents)}</td>
                        <td className="num">
                          <strong>{formatMoney(op.total_cents)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Cartao "Info" (o olho da tabela dinamica): o cadastro do cliente e o resumo do periodo do
 * relatorio — o preco medio que saiu da coluna mora aqui.
 */
export function CustomerInfoModal({
  customer,
  periodLabel,
  totals,
  lastSale,
  onWeighings,
  onClose
}: {
  customer: CustomerRef;
  periodLabel: string;
  totals: WeighingTotals;
  /** Instante da ultima pesagem do cliente no periodo. */
  lastSale: string | null;
  onWeighings: () => void;
  onClose: () => void;
}) {
  const user = useUser();
  const info = useAsync(
    () => loadCustomerInfo(user.companyId, customer.id),
    [user.companyId, customer.id]
  );
  const row = info.data?.customer ?? null;

  return (
    <Modal
      wide
      title={row?.trade_name || customer.name}
      description={row && row.legal_name !== row.trade_name ? row.legal_name : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onWeighings}>
            Ver pesagens
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Fechar
          </button>
        </>
      }
    >
      <div className="cp">
        <div className="cp-tags">
          {row ? (
            <>
              {row.omie_customer_id ? (
                <Pill tone="warning">OMIE {row.omie_customer_id}</Pill>
              ) : (
                <Pill tone="success">LOCAL</Pill>
              )}
              {!row.is_active && <Pill>INATIVO</Pill>}
              {row.omie_billing_blocked && <Pill tone="danger">FATURAMENTO BLOQUEADO</Pill>}
            </>
          ) : (
            !info.loading && <Pill>SEM CADASTRO</Pill>
          )}
        </div>

        {info.error && <Alert kind="error">{info.error}</Alert>}
        {info.loading && <p className="cp-muted">Carregando cadastro...</p>}
        {!info.loading && !row && !info.error && (
          <Alert kind="info">
            Esta venda foi feita sem cadastro de cliente (so o nome ficou na pesagem).
          </Alert>
        )}

        <section className="cp-card">
          <h3>Resumo · {periodLabel}</h3>
          <TotalsStrip totals={totals} />
          <p className="cp-muted">
            Ultima pesagem no periodo: {lastSale ? formatDateTime(lastSale) : "—"}
          </p>
        </section>

        {row && (
          <>
            <InfoSection title="Cadastro">
              <InfoItem label="Razao social" value={row.legal_name} wide />
              <InfoItem label="Nome fantasia" value={row.trade_name} wide />
              <InfoItem label="Documento" value={formatDocument(row.document)} />
              <InfoItem label="Tipo" value={row.is_individual ? "Pessoa fisica" : "Empresa"} />
              <InfoItem label="Inscricao estadual" value={row.state_registration} />
              <InfoItem label="Inscricao municipal" value={row.municipal_registration} />
              <InfoItem label="Cliente desde" value={formatDate(row.created_at)} />
            </InfoSection>

            <InfoSection title="Contato">
              <InfoItem label="Contato" value={row.contact_name} />
              <InfoItem label="Telefone" value={row.phone} />
              <InfoItem label="Telefone 2" value={row.phone_secondary} />
              <InfoItem label="E-mail" value={row.email} />
              <InfoItem label="Endereco" value={customerAddress(row)} wide />
              <InfoItem label="Cidade" value={customerCityLine(row)} wide />
            </InfoSection>

            <InfoSection title="Comercial">
              <InfoItem label="Forma de pagamento" value={info.data?.paymentMethodName} />
              <InfoItem label="Condicao" value={info.data?.paymentTermName} />
              <InfoItem label="Transportadora" value={info.data?.carrierName} />
              <InfoItem
                label="Exige nota"
                value={row.nf_required === null ? null : row.nf_required ? "Sim" : "Nao"}
              />
              <InfoItem label="Conta de credito" value={creditLabel(row)} />
              <InfoItem
                label="Limite de credito"
                value={row.credit_limit_cents ? formatMoney(row.credit_limit_cents) : null}
              />
              <InfoItem
                label="A receber em aberto"
                value={formatMoney(row.open_receivables_cents)}
              />
            </InfoSection>

            {row.observations && (
              <InfoSection title="Observacoes">
                <InfoItem label="" value={row.observations} wide />
              </InfoSection>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cp-card">
      <h3>{title}</h3>
      <dl className="cp-items">{children}</dl>
    </section>
  );
}

function InfoItem({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={`cp-item${wide ? " wide" : ""}`}>
      {label && <dt>{label}</dt>}
      <dd>{empty ? "—" : value}</dd>
    </div>
  );
}
