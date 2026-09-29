import "./truck-stages.css";

import { ArrowRight, Ban, Clock, LogIn, LogOut, PackageCheck, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUser } from "../lib/auth";
import { formatPlate, todayIso } from "../lib/format";
import { OPEN_STATUS } from "../lib/operation";
import { supabase } from "../lib/supabase";
import {
  BOARD_COLUMNS,
  ENTRY_WINDOW_MINUTES,
  STAGE_HINTS,
  STAGE_LABELS,
  TRUCK_STAGES,
  averageDurations,
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
 * Etapas do caminhao na pedreira (ENTRADA -> CARREGANDO -> SAIDA), em tempo real, a partir da
 * pesagem que a BALANCA grava (a regra vive em `lib/truck-stages.ts`); aqui e a leitura e o
 * desenho.
 *
 * Carga no banco (o projeto ja estourou cota): quem avisa que algo mudou e o Realtime de
 * `operation_change_pings` (a balanca gravou pesagem), e o aviso so faz a tela reler, com folga
 * de 1,5 s para varios avisos virarem uma leitura. A releitura periodica e a rede de seguranca
 * (30 s sem o aviso, 90 s com ele) e para com a aba escondida — a mesma disciplina da tela
 * Monitoramento. O relogio de 15 s e o que passa o caminhao da ENTRADA para o CARREGANDO.
 */

const OPERATION_COLUMNS =
  "id, plate, customer_name, product_description, driver_name, created_at, closed_at, updated_at, cancel_reason";
const CLOSED_STATUSES = ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"];
const REALTIME_DEBOUNCE_MS = 1_500;
const POLL_FALLBACK_MS = 30_000;
const POLL_WITH_REALTIME_MS = 90_000;
const CLOCK_MS = 15_000;

type OperationRow = {
  id: string;
  plate: string | null;
  customer_name: string | null;
  product_description: string | null;
  driver_name: string | null;
  created_at: string;
  closed_at: string | null;
  updated_at: string;
  cancel_reason: string | null;
};

type RowKind = "open" | "closed" | "cancelled";

function toTruck(row: OperationRow, kind: RowKind): StageTruck {
  return {
    operationId: row.id,
    plate: row.plate ?? "",
    customerName: row.customer_name || "Cliente não informado",
    productDescription: row.product_description || "Produto não informado",
    driverName: row.driver_name || "",
    entryAt: row.created_at,
    exitAt: kind === "closed" ? (row.closed_at ?? null) : null,
    // A nuvem nao guarda a hora do cancelamento: a ultima escrita da linha e ela (o mesmo
    // recorte da aba Canceladas, `q.cancelledOperations`).
    cancelledAt: kind === "cancelled" ? row.updated_at : null,
    cancelReason: kind === "cancelled" ? row.cancel_reason : null
  };
}

/** As operacoes em aberto da unidade, as concluidas hoje e as canceladas hoje. */
async function loadTrucks(companyId: string, unitId: string): Promise<StageTruck[]> {
  const startOfDay = `${todayIso()}T00:00:00-03:00`;
  const [open, closed, cancelled] = await Promise.all([
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
      .limit(300),
    supabase
      .from("weighing_operations")
      .select(OPERATION_COLUMNS)
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .eq("status", "cancelled")
      .gte("updated_at", startOfDay)
      .order("updated_at", { ascending: false })
      .limit(300)
  ]);
  if (open.error) throw new Error(open.error.message);
  if (closed.error) throw new Error(closed.error.message);
  if (cancelled.error) throw new Error(cancelled.error.message);
  return [
    ...((open.data ?? []) as OperationRow[]).map((row) => toTruck(row, "open")),
    ...((closed.data ?? []) as OperationRow[]).map((row) => toTruck(row, "closed")),
    ...((cancelled.data ?? []) as OperationRow[]).map((row) => toTruck(row, "cancelled"))
  ];
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
  saida: PackageCheck,
  cancelada: Ban
};

type RealtimeState = "connecting" | "live" | "down";

export function TruckStages() {
  const user = useUser();
  const [trucks, setTrucks] = useState<StageTruck[]>([]);
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
      const result = await loadTrucks(user.companyId, user.unitId);
      if (!mounted.current) return;
      setTrucks(result);
      setNow(Date.now());
      setError(null);
    } catch {
      if (mounted.current) {
        setError("Não foi possível atualizar os caminhões. Confira a internet; tentamos de novo.");
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

  // Aviso em tempo real: a balanca gravou pesagem da empresa -> rele.
  useEffect(() => {
    let subscribedBefore = false;
    setRealtime("connecting");
    const channel = supabase
      .channel(`truck-stages:${user.companyId}`)
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
  }, [user.companyId, schedule]);

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

  const groups = useMemo(() => groupByStage(trucks, now), [trucks, now]);
  const averages = useMemo(() => averageDurations(groups.saida, now), [groups, now]);
  const insideCount = groups.entrada.length + groups.carregando.length;
  const stageNote: Record<TruckStage, string> = {
    entrada: `Chegaram nos últimos ${ENTRY_WINDOW_MINUTES} min`,
    carregando: `Espera média hoje: ${formatDuration(averages.carregando)}`,
    saida: `Tempo médio na pedreira: ${formatDuration(averages.total)}`,
    cancelada: "Canceladas hoje na balança"
  };

  return (
    <section className="truck-stages" aria-labelledby="truck-stages-title">
      <header className="ts-head">
        <div>
          <h2 id="truck-stages-title" className="ts-title">
            Caminhões na pedreira
          </h2>
          <p className="ts-subtitle">
            {insideCount === 1 ? "1 caminhão agora" : `${insideCount} caminhões agora`} ·{" "}
            {groups.saida.length === 1 ? "1 saiu hoje" : `${groups.saida.length} saíram hoje`} ·{" "}
            {groups.cancelada.length === 1
              ? "1 cancelada hoje"
              : `${groups.cancelada.length} canceladas hoje`}
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

      <ol className="ts-flow" aria-label="Etapas do caminhão">
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
              <span className="ts-count-label">{count === 1 ? "caminhão" : "caminhões"}</span>
              <span className="ts-avg">
                <Clock size={13} aria-hidden="true" /> {stageNote[stage]}
              </span>
              <span className="ts-hint">{STAGE_HINTS[stage]}</span>
            </li>
          );
        })}
      </ol>

      <div className="ts-columns">
        {BOARD_COLUMNS.map((stage) => (
          <div key={stage} className={`ts-column ts-${stage}`}>
            <div className="ts-column-head">
              <span className="ts-swatch" aria-hidden="true" />
              <strong>{STAGE_LABELS[stage]}</strong>
              <CountBadge>{groups[stage].length}</CountBadge>
            </div>
            <ul className="ts-list" aria-label={`Caminhões na etapa ${STAGE_LABELS[stage]}`}>
              {groups[stage].length === 0 && (
                <li className="ts-empty">
                  {loaded ? "Nenhum caminhão nesta etapa." : "Carregando..."}
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
                      {truck.cancelledAt && (
                        <span className="ts-item-reason" title={truck.cancelReason ?? undefined}>
                          {truck.cancelReason || "Sem motivo registrado"}
                        </span>
                      )}
                    </span>
                    <span className="ts-item-time">
                      <strong>{formatDuration(timeInCurrentStage(truck, now))}</strong>
                      <span>
                        {truck.cancelledAt
                          ? `cancelou ${clock(truck.cancelledAt)}`
                          : truck.exitAt
                            ? `saiu ${clock(truck.exitAt)}`
                            : `entrou ${clock(truck.entryAt)}`}
                      </span>
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
          <strong>Saíram hoje</strong>
          <CountBadge>{groups.saida.length}</CountBadge>
          <span className="ts-finished-hint">Tempo de cada caminhão em cada etapa</span>
        </div>
        {groups.saida.length === 0 ? (
          <p className="ts-empty">
            {loaded ? "Nenhum caminhão saiu hoje ainda." : "Carregando..."}
          </p>
        ) : (
          <div className="ts-finished-scroll">
            <table className="ts-table">
              <thead>
                <tr>
                  <th>Placa</th>
                  <th>Cliente / Produto</th>
                  <th className="num">Entrou</th>
                  <th className="num">Entrada</th>
                  <th className="num">Carregando</th>
                  <th className="num">Total</th>
                  <th className="num">Saiu</th>
                </tr>
              </thead>
              <tbody>
                {groups.saida.map((truck) => {
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
                      <td className="num">{clock(truck.entryAt)}</td>
                      <td className="num">{formatDuration(durations.entrada)}</td>
                      <td className="num">{formatDuration(durations.carregando)}</td>
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

/** O caminho de um caminhao: a hora de cada passo e quanto tempo ficou em cada etapa. */
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
  const current = stageOf(truck, now);
  const entryMs = Date.parse(truck.entryAt);
  const waitingFrom = Number.isFinite(entryMs)
    ? new Date(entryMs + ENTRY_WINDOW_MINUTES * 60_000).toISOString()
    : null;
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
        <li className={`ts-timeline-step ts-entrada${current === "entrada" ? " current" : ""}`}>
          <span className="ts-swatch" aria-hidden="true" />
          <div>
            <strong>{STAGE_LABELS.entrada}</strong>
            <span>Pesou a entrada: {clock(truck.entryAt)}</span>
          </div>
          <span className="ts-timeline-duration">
            {formatDuration(durations.entrada)}
            {current === "entrada" && <small>até agora</small>}
          </span>
        </li>
        <li
          className={`ts-timeline-step ts-carregando${current === "carregando" ? " current" : ""}`}
        >
          <span className="ts-swatch" aria-hidden="true" />
          <div>
            <strong>{STAGE_LABELS.carregando}</strong>
            <span>
              {durations.carregando === null
                ? "Saiu antes de passar por esta etapa"
                : `Em aberto, aguardando desde ${clock(waitingFrom)}`}
            </span>
          </div>
          <span className="ts-timeline-duration">
            {formatDuration(durations.carregando)}
            {current === "carregando" && <small>até agora</small>}
          </span>
        </li>
        {truck.cancelledAt ? (
          <li className="ts-timeline-step ts-cancelada current">
            <span className="ts-swatch" aria-hidden="true">
              <Ban size={10} />
            </span>
            <div>
              <strong>Cancelada</strong>
              <span>
                Às {clock(truck.cancelledAt)} — {truck.cancelReason || "sem motivo registrado"}
              </span>
            </div>
            <span className="ts-timeline-duration total">
              {formatDuration(durations.total)}
              <small>até cancelar</small>
            </span>
          </li>
        ) : (
          <li className={`ts-timeline-step ts-saida${current === "saida" ? " current" : ""}`}>
            <span className="ts-swatch" aria-hidden="true">
              <ArrowRight size={12} />
            </span>
            <div>
              <strong>{STAGE_LABELS.saida}</strong>
              <span>
                {truck.exitAt
                  ? `Operação concluída: pesou a saída às ${clock(truck.exitAt)}`
                  : "Ainda não pesou a saída"}
              </span>
            </div>
            <span className="ts-timeline-duration total">
              {formatDuration(durations.total)}
              <small>{truck.exitAt ? "na pedreira" : "até agora"}</small>
            </span>
          </li>
        )}
      </ol>
      <p className="ts-note">
        As etapas saem da pesagem da balança: a entrada vale nos primeiros {ENTRY_WINDOW_MINUTES}{" "}
        minutos; depois, enquanto a operação estiver em aberto, o caminhão está carregando; ao pesar
        a saída, a operação conclui.
      </p>
    </Modal>
  );
}
