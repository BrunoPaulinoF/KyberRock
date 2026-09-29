import "./customer-panels.css";

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { useUser } from "../lib/auth";
import {
  loadCreditBalance,
  loadOmieBalance,
  type OmieBalance,
  type OmieInvoiceBalance
} from "../lib/customer-balance";
import {
  creditLabel,
  customerAddress,
  customerCityLine,
  groupWeighingsByProduct,
  loadCustomerInfo,
  loadCustomerWeighings,
  sumWeighings,
  type CustomerRef,
  type CustomerRow,
  type SpecialPriceLine,
  type WeighingTotals
} from "../lib/customer-weighings";
import { invoiceNumberLabel } from "../lib/desktop/invoice-number-label";
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

/** "NF 4521", "Sem nota" (venda com nota ainda sem numero) ou "—" (venda interna). */
function InvoiceNumber({ number, internal }: { number: string | null; internal: boolean }) {
  const label = invoiceNumberLabel(number, internal ? "internal" : "invoice");
  return label.state === "number" ? (
    <strong>NF {label.text}</strong>
  ) : (
    <span className="cp-muted" title={label.title ?? undefined}>
      {label.text}
    </span>
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
                      <th>Nota fiscal</th>
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
                        <td>
                          <InvoiceNumber
                            number={op.omie_invoice_number}
                            internal={op.operation_type === "internal"}
                          />
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
 * Cartao "Info" do cliente: o cadastro, os precos especiais e o saldo (credito no KyberRock e o
 * que esta em aberto no OMIE). Abre pelo olho da tabela dinamica — ali com o resumo do periodo do
 * relatorio, onde mora o preco medio que saiu da coluna — e pelos dois cliques na lista de
 * clientes da tela Cadastros, sem resumo.
 */
export function CustomerInfoModal({
  customer,
  summary,
  onWeighings,
  actions,
  onClose
}: {
  customer: CustomerRef;
  /** O resumo do periodo do relatorio. Sem ele (aberto pelo cadastro) o cartao nao mostra. */
  summary?: {
    periodLabel: string;
    totals: WeighingTotals;
    /** Instante da ultima pesagem do cliente no periodo. */
    lastSale: string | null;
  };
  onWeighings?: () => void;
  /** Botoes a mais no rodape (a tela Cadastros poe o Editar e a ficha). */
  actions?: ReactNode;
  onClose: () => void;
}) {
  const user = useUser();
  const info = useAsync(
    () => loadCustomerInfo(user.companyId, customer.id),
    [user.companyId, customer.id]
  );
  const row = info.data?.customer ?? null;
  const specialPrices = info.data?.specialPrices ?? [];

  return (
    <Modal
      wide
      title={row?.trade_name || customer.name}
      description={row && row.legal_name !== row.trade_name ? row.legal_name : undefined}
      onClose={onClose}
      footer={
        <>
          {actions}
          {onWeighings && (
            <button type="button" className="btn" onClick={onWeighings}>
              Ver pesagens
            </button>
          )}
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

        {summary && (
          <section className="cp-card">
            <h3>Resumo · {summary.periodLabel}</h3>
            <TotalsStrip totals={summary.totals} />
            <p className="cp-muted">
              Ultima pesagem no periodo: {summary.lastSale ? formatDateTime(summary.lastSale) : "—"}
            </p>
          </section>
        )}

        {row && (
          <>
            <CustomerBalanceCard customer={row} />

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
            </InfoSection>

            <section className="cp-card">
              <h3>Precos especiais ({specialPrices.length})</h3>
              {specialPrices.length === 0 ? (
                <p className="cp-muted">
                  Sem preco especial: o cliente paga o preco padrao de cada produto.
                </p>
              ) : (
                <div className="table-wrap cp-table">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th className="num">Especial</th>
                        <th className="num">Padrao</th>
                        <th className="num">Diferenca</th>
                      </tr>
                    </thead>
                    <tbody>
                      {specialPrices.map((price) => (
                        <tr key={price.productId}>
                          <td>
                            <strong>{price.productDescription}</strong>
                            {price.productCode && (
                              <span className="cell-sub">Codigo {price.productCode}</span>
                            )}
                          </td>
                          <td className="num">
                            <strong>{perTon(price.specialCents)}</strong>
                          </td>
                          <td className="num">
                            {price.defaultCents === null ? "—" : perTon(price.defaultCents)}
                          </td>
                          <td className="num">{priceDifference(price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

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

/** "-7,00" (mais barato que o padrao) ou "+3,00"; "—" sem padrao para comparar. */
function priceDifference(price: SpecialPriceLine): string {
  if (price.defaultCents === null) return "—";
  const diff = price.specialCents - price.defaultCents;
  if (diff === 0) return "igual";
  return `${diff > 0 ? "+" : "-"}${formatMoney(Math.abs(diff))}`;
}

/**
 * O saldo do cliente: o credito no KyberRock (extrato fiado / pre-pago, que ja esta na nuvem) e
 * os titulos em aberto no OMIE, perguntados na hora (`lib/customer-balance.ts`).
 */
export function CustomerBalanceCard({ customer }: { customer: CustomerRow }) {
  const user = useUser();
  const credit = useAsync(
    () => loadCreditBalance(user.companyId, customer.id),
    [user.companyId, customer.id]
  );
  // Sem codigo no OMIE nao ha o que perguntar: nem gasta a chamada. O "Atualizar" pergunta de
  // novo mesmo com a resposta guardada (`loadOmieBalance`).
  const [forceOmie, setForceOmie] = useState(0);
  const omie = useAsync(
    () =>
      customer.omie_customer_id
        ? loadOmieBalance(customer.id, { force: forceOmie > 0 })
        : Promise.resolve<OmieBalance>({ status: "not_linked" }),
    [customer.id, customer.omie_customer_id, forceOmie]
  );
  const omieData = omie.data;
  const showCredit = customer.credit_account_enabled || (credit.data?.movements ?? 0) > 0;

  return (
    <section className="cp-card">
      <div className="cp-card-head">
        <h3>Saldo do cliente</h3>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            void credit.reload();
            setForceOmie((count) => count + 1);
          }}
          disabled={omie.loading || credit.loading}
        >
          {omie.loading ? "Consultando OMIE..." : "Atualizar"}
        </button>
      </div>
      <dl className="cp-items">
        {omie.loading && !omieData ? (
          <InfoItem label="Em aberto no OMIE" value="Consultando..." />
        ) : omieData?.status === "ok" ? (
          <>
            <InfoItem
              label="Em aberto no OMIE"
              value={
                <>
                  {formatMoney(omieData.openCents)}
                  <span className="cell-sub">
                    {omieData.openTitles === 1 ? "1 titulo" : `${omieData.openTitles} titulos`}
                  </span>
                </>
              }
            />
            <InfoItem
              label="Vencido"
              value={
                omieData.overdueCents > 0 ? (
                  <span className="cp-danger">
                    {formatMoney(omieData.overdueCents)}
                    <span className="cell-sub">
                      {omieData.overdueTitles === 1
                        ? "1 titulo"
                        : `${omieData.overdueTitles} titulos`}
                    </span>
                  </span>
                ) : (
                  "Nada vencido"
                )
              }
            />
            <InfoItem
              label="Proximo vencimento"
              value={omieData.nextDueDate ? formatDate(omieData.nextDueDate) : null}
            />
          </>
        ) : omieData?.status === "not_linked" ? (
          <InfoItem
            label="Em aberto no OMIE"
            value="Cliente ainda sem codigo no OMIE"
            wide={!showCredit}
          />
        ) : (
          <InfoItem
            label="Em aberto no OMIE"
            value={omieData?.status === "unavailable" ? omieData.message : null}
            wide
          />
        )}
        {showCredit && (
          <InfoItem
            label="Credito no KyberRock"
            value={
              credit.error ? (
                credit.error
              ) : credit.data ? (
                <span className={credit.data.balanceCents < 0 ? "cp-danger" : undefined}>
                  {formatMoney(credit.data.balanceCents)}
                  <span className="cell-sub">
                    {credit.data.balanceCents < 0 ? "utilizado do limite" : "disponivel"}
                  </span>
                </span>
              ) : (
                "Carregando..."
              )
            }
          />
        )}
      </dl>
      {omieData?.status === "ok" && omieData.byInvoice.length > 0 && (
        <InvoiceBalances groups={omieData.byInvoice} />
      )}
      {omieData?.status === "ok" && (
        <p className="cp-muted">
          Consultado no OMIE em {formatDateTime(omieData.checkedAt)}.
          {omieData.truncated &&
            " O cliente tem mais de cinco mil titulos em aberto: o total e parcial."}
        </p>
      )}
    </section>
  );
}

/**
 * O saldo em aberto separado por nota fiscal — o comercial precisa saber QUAL nota o cliente
 * ainda deve, nao so o total. Titulo sem nota (lancamento avulso, adiantamento) fica na ultima
 * linha.
 */
function InvoiceBalances({ groups }: { groups: OmieInvoiceBalance[] }) {
  return (
    <div className="table-wrap cp-table">
      <table className="data">
        <thead>
          <tr>
            <th>Nota fiscal</th>
            <th>Emissao</th>
            <th className="num">Titulos</th>
            <th className="num">Vencido</th>
            <th className="num">Em aberto</th>
            <th>Proximo vencimento</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.invoiceNumber ?? "sem-nota"}>
              <td>
                {group.invoiceNumber ? (
                  <strong>NF {group.invoiceNumber}</strong>
                ) : (
                  <span className="cp-muted">Sem nota fiscal</span>
                )}
              </td>
              <td>{group.issueDate ? formatDate(group.issueDate) : "—"}</td>
              <td className="num">{group.openTitles.toLocaleString("pt-BR")}</td>
              <td className="num">
                {group.overdueCents > 0 ? (
                  <span className="cp-danger">{formatMoney(group.overdueCents)}</span>
                ) : (
                  "—"
                )}
              </td>
              <td className="num">
                <strong>{formatMoney(group.openCents)}</strong>
              </td>
              <td>{group.nextDueDate ? formatDate(group.nextDueDate) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
