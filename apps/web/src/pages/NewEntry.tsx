import { BadgeDollarSign, Scale } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { DeskPanel, EmptyState } from "../components/desk";
import { Picker } from "../components/Picker";
import { Alert, Field, useToast } from "../components/ui";
import { useUser } from "../lib/auth";
import { formatMoney } from "../lib/format";
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
 * colunas (Dados comerciais, Transporte, Resumo da entrada). A diferenca e a de sempre do
 * site: o peso e DIGITADO (como na balanca virtual) e "Registrar entrada" vira um pedido que a
 * balanca executora registra com as mesmas regras do botao "Capturar peso".
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
  const [paymentTermId, setPaymentTermId] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [operationType, setOperationType] = useState<"invoice" | "internal">("invoice");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaults = useAsync(() => q.productDefaultPrices(user.companyId), [user.companyId]);
  const special = useAsync(
    () => (customerId ? q.customerSpecialPrices(user.companyId, customerId) : Promise.resolve([])),
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

  // O cliente traz os padroes dele (forma, condicao, transportadora e se pede nota).
  function chooseCustomer(id: string) {
    setCustomerId(id);
    const preset = catalog.data?.customerDefaults.get(id);
    setCarrierId(preset?.carrierId ?? "");
    if (!preset) return;
    if (preset.paymentMethodId) setPaymentMethodId(preset.paymentMethodId);
    setPaymentTermId(preset.paymentTermId);
    if (preset.nfRequired === false) setOperationType("internal");
    if (preset.nfRequired === true) setOperationType("invoice");
  }

  function reset() {
    setCustomerId("");
    setProductId("");
    setPaymentMethodId("");
    setPaymentTermId("");
    setCarrierId("");
    setVehicleId("");
    setDriverId("");
    setOperationType("invoice");
    setWeight("");
    setError(null);
  }

  const entryWeightKg = parseWeight(weight);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!customerId) return setError("Escolha o cliente.");
    if (!productId) return setError("Escolha o produto.");
    if (!vehicleId) return setError("Escolha a placa.");
    if (!driverId) return setError("Escolha o motorista.");
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
        paymentTermId: paymentTermId || undefined,
        operationType,
        entryWeightKg
      }
    });
    setBusy(false);
    if (ok) {
      reset();
      navigate("/operacoes");
    }
  }

  const options = catalog.data;

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
              value={customerId}
              options={options?.customers ?? []}
              onChange={chooseCustomer}
              placeholder="Buscar cliente..."
              autoFocus
            />
          </Field>
          <Field label="Produto">
            <Picker
              value={productId}
              options={options?.products ?? []}
              onChange={setProductId}
              placeholder="Buscar produto..."
            />
          </Field>
          <Field label="Forma de pagamento">
            <Picker
              value={paymentMethodId}
              options={options?.paymentMethods ?? []}
              onChange={setPaymentMethodId}
              placeholder="Buscar forma de pagamento..."
              allowEmpty
              emptyLabel="Padrao do cliente"
            />
          </Field>
          <Field label="Condicao de pagamento">
            <Picker
              value={paymentTermId}
              options={options?.paymentTerms ?? []}
              onChange={setPaymentTermId}
              placeholder="Buscar condicao..."
              allowEmpty
              emptyLabel="A vista"
            />
          </Field>
          <p className="helper">Vazio = a vista (vencimento no dia da venda).</p>
        </article>

        <article className="entry-card">
          <CardHead
            icon={<img src="./midia/truck.png" alt="" />}
            title="Transporte"
            description="Transportadora, placa e motorista"
          />
          <div className="choice-box">
            <span>Nota fiscal</span>
            <div className="choice-row">
              <button
                type="button"
                className={`choice${operationType === "invoice" ? " active" : ""}`}
                onClick={() => setOperationType("invoice")}
              >
                Com nota
              </button>
              <button
                type="button"
                className={`choice${operationType === "internal" ? " active" : ""}`}
                onClick={() => setOperationType("internal")}
              >
                Sem nota
              </button>
            </div>
            <span className="helper" style={{ margin: 0, fontWeight: 400 }}>
              Vem do cadastro do cliente; da para trocar tambem no fechamento.
            </span>
          </div>
          <Field label="Transportadora">
            <Picker
              value={carrierId}
              options={options?.carriers ?? []}
              onChange={setCarrierId}
              placeholder="Buscar transportadora..."
              allowEmpty
              emptyLabel="Sem transportadora"
            />
          </Field>
          <div className="entry-inline">
            <Field label="Placa">
              <Picker
                value={vehicleId}
                options={options?.vehicles ?? []}
                onChange={setVehicleId}
                placeholder="Buscar placa..."
              />
            </Field>
            <Field label="Motorista">
              <Picker
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
            description="Preco, peso e envio para a balanca"
          />
          <PriceSummary
            price={price}
            weightKg={entryWeightKg}
            operationType={operationType}
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
  return status.executor.online ? (
    <>Balanca {status.executor.name} conectada: ela registra a entrada.</>
  ) : (
    <>Balanca {status.executor.name} fora do ar: o pedido espera ela voltar.</>
  );
}

function PriceSummary({
  price,
  weightKg,
  operationType,
  ready
}: {
  price: { cents: number | null; source: string } | null;
  weightKg: number | null;
  operationType: "invoice" | "internal";
  ready: boolean;
}) {
  if (!ready || !price) {
    return <div className="price-box">Selecione cliente e produto para ver o preco.</div>;
  }
  return (
    <div className="price-box filled">
      <dl>
        <dt>Preco por tonelada</dt>
        <dd>{price.cents === null ? "Sem preco" : `${formatMoney(price.cents)}/ton`}</dd>
        <dt>Origem</dt>
        <dd>{price.source}</dd>
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
