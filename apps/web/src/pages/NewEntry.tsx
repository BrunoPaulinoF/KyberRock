import { BadgeDollarSign, Scale } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { DeskPanel, EmptyState } from "../components/desk";
import { Picker } from "../components/Picker";
import { Alert, Field, useToast } from "../components/ui";
import { useUser } from "../lib/auth";
import { getFreightModalityInfo } from "../lib/desktop/freight";
import {
  INITIAL_ENTRY_FREIGHT,
  PAYMENT_CONDITION_FORMATS,
  applyFreightGroup,
  applyFreightInvoiceChoice,
  conditionTextOf,
  customerDefaultModality,
  describePaymentCondition,
  entryFreightPayload,
  freightGoesToCustomerInvoice,
  freightInvoiceChoice,
  hasFreightValue,
  isCarrierRequired,
  resolveCustomerFreight,
  validateEntryFreight,
  type EntryFreightForm,
  type FreightCalculationType
} from "../lib/entry-freight";
import { formatMoney, parseMoneyToCents } from "../lib/format";
import { parseWeight } from "../lib/operation";
import { q } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import {
  sendRequest,
  submitOnCtrlEnter,
  useCatalog,
  useExecutorStatus,
  type ExecutorStatus
} from "./Operation";

/**
 * Nova entrada, na disposicao da tela do desktop: a faixa escura com o peso no alto e as tres
 * colunas (Dados comerciais, Transporte, Resumo da entrada), com o mesmo bloco de frete e o
 * mesmo campo livre de condicao de pagamento. A diferenca e a de sempre do site: o peso e
 * DIGITADO (como na balanca virtual) e "Registrar entrada" vira um pedido que a balanca
 * executora registra com as mesmas regras do botao "Capturar peso".
 */
export function NewEntry() {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const catalog = useCatalog(user.companyId);
  const executor = useExecutorStatus();
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [conditionText, setConditionText] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [operationType, setOperationType] = useState<"invoice" | "internal">("invoice");
  const [freight, setFreight] = useState<EntryFreightForm>(INITIAL_ENTRY_FREIGHT);
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ultimo par (cliente, produto) que ja puxou o frete: "sem frete" escolhido de proposito nao
  // e desfeito pelo preenchimento automatico (mesma regra do desktop).
  const lastFreightPullRef = useRef("");

  const payment = useAsync(
    () => Promise.all([q.paymentMethods(user.companyId), q.paymentTerms(user.companyId)]),
    [user.companyId]
  );
  const [methods, terms] = payment.data ?? [[], []];
  const selectedMethod = methods.find((method) => method.id === paymentMethodId) ?? null;
  const paymentMethodIsCredit = selectedMethod?.is_customer_credit === true;

  const defaults = useAsync(() => q.productDefaultPrices(user.companyId), [user.companyId]);
  const special = useAsync(
    () => (customerId ? q.customerSpecialPrices(user.companyId, customerId) : Promise.resolve([])),
    [user.companyId, customerId]
  );
  const freightRules = useAsync(
    () => (customerId ? q.customerFreightRules(user.companyId, customerId) : Promise.resolve([])),
    [user.companyId, customerId]
  );
  const price = useMemo(() => {
    if (!productId) return null;
    const own = (special.data ?? []).find((row) => row.product_id === productId);
    if (own) return { cents: own.unit_price_cents, source: "Preco especial do cliente" };
    const standard = (defaults.data ?? []).find((row) => row.product_id === productId);
    if (standard) return { cents: standard.unit_price_cents, source: "Preco padrao do produto" };
    return { cents: null, source: "Produto sem preco cadastrado" };
  }, [productId, special.data, defaults.data]);

  // Esc volta para a fila, como o "Voltar" do rodape do desktop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target instanceof HTMLInputElement)) {
        navigate("/operacoes");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // O frete do cliente assim que ele e o produto sao escolhidos: o do cadastro, senao o da
  // ultima venda igual. Roda de novo ao voltar para "com frete".
  const withFreight = hasFreightValue(freight);
  useEffect(() => {
    if (!customerId || !productId || !freightRules.data) return;
    const pairKey = `${customerId}|${productId}`;
    const isNewPair = lastFreightPullRef.current !== pairKey;
    if (!isNewPair && !withFreight) return;
    lastFreightPullRef.current = pairKey;
    const rule = resolveCustomerFreight(freightRules.data, customerId, productId);
    if (!rule) return;
    setFreight((prev) => ({
      ...applyFreightInvoiceChoice(applyFreightGroup(prev, "with_freight"), rule.showOnReceipt),
      freightCalculationType: rule.calculationType,
      freightBaseValueCents: rule.baseValueCents,
      freightFixedValueCents: rule.fixedValueCents,
      freightDistanceKm: rule.distanceKm ? String(rule.distanceKm) : prev.freightDistanceKm,
      freightDestination: rule.destination ?? prev.freightDestination
    }));
  }, [customerId, productId, freightRules.data, withFreight]);

  if (!user.canOperate) {
    return (
      <DeskPanel>
        <EmptyState
          title="Seu acesso nao registra pesagens"
          hint="Nova entrada e para os perfis Operacao e Gestor."
        />
      </DeskPanel>
    );
  }

  /**
   * O cliente traz o arranjo dele: nota ou nao pelo cadastro, tipo de frete padrao, e — o que
   * mais vale — a transportadora, forma e condicao da ULTIMA entrada dele. O padrao do cadastro
   * so entra quando o cliente ainda nao tem entrada nenhuma (mesma regra do desktop).
   */
  function chooseCustomer(id: string) {
    setCustomerId(id);
    lastFreightPullRef.current = "";
    const preset = catalog.data?.customerDefaults.get(id);
    setCarrierId(preset?.carrierId ?? "");
    if (preset?.paymentMethodId) setPaymentMethodId(preset.paymentMethodId);
    setConditionText("");
    if (preset?.nfRequired === false) setOperationType("internal");
    if (preset?.nfRequired === true) setOperationType("invoice");
    const modality = customerDefaultModality(preset?.freightModality);
    setFreight(
      modality ? { ...INITIAL_ENTRY_FREIGHT, freightModality: modality } : INITIAL_ENTRY_FREIGHT
    );
    if (!id) return;
    const defaultTermId = preset?.paymentTermId ?? "";
    void q
      .lastCustomerOperations(user.companyId, id)
      .catch(() => [])
      .then((recent) => {
        const last = recent[0];
        if (last) {
          if (last.carrier_id) setCarrierId(last.carrier_id);
          if (last.payment_method_id) setPaymentMethodId(last.payment_method_id);
        }
        const termId = last?.payment_term_id ?? defaultTermId;
        const term = terms.find((row) => row.id === termId);
        if (term) setConditionText(conditionTextOf(term.rules_json, term.name));
        // A observacao ("Destino/obs.") da ultima entrada volta, so no campo vazio.
        const note = recent
          .map((operation) => readDestination(operation.freight_json))
          .find(Boolean);
        if (note) {
          setFreight((prev) =>
            prev.freightDestination.trim() ? prev : { ...prev, freightDestination: note }
          );
        }
      });
  }

  function reset() {
    setCustomerId("");
    setProductId("");
    setPaymentMethodId("");
    setConditionText("");
    setCarrierId("");
    setVehicleId("");
    setDriverId("");
    setOperationType("invoice");
    setFreight(INITIAL_ENTRY_FREIGHT);
    lastFreightPullRef.current = "";
    setWeight("");
    setError(null);
  }

  const entryWeightKg = parseWeight(weight);
  const carrierRequired = isCarrierRequired(freight.freightModality);
  const freightToInvoice = freightGoesToCustomerInvoice(freight, paymentMethodIsCredit);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!vehicleId) return setError("Selecione a placa.");
    if (!customerId) return setError("Selecione o cliente.");
    if (!driverId) return setError("Selecione o motorista.");
    if (!productId) return setError("Selecione o produto.");
    if (carrierRequired && !carrierId) return setError("Selecione a transportadora.");
    const freightError = validateEntryFreight(freight, conditionText);
    if (freightError) return setError(freightError);
    if (entryWeightKg === null) return setError("Digite o peso de entrada em kg.");
    setBusy(true);
    const ok = await sendRequest(toast, "entry", {
      data: {
        customerId,
        vehicleId,
        driverId,
        productId,
        carrierId: carrierId || undefined,
        paymentMethodId: paymentMethodId || undefined,
        conditionText: conditionText.trim() || undefined,
        operationType,
        entryWeightKg,
        ...entryFreightPayload({
          ...freight,
          deductFreightFromCredit: freight.deductFreightFromCredit || freightToInvoice
        })
      }
    });
    setBusy(false);
    if (ok) {
      reset();
      navigate("/operacoes");
    }
  }

  const options = catalog.data;
  const modalityInfo = getFreightModalityInfo(freight.freightModality);
  const invoiceChoice = freightInvoiceChoice(freight.freightModality);
  const conditionPreview = describePaymentCondition(conditionText);

  return (
    <form
      className="entry-shell"
      onSubmit={(event) => void submit(event)}
      onKeyDown={submitOnCtrlEnter}
    >
      <div className="entry-hero">
        <div className="entry-hero-text">
          <p className="desk-kicker">Operacao de balanca</p>
          <h1>Nova entrada</h1>
          <p>Use Tab para avancar e Ctrl+Enter para registrar.</p>
        </div>
        <WeightCard
          value={weight}
          onChange={setWeight}
          ready={entryWeightKg !== null}
          executor={executor}
        />
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {catalog.error && <Alert kind="error">{catalog.error}</Alert>}

      <div className="entry-grid">
        <article className="entry-card">
          <CardHead
            icon={<img src="./midia/commerce.png" alt="" />}
            title="Dados comerciais"
            description="Cliente, produto e pagamento"
          />
          <Field label="Cliente">
            <Picker
              loading={!options}
              value={customerId}
              options={options?.customers ?? []}
              onChange={chooseCustomer}
              placeholder="Buscar cliente..."
              autoFocus
            />
          </Field>
          <Field label="Produto">
            <Picker
              loading={!options}
              value={productId}
              options={options?.products ?? []}
              onChange={setProductId}
              placeholder="Buscar produto..."
            />
          </Field>
          <Field label="Forma de pagamento">
            <Picker
              loading={!options}
              value={paymentMethodId}
              options={options?.paymentMethods ?? []}
              onChange={setPaymentMethodId}
              placeholder="Buscar forma de pagamento..."
              allowEmpty
              emptyLabel="Padrao do cliente"
            />
          </Field>
          {selectedMethod?.is_wallet && (
            <p className="helper">
              Venda em carteira: a nota sai sem cobranca e a venda fica na tela Carteira ate o
              fechamento, onde voce define como o cliente vai pagar.
            </p>
          )}
          <Field
            label="Condicao de pagamento"
            hint="Se a condicao nao existir no OMIE, ela e criada automaticamente no envio."
          >
            <input
              className="input"
              value={conditionText}
              placeholder='Ex.: "30", "7 14 21", "3 parcelas" ou "s+20"'
              onChange={(event) => setConditionText(event.target.value)}
            />
          </Field>
          <div className="condition-legend">
            <p className={`condition-preview is-${conditionPreview.status}`}>
              {conditionPreview.message}
            </p>
            <details>
              <summary>Como escrever</summary>
              <table>
                <tbody>
                  {PAYMENT_CONDITION_FORMATS.map((format) => (
                    <tr key={format.example}>
                      <td>
                        <code>{format.example}</code>
                      </td>
                      <td>{format.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        </article>

        <article className="entry-card">
          <CardHead
            icon={<img src="./midia/truck.png" alt="" />}
            title="Transporte"
            description="Transportadora, placa e motorista"
          />
          <div className="choice-box">
            <span>Tipo de frete</span>
            <div className="choice-row">
              <button
                type="button"
                aria-pressed={withFreight}
                className={`choice${withFreight ? " active" : ""}`}
                onClick={() => setFreight((prev) => applyFreightGroup(prev, "with_freight"))}
              >
                Com frete
              </button>
              <button
                type="button"
                aria-pressed={!withFreight}
                className={`choice${!withFreight ? " active" : ""}`}
                onClick={() => setFreight((prev) => applyFreightGroup(prev, "without_freight"))}
              >
                Sem frete
              </button>
            </div>
            <span className="helper" style={{ margin: 0, fontWeight: 400 }}>
              {modalityInfo.description}
            </span>
            <label className="check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={invoiceChoice.checked}
                onChange={(event) =>
                  setFreight((prev) => applyFreightInvoiceChoice(prev, event.target.checked))
                }
              />
              {invoiceChoice.label}
            </label>
            {withFreight && (
              <div className="freight-grid">
                <Field label="Calculo">
                  <select
                    className="select"
                    value={freight.freightCalculationType}
                    onChange={(event) =>
                      setFreight((prev) => ({
                        ...prev,
                        freightCalculationType: event.target.value as FreightCalculationType
                      }))
                    }
                  >
                    <option value="per_ton">Por tonelada</option>
                    <option value="per_ton_km">Tonelada-km</option>
                    <option value="fixed_plus_ton">Fixo + tonelada</option>
                  </select>
                </Field>
                <MoneyField
                  label={
                    freight.freightCalculationType === "per_ton_km"
                      ? "Frete por ton-km"
                      : "Frete por tonelada"
                  }
                  cents={freight.freightBaseValueCents}
                  onChange={(cents) =>
                    setFreight((prev) => ({ ...prev, freightBaseValueCents: cents }))
                  }
                />
                {freight.freightCalculationType === "fixed_plus_ton" && (
                  <MoneyField
                    label="Valor fixo do frete"
                    cents={freight.freightFixedValueCents}
                    onChange={(cents) =>
                      setFreight((prev) => ({ ...prev, freightFixedValueCents: cents }))
                    }
                  />
                )}
                {freight.freightCalculationType === "per_ton_km" && (
                  <Field label="Distancia km">
                    <input
                      className="input"
                      inputMode="decimal"
                      value={freight.freightDistanceKm}
                      placeholder="Ex: 35"
                      onChange={(event) =>
                        setFreight((prev) => ({ ...prev, freightDistanceKm: event.target.value }))
                      }
                    />
                  </Field>
                )}
                <Field
                  label="Destino/obs."
                  hint="Sai impressa no cupom e volta preenchida na proxima entrada deste cliente."
                >
                  <input
                    className="input"
                    value={freight.freightDestination}
                    placeholder="Ex: entregar na obra do centro"
                    onChange={(event) =>
                      setFreight((prev) => ({ ...prev, freightDestination: event.target.value }))
                    }
                  />
                </Field>
                <label className="check" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={freight.deductFreightFromCredit || freightToInvoice}
                    disabled={freightToInvoice}
                    onChange={(event) =>
                      setFreight((prev) => ({
                        ...prev,
                        deductFreightFromCredit: event.target.checked
                      }))
                    }
                  />
                  Abater frete do credito do cliente
                </label>
                {freightToInvoice && (
                  <p className="helper" style={{ margin: 0 }}>
                    Frete pago pela Pedreira e forma de pagamento no credito do cliente: o frete
                    entra automaticamente na fatura.
                  </p>
                )}
              </div>
            )}
          </div>
          <Field label="Transportadora">
            <Picker
              loading={!options}
              value={carrierId}
              options={options?.carriers ?? []}
              onChange={setCarrierId}
              placeholder="Buscar transportadora..."
              allowEmpty
              emptyLabel="Sem transportadora"
            />
          </Field>
          {!carrierRequired && (
            <p className="helper">
              Transportadora opcional: o tipo de frete escolhido nao leva transportador na nota.
            </p>
          )}
          <div className="entry-inline">
            <Field label="Placa">
              <Picker
                loading={!options}
                value={vehicleId}
                options={options?.vehicles ?? []}
                onChange={setVehicleId}
                placeholder="Buscar placa..."
              />
            </Field>
            <Field label="Motorista">
              <Picker
                loading={!options}
                value={driverId}
                options={options?.drivers ?? []}
                onChange={setDriverId}
                placeholder="Buscar motorista..."
              />
            </Field>
          </div>
        </article>

        <aside className="entry-card summary">
          <CardHead
            icon={<BadgeDollarSign size={18} strokeWidth={2.4} />}
            title="Resumo da entrada"
            description="Preco, frete e captura"
          />
          <PriceSummary
            price={price}
            weightKg={entryWeightKg}
            operationType={operationType}
            freight={freight}
            ready={Boolean(customerId && productId)}
          />
          <div className="entry-actions">
            <button type="submit" className="capture-btn" disabled={busy}>
              <Scale size={18} strokeWidth={2.4} />
              {busy ? "Enviando..." : "Registrar entrada"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                reset();
                navigate("/operacoes");
              }}
            >
              Limpar e voltar
            </button>
          </div>
        </aside>
      </div>
    </form>
  );
}

/** O destino/observacao gravado no frete de uma pesagem (`freight_json.destination`). */
function readDestination(freightJson: string | null): string | null {
  if (!freightJson) return null;
  try {
    const parsed = JSON.parse(freightJson) as { destination?: unknown };
    return typeof parsed.destination === "string" && parsed.destination.trim()
      ? parsed.destination.trim()
      : null;
  } catch {
    return null;
  }
}

function CardHead({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="card-section-head">
      <span className="card-section-icon">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

/** Campo de dinheiro em reais ("15,00"), guardado em centavos. Vazio = sem valor. */
function MoneyField({
  label,
  cents,
  onChange
}: {
  label: string;
  cents: number | null;
  onChange: (cents: number | null) => void;
}) {
  const [text, setText] = useState(
    cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",")
  );
  // Valor que chega de fora (frete puxado do cliente) substitui o texto.
  const lastCents = useRef(cents);
  useEffect(() => {
    if (cents !== lastCents.current) {
      lastCents.current = cents;
      setText(cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));
    }
  }, [cents]);
  return (
    <Field label={label}>
      <input
        className="input"
        inputMode="decimal"
        value={text}
        placeholder="0,00"
        onChange={(event) => {
          setText(event.target.value);
          const parsed = event.target.value.trim() ? parseMoneyToCents(event.target.value) : null;
          lastCents.current = parsed;
          onChange(parsed);
        }}
      />
    </Field>
  );
}

/**
 * O cartao "Peso" da faixa escura. No desktop ele mostra a leitura da balanca; aqui e o campo
 * onde o peso e digitado, e a bolinha diz se a balanca que vai registrar esta conectada.
 */
function WeightCard({
  value,
  onChange,
  ready,
  executor
}: {
  value: string;
  onChange: (value: string) => void;
  ready: boolean;
  executor: ExecutorStatus | null;
}) {
  const dot = !executor ? "wait" : executor.executor?.online ? "on" : "";
  return (
    <div className={`weight-card${ready ? " ready" : ""}`}>
      <div className="weight-card-head">
        <img src="./midia/peso.png" alt="" />
        <span>Peso de entrada</span>
        <i className={`weight-dot ${dot}`} aria-hidden="true" />
      </div>
      <label className="weight-card-value">
        <input
          inputMode="numeric"
          value={value}
          placeholder="--"
          aria-label="Peso de entrada em kg"
          onChange={(event) => onChange(event.target.value)}
        />
        <b>kg</b>
      </label>
      <small>
        <ExecutorText status={executor} />
      </small>
    </div>
  );
}

function ExecutorText({ status }: { status: ExecutorStatus | null }) {
  if (!status) return <>Verificando a balanca...</>;
  if (!status.executor) return <>Nenhuma balanca executa os pedidos do site.</>;
  const { name, online, needsUpdate, appVersion, minVersion } = status.executor;
  if (needsUpdate) {
    return (
      <>
        Balanca {name} {online ? "" : "fora do ar e "}desatualizada
        {appVersion ? ` (versao ${appVersion})` : ""}: atualize para {minVersion ?? "a mais nova"}{" "}
        para registrar entradas pelo site.
      </>
    );
  }
  return online ? (
    <>Balanca {status.executor.name} conectada: ela registra a entrada.</>
  ) : (
    <>Balanca {status.executor.name} fora do ar: o pedido espera ela voltar.</>
  );
}

function PriceSummary({
  price,
  weightKg,
  operationType,
  freight,
  ready
}: {
  price: { cents: number | null; source: string } | null;
  weightKg: number | null;
  operationType: "invoice" | "internal";
  freight: EntryFreightForm;
  ready: boolean;
}) {
  if (!ready || !price) {
    return <div className="price-box">Selecione cliente e produto para ver o preco.</div>;
  }
  const info = getFreightModalityInfo(freight.freightModality);
  const freightText = !info.supportsCharge
    ? info.label
    : freight.freightBaseValueCents === null && freight.freightFixedValueCents === null
      ? "Com frete (sem valor)"
      : `${formatMoney(freight.freightBaseValueCents ?? 0)}${
          freight.freightCalculationType === "per_ton_km" ? "/ton-km" : "/ton"
        }${
          freight.freightCalculationType === "fixed_plus_ton" && freight.freightFixedValueCents
            ? ` + ${formatMoney(freight.freightFixedValueCents)}`
            : ""
        }`;
  return (
    <div className="price-box filled">
      <dl>
        <dt>Preco por tonelada</dt>
        <dd>{price.cents === null ? "Sem preco" : `${formatMoney(price.cents)}/ton`}</dd>
        <dt>Origem</dt>
        <dd>{price.source}</dd>
        <dt>Frete</dt>
        <dd>{freightText}</dd>
        <dt>Peso de entrada</dt>
        <dd>{weightKg === null ? "—" : `${weightKg.toLocaleString("pt-BR")} kg`}</dd>
        <dt>Operacao</dt>
        <dd>{operationType === "invoice" ? "Com nota (venda)" : "Sem nota (interna)"}</dd>
      </dl>
      <p className="helper" style={{ margin: "8px 0 0" }}>
        Tabela de preco, frete e credito a balanca confere ao registrar.
      </p>
    </div>
  );
}
