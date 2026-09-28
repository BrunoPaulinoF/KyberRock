import "./truck-stages.css";

import { ArrowRight, Clock, LogIn, LogOut, PackageCheck, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUser } from "../lib/auth";
import { formatPlate, todayIso } from "../lib/format";
import { OPEN_STATUS } from "../lib/operation";
import { supabase } from "../lib/supabase";
import {
  STAGE_HINTS,
  STAGE_LABELS,
  TRUCK_STAGES,
  averageStageDurations,
  formatDuration,
  groupByStage,
  stageDurations,
  stageOf,
  timeInCurrentStage,
  type StageTruck,
  type TruckStage
} from "../lib/truck-stages";
import { CountBadge, PlateBadge } from "./desk";
import { Alert, Modal } from "./ui";

/*
 * Etapas do caminhao na pedreira (ENTRADA -> CARREGANDO -> SAIDA), em tempo real. A conta vive
 * em `lib/truck-stages.ts`; aqui e a leitura e o desenho.
 *
 * Carga no banco (o projeto ja estourou cota): quem avisa que algo mudou e o Realtime —
 * `operation_change_pings` (a balanca gravou pesagem) e `loading_requests` da unidade (o
 * carregador marcou Iniciar/Concluir) —, e o aviso so faz a tela reler, com folga de 1,5 s para
 * varios avisos virarem uma leitura. A releitura periodica e a rede de seguranca (30 s sem o
 * aviso, 90 s com ele) e para com a aba escondida — a mesma disciplina da tela Monitoramento.
 */

const OPERATION_COLUMNS =
  "id, plate, customer_name, product_description, driver_name, created_at, closed_at";
const CLOSED_STATUSES = ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"];
const REALTIME_DEBOUNCE_MS = 1_500;
const POLL_FALLBACK_MS = 30_000;
const POLL_WITH_REALTIME_MS = 90_000;
const CLOCK_MS = 15_000;
/** Ids por consulta de `loading_requests` (o `in(...)` vai na URL). */
const ID_CHUNK = 150;

type OperationRow = {
  id: string;
  plate: string | null;
  customer_name: string | null;
  product_description: string | null;
  driver_name: string | null;
  created_at: string;
  closed_at: string | null;
};

type LoaderMarks = { loader_started_at: string | null; loader_completed_at: string | null };

async function loadLoaderMarks(
  companyId: string,
  operationIds: string[]
): Promise<Map<string, LoaderMarks>> {
  const marks = new Map<string, LoaderMarks>();
  for (let index = 0; index < operationIds.length; index += ID_CHUNK) {
    const { data, error } = await supabase
      .from("loading_requests")
      .select("operation_id, loader_started_at, loader_completed_at")
      .eq("company_id", companyId)
      .in("operation_id", operationIds.slice(index, index + ID_CHUNK));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) marks.set(row.operation_id, row);
  }
  return marks;
}

function toTruck(row: OperationRow, marks: LoaderMarks | undefined, exited: boolean): StageTruck {
  return {
    operationId: row.id,
    plate: row.plate ?? "",
    customerName: row.customer_name || "Cliente nao informado",
    productDescription: row.product_description || "Produto nao informado",
    driverName: row.driver_name || "",
    entryAt: row.created_at,
    loadStartedAt: marks?.loader_started_at ?? null,
    loadedAt: marks?.loader_completed_at ?? null,
    exitAt: exited ? (row.closed_at ?? null) : null
  };
}

/** Quem esta na pedreira agora e quem ja saiu hoje, com os carimbos do carregador. */
async function loadStages(
  companyId: string,
  unitId: string
): Promise<{ inside: StageTruck[]; finished: StageTruck[] }> {
  const startOfDay = `${todayIso()}T00:00:00-03:00`;
  const [open, closed] = await Promise.all([
    supabase
      .from("weighing_operations")
      .select(OPERATION_COLUMNS)
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .eq("status", OPEN_STATUS)
      .order("created_at", { ascending: true })
      .limit(300),
    supabase
      .from("weighing_operations")
      .select(OPERATION_COLUMNS)
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .in("status", CLOSED_STATUSES)
      .gte("closed_at", startOfDay)
      .order("closed_at", { ascending: false })
      .limit(300)
  ]);
  if (open.error) throw new Error(open.error.message);
  if (closed.error) throw new Error(closed.error.message);
  const openRows = (open.data ?? []) as OperationRow[];
  const closedRows = (closed.data ?? []) as OperationRow[];
  const marks = await loadLoaderMarks(companyId, [
    ...openRows.map((row) => row.id),
    ...closedRows.map((row) => row.id)
  ]);
  return {
    inside: openRows.map((row) => toTruck(row, marks.get(row.id), false)),
    finished: closedRows.map((row) => toTruck(row, marks.get(row.id), true))
  };
}

function clock(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo"
  });
}

const STAGE_ICONS: Record<TruckStage, typeof Truck> = {
  entrada: LogIn,
  carregando: Truck,
  saida: PackageCheck
};

type RealtimeState = "connecting" | "live" | "down";

export function TruckStages() {
  const user = useUser();
  const [inside, setInside] = useState<StageTruck[]>([]);
  const [finished, setFinished] = useState<StageTruck[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<RealtimeState>("connecting");
  const [now, setNow] = useState(() => Date.now());
  const [detail, setDetail] = useState<StageTruck | null>(null);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const debounce = useRef<number | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const result = await loadStages(user.companyId, user.unitId);
      if (!mounted.current) return;
      setInside(result.inside);
      setFinished(result.finished);
      setNow(Date.now());
      setError(null);
    } catch {
      if (mounted.current) {
        setError("Nao foi possivel atualizar os caminhoes. Confira a internet; tentamos de novo.");
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoaded(true);
      if (mounted.current && queued.current) {
        queued.current = false;
        void load();
      }
    }
  }, [user.companyId, user.unitId]);

  const schedule = useCallback(() => {
    if (debounce.current !== null) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      debounce.current = null;
      void load();
    }, REALTIME_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      if (debounce.current !== null) window.clearTimeout(debounce.current);
    };
  }, [load]);

  // Aviso em tempo real: pesagem gravada pela balanca ou marca do carregador -> rele.
  useEffect(() => {
    let subscribedBefore = false;
    setRealtime("connecting");
    const channel = supabase
      .channel(`truck-stages:${user.companyId}:${user.unitId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "operation_change_pings",
          filter: `company_id=eq.${user.companyId}`
        },
        schedule
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loading_requests",
          filter: `unit_id=eq.${user.unitId}`
        },
        schedule
      )
      .subscribe((status) => {
        if (!mounted.current) return;
        if (status === "SUBSCRIBED") {
          setRealtime("live");
          // O que mudou enquanto a inscricao esteve fora do ar nao volta sozinho.
          if (subscribedBefore) schedule();
          subscribedBefore = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtime("down");
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user.companyId, user.unitId, schedule]);

  // Rede de seguranca e relogio, so com a aba visivel.
  const pollMs = realtime === "live" ? POLL_WITH_REALTIME_MS : POLL_FALLBACK_MS;
  useEffect(() => {
    let poll: number | null = null;
    let tick: number | null = null;
    const start = () => {
      if (poll === null) poll = window.setInterval(() => void load(), pollMs);
      if (tick === null) tick = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    };
    const stop = () => {
      if (poll !== null) window.clearInterval(poll);
      if (tick !== null) window.clearInterval(tick);
      poll = null;
      tick = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      setNow(Date.now());
      start();
      schedule();
    };
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, pollMs, schedule]);

  const groups = useMemo(() => groupByStage(inside, now), [inside, now]);
  const averages = useMemo(() => averageStageDurations(finished, now), [finished, now]);
  const noLoaderMarks =
    inside.length + finished.length > 0 &&
    [...inside, ...finished].every((truck) => !truck.loadStartedAt && !truck.loadedAt);

  return (
    <section className="truck-stages" aria-labelledby="truck-stages-title">
      <header className="ts-head">
        <div>
          <h2 id="truck-stages-title" className="ts-title">
            Caminhoes na pedreira
          </h2>
          <p className="ts-subtitle">
            {inside.length === 1 ? "1 caminhao agora" : `${inside.length} caminhoes agora`} ·{" "}
            {finished.length === 1 ? "1 saiu hoje" : `${finished.length} sairam hoje`}
            {averages.total !== null &&
              ` · tempo medio na pedreira ${formatDuration(averages.total)}`}
          </p>
        </div>
        <span className={`ts-live ${realtime}`} role="status">
          <span aria-hidden="true" />
          {realtime === "live"
            ? "Ao vivo"
            : realtime === "connecting"
              ? "Conectando"
              : "Atualizando a cada 30 s"}
        </span>
      </header>

      {error && <Alert kind="warn">{error}</Alert>}

      <ol className="ts-flow" aria-label="Etapas do caminhao">
        {TRUCK_STAGES.map((stage, index) => {
          const Icon = STAGE_ICONS[stage];
          const count = groups[stage].length;
          return (
            <li key={stage} className={`ts-step ts-${stage}`} title={STAGE_HINTS[stage]}>
              <span className="ts-arrow" aria-hidden="true" />
              <span className="ts-pin" aria-hidden="true" />
              <span className="ts-step-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span className="ts-step-name">
                {index + 1}. {STAGE_LABELS[stage]}
              </span>
              <strong className="ts-count">{count}</strong>
              <span className="ts-count-label">{count === 1 ? "caminhao" : "caminhoes"}</span>
              <span className="ts-avg">
                <Clock size={13} aria-hidden="true" /> Media hoje:{" "}
                <strong>{formatDuration(averages[stage])}</strong>
              </span>
              <span className="ts-hint">{STAGE_HINTS[stage]}</span>
            </li>
          );
        })}
      </ol>

      {noLoaderMarks && (
        <p className="ts-note">
          O carregador ainda nao marcou "Iniciar" e "Concluir" na tela de carregamento: sem essas
          marcas, todo o tempo do caminhao fica na etapa Entrada.
        </p>
      )}

      <div className="ts-columns">
        {TRUCK_STAGES.map((stage) => (
          <div key={stage} className={`ts-column ts-${stage}`}>
            <div className="ts-column-head">
              <span className="ts-swatch" aria-hidden="true" />
              <strong>{STAGE_LABELS[stage]}</strong>
              <CountBadge>{groups[stage].length}</CountBadge>
            </div>
            <ul className="ts-list" aria-label={`Caminhoes na etapa ${STAGE_LABELS[stage]}`}>
              {groups[stage].length === 0 && (
                <li className="ts-empty">
                  {loaded ? "Nenhum caminhao nesta etapa." : "Carregando..."}
                </li>
              )}
              {groups[stage].map((truck) => (
                <li key={truck.operationId}>
                  <button
                    type="button"
                    className="ts-item"
                    onClick={() => setDetail(truck)}
                    title="Ver o tempo em cada etapa"
                  >
                    <PlateBadge plate={formatPlate(truck.plate)} />
                    <span className="ts-item-text">
                      <strong>{truck.customerName}</strong>
                      <span>{truck.productDescription}</span>
                    </span>
                    <span className="ts-item-time">
                      <strong>{formatDuration(timeInCurrentStage(truck, now))}</strong>
                      <span>entrou {clock(truck.entryAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="ts-finished">
        <div className="ts-column-head">
          <LogOut size={16} aria-hidden="true" />
          <strong>Sairam hoje</strong>
          <CountBadge>{finished.length}</CountBadge>
          <span className="ts-finished-hint">Tempo de cada caminhao em cada etapa</span>
        </div>
        {finished.length === 0 ? (
          <p className="ts-empty">
            {loaded ? "Nenhum caminhao saiu hoje ainda." : "Carregando..."}
          </p>
        ) : (
          <div className="ts-finished-scroll">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Placa</th>
                  <th>Cliente / Produto</th>
                  <th className="num">Entrada</th>
                  <th className="num">Carregando</th>
                  <th className="num">Saida</th>
                  <th className="num">Total</th>
                  <th className="num">Saiu</th>
                </tr>
              </thead>
              <tbody>
                {finished.map((truck) => {
                  const durations = stageDurations(truck, now);
                  return (
                    <tr key={truck.operationId} onClick={() => setDetail(truck)}>
                      <td>
                        <PlateBadge plate={formatPlate(truck.plate)} />
                      </td>
                      <td>
                        <strong>{truck.customerName}</strong>
                        <span className="cell-sub">{truck.productDescription}</span>
                      </td>
                      <td className="num">{formatDuration(durations.entrada)}</td>
                      <td className="num">{formatDuration(durations.carregando)}</td>
                      <td className="num">{formatDuration(durations.saida)}</td>
                      <td className="num">
                        <strong>{formatDuration(durations.total)}</strong>
                      </td>
                      <td className="num">{clock(truck.exitAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && <TruckTimeline truck={detail} now={now} onClose={() => setDetail(null)} />}
    </section>
  );
}

/** O caminho de um caminhao: a hora de cada marca e quanto tempo ficou em cada etapa. */
function TruckTimeline({
  truck,
  now,
  onClose
}: {
  truck: StageTruck;
  now: number;
  onClose: () => void;
}) {
  const durations = stageDurations(truck, now);
  const current = truck.exitAt ? null : stageOf(truck);
  const steps: Array<{ stage: TruckStage; startedAt: string | null; label: string }> = [
    { stage: "entrada", startedAt: truck.entryAt, label: "Pesou a entrada" },
    { stage: "carregando", startedAt: truck.loadStartedAt, label: "Carregador iniciou" },
    { stage: "saida", startedAt: truck.loadedAt, label: "Carregador concluiu" }
  ];
  return (
    <Modal
      title={`${formatPlate(truck.plate)} — ${truck.customerName}`}
      description={`${truck.productDescription}${truck.driverName ? ` · Motorista: ${truck.driverName}` : ""}`}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <ol className="ts-timeline">
        {steps.map(({ stage, startedAt, label }) => (
          <li
            key={stage}
            className={`ts-timeline-step ts-${stage}${current === stage ? " current" : ""}`}
          >
            <span className="ts-swatch" aria-hidden="true" />
            <div>
              <strong>{STAGE_LABELS[stage]}</strong>
              <span>
                {label}: {clock(startedAt)}
              </span>
            </div>
            <span className="ts-timeline-duration">
              {formatDuration(durations[stage])}
              {current === stage && <small>ate agora</small>}
            </span>
          </li>
        ))}
        <li className="ts-timeline-step ts-exit">
          <span className="ts-swatch" aria-hidden="true">
            <ArrowRight size={12} />
          </span>
          <div>
            <strong>Saiu da pedreira</strong>
            <span>Pesou a saida: {truck.exitAt ? clock(truck.exitAt) : "ainda nao"}</span>
          </div>
          <span className="ts-timeline-duration total">
            {formatDuration(durations.total)}
            <small>no total</small>
          </span>
        </li>
      </ol>
      <p className="ts-note">
        Etapa sem marca do carregador aparece como "—": o tempo dela ficou somado na etapa anterior.
      </p>
    </Modal>
  );
}
