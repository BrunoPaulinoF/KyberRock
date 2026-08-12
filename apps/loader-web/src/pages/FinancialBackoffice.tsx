import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import {
  centsToInput,
  daysOverdue,
  describeNextClosing,
  downloadBase64Pdf,
  filterInvoices,
  formatCents,
  formatDateBr,
  formatDateTimeBr,
  invoiceStatusLabel,
  invoiceStatusTone,
  parseMoneyToCents,
  summarizeInvoiceList
} from "../lib/billing";
import type {
  BillingCompany,
  BillingInvoice,
  BillingSettingsView,
  BillingSummary
} from "../lib/billing";

/**
 * Backoffice financeiro — a aba "Financeiro" do painel administrativo.
 *
 * E a cobranca DA PLATAFORMA: a Kybernan fatura cada pedreira pelo valor
 * acertado no cadastro dela. Nada aqui tem relacao com o financeiro das
 * operacoes da balanca (esse vive no OMIE e no relatorio de vendas), e por isso
 * a tela e separada dos cadastros.
 *
 * Toda regra (fechamento, rateio da primeira fatura, vencimento, boleto do
 * Mercado Pago, envio por WhatsApp, bloqueio por inadimplencia) roda na Edge
 * Function `admin-billing`, que compartilha o motor com a passada automatica do
 * `billing-run`. Esta tela dispara acoes e mostra resultado — nunca recalcula
 * data ou valor por conta propria.
 */

type FinancialTab = "invoices" | "companies" | "settings";

/** Mascara devolvida pelo backend; reenviada para dizer "mantenha o segredo gravado". */
const SECRET_UNCHANGED = "********";

const CARD: React.CSSProperties = {
  background: "#fff",
  padding: "24px",
  borderRadius: "16px",
  border: "1px solid #e2e8f0"
};

const INPUT: React.CSSProperties = {
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #cbd5e1",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "14px"
};

const PRIMARY_BUTTON: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "8px",
  border: "none",
  background: "#0f172a",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "14px"
};

const SMALL_BUTTON: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  background: "#fff",
  cursor: "pointer",
  fontSize: "12px",
  whiteSpace: "nowrap"
};

const DANGER_BUTTON: React.CSSProperties = {
  ...SMALL_BUTTON,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#dc2626"
};

const MODAL_Z_INDEX = 1300;

interface FinancialData {
  today: string;
  settings: BillingSettingsView;
  companies: BillingCompany[];
  invoices: BillingInvoice[];
  summary: BillingSummary;
}

export function FinancialBackoffice({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [activeTab, setActiveTab] = useState<FinancialTab>("invoices");
  const [data, setData] = useState<FinancialData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  const [editingCompany, setEditingCompany] = useState<BillingCompany | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<BillingInvoice | null>(null);

  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof AdminSessionExpiredError) {
        onSessionExpired();
        return;
      }
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : fallback });
    },
    [onSessionExpired]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await callAdminFunction<FinancialData>("admin-billing", { action: "list" });
      setData(response);
    } catch (error) {
      handleError(error, "Nao foi possivel carregar o financeiro.");
    } finally {
      setIsLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Toda acao passa por aqui: trava o botao, mostra o resultado e recarrega. Sem
   * o recarregamento a tela mentiria — boleto emitido continuaria "sem boleto"
   * ate alguem apertar F5.
   */
  const runAction = useCallback(
    async (
      key: string,
      action: string,
      payload: Record<string, unknown>,
      successMessage: string
    ): Promise<boolean> => {
      setBusyAction(key);
      setFeedback(null);
      try {
        const response = await callAdminFunction<{ warning?: string | null; warnings?: string[] }>(
          "admin-billing",
          { action, payload }
        );
        const warnings = [response.warning, ...(response.warnings ?? [])].filter(
          (value): value is string => Boolean(value)
        );
        setFeedback({
          tone: warnings.length > 0 ? "error" : "ok",
          text: warnings.length > 0 ? `${successMessage} ${warnings.join(" ")}` : successMessage
        });
        await load();
        return true;
      } catch (error) {
        handleError(error, "A acao falhou.");
        return false;
      } finally {
        setBusyAction(null);
      }
    },
    [handleError, load]
  );

  const companiesById = useMemo(
    () => new Map((data?.companies ?? []).map((company) => [company.id, company.name])),
    [data]
  );

  const visibleInvoices = useMemo(
    () =>
      filterInvoices(data?.invoices ?? [], companiesById, {
        companyId: filterCompanyId,
        status: filterStatus,
        search
      }),
    [data, companiesById, filterCompanyId, filterStatus, search]
  );

  const listTotals = useMemo(() => summarizeInvoiceList(visibleInvoices), [visibleInvoices]);

  async function handleDownloadPdf(invoice: BillingInvoice): Promise<void> {
    setBusyAction(`pdf:${invoice.id}`);
    try {
      const response = await callAdminFunction<{ fileName: string; base64: string }>(
        "admin-billing",
        { action: "invoice_pdf", payload: { invoiceId: invoice.id } }
      );
      downloadBase64Pdf(response.base64, response.fileName);
    } catch (error) {
      handleError(error, "Nao foi possivel gerar o PDF da fatura.");
    } finally {
      setBusyAction(null);
    }
  }

  if (isLoading && !data) {
    return <p style={{ color: "#64748b" }}>Carregando o financeiro...</p>;
  }
  if (!data) {
    return (
      <div style={CARD}>
        <p style={{ margin: 0, color: "#b91c1c" }}>
          Nao foi possivel carregar o financeiro. Verifique se a Edge Function{" "}
          <code>admin-billing</code> esta implantada e se a migracao do backoffice financeiro foi
          aplicada.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          style={{ ...PRIMARY_BUTTON, marginTop: "16px" }}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          flexWrap: "wrap"
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Financeiro</h2>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#64748b" }}>
            Mensalidade da plataforma por pedreira: fechamento, fatura, boleto do Mercado Pago,
            envio por WhatsApp e bloqueio por inadimplencia.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            void runAction(
              "run-cycle",
              "run_cycle",
              {},
              "Passada de cobranca executada. Confira as faturas abaixo."
            )
          }
          disabled={busyAction === "run-cycle"}
          style={{ ...PRIMARY_BUTTON, opacity: busyAction === "run-cycle" ? 0.6 : 1 }}
        >
          {busyAction === "run-cycle" ? "Processando..." : "Rodar cobranca agora"}
        </button>
      </header>

      {feedback && (
        <div
          role="status"
          style={{
            padding: "12px 16px",
            borderRadius: "12px",
            fontSize: "14px",
            background: feedback.tone === "ok" ? "#dcfce7" : "#fef2f2",
            color: feedback.tone === "ok" ? "#166534" : "#b91c1c",
            border: `1px solid ${feedback.tone === "ok" ? "#86efac" : "#fecaca"}`
          }}
        >
          {feedback.text}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
          gap: "12px"
        }}
      >
        <StatCard
          label="Mensalidade recorrente"
          value={formatCents(data.summary.monthlyRecurringCents)}
          hint={`${data.summary.billedCompanies} pedreira(s) com cobranca ativa`}
        />
        <StatCard
          label="Em aberto"
          value={formatCents(data.summary.openAmountCents)}
          hint={`${data.summary.openCount} fatura(s)`}
        />
        <StatCard
          label="Vencidas"
          value={formatCents(data.summary.overdueAmountCents)}
          hint={`${data.summary.overdueCount} fatura(s)`}
          tone="danger"
        />
        <StatCard
          label="Recebido"
          value={formatCents(data.summary.paidAmountCents)}
          hint={`${data.summary.paidCount} fatura(s) paga(s)`}
          tone="success"
        />
        <StatCard
          label="Bloqueadas"
          value={String(data.summary.blockedCompanies)}
          hint="Pedreiras sem acesso a balanca"
          tone={data.summary.blockedCompanies > 0 ? "danger" : "neutral"}
        />
      </div>

      <nav style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {(
          [
            ["invoices", "Faturas"],
            ["companies", "Cobranca por pedreira"],
            ["settings", "Configuracoes"]
          ] as Array<[FinancialTab, string]>
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              borderRadius: "999px",
              border: "1px solid #cbd5e1",
              background: activeTab === tab ? "#0f172a" : "#fff",
              color: activeTab === tab ? "#fff" : "#334155",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 700
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "invoices" && (
        <article style={CARD}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
              gap: "12px",
              marginBottom: "16px"
            }}
          >
            <select
              value={filterCompanyId}
              onChange={(event) => setFilterCompanyId(event.target.value)}
              style={INPUT}
            >
              <option value="">Todas as pedreiras</option>
              {data.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
              style={INPUT}
            >
              <option value="">Todas as situacoes</option>
              <option value="open">Em aberto</option>
              <option value="overdue">Vencidas</option>
              <option value="paid">Pagas</option>
              <option value="canceled">Canceladas</option>
            </select>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por numero, referencia ou pedreira"
              style={INPUT}
            />
          </div>

          {visibleInvoices.length === 0 ? (
            <p style={{ color: "#64748b", margin: 0 }}>
              Nenhuma fatura encontrada. Faturas sao geradas no fechamento de cada ciclo — use
              &quot;Gerar fatura&quot; na aba de cobranca por pedreira para antecipar.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {visibleInvoices.map((invoice) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  companyName={companiesById.get(invoice.company_id) ?? "Pedreira removida"}
                  today={data.today}
                  busyAction={busyAction}
                  onIssueBoleto={(reissue) =>
                    void runAction(
                      `boleto:${invoice.id}`,
                      "issue_boleto",
                      { invoiceId: invoice.id, reissue },
                      reissue ? "Boleto reemitido." : "Boleto emitido."
                    )
                  }
                  onSend={() =>
                    void runAction(
                      `send:${invoice.id}`,
                      "send_invoice",
                      { invoiceId: invoice.id },
                      "Fatura enviada pelo WhatsApp."
                    )
                  }
                  onRefresh={() =>
                    void runAction(
                      `refresh:${invoice.id}`,
                      "refresh_invoice",
                      { invoiceId: invoice.id },
                      "Situacao do boleto atualizada."
                    )
                  }
                  onMarkPaid={() => {
                    if (!confirm(`Confirmar o recebimento da fatura ${invoice.number}?`)) return;
                    void runAction(
                      `paid:${invoice.id}`,
                      "mark_invoice_paid",
                      { invoiceId: invoice.id },
                      "Fatura quitada. O acesso e liberado se nao houver outra pendencia."
                    );
                  }}
                  onCancel={() => {
                    const reason = prompt("Motivo do cancelamento:") ?? "";
                    if (!reason.trim()) return;
                    void runAction(
                      `cancel:${invoice.id}`,
                      "cancel_invoice",
                      { invoiceId: invoice.id, reason },
                      "Fatura cancelada."
                    );
                  }}
                  onDelete={() => {
                    if (
                      !confirm(
                        `Excluir definitivamente a fatura ${invoice.number}? Isso nao pode ser desfeito.`
                      )
                    ) {
                      return;
                    }
                    void runAction(
                      `delete:${invoice.id}`,
                      "delete_invoice",
                      { invoiceId: invoice.id },
                      "Fatura excluida."
                    );
                  }}
                  onEdit={() => setEditingInvoice(invoice)}
                  onDownloadPdf={() => void handleDownloadPdf(invoice)}
                />
              ))}
            </div>
          )}

          {visibleInvoices.length > 0 && (
            <footer
              style={{
                marginTop: "16px",
                paddingTop: "12px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                gap: "20px",
                flexWrap: "wrap",
                fontSize: "13px",
                color: "#475569"
              }}
            >
              <span>{listTotals.count} fatura(s) na tela</span>
              <span>Em aberto: {formatCents(listTotals.openCents)}</span>
              <span>Vencidas: {formatCents(listTotals.overdueCents)}</span>
              <span>Recebido: {formatCents(listTotals.paidCents)}</span>
            </footer>
          )}
        </article>
      )}

      {activeTab === "companies" && (
        <article style={CARD}>
          <h3 style={{ margin: "0 0 4px 0" }}>Cobranca por pedreira</h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#64748b" }}>
            Cada pedreira tem o seu valor acertado, a data de virada do sistema e o proprio
            calendario de fechamento e vencimento.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {data.companies.map((company) => (
              <CompanyBillingRow
                key={company.id}
                company={company}
                busyAction={busyAction}
                onEdit={() => setEditingCompany(company)}
                onGenerate={(force) =>
                  void runAction(
                    `generate:${company.id}`,
                    "generate_invoice",
                    { companyId: company.id, force },
                    "Fatura gerada, boleto emitido e envio disparado."
                  )
                }
                onToggleBlock={() => {
                  const blocked = company.payment_blocked !== true;
                  const reason = blocked
                    ? (prompt("Motivo do bloqueio:", "Bloqueio manual do financeiro.") ?? "")
                    : "";
                  if (blocked && !reason.trim()) return;
                  void runAction(
                    `block:${company.id}`,
                    "set_payment_block",
                    { companyId: company.id, blocked, reason },
                    blocked ? "Pedreira bloqueada." : "Acesso liberado."
                  );
                }}
              />
            ))}
          </div>
        </article>
      )}

      {activeTab === "settings" && (
        <BillingSettingsForm
          settings={data.settings}
          busy={busyAction === "settings"}
          onSave={(payload) =>
            void runAction("settings", "update_settings", payload, "Configuracao salva.")
          }
        />
      )}

      {editingCompany && (
        <CompanyBillingModal
          company={editingCompany}
          settings={data.settings}
          busy={busyAction === `company:${editingCompany.id}`}
          onClose={() => setEditingCompany(null)}
          onSave={async (payload) => {
            const ok = await runAction(
              `company:${editingCompany.id}`,
              "update_company_billing",
              { companyId: editingCompany.id, ...payload },
              "Cadastro de cobranca salvo."
            );
            if (ok) setEditingCompany(null);
          }}
        />
      )}

      {editingInvoice && (
        <InvoiceEditModal
          invoice={editingInvoice}
          busy={busyAction === `edit:${editingInvoice.id}`}
          onClose={() => setEditingInvoice(null)}
          onSave={async (payload) => {
            const ok = await runAction(
              `edit:${editingInvoice.id}`,
              "update_invoice",
              { invoiceId: editingInvoice.id, ...payload },
              "Fatura ajustada."
            );
            if (ok) setEditingInvoice(null);
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Blocos da tela
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  hint,
  tone = "neutral"
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "success" | "danger";
}) {
  const color = tone === "danger" ? "#b91c1c" : tone === "success" ? "#166534" : "#0f172a";
  return (
    <div style={{ ...CARD, padding: "16px" }}>
      <p style={{ margin: 0, fontSize: "12px", color: "#64748b", textTransform: "uppercase" }}>
        {label}
      </p>
      <p style={{ margin: "6px 0 2px 0", fontSize: "22px", fontWeight: 700, color }}>{value}</p>
      <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>{hint}</p>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: { background: string; color: string } }) {
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 700,
        background: tone.background,
        color: tone.color
      }}
    >
      {label}
    </span>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" }}>
      <span style={{ fontWeight: 700, color: "#334155" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: "12px", color: "#64748b" }}>{hint}</span>}
    </label>
  );
}

function Modal({
  title,
  subtitle,
  children,
  onClose
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px",
        overflowY: "auto",
        zIndex: MODAL_Z_INDEX
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: "24px",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "720px"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px"
          }}
        >
          <div>
            <h3 style={{ margin: 0 }}>{title}</h3>
            {subtitle && (
              <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#64748b" }}>{subtitle}</p>
            )}
          </div>
          <button type="button" onClick={onClose} style={SMALL_BUTTON}>
            Fechar
          </button>
        </div>
        <div style={{ marginTop: "20px" }}>{children}</div>
      </div>
    </div>
  );
}

function InvoiceRow({
  invoice,
  companyName,
  today,
  busyAction,
  onIssueBoleto,
  onSend,
  onRefresh,
  onMarkPaid,
  onCancel,
  onDelete,
  onEdit,
  onDownloadPdf
}: {
  invoice: BillingInvoice;
  companyName: string;
  today: string;
  busyAction: string | null;
  onIssueBoleto: (reissue: boolean) => void;
  onSend: () => void;
  onRefresh: () => void;
  onMarkPaid: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onDownloadPdf: () => void;
}) {
  const isBusy = busyAction?.endsWith(invoice.id) ?? false;
  const isClosed = invoice.status === "paid" || invoice.status === "canceled";

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "12px",
        padding: "16px",
        background: invoice.status === "overdue" ? "#fffbfb" : "#fff",
        opacity: isBusy ? 0.6 : 1
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "flex-start"
        }}
      >
        <div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "15px" }}>{companyName}</strong>
            <Badge
              label={invoiceStatusLabel(invoice.status)}
              tone={invoiceStatusTone(invoice.status)}
            />
            {invoice.is_prorated && (
              <Badge label="Proporcional" tone={{ background: "#fef3c7", color: "#92400e" }} />
            )}
            {invoice.blocked_at && (
              <Badge label="Gerou bloqueio" tone={{ background: "#fee2e2", color: "#991b1b" }} />
            )}
          </div>
          <p style={{ margin: "6px 0 0 0", fontSize: "13px", color: "#475569" }}>
            {invoice.number} • Referencia {invoice.reference_label} • Periodo{" "}
            {formatDateBr(invoice.period_start)} a {formatDateBr(invoice.period_end)}
          </p>
          <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#475569" }}>
            Vencimento {formatDateBr(invoice.due_date)}
            {invoice.status === "overdue" && (
              <strong style={{ color: "#b91c1c" }}>
                {" "}
                — {Math.max(0, daysOverdue(invoice.due_date, today))} dia(s) de atraso
              </strong>
            )}
          </p>
          {invoice.is_prorated && invoice.prorated_days && invoice.full_period_days && (
            <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#64748b" }}>
              Primeira fatura: {invoice.prorated_days} de {invoice.full_period_days} dias do ciclo.
            </p>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
            {formatCents(invoice.amount_cents)}
          </p>
          {invoice.discount_cents > 0 && (
            <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
              Desconto {formatCents(invoice.discount_cents)}
            </p>
          )}
          {invoice.addition_cents > 0 && (
            <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
              Acrescimo {formatCents(invoice.addition_cents)}
            </p>
          )}
          {invoice.paid_at && (
            <p style={{ margin: 0, fontSize: "12px", color: "#166534" }}>
              Pago em {formatDateTimeBr(invoice.paid_at)}
            </p>
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: "12px",
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          fontSize: "12px",
          color: "#475569"
        }}
      >
        <span>
          Boleto:{" "}
          {invoice.boleto_payment_id
            ? `${invoice.boleto_status ?? "emitido"} (${invoice.boleto_payment_id})`
            : "nao emitido"}
        </span>
        <span>
          WhatsApp:{" "}
          {invoice.whatsapp_sent_at
            ? `enviado em ${formatDateTimeBr(invoice.whatsapp_sent_at)}`
            : "nao enviado"}
        </span>
      </div>

      {invoice.boleto_barcode && (
        <p
          style={{
            margin: "8px 0 0 0",
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#334155",
            wordBreak: "break-all"
          }}
        >
          {invoice.boleto_barcode}
        </p>
      )}
      {invoice.boleto_error && (
        <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#b91c1c" }}>
          {invoice.boleto_error}
        </p>
      )}
      {invoice.whatsapp_error && (
        <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#b45309" }}>
          WhatsApp: {invoice.whatsapp_error}
        </p>
      )}
      {invoice.cancel_reason && (
        <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b" }}>
          Cancelamento: {invoice.cancel_reason}
        </p>
      )}

      <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {invoice.boleto_url && (
          <a
            href={invoice.boleto_url}
            target="_blank"
            rel="noreferrer"
            style={{ ...SMALL_BUTTON, textDecoration: "none", color: "#1d4ed8" }}
          >
            Abrir boleto
          </a>
        )}
        {invoice.boleto_barcode && (
          <button
            type="button"
            style={SMALL_BUTTON}
            onClick={() => void copyToClipboard(invoice.boleto_barcode ?? "")}
          >
            Copiar linha digitavel
          </button>
        )}
        {!isClosed && (
          <button
            type="button"
            style={SMALL_BUTTON}
            onClick={() => onIssueBoleto(Boolean(invoice.boleto_payment_id))}
          >
            {invoice.boleto_payment_id ? "Reemitir boleto" : "Emitir boleto"}
          </button>
        )}
        {!isClosed && (
          <button type="button" style={SMALL_BUTTON} onClick={onSend}>
            {invoice.whatsapp_sent_at ? "Reenviar WhatsApp" : "Enviar WhatsApp"}
          </button>
        )}
        {invoice.boleto_payment_id && !isClosed && (
          <button type="button" style={SMALL_BUTTON} onClick={onRefresh}>
            Atualizar situacao
          </button>
        )}
        <button type="button" style={SMALL_BUTTON} onClick={onDownloadPdf}>
          Baixar PDF
        </button>
        {!isClosed && (
          <button type="button" style={SMALL_BUTTON} onClick={onEdit}>
            Ajustar
          </button>
        )}
        {!isClosed && (
          <button type="button" style={SMALL_BUTTON} onClick={onMarkPaid}>
            Marcar como paga
          </button>
        )}
        {invoice.status !== "paid" && invoice.status !== "canceled" && (
          <button type="button" style={DANGER_BUTTON} onClick={onCancel}>
            Cancelar
          </button>
        )}
        {invoice.status !== "paid" && (
          <button type="button" style={DANGER_BUTTON} onClick={onDelete}>
            Excluir
          </button>
        )}
      </div>
    </div>
  );
}

function CompanyBillingRow({
  company,
  busyAction,
  onEdit,
  onGenerate,
  onToggleBlock
}: {
  company: BillingCompany;
  busyAction: string | null;
  onEdit: () => void;
  onGenerate: (force: boolean) => void;
  onToggleBlock: () => void;
}) {
  const isBusy = busyAction?.endsWith(company.id) ?? false;
  const blocked = company.payment_blocked === true;

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "12px",
        padding: "16px",
        opacity: isBusy ? 0.6 : 1
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "flex-start"
        }}
      >
        <div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <strong>{company.name}</strong>
            <Badge
              label={company.billing_enabled ? "Cobranca ativa" : "Sem cobranca"}
              tone={
                company.billing_enabled
                  ? { background: "#dcfce7", color: "#166534" }
                  : { background: "#e2e8f0", color: "#475569" }
              }
            />
            {blocked && (
              <Badge label="Bloqueada" tone={{ background: "#fee2e2", color: "#991b1b" }} />
            )}
            {company.billing_block_exempt && (
              <Badge
                label="Isenta de bloqueio"
                tone={{ background: "#fef3c7", color: "#92400e" }}
              />
            )}
          </div>
          <p style={{ margin: "6px 0 0 0", fontSize: "13px", color: "#475569" }}>
            Valor acertado:{" "}
            <strong>
              {company.billing_monthly_amount_cents
                ? formatCents(company.billing_monthly_amount_cents)
                : "nao informado"}
            </strong>
            {" • "}Virada: {formatDateBr(company.billing_start_date) || "nao informada"}
            {" • "}Fecha dia {company.billing_plan.closingDay}, vence dia{" "}
            {company.billing_plan.dueDay}
            {" • "}Bloqueio apos {company.billing_plan.graceDays} dia(s)
          </p>
          <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#64748b" }}>
            {describeNextClosing(company)}
          </p>
          {blocked && company.payment_blocked_reason && (
            <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#b91c1c" }}>
              {company.payment_blocked_reason}
            </p>
          )}
          {company.billing_plan.blockers.length > 0 && (
            <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#b45309" }}>
              Pendente para faturar: {company.billing_plan.blockers.join(", ")}.
            </p>
          )}
          {company.billing_plan.missing.whatsapp.length > 0 && (
            <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "#b45309" }}>
              Sem WhatsApp de cobranca: a fatura sera gerada, mas nao enviada.
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" style={SMALL_BUTTON} onClick={onEdit}>
            Editar cobranca
          </button>
          <button
            type="button"
            style={SMALL_BUTTON}
            disabled={!company.billing_plan.readyToClose}
            title={
              company.billing_plan.readyToClose
                ? undefined
                : "Complete o cadastro de cobranca antes de faturar"
            }
            onClick={() => onGenerate(false)}
          >
            Gerar fatura
          </button>
          <button
            type="button"
            style={SMALL_BUTTON}
            disabled={!company.billing_plan.readyToClose}
            title="Fecha o proximo ciclo mesmo antes da data de fechamento"
            onClick={() => {
              if (!confirm("Antecipar o fechamento do proximo ciclo desta pedreira?")) return;
              onGenerate(true);
            }}
          >
            Antecipar fechamento
          </button>
          <button
            type="button"
            style={blocked ? SMALL_BUTTON : DANGER_BUTTON}
            onClick={onToggleBlock}
          >
            {blocked ? "Liberar acesso" : "Bloquear acesso"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CompanyBillingModal({
  company,
  settings,
  busy,
  onClose,
  onSave
}: {
  company: BillingCompany;
  settings: BillingSettingsView;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const [amountInput, setAmountInput] = useState(
    centsToInput(company.billing_monthly_amount_cents)
  );
  const [amountError, setAmountError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const monthlyAmountCents = amountInput.trim() ? parseMoneyToCents(amountInput) : null;
    if (amountInput.trim() && monthlyAmountCents === null) {
      setAmountError("Valor invalido. Use o formato 1.234,56.");
      return;
    }
    setAmountError(null);

    void onSave({
      billingEnabled: form.get("billingEnabled") === "on",
      billingBlockExempt: form.get("billingBlockExempt") === "on",
      billingMonthlyAmountCents: monthlyAmountCents,
      billingStartDate: String(form.get("billingStartDate") ?? ""),
      billingClosingDay: emptyToNull(form.get("billingClosingDay")),
      billingDueDay: emptyToNull(form.get("billingDueDay")),
      billingGraceDays: emptyToNull(form.get("billingGraceDays")),
      billingLegalName: form.get("billingLegalName"),
      billingDocument: form.get("billingDocument"),
      billingEmail: form.get("billingEmail"),
      billingPhone: form.get("billingPhone"),
      billingContactName: form.get("billingContactName"),
      billingZipcode: form.get("billingZipcode"),
      billingAddressStreet: form.get("billingAddressStreet"),
      billingAddressNumber: form.get("billingAddressNumber"),
      billingAddressComplement: form.get("billingAddressComplement"),
      billingNeighborhood: form.get("billingNeighborhood"),
      billingCity: form.get("billingCity"),
      billingState: form.get("billingState"),
      billingNotes: form.get("billingNotes")
    });
  }

  return (
    <Modal
      title={`Cobranca — ${company.name}`}
      subtitle="Valor acertado, calendario do ciclo e os dados que o boleto do Mercado Pago exige."
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "20px" }}
      >
        <fieldset style={FIELDSET}>
          <legend style={LEGEND}>Contrato</legend>
          <div style={GRID_TWO}>
            <Field
              label="Valor acertado (mensal)"
              hint="Negociado caso a caso. A primeira fatura sai proporcional aos dias usados."
            >
              <input
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="900,00"
                inputMode="decimal"
                style={INPUT}
              />
            </Field>
            <Field
              label="Data de virada do sistema"
              hint="Primeiro dia de uso cobrado; base do rateio da primeira fatura."
            >
              <input
                name="billingStartDate"
                type="date"
                defaultValue={company.billing_start_date ?? ""}
                style={INPUT}
              />
            </Field>
            <Field
              label="Dia do fechamento"
              hint={`Vazio usa o padrao (${settings.defaultClosingDay}).`}
            >
              <input
                name="billingClosingDay"
                type="number"
                min={1}
                max={31}
                defaultValue={company.billing_closing_day ?? ""}
                style={INPUT}
              />
            </Field>
            <Field
              label="Dia do vencimento"
              hint={`Vazio usa o padrao (${settings.defaultDueDay}).`}
            >
              <input
                name="billingDueDay"
                type="number"
                min={1}
                max={31}
                defaultValue={company.billing_due_day ?? ""}
                style={INPUT}
              />
            </Field>
            <Field
              label="Dias de inadimplencia ate o bloqueio"
              hint={`Vazio usa o padrao (${settings.defaultGraceDays}).`}
            >
              <input
                name="billingGraceDays"
                type="number"
                min={0}
                max={365}
                defaultValue={company.billing_grace_days ?? ""}
                style={INPUT}
              />
            </Field>
          </div>
          {amountError && (
            <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#b91c1c" }}>{amountError}</p>
          )}
          <div style={{ display: "flex", gap: "20px", marginTop: "12px", flexWrap: "wrap" }}>
            <Checkbox
              name="billingEnabled"
              defaultChecked={company.billing_enabled}
              label="Cobrar automaticamente no fechamento"
            />
            <Checkbox
              name="billingBlockExempt"
              defaultChecked={company.billing_block_exempt}
              label="Isenta do bloqueio automatico"
            />
          </div>
        </fieldset>

        <fieldset style={FIELDSET}>
          <legend style={LEGEND}>Dados do boleto</legend>
          <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#64748b" }}>
            O Mercado Pago exige documento, e-mail e endereco completo do pagador. Faltando um
            deles, a emissao inteira e recusada.
          </p>
          <div style={GRID_TWO}>
            <Field label="Razao social (cobranca)" hint="Vazio usa a razao social do cadastro.">
              <input
                name="billingLegalName"
                defaultValue={company.billing_legal_name ?? ""}
                placeholder={company.legal_name ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="CNPJ/CPF (cobranca)" hint="Vazio usa o documento do cadastro.">
              <input
                name="billingDocument"
                defaultValue={company.billing_document ?? ""}
                placeholder={company.document ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="E-mail de cobranca">
              <input
                name="billingEmail"
                type="email"
                defaultValue={company.billing_email ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="WhatsApp de cobranca" hint="Para onde a fatura e o boleto sao enviados.">
              <input
                name="billingPhone"
                defaultValue={company.billing_phone ?? ""}
                placeholder="(31) 99999-9999"
                style={INPUT}
              />
            </Field>
            <Field label="Contato do financeiro">
              <input
                name="billingContactName"
                defaultValue={company.billing_contact_name ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="CEP">
              <input
                name="billingZipcode"
                defaultValue={company.billing_zipcode ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="Endereco">
              <input
                name="billingAddressStreet"
                defaultValue={company.billing_address_street ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="Numero">
              <input
                name="billingAddressNumber"
                defaultValue={company.billing_address_number ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="Complemento">
              <input
                name="billingAddressComplement"
                defaultValue={company.billing_address_complement ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="Bairro">
              <input
                name="billingNeighborhood"
                defaultValue={company.billing_neighborhood ?? ""}
                style={INPUT}
              />
            </Field>
            <Field label="Cidade">
              <input name="billingCity" defaultValue={company.billing_city ?? ""} style={INPUT} />
            </Field>
            <Field label="UF">
              <input
                name="billingState"
                maxLength={2}
                defaultValue={company.billing_state ?? ""}
                style={INPUT}
              />
            </Field>
          </div>
        </fieldset>

        <Field label="Observacoes internas">
          <textarea
            name="billingNotes"
            rows={3}
            defaultValue={company.billing_notes ?? ""}
            style={{ ...INPUT, resize: "vertical" }}
          />
        </Field>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="submit"
            disabled={busy}
            style={{ ...PRIMARY_BUTTON, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Salvando..." : "Salvar cobranca"}
          </button>
          <button type="button" onClick={onClose} style={{ ...SMALL_BUTTON, padding: "10px 16px" }}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InvoiceEditModal({
  invoice,
  busy,
  onClose,
  onSave
}: {
  invoice: BillingInvoice;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const [base, setBase] = useState(centsToInput(invoice.base_amount_cents));
  const [discount, setDiscount] = useState(centsToInput(invoice.discount_cents));
  const [addition, setAddition] = useState(centsToInput(invoice.addition_cents));
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => {
    const baseCents = parseMoneyToCents(base) ?? 0;
    const discountCents = parseMoneyToCents(discount) ?? 0;
    const additionCents = parseMoneyToCents(addition) ?? 0;
    return Math.max(0, baseCents + additionCents - discountCents);
  }, [base, discount, addition]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const baseCents = parseMoneyToCents(base);
    if (baseCents === null) {
      setError("Valor do periodo invalido.");
      return;
    }
    setError(null);
    const form = new FormData(event.currentTarget);
    void onSave({
      baseAmountCents: baseCents,
      discountCents: parseMoneyToCents(discount) ?? 0,
      additionCents: parseMoneyToCents(addition) ?? 0,
      dueDate: form.get("dueDate"),
      notes: form.get("notes")
    });
  }

  return (
    <Modal
      title={`Ajustar fatura ${invoice.number}`}
      subtitle={`Referencia ${invoice.reference_label}. O total e sempre valor do periodo + acrescimo - desconto.`}
      onClose={onClose}
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "16px" }}
      >
        <div style={GRID_TWO}>
          <Field label="Valor do periodo">
            <input
              value={base}
              onChange={(e) => setBase(e.target.value)}
              inputMode="decimal"
              style={INPUT}
            />
          </Field>
          <Field label="Acrescimo">
            <input
              value={addition}
              onChange={(e) => setAddition(e.target.value)}
              inputMode="decimal"
              style={INPUT}
            />
          </Field>
          <Field label="Desconto">
            <input
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              inputMode="decimal"
              style={INPUT}
            />
          </Field>
          <Field label="Vencimento">
            <input name="dueDate" type="date" defaultValue={invoice.due_date} style={INPUT} />
          </Field>
        </div>

        <p style={{ margin: 0, fontSize: "16px", fontWeight: 700 }}>
          Total: {formatCents(preview)}
        </p>
        {invoice.boleto_payment_id && (
          <p style={{ margin: 0, fontSize: "12px", color: "#b45309" }}>
            Ja existe boleto emitido com o valor e o vencimento antigos. Depois de salvar, use
            &quot;Reemitir boleto&quot; — o papel que o cliente recebeu nao muda sozinho.
          </p>
        )}
        {error && <p style={{ margin: 0, fontSize: "12px", color: "#b91c1c" }}>{error}</p>}

        <Field label="Observacoes">
          <textarea
            name="notes"
            rows={3}
            defaultValue={invoice.notes ?? ""}
            style={{ ...INPUT, resize: "vertical" }}
          />
        </Field>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="submit"
            disabled={busy}
            style={{ ...PRIMARY_BUTTON, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Salvando..." : "Salvar fatura"}
          </button>
          <button type="button" onClick={onClose} style={{ ...SMALL_BUTTON, padding: "10px 16px" }}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BillingSettingsForm({
  settings,
  busy,
  onSave
}: {
  settings: BillingSettingsView;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      mercadoPagoEnvironment: form.get("mercadoPagoEnvironment"),
      // Campo vazio significa "mantenha": o valor gravado nunca chega ao
      // navegador, entao um submit sem redigitar nao pode apagar o token.
      mercadoPagoAccessToken: keepSecret(form.get("mercadoPagoAccessToken")),
      mercadoPagoWebhookSecret: keepSecret(form.get("mercadoPagoWebhookSecret")),
      whatsappUrl: form.get("whatsappUrl"),
      whatsappInstanceToken: keepSecret(form.get("whatsappInstanceToken")),
      whatsappInstanceName: form.get("whatsappInstanceName"),
      defaultClosingDay: form.get("defaultClosingDay"),
      defaultDueDay: form.get("defaultDueDay"),
      defaultGraceDays: form.get("defaultGraceDays"),
      autoCloseEnabled: form.get("autoCloseEnabled") === "on",
      autoBoletoEnabled: form.get("autoBoletoEnabled") === "on",
      autoWhatsappEnabled: form.get("autoWhatsappEnabled") === "on",
      autoBlockEnabled: form.get("autoBlockEnabled") === "on",
      issuerName: form.get("issuerName"),
      issuerDocument: form.get("issuerDocument"),
      issuerEmail: form.get("issuerEmail"),
      issuerPhone: form.get("issuerPhone"),
      issuerPixKey: form.get("issuerPixKey"),
      invoiceDescriptionTemplate: form.get("invoiceDescriptionTemplate"),
      whatsappMessageTemplate: form.get("whatsappMessageTemplate")
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <article style={CARD}>
        <h3 style={{ margin: "0 0 4px 0" }}>Mercado Pago</h3>
        <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#64748b" }}>
          O access token e da conta que EMITE os boletos. Ele fica so no servidor — o painel mostra
          apenas os quatro ultimos caracteres.
        </p>
        <div style={GRID_TWO}>
          <Field
            label="Access token"
            hint={
              settings.hasMercadoPagoAccessToken
                ? `Configurado (${settings.mercadoPagoAccessTokenPreview}). Deixe vazio para manter.`
                : "Nao configurado. Sem ele, nenhum boleto e emitido."
            }
          >
            <input
              name="mercadoPagoAccessToken"
              type="password"
              autoComplete="off"
              placeholder={settings.hasMercadoPagoAccessToken ? SECRET_UNCHANGED : "APP_USR-..."}
              style={INPUT}
            />
          </Field>
          <Field label="Ambiente">
            <select
              name="mercadoPagoEnvironment"
              defaultValue={settings.mercadoPagoEnvironment}
              style={INPUT}
            >
              <option value="production">Producao</option>
              <option value="sandbox">Sandbox (teste)</option>
            </select>
          </Field>
          <Field
            label="Segredo da assinatura do webhook"
            hint={
              settings.hasMercadoPagoWebhookSecret
                ? "Configurado. Deixe vazio para manter."
                : "Opcional. Sem ele, a baixa e confirmada consultando a API do Mercado Pago."
            }
          >
            <input
              name="mercadoPagoWebhookSecret"
              type="password"
              autoComplete="off"
              placeholder={settings.hasMercadoPagoWebhookSecret ? SECRET_UNCHANGED : ""}
              style={INPUT}
            />
          </Field>
        </div>
      </article>

      <article style={CARD}>
        <h3 style={{ margin: "0 0 4px 0" }}>WhatsApp da cobranca</h3>
        <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#64748b" }}>
          Instancia UAZAPI da Kybernan, usada para mandar fatura e boleto a todas as pedreiras. E
          diferente da instancia que cada pedreira configura para os relatorios dela.
        </p>
        <div style={GRID_TWO}>
          <Field label="URL da instancia">
            <input
              name="whatsappUrl"
              defaultValue={settings.whatsappUrl}
              placeholder="https://sua-instancia.uazapi.com"
              style={INPUT}
            />
          </Field>
          <Field
            label="Token da instancia"
            hint={
              settings.hasWhatsappInstanceToken
                ? `Configurado (${settings.whatsappInstanceTokenPreview}). Deixe vazio para manter.`
                : "Nao configurado. Sem ele, a fatura e gerada mas nao enviada."
            }
          >
            <input
              name="whatsappInstanceToken"
              type="password"
              autoComplete="off"
              placeholder={settings.hasWhatsappInstanceToken ? SECRET_UNCHANGED : ""}
              style={INPUT}
            />
          </Field>
          <Field label="Nome da instancia">
            <input
              name="whatsappInstanceName"
              defaultValue={settings.whatsappInstanceName}
              style={INPUT}
            />
          </Field>
        </div>
      </article>

      <article style={CARD}>
        <h3 style={{ margin: "0 0 4px 0" }}>Padroes do ciclo</h3>
        <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#64748b" }}>
          Valem para a pedreira que nao definiu o proprio calendario.
        </p>
        <div style={GRID_TWO}>
          <Field label="Dia do fechamento" hint="Meses curtos fecham no ultimo dia.">
            <input
              name="defaultClosingDay"
              type="number"
              min={1}
              max={31}
              defaultValue={settings.defaultClosingDay}
              style={INPUT}
            />
          </Field>
          <Field
            label="Dia do vencimento"
            hint="Menor ou igual ao fechamento vence no mes seguinte."
          >
            <input
              name="defaultDueDay"
              type="number"
              min={1}
              max={31}
              defaultValue={settings.defaultDueDay}
              style={INPUT}
            />
          </Field>
          <Field
            label="Dias de inadimplencia ate o bloqueio"
            hint="Passados esses dias apos o vencimento, o acesso a balanca e bloqueado automaticamente."
          >
            <input
              name="defaultGraceDays"
              type="number"
              min={0}
              max={365}
              defaultValue={settings.defaultGraceDays}
              style={INPUT}
            />
          </Field>
        </div>
        <div
          style={{
            display: "flex",
            gap: "20px",
            marginTop: "16px",
            flexWrap: "wrap",
            paddingTop: "16px",
            borderTop: "1px solid #e2e8f0"
          }}
        >
          <Checkbox
            name="autoCloseEnabled"
            defaultChecked={settings.autoCloseEnabled}
            label="Fechar o ciclo automaticamente"
          />
          <Checkbox
            name="autoBoletoEnabled"
            defaultChecked={settings.autoBoletoEnabled}
            label="Emitir o boleto automaticamente"
          />
          <Checkbox
            name="autoWhatsappEnabled"
            defaultChecked={settings.autoWhatsappEnabled}
            label="Enviar por WhatsApp automaticamente"
          />
          <Checkbox
            name="autoBlockEnabled"
            defaultChecked={settings.autoBlockEnabled}
            label="Bloquear por inadimplencia"
          />
        </div>
      </article>

      <article style={CARD}>
        <h3 style={{ margin: "0 0 4px 0" }}>Emitente e textos</h3>
        <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#64748b" }}>
          Aparecem na fatura em PDF, na descricao do boleto e na mensagem enviada ao cliente.
        </p>
        <div style={GRID_TWO}>
          <Field label="Nome do emitente">
            <input name="issuerName" defaultValue={settings.issuerName} style={INPUT} />
          </Field>
          <Field label="CNPJ do emitente">
            <input name="issuerDocument" defaultValue={settings.issuerDocument} style={INPUT} />
          </Field>
          <Field label="E-mail">
            <input name="issuerEmail" defaultValue={settings.issuerEmail} style={INPUT} />
          </Field>
          <Field label="Telefone de suporte">
            <input name="issuerPhone" defaultValue={settings.issuerPhone} style={INPUT} />
          </Field>
          <Field
            label="Chave PIX"
            hint="Opcional; entra na fatura e na mensagem como alternativa ao boleto."
          >
            <input name="issuerPixKey" defaultValue={settings.issuerPixKey} style={INPUT} />
          </Field>
        </div>
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <Field
            label="Descricao do boleto"
            hint="Marcadores: {emitente} {pedreira} {referencia} {periodo}. Vazio usa o texto padrao."
          >
            <input
              name="invoiceDescriptionTemplate"
              defaultValue={settings.invoiceDescriptionTemplate}
              placeholder="{emitente} - Mensalidade {referencia} - {pedreira}"
              style={INPUT}
            />
          </Field>
          <Field
            label="Mensagem do WhatsApp"
            hint="Marcadores: {pedreira} {numero} {referencia} {valor} {vencimento} {boleto} {linha_digitavel} {pix}. Vazio usa a mensagem padrao."
          >
            <textarea
              name="whatsappMessageTemplate"
              rows={4}
              defaultValue={settings.whatsappMessageTemplate}
              style={{ ...INPUT, resize: "vertical" }}
            />
          </Field>
        </div>
      </article>

      <div>
        <button
          type="submit"
          disabled={busy}
          style={{ ...PRIMARY_BUTTON, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Salvando..." : "Salvar configuracoes"}
        </button>
      </div>
    </form>
  );
}

function Checkbox({
  name,
  label,
  defaultChecked
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------

const FIELDSET: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "16px",
  margin: 0
};

const LEGEND: React.CSSProperties = {
  padding: "0 8px",
  fontSize: "13px",
  fontWeight: 700,
  color: "#334155"
};

const GRID_TWO: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
  gap: "12px"
};

/** Campo vazio = "mantenha o que esta gravado"; `undefined` nao vai no payload. */
function keepSecret(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

function emptyToNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      alert("Linha digitavel copiada!");
      return;
    }
  } catch {
    // cai para a copia manual abaixo
  }
  window.prompt("Copie a linha digitavel:", value);
}
