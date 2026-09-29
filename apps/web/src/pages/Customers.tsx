import { SearchCheck } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { ConditionLegend } from "../components/ConditionLegend";
import { CustomerInfoModal } from "../components/CustomerPanels";
import { IconAction, NewButton, Pill, SearchBar, SectionHead } from "../components/desk";
import { DeleteDialog } from "../components/PricePassword";
import {
  Alert,
  Badge,
  DataTable,
  Field,
  LoadMore,
  Modal,
  PAGE_SIZE,
  Warnings,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { conditionTextOf, describePaymentCondition } from "../lib/entry-freight";
import { documentKind, formatDocument, isValidDocument, normalizeDocument } from "../lib/format";
import { q, type Customer, type PaymentTerm } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import { usePaged } from "../lib/use-paged";
import { CustomerFileModal } from "./CustomerFile";

/** O texto da busca so vira consulta quando a pessoa para de digitar. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Aba Clientes da tela Cadastros (a `CustomersView` do desktop). A lista vem do banco 50 por
 * vez, ja filtrada (`q.customersPage`): a pedreira tem mais de 2 mil clientes e trazer todos era
 * o que pesava. "Ver mais" traz os proximos 50.
 */
export function CustomersSection() {
  const user = useUser();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const debouncedSearch = useDebounced(search);
  const list = usePaged(
    (from, to) =>
      q.customersPage(
        user.companyId,
        { search: debouncedSearch, includeInactive: showInactive },
        from,
        to
      ),
    [user.companyId, debouncedSearch, showInactive],
    PAGE_SIZE
  );
  const aux = useAsync(
    () => Promise.all([q.paymentTerms(user.companyId), q.activeCustomerCount(user.companyId)]),
    [user.companyId]
  );
  // Cliente salvo, inativado ou excluido na balanca aparece aqui sem clicar em atualizar.
  useOnCadastroChange(list.refresh, CADASTRO_TABLES.customers);
  useOnCadastroChange(aux.refresh, [...CADASTRO_TABLES.customers, ...CADASTRO_TABLES.payment]);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [file, setFile] = useState<Customer | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [removing, setRemoving] = useState<Customer | null>(null);

  const [terms, activeCount] = aux.data ?? [[], 0];
  const error = list.error ?? aux.error;

  async function refresh() {
    await Promise.all([list.reload(), aux.reload()]);
  }

  async function toggleActive(customer: Customer) {
    try {
      await callWebApi("set_customer_active", { id: customer.id, isActive: !customer.is_active });
      toast.push(customer.is_active ? "Cliente inativado." : "Cliente reativado.");
      await refresh();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      <SectionHead
        title="Clientes"
        count={activeCount}
        description="Clientes sincronizados do OMIE ou criados aqui. Clientes novos são enviados ao OMIE na hora. Dois cliques no cliente mostram os dados dele."
        action={
          user.canEditCustomers && (
            <NewButton onClick={() => setEditing("new")}>Novo cliente</NewButton>
          )
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar cliente por nome, fantasia ou CNPJ..."
        onRefresh={() => void refresh()}
      >
        <label className="check" style={{ margin: 0, whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Inativos
        </label>
      </SearchBar>
      <DataTable
        rows={list.rows}
        rowKey={(c) => c.id}
        rowClassName={(c) => (c.is_active ? undefined : "inactive")}
        empty={list.loading ? "Carregando..." : "Nenhum cliente encontrado."}
        pageSize={0}
        onRowDoubleClick={setViewing}
        footer={
          <LoadMore
            shown={list.rows.length}
            total={list.total}
            loading={list.loading}
            onMore={() => void list.more()}
          />
        }
        columns={[
          {
            key: "name",
            header: "Cliente",
            render: (c) => (
              <>
                <strong>{c.trade_name || c.legal_name}</strong>
                <span className="cell-sub">{c.legal_name}</span>
              </>
            )
          },
          { key: "doc", header: "Documento", render: (c) => formatDocument(c.document) || "—" },
          {
            key: "contact",
            header: "Contato",
            render: (c) => (
              <>
                <strong>{c.phone || "—"}</strong>
                <span className="cell-sub">{c.email || ""}</span>
              </>
            )
          },
          {
            key: "origin",
            header: "Origem / Status",
            render: (c) => (
              <span className="row-actions" style={{ justifyContent: "flex-start" }}>
                {c.omie_customer_id ? (
                  <Pill tone="warning">OMIE</Pill>
                ) : (
                  <Pill tone="success">LOCAL</Pill>
                )}
                {c.credit_account_enabled && (
                  <Badge kind="accent">{c.credit_mode === "prepaid" ? "pré-pago" : "fiado"}</Badge>
                )}
                {!c.is_active && <Pill>INATIVO</Pill>}
              </span>
            )
          },
          {
            key: "actions",
            header: "Ações",
            numeric: true,
            render: (c) => (
              <span className="row-actions">
                <IconAction
                  icon="eye"
                  label="Ver os dados do cliente (ou dois cliques na linha)"
                  onClick={() => setViewing(c)}
                />
                {user.canEditCustomers && (
                  <>
                    <IconAction icon="edit" label="Editar cliente" onClick={() => setEditing(c)} />
                    <IconAction
                      icon="sliders"
                      label="Comercial, preços, frete, transporte e entrega futura"
                      onClick={() => setFile(c)}
                    />
                    <button className="btn small" onClick={() => void toggleActive(c)}>
                      {c.is_active ? "Inativar" : "Reativar"}
                    </button>
                    <IconAction
                      icon="trash"
                      label="Excluir cliente"
                      tone="danger"
                      onClick={() => setRemoving(c)}
                    />
                  </>
                )}
              </span>
            )
          }
        ]}
      />

      {editing && (
        <CustomerForm
          customer={editing === "new" ? null : editing}
          terms={terms}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
      {viewing && (
        <CustomerInfoModal
          customer={{ id: viewing.id, name: viewing.trade_name || viewing.legal_name }}
          actions={
            user.canEditCustomers && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setEditing(viewing);
                    setViewing(null);
                  }}
                >
                  Editar cadastro
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setFile(viewing);
                    setViewing(null);
                  }}
                >
                  Comercial, preços e mais
                </button>
              </>
            )
          }
          onClose={() => setViewing(null)}
        />
      )}
      {file && (
        <CustomerFileModal
          customer={file}
          onClose={() => {
            setFile(null);
            void refresh();
          }}
        />
      )}
      {removing && (
        <DeleteDialog
          title={`Excluir ${removing.trade_name || removing.legal_name}`}
          description="Só sai o cliente sem histórico (nenhuma pesagem nem lançamento de crédito). Quem já comprou deve ser inativado."
          askPassword={user.requiresPricePassword}
          onClose={() => setRemoving(null)}
          onConfirm={async (pricePassword) => {
            try {
              await callWebApi("delete_customer", { id: removing.id, pricePassword });
              toast.push("Cliente excluído.");
              setRemoving(null);
              await refresh();
              return null;
            } catch (caught) {
              return errorMessage(caught);
            }
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function CustomerForm({
  customer,
  terms,
  onClose,
  onSaved
}: {
  customer: Customer | null;
  terms: PaymentTerm[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [form, setForm] = useState({
    legalName: customer?.legal_name ?? "",
    tradeName: customer?.trade_name ?? "",
    document: formatDocument(customer?.document) ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    phoneSecondary: customer?.phone_secondary ?? "",
    contactName: customer?.contact_name ?? "",
    zipcode: customer?.zipcode ?? "",
    addressStreet: customer?.address_street ?? "",
    addressNumber: customer?.address_number ?? "",
    addressComplement: customer?.address_complement ?? "",
    neighborhood: customer?.neighborhood ?? "",
    city: customer?.city ?? "",
    state: customer?.state ?? "",
    stateRegistration: customer?.state_registration ?? "",
    observations: customer?.observations ?? ""
  });
  // Condicao padrao como TEXTO, igual ao desktop ("30", "7 14 21", "3 parcelas"): a web-api
  // reusa a condicao com a mesma regra ou cria uma na hora.
  const initialCondition = useMemo(() => {
    const term = terms.find((t) => t.id === customer?.default_payment_term_id);
    return term ? conditionTextOf(term.rules_json, term.name) : "";
  }, [terms, customer?.default_payment_term_id]);
  const [conditionText, setConditionText] = useState(initialCondition);
  const [cnpjBusy, setCnpjBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (form.document.trim() && !isValidDocument(form.document)) {
      setError("CNPJ/CPF inválido. Confira os dígitos.");
      return;
    }
    // Cliente que ja existe nao mexe na condicao aqui (ela fica na ficha): a guardada, mesmo
    // num formato antigo do OMIE, nao pode travar a edicao do endereco.
    if (!customer && describePaymentCondition(conditionText).status === "invalid") {
      setError('Condição de pagamento padrão inválida. Veja os formatos em "Como escrever".');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Campo vazio vai como null (limpa); a web-api nao mexe no que nao for enviado.
      const payload: Record<string, unknown> = { ...(customer ? { id: customer.id } : {}) };
      for (const [key, value] of Object.entries(form)) payload[key] = value.trim() || null;
      // So manda a condicao quando ela mudou: reabrir e salvar nao recria nem troca a condicao.
      if (conditionText.trim() !== initialCondition.trim()) {
        payload.defaultPaymentCondition = conditionText.trim() || null;
      }
      const result = await callWebApi("upsert_customer", payload);
      setWarnings(result.warnings);
      toast.push(customer ? "Cliente salvo." : "Cliente cadastrado.");
      if (result.warnings.length === 0) await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  // Busca os dados pelo CNPJ (Receita) e preenche o formulario, como o botao do desktop. Nao
  // apaga o que ja esta preenchido quando a Receita nao tem o campo.
  async function lookupCnpj() {
    if (documentKind(normalizeDocument(form.document)) !== "cnpj") {
      setError("Informe um CNPJ com 14 posições para buscar.");
      return;
    }
    setCnpjBusy(true);
    setError(null);
    try {
      const data = (await callWebApi("lookup_cnpj", { cnpj: form.document })) as unknown as {
        found: boolean;
        [key: string]: unknown;
      };
      if (!data.found) {
        toast.push("CNPJ não encontrado na base da Receita.", "error");
        return;
      }
      const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");
      setForm((prev) => ({
        ...prev,
        legalName: text("legalName") || prev.legalName,
        tradeName: text("tradeName") || prev.tradeName,
        phone: text("phone") || prev.phone,
        email: text("email") || prev.email,
        zipcode: text("zipcode") || prev.zipcode,
        addressStreet: text("addressStreet") || prev.addressStreet,
        addressNumber: text("addressNumber") || prev.addressNumber,
        addressComplement: text("addressComplement") || prev.addressComplement,
        neighborhood: text("neighborhood") || prev.neighborhood,
        city: text("city") || prev.city,
        state: (text("state") || prev.state).toUpperCase().slice(0, 2)
      }));
      toast.push(
        text("email")
          ? "Dados do CNPJ preenchidos. Revise e salve."
          : "Dados do CNPJ preenchidos. E-mail não consta na Receita — informe manualmente."
      );
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    } finally {
      setCnpjBusy(false);
    }
  }

  const formId = "customer-form";
  return (
    <Modal
      title={customer ? `Editar ${customer.trade_name}` : "Novo cliente"}
      description="Nome, documento e endereço sobem para o OMIE ao salvar."
      onClose={onClose}
      wide
      footer={
        <>
          {warnings.length > 0 ? (
            <button className="btn primary" onClick={() => void onSaved()}>
              Entendi
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>
                Cancelar
              </button>
              <button className="btn primary" type="submit" form={formId} disabled={busy}>
                {busy ? "Salvando..." : "Salvar"}
              </button>
            </>
          )}
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <Warnings items={warnings} />
      <form id={formId} onSubmit={(e) => void onSubmit(e)}>
        <div className="grid-2">
          <Field label="Razão social">
            <input
              className="input"
              value={form.legalName}
              onChange={set("legalName")}
              required
              autoFocus
            />
          </Field>
          <Field label="Nome fantasia" hint="Vazio = usa a razão social.">
            <input className="input" value={form.tradeName} onChange={set("tradeName")} />
          </Field>
          <Field label="CNPJ/CPF" hint="CNPJ novo pode ter letras; digite como está no documento.">
            <div className="input-with-action">
              <input className="input" value={form.document} onChange={set("document")} />
              <button
                type="button"
                className="btn"
                onClick={() => void lookupCnpj()}
                disabled={cnpjBusy}
                title="Buscar dados pelo CNPJ (Receita) e preencher o cadastro"
              >
                <SearchCheck size={15} />
                {cnpjBusy ? "Buscando..." : "Buscar CNPJ"}
              </button>
            </div>
          </Field>
          <Field label="Inscrição estadual">
            <input
              className="input"
              value={form.stateRegistration}
              onChange={set("stateRegistration")}
            />
          </Field>
          <Field label="E-mail">
            <input className="input" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Telefone">
            <input
              className="input"
              value={form.phone}
              onChange={set("phone")}
              placeholder="(15) 99999-9999"
            />
          </Field>
          <Field label="Telefone 2">
            <input
              className="input"
              value={form.phoneSecondary}
              onChange={set("phoneSecondary")}
              placeholder="(15) 3333-3333"
            />
          </Field>
          <Field label="Contato">
            <input className="input" value={form.contactName} onChange={set("contactName")} />
          </Field>
        </div>
        {/*
          Cliente que ja existe muda a condicao na ficha (aba Comercial e credito), ao lado da
          forma de pagamento. Aqui ela fica so no cadastro novo, que ainda nao tem ficha.
        */}
        {customer ? (
          <p className="desk-muted">
            Condição de pagamento padrão: <strong>{initialCondition || "sem padrão"}</strong>. Para
            mudar, use o botão de ficha do cliente (aba Comercial e crédito), junto da forma de
            pagamento.
          </p>
        ) : (
          <>
            <Field
              label="Condição de pagamento padrão"
              hint="Vazio = sem padrão. Se não existir no OMIE, é criada automaticamente no envio."
            >
              <input
                className="input"
                value={conditionText}
                onChange={(e) => setConditionText(e.target.value)}
                placeholder='Ex.: "30", "7 14 21", "3 parcelas" ou "s+20"'
              />
            </Field>
            <ConditionLegend value={conditionText} />
          </>
        )}
        <div className="grid-3">
          <Field label="CEP">
            <input className="input" value={form.zipcode} onChange={set("zipcode")} />
          </Field>
          <Field label="Cidade">
            <input className="input" value={form.city} onChange={set("city")} />
          </Field>
          <Field label="UF">
            <input className="input" value={form.state} onChange={set("state")} maxLength={2} />
          </Field>
        </div>
        <div className="grid-3">
          <Field label="Logradouro">
            <input className="input" value={form.addressStreet} onChange={set("addressStreet")} />
          </Field>
          <Field label="Número">
            <input className="input" value={form.addressNumber} onChange={set("addressNumber")} />
          </Field>
          <Field label="Bairro">
            <input className="input" value={form.neighborhood} onChange={set("neighborhood")} />
          </Field>
        </div>
        <Field label="Complemento">
          <input
            className="input"
            value={form.addressComplement}
            onChange={set("addressComplement")}
          />
        </Field>
        <Field label="Observações internas">
          <textarea
            className="textarea"
            rows={3}
            value={form.observations}
            onChange={set("observations")}
          />
        </Field>
      </form>
    </Modal>
  );
}
