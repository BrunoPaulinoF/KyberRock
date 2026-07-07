import { useEffect, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

export interface WeighingOperation {
  id: string;
  plate: string;
  customerName: string;
  driverName: string;
  productDescription: string;
  entryWeightKg: number;
  status: string;
  createdAt: string;
  loaderCompletedAt: string | null;
}

// Duration of the truck departure animation. Keep in sync with the
// `truck-drive-off` keyframes duration in loader-ui.css.
const DEPART_ANIMATION_MS = 1150;

function formatWeight(weightKg: number): string {
  if (!weightKg) {
    return "A definir";
  }

  return `${weightKg.toLocaleString("pt-BR")} kg`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

interface LoadingRequestRow {
  id: string;
  plate: string;
  customer_name: string;
  driver_name: string;
  product_description: string;
  entry_weight_kg: number | null;
  status: string;
  created_at: string;
  loader_completed_at: string | null;
}

function mapRow(row: LoadingRequestRow): WeighingOperation {
  return {
    id: row.id,
    plate: row.plate,
    customerName: row.customer_name,
    driverName: row.driver_name,
    productDescription: row.product_description,
    entryWeightKg: Number(row.entry_weight_kg ?? 0),
    status: row.status,
    createdAt: row.created_at,
    loaderCompletedAt: row.loader_completed_at
  };
}

/**
 * Operations still awaiting the loader (used for counters). A departing
 * operation already has `loaderCompletedAt` set, so it is excluded here.
 */
export function getInProgressOperations(operations: WeighingOperation[]): WeighingOperation[] {
  return operations.filter((operation) => !operation.loaderCompletedAt);
}

/**
 * Operations that should be rendered as cards: everything still in progress
 * plus any concluded operation whose truck is still driving off screen, so the
 * departure animation can play before the row disappears.
 */
export function getRenderedOperations(
  operations: WeighingOperation[],
  departingIds: ReadonlySet<string>
): WeighingOperation[] {
  return operations.filter(
    (operation) => !operation.loaderCompletedAt || departingIds.has(operation.id)
  );
}

/** Minutos desde a chegada do caminhao (created_at). */
export function minutesSinceArrival(createdAt: string, now: number): number {
  const arrived = new Date(createdAt).getTime();
  if (Number.isNaN(arrived)) return 0;
  return Math.max(0, (now - arrived) / 60_000);
}

/**
 * Operacoes em andamento cujo caminhao ja passou do tempo medio dentro da
 * pedreira (projetado pelo desktop na unidade). Vazio se nao ha media.
 */
export function getOvertimeOperations(
  operations: WeighingOperation[],
  avgMinutes: number | null,
  now: number
): WeighingOperation[] {
  if (!avgMinutes || avgMinutes <= 0) return [];
  return operations.filter(
    (operation) =>
      !operation.loaderCompletedAt && minutesSinceArrival(operation.createdAt, now) > avgMinutes
  );
}

export function LoaderDashboard() {
  const { user, logout } = useAuth();
  const [operations, setOperations] = useState<WeighingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingCompletions, setPendingCompletions] = useState<Set<string>>(new Set());
  const [departingIds, setDepartingIds] = useState<Set<string>>(new Set());
  const [avgQuarryMinutes, setAvgQuarryMinutes] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Relogio para recalcular o tempo decorrido sem depender do polling.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void loadOperations();

    if (!user?.unitId) return;

    const channel = supabase
      .channel(`loading-requests:${user.unitId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "loading_requests",
          filter: `unit_id=eq.${user.unitId}`
        },
        () => void loadOperations({ preserveLoading: true })
      )
      .subscribe();

    const fallbackPolling = window.setInterval(
      () => void loadOperations({ preserveLoading: true }),
      15_000
    );

    return () => {
      window.clearInterval(fallbackPolling);
      void supabase.removeChannel(channel);
    };
  }, [user?.unitId]);

  async function loadOperations(options: { preserveLoading?: boolean } = {}) {
    if (!user?.unitId) {
      setIsLoading(false);
      return;
    }

    if (!options.preserveLoading) setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("loading_requests")
        .select(
          "id,plate,customer_name,driver_name,product_description,entry_weight_kg,status,created_at,loader_completed_at"
        )
        .eq("unit_id", user.unitId)
        .eq("status", "open")
        .order("created_at", { ascending: true });

      if (error) throw error;
      setOperations((data ?? []).map(mapRow));
      setErrorMessage(null);

      // Media de tempo dentro da pedreira (projetada pelo desktop na unidade),
      // usada para destacar caminhoes acima da media. Best-effort.
      const { data: unitData } = await supabase
        .from("units")
        .select("avg_quarry_minutes")
        .eq("id", user.unitId)
        .maybeSingle();
      const avg = Number((unitData as { avg_quarry_minutes?: number | null } | null)?.avg_quarry_minutes ?? 0);
      setAvgQuarryMinutes(Number.isFinite(avg) && avg > 0 ? avg : null);
    } catch (error) {
      console.error("Error loading operations:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Nao foi possivel carregar a fila de cargas."
      );
    } finally {
      setIsLoading(false);
    }
  }

  function finalizeDeparture(operationId: string) {
    setDepartingIds((current) => {
      if (!current.has(operationId)) return current;
      const next = new Set(current);
      next.delete(operationId);
      return next;
    });
    setPendingCompletions((current) => {
      if (!current.has(operationId)) return current;
      const next = new Set(current);
      next.delete(operationId);
      return next;
    });
  }

  async function handleCompleteOperation(operation: WeighingOperation) {
    if (!user?.unitId) return;
    if (operation.loaderCompletedAt) return;
    if (pendingCompletions.has(operation.id)) return;

    setPendingCompletions((current) => {
      const next = new Set(current);
      next.add(operation.id);
      return next;
    });
    // Trigger the truck animation. The row keeps rendering while it drives off
    // because `getRenderedOperations` includes departing ids.
    setDepartingIds((current) => {
      const next = new Set(current);
      next.add(operation.id);
      return next;
    });

    const optimisticTimestamp = new Date().toISOString();
    setOperations((current) =>
      current.map((item) =>
        item.id === operation.id ? { ...item, loaderCompletedAt: optimisticTimestamp } : item
      )
    );

    try {
      const { error } = await supabase
        .from("loading_requests")
        .update({ loader_completed_at: optimisticTimestamp })
        .eq("id", operation.id)
        .eq("unit_id", user.unitId)
        .eq("status", "open");

      if (error) throw error;
      setErrorMessage(null);
      // Success: let the truck finish driving off. `onDeparted` (or the safety
      // timeout below) removes the row once the animation ends.
      window.setTimeout(() => finalizeDeparture(operation.id), DEPART_ANIMATION_MS + 250);
    } catch (error) {
      console.error("Error completing loading operation:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Nao foi possivel marcar a carga como concluida."
      );
      // Revert everything: the truck stops and the row returns to the queue.
      setOperations((current) =>
        current.map((item) =>
          item.id === operation.id ? { ...item, loaderCompletedAt: null } : item
        )
      );
      finalizeDeparture(operation.id);
    }
  }

  const inProgressOperations = getInProgressOperations(operations);
  const renderedOperations = getRenderedOperations(operations, departingIds);
  const overtimeOperations = getOvertimeOperations(inProgressOperations, avgQuarryMinutes, now);
  const overtimeIds = new Set(overtimeOperations.map((operation) => operation.id));
  const operatorName = user?.name ?? "Carregador";

  return (
    <main className="loader-page">
      <header className="loader-header">
        <div className="operator-chip" aria-label={`Operador ${operatorName}`}>
          <span className="operator-avatar" aria-hidden="true">
            {operatorName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <span className="operator-name">{operatorName}</span>
            <span className="operator-role">Carregador</span>
          </span>
        </div>
        <button onClick={logout} className="secondary-action">
          Sair
        </button>
      </header>

      <section className="loader-hero" aria-labelledby="loader-dashboard-title">
        <div>
          <p className="loader-eyebrow">Fila operacional</p>
          <h1 id="loader-dashboard-title" className="loader-title">
            Cargas prontas para atendimento
          </h1>
          <p className="loader-description">
            Atenda a fila em ordem de chegada. Marque a carga como concluida assim que o veiculo
            terminar o carregamento.
          </p>
        </div>
        <div className="queue-stat" aria-label={`${inProgressOperations.length} cargas abertas`}>
          <strong>{inProgressOperations.length}</strong>
          <span>em aberto</span>
        </div>
      </section>

      {errorMessage ? (
        <div className="error-banner" role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            className="secondary-action"
            onClick={() => void loadOperations({ preserveLoading: true })}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {overtimeOperations.length > 0 ? (
        <div className="overtime-banner" role="alert">
          <span className="overtime-banner__label">
            ⚠ Acima do tempo medio ({Math.round(avgQuarryMinutes ?? 0)}min):
          </span>
          <span className="overtime-banner__plates">
            {overtimeOperations.map((operation) => (
              <span key={operation.id} className="overtime-plate">
                {operation.plate || "SEM PLACA"}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      <section className="queue-panel" aria-labelledby="in-progress-title">
        <div className="queue-panel-header">
          <div>
            <h2 id="in-progress-title" className="queue-panel-title">
              Cargas em andamento
            </h2>
            <p className="queue-panel-subtitle">
              Atenda de cima para baixo. Ao concluir, a carga sai desta lista.
            </p>
          </div>
          <span className="queue-count-badge">{inProgressOperations.length}</span>
        </div>

        {isLoading ? (
          <EmptyState title="Carregando fila..." description="Buscando cargas em aberto da unidade." />
        ) : renderedOperations.length === 0 ? (
          <EmptyState
            title="Nenhuma carga aguardando"
            description="Quando uma operacao entrar na fila, ela aparecera aqui."
          />
        ) : (
          <div className={`card-list${departingIds.size > 0 ? " card-list--departing" : ""}`}>
            {renderedOperations.map((operation, index) => (
              <LoadingCard
                key={operation.id}
                operation={operation}
                position={index + 1}
                isSubmitting={pendingCompletions.has(operation.id)}
                isDeparting={departingIds.has(operation.id)}
                isOvertime={overtimeIds.has(operation.id)}
                onComplete={() => void handleCompleteOperation(operation)}
                onDeparted={() => finalizeDeparture(operation.id)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function LoadingCard({
  operation,
  position,
  isSubmitting,
  isDeparting,
  isOvertime,
  onComplete,
  onDeparted
}: {
  operation: WeighingOperation;
  position: number;
  isSubmitting: boolean;
  isDeparting: boolean;
  isOvertime: boolean;
  onComplete: () => void;
  onDeparted: () => void;
}) {
  return (
    <article
      className={`operation-card${isDeparting ? " operation-card--departing" : ""}${
        isOvertime ? " operation-card--overtime" : ""
      }`}
      aria-hidden={isDeparting ? true : undefined}
      onAnimationEnd={(event) => {
        // Ignore animation events bubbling up from child elements (truck reveal
        // / bob) — only react to the card's own drive-off animation ending.
        if (event.target !== event.currentTarget) return;
        if (isDeparting) onDeparted();
      }}
    >
      <div className="operation-card__content">
        <div className="operation-top-row">
          <span className="queue-position">{position}º</span>
          <div className="operation-identity">
            <h3 className="operation-plate">{operation.plate}</h3>
            <p className="operation-customer">{operation.customerName}</p>
          </div>
          <span className={`waiting-pill${isOvertime ? " waiting-pill--overtime" : ""}`}>
            {isOvertime ? "Acima da media" : "Aguardando"}
          </span>
        </div>

        <dl className="details-grid">
          <InfoItem label="Motorista" value={operation.driverName} />
          <InfoItem label="Produto" value={operation.productDescription} />
          <InfoItem label="Quantidade" value={formatWeight(operation.entryWeightKg)} />
          <InfoItem label="Chegada" value={formatDateTime(operation.createdAt)} />
        </dl>

        <button
          onClick={onComplete}
          disabled={isSubmitting}
          className="primary-action complete-button"
        >
          {isSubmitting ? "Enviando..." : "Concluir carga"}
        </button>
      </div>

      <div className="operation-card__truck" aria-hidden="true">
        <span className="operation-card__truck-icon">🚚</span>
        <span className="operation-card__truck-trail" />
      </div>
    </article>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-card">
      <dt className="detail-label">{label}</dt>
      <dd className="detail-value">{value}</dd>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-inner">
        <span className="empty-icon" aria-hidden="true">
          KR
        </span>
        <strong className="empty-title">{title}</strong>
        <span className="empty-description">{description}</span>
      </div>
    </div>
  );
}
