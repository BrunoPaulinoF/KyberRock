import { Power, SearchCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { ConditionLegend } from "../components/ConditionLegend";
import { CustomerInfoModal } from "../components/CustomerPanels";
import { IconAction, NewButton, SearchBar, SectionHead } from "../components/desk";
import { DeleteDialog } from "../components/PricePassword";
import {
  ActionMenu,
  Alert,
  DataTable,
  ErrorState,
  Field,
  LoadMore,
  Modal,
  PAGE_SIZE,
  Pill,
  Warnings,
  useDiscardGuard,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { lookupCep } from "../lib/cep";
import { loadCustomerInfo } from "../lib/customer-weighings";
import { conditionTextOf, describePaymentCondition } from "../lib/entry-freight";
import { documentKind, formatDocument, isValidDocument, normalizeDocument } from "../lib/format";
import { maskCep, maskDocument, maskPhone } from "../lib/masks";
import { q, type Customer, type PaymentTerm } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import { usePaged } from "../lib/use-paged";
import {
  cepToSave,
  fieldOfError,
  fillEmptyAddress,
  maskPhoneInput,
  maskStored,
  phoneToSave
} from "./cadastro-form";
import { CustomerFileModal } from "./CustomerFile";

/** Parametro do link direto que abre um cliente (`/cadastros/clientes?cliente=<id>`). */
const CUSTOMER_LINK_PARAM = "cliente";

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
    PAGE_SIZE,
    // Memoria so da lista sem busca: cada palavra digitada viraria uma entrada nova.
    {
      key: debouncedSearch.trim()
        ? null
        : `clientes:${user.companyId}:${showInactive ? "com-inativos" : "ativos"}`
    }
  );
  const aux = useAsync(
    () => Promise.all([q.paymentTerms(user.companyId), q.activeCustomerCount(user.companyId)]),
    [user.companyId],
    { key: `clientes:condicoes-e-total:${user.companyId}` }
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

  // Inativar tem volta: faz na hora e o "Desfazer" da mensagem reativa pela mesma chamada do
  // botao Reativar — em vez de perguntar antes.
  async function setActive(customer: Customer, isActive: boolean) {
    try {
      await callWebApi("set_customer_active", { id: customer.id, isActive });
      if (isActive) toast.push("Cliente reativado.");
      else {
        toast.push("Cliente inativado.", "ok", {
          action: { label: "Desfazer", onClick: () => void setActive(customer, true) }
        });
      }
      await refresh();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  // Link direto (`?cliente=<id>`, a busca rapida usa): abre os dados do cliente como os dois
  // cliques na linha. O cliente pode nao estar na pagina carregada, entao vem pelo id.
  const [params, setParams] = useSearchParams();
  const linkedId = params.get(CUSTOMER_LINK_PARAM);
  const linkedRef = useRef(linkedId);
  linkedRef.current = linkedId;
  useEffect(() => {
    if (!linkedId) return;
    void loadCustomerInfo(user.companyId, linkedId).then(
      (info) => {
        if (linkedRef.current !== linkedId) return;
        if (info.customer) setViewing(info.customer);
        else {
          toast.push("Cliente do link não encontrado.", "warn");
          clearLink();
        }
      },
      (caught: unknown) => toast.push(errorMessage(caught), "error")
    );
    // So quando o link muda: repintar a tela nao reabre a janela.
  }, [linkedId, user.companyId]);

  function clearLink() {
    if (!linkedRef.current) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(CUSTOMER_LINK_PARAM);
        return next;
      },
      { replace: true }
    );
  }

  function closeViewing() {
    setViewing(null);
    clearLink();
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
      {error && <ErrorState message={error} onRetry={() => void refresh()} />}
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
        loading={list.loading}
        empty="Nenhum cliente encontrado."
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
              <span className="cell-wrap">
                <strong>{c.trade_name || c.legal_name}</strong>
                <span className="cell-sub">{c.legal_name}</span>
              </span>
            )
          },
          { key: "doc", header: "Documento", render: (c) => formatDocument(c.document) || "—" },
          {
            key: "contact",
            header: "Contato",
            render: (c) => (
              <>
                <strong>{maskStored(c.phone, maskPhone) || "—"}</strong>
                <span className="cell-sub cell-break">{c.email || ""}</span>
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
                  <Pill tone="info">{c.credit_mode === "prepaid" ? "pré-pago" : "fiado"}</Pill>
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
                    {/* O resto vai no "⋯": cinco botoes lado a lado empurravam a tabela para
                        fora da tela e obrigavam a rolar de lado para chegar neles. */}
                    <ActionMenu
                      label={`Mais ações — ${c.trade_name || c.legal_name}`}
                      actions={[
                        {
                          label: "Comercial, preços e mais",
                          icon: SlidersHorizontal,
                          hint: "Preços, frete, transporte e entrega futura",
                          onClick: () => setFile(c)
                        },
                        {
                          label: c.is_active ? "Inativar" : "Reativar",
                          icon: Power,
                          onClick: () => void setActive(c, !c.is_active)
                        },
                        {
                          label: "Excluir cliente",
                          icon: Trash2,
                          tone: "danger",
                          onClick: () => setRemoving(c)
                        }
                      ]}
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
                    closeViewing();
                  }}
                >
                  Editar cadastro
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setFile(viewing);
                    closeViewing();
                  }}
                >
                  Comercial, preços e mais
                </button>
              </>
            )
          }
          onClose={closeViewing}
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

/** O formulario como abre: o valor gravado, com a mascara so onde ela nao perde nada dele. */
function customerFormOf(customer: Customer | null) {
  return {
    legalName: customer?.legal_name ?? "",
    tradeName: customer?.trade_name ?? "",
    document: formatDocument(customer?.document) ?? "",
    email: customer?.email ?? "",
    phone: maskStored(customer?.phone, maskPhone),
    phoneSecondary: maskStored(customer?.phone_secondary, maskPhone),
    contactName: customer?.contact_name ?? "",
    zipcode: maskStored(customer?.zipcode, maskCep),
    addressStreet: customer?.address_street ?? "",
    addressNumber: customer?.address_number ?? "",
    addressComplement: customer?.address_complement ?? "",
    neighborhood: customer?.neighborhood ?? "",
    city: customer?.city ?? "",
    state: customer?.state ?? "",
    stateRegistration: customer?.state_registration ?? "",
    observations: customer?.observations ?? ""
  };
}

type CustomerFormState = ReturnType<typeof customerFormOf>;
type CustomerField = keyof CustomerFormState | "condition";

/** A recusa da `web-api` que tem campo aparece embaixo dele; o resto, no alto da janela. */
const CUSTOMER_ERROR_FIELDS: ReadonlyArray<readonly [CustomerField, RegExp]> = [
  ["document", /CNPJ\/CPF/i],
  ["state", /\bUF\b/],
  ["legalName", /raz[aã]o social/i],
  ["tradeName", /nome fantasia/i],
  ["condition", /condi[cç][aã]o de pagamento/i]
];

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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CustomerField, string>>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [initialForm] = useState(() => customerFormOf(customer));
  const [form, setForm] = useState(initialForm);
  const formRef = useRef(form);
  formRef.current = form;
  // Condicao padrao como TEXTO, igual ao desktop ("30", "7 14 21", "3 parcelas"): a web-api
  // reusa a condicao com a mesma regra ou cria uma na hora.
  const initialCondition = useMemo(() => {
    const term = terms.find((t) => t.id === customer?.default_payment_term_id);
    return term ? conditionTextOf(term.rules_json, term.name) : "";
  }, [terms, customer?.default_payment_term_id]);
  const [conditionText, setConditionText] = useState(initialCondition);
  const [cnpjBusy, setCnpjBusy] = useState(false);
  // O endereco pelo CEP: a ultima consulta pedida (resposta de uma anterior e descartada).
  const [cepState, setCepState] = useState<"idle" | "busy" | "filled">("idle");
  const cepRequest = useRef("");

  // A condicao so conta no cadastro novo: no que ja existe ela nem aparece aqui.
  const dirty =
    !saved &&
    ((Object.keys(form) as Array<keyof CustomerFormState>).some(
      (key) => form[key] !== initialForm[key]
    ) ||
      (!customer && conditionText.trim() !== initialCondition.trim()));
  const guard = useDiscardGuard(dirty);

  function setFieldError(field: CustomerField, message: string | null) {
    setFieldErrors((current) => {
      if ((current[field] ?? null) === message) return current;
      const next = { ...current };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  }

  const set =
    (key: keyof CustomerFormState, mask?: (value: string) => string) =>
    (e: { target: { value: string } }) => {
      const value = mask ? mask(e.target.value) : e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
      setFieldError(key, null);
    };

  // CEP completo: rua, bairro, cidade e UF vem do ViaCEP, so nos campos VAZIOS. Falha ou CEP
  // inexistente nao avisa nem trava: e so ajuda de digitacao.
  function onZipcodeChange(e: { target: { value: string } }) {
    const zipcode = maskCep(e.target.value);
    setForm((f) => ({ ...f, zipcode }));
    const digits = zipcode.replace(/\D/g, "");
    cepRequest.current = digits;
    if (digits.length !== 8) {
      setCepState("idle");
      return;
    }
    setCepState("busy");
    void lookupCep(digits).then((address) => {
      if (cepRequest.current !== digits) return;
      if (!address || !fillEmptyAddress(formRef.current, address)) {
        setCepState("idle");
        return;
      }
      setForm((f) => fillEmptyAddress(f, address) ?? f);
      setCepState("filled");
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const errors: Partial<Record<CustomerField, string>> = {};
    if (form.document.trim() && !isValidDocument(form.document)) {
      errors.document = "CNPJ/CPF inválido. Confira os dígitos.";
    }
    // Cliente que ja existe nao mexe na condicao aqui (ela fica na ficha): a guardada, mesmo
    // num formato antigo do OMIE, nao pode travar a edicao do endereco.
    if (!customer && describePaymentCondition(conditionText).status === "invalid") {
      errors.condition =
        'Condição de pagamento padrão inválida. Veja os formatos em "Como escrever".';
    }
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try {
      // Campo vazio vai como null (limpa); a web-api nao mexe no que nao for enviado.
      const payload: Record<string, unknown> = { ...(customer ? { id: customer.id } : {}) };
      for (const [key, value] of Object.entries(form)) payload[key] = value.trim() || null;
      // Telefone e CEP: o gravado sobe como estava se ninguem mexeu; o digitado com a mascara
      // sobe so com os digitos, como a balanca grava.
      payload.phone = phoneToSave(form.phone, initialForm.phone, customer?.phone);
      payload.phoneSecondary = phoneToSave(
        form.phoneSecondary,
        initialForm.phoneSecondary,
        customer?.phone_secondary
      );
      payload.zipcode = cepToSave(form.zipcode, initialForm.zipcode, customer?.zipcode);
      // So manda a condicao quando ela mudou: reabrir e salvar nao recria nem troca a condicao.
      if (conditionText.trim() !== initialCondition.trim()) {
        payload.defaultPaymentCondition = conditionText.trim() || null;
      }
      const result = await callWebApi("upsert_customer", payload);
      setSaved(true);
      setWarnings(result.warnings);
      toast.push(customer ? "Cliente salvo." : "Cliente cadastrado.");
      if (result.warnings.length === 0) await onSaved();
    } catch (caught) {
      const message = errorMessage(caught);
      const field = fieldOfError(message, CUSTOMER_ERROR_FIELDS);
      // A condicao do cliente que ja existe nao aparece aqui: a recusa dela fica no alto.
      if (field && (field !== "condition" || !customer)) setFieldError(field, message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  // Busca os dados pelo CNPJ (Receita) e preenche o formulario, como o botao do desktop. Nao
  // apaga o que ja esta preenchido quando a Receita nao tem o campo.
  async function lookupCnpj() {
    if (documentKind(normalizeDocument(form.document)) !== "cnpj") {
      setFieldError("document", "Informe um CNPJ com 14 posições para buscar.");
      return;
    }
    setCnpjBusy(true);
    setError(null);
    setFieldError("document", null);
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
        phone: text("phone") ? maskStored(text("phone"), maskPhone) : prev.phone,
        email: text("email") || prev.email,
        zipcode: text("zipcode") ? maskStored(text("zipcode"), maskCep) : prev.zipcode,
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

  const cepHint =
    cepState === "busy"
      ? "Buscando o endereço..."
      : cepState === "filled"
        ? "Endereço preenchido pelo CEP."
        : undefined;
  const formId = "customer-form";
  return (
    <Modal
      title={customer ? `Editar ${customer.trade_name}` : "Novo cliente"}
      description="Nome, documento e endereço sobem para o OMIE ao salvar."
      onClose={onClose}
      dirty={dirty}
      wide
      footer={
        <>
          {warnings.length > 0 ? (
            <button type="button" className="btn primary" onClick={() => void onSaved()}>
              Entendi
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => void guard(onClose)}>
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
          <Field label="Razão social" error={fieldErrors.legalName}>
            <input
              className="input"
              value={form.legalName}
              onChange={set("legalName")}
              required
              autoFocus
            />
          </Field>
          {/* Na edicao a web-api recusa o nome fantasia vazio; so o cadastro novo cai na razao. */}
          <Field
            label="Nome fantasia"
            hint={customer ? undefined : "Vazio = usa a razão social."}
            error={fieldErrors.tradeName}
          >
            <input
              className="input"
              value={form.tradeName}
              onChange={set("tradeName")}
              required={Boolean(customer)}
            />
          </Field>
          <Field
            label="CNPJ/CPF"
            hint="CNPJ novo pode ter letras; digite como está no documento."
            error={fieldErrors.document}
          >
            <div className="input-with-action">
              <input
                className="input"
                value={form.document}
                onChange={set("document", maskDocument)}
                aria-invalid={fieldErrors.document ? true : undefined}
                aria-label="CNPJ/CPF"
                autoComplete="off"
              />
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
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={set("phone", maskPhoneInput)}
              placeholder="(15) 99999-9999"
            />
          </Field>
          <Field label="Telefone 2">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={form.phoneSecondary}
              onChange={set("phoneSecondary", maskPhoneInput)}
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
              error={fieldErrors.condition}
            >
              <input
                className="input"
                value={conditionText}
                onChange={(e) => {
                  setConditionText(e.target.value);
                  setFieldError("condition", null);
                }}
                placeholder='Ex.: "30", "7 14 21", "3 parcelas" ou "s+20"'
              />
            </Field>
            <ConditionLegend value={conditionText} />
          </>
        )}
        <div className="grid-3">
          <Field label="CEP" hint={cepHint}>
            <input
              className="input"
              inputMode="numeric"
              value={form.zipcode}
              onChange={onZipcodeChange}
              placeholder="00000-000"
            />
          </Field>
          <Field label="Cidade">
            <input className="input" value={form.city} onChange={set("city")} />
          </Field>
          <Field label="UF" error={fieldErrors.state}>
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
