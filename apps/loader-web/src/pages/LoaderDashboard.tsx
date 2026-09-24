import { useEffect, useState } from "react";

import { useAuth } from "../contexts/AuthContext";
import { isIosDevice, useInstallPrompt } from "../lib/pwa-install";
import { supabase } from "../lib/supabase";

export interface WeighingOperation {
  id: string;
  plate: string;
  customerName: string;
  driverName: string;
  productDescription: string;
  entryWeightKg: number | null;
  status: string;
  createdAt: string;
  loaderCompletedAt: string | null;
}

// Duration of the truck departure animation. Keep in sync with the
// `truck-drive-off` keyframes duration in loader-ui.css.
const DEPART_ANIMATION_MS = 1150;

// Fuso da pedreira (unidade), nao o do navegador do carregador. Sem timeZone, o horario de
// chegada aparecia deslocado para um carregador acessando de outro fuso. Default: America/Sao_Paulo.
const DEFAULT_UNIT_TIMEZONE = "America/Sao_Paulo";

/**
 * Horario de chegada no formato mais curto possivel para o card compacto:
 * so `HH:mm` quando o caminhao chegou no mesmo dia da unidade, `dd/MM HH:mm`
 * quando a fila atravessou a virada do dia.
 */
export function formatArrival(
  value: string | null | undefined,
  timeZone?: string | null,
  now: number = Date.now()
): string {
  if (!value) return "-";
  const arrived = new Date(value);
  if (Number.isNaN(arrived.getTime())) return "-";

  const zone = timeZone || DEFAULT_UNIT_TIMEZONE;
  const time = arrived.toLocaleString("pt-BR", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit"
  });

  const dayFormat: Intl.DateTimeFormatOptions = {
    timeZone: zone,
    day: "2-digit",
    month: "2-digit"
  };
  const arrivedDay = arrived.toLocaleDateString("pt-BR", dayFormat);
  const today = new Date(now).toLocaleDateString("pt-BR", dayFormat);

  return arrivedDay === today ? time : `${arrivedDay} ${time}`;
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
    entryWeightKg: row.entry_weight_kg,
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

/** Um produto e quantas cargas dele estao esperando o carregador. */
export interface ProductQueueCount {
  label: string;
  count: number;
}

/**
 * Quantas cargas em aberto existem de cada produto, para os contadores no topo da fila:
 * o carregador ve de uma vez quantos caminhoes de cada brita estao no patio, sem contar
 * card por card. Agrupa pela descricao (o projeto da nuvem nao traz o id do produto),
 * ordena da maior fila para a menor e, no empate, em ordem alfabetica, para a faixa nao
 * dancar a cada atualizacao.
 */
export function countInProgressByProduct(operations: WeighingOperation[]): ProductQueueCount[] {
  const counts = new Map<string, ProductQueueCount>();

  for (const operation of operations) {
    const label = operation.productDescription?.trim() || "Sem produto";
    const key = label.toLowerCase();
    const current = counts.get(key);
    if (current) {
      current.count++;
    } else {
      counts.set(key, { label, count: 1 });
    }
  }

  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")
  );
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

/** Janela do historico de conclusoes que ainda podem ser desfeitas pelo carregador. */
export const RECENT_COMPLETION_WINDOW_MS = 30 * 60_000;

/**
 * Cargas concluidas pelo carregador nos ultimos 30 minutos, mais recente
 * primeiro. So enxerga solicitacoes ainda abertas (a RLS esconde as que o
 * desktop ja fechou — e essas nao podem mais ser desfeitas mesmo).
 */
export function getRecentCompletedOperations(
  operations: WeighingOperation[],
  now: number,
  windowMs: number = RECENT_COMPLETION_WINDOW_MS
): WeighingOperation[] {
  return operations
    .filter((operation) => {
      if (!operation.loaderCompletedAt) return false;
      const completed = new Date(operation.loaderCompletedAt).getTime();
      if (Number.isNaN(completed)) return false;
      return now - completed <= windowMs;
    })
    .sort(
      (a, b) =>
        new Date(b.loaderCompletedAt ?? 0).getTime() - new Date(a.loaderCompletedAt ?? 0).getTime()
    );
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
  const [unitTimezone, setUnitTimezone] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const [pendingCancellations, setPendingCancellations] = useState<Set<string>>(new Set());
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const { isInstalled, install } = useInstallPrompt();

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
        .select("avg_quarry_minutes,timezone")
        .eq("id", user.unitId)
        .maybeSingle();
      const unitRow = unitData as {
        avg_quarry_minutes?: number | null;
        timezone?: string | null;
      } | null;
      const avg = Number(unitRow?.avg_quarry_minutes ?? 0);
      setAvgQuarryMinutes(Number.isFinite(avg) && avg > 0 ? avg : null);
      setUnitTimezone(unitRow?.timezone?.trim() || null);
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

  /**
   * Desfaz o "Concluir carga": a carga volta para a fila em andamento e o
   * desktop apaga o status de carregado assim que a projecao chega (pull leve).
   */
  async function handleCancelCompletion(operation: WeighingOperation) {
    if (!user?.unitId) return;
    if (!operation.loaderCompletedAt) return;
    if (pendingCancellations.has(operation.id)) return;

    const previousCompletedAt = operation.loaderCompletedAt;
    setPendingCancellations((current) => {
      const next = new Set(current);
      next.add(operation.id);
      return next;
    });
    // A carga pode ainda estar com a animacao de saida pendente; cancelar tudo.
    finalizeDeparture(operation.id);
    setOperations((current) =>
      current.map((item) =>
        item.id === operation.id ? { ...item, loaderCompletedAt: null } : item
      )
    );

    try {
      const { error } = await supabase
        .from("loading_requests")
        .update({ loader_completed_at: null })
        .eq("id", operation.id)
        .eq("unit_id", user.unitId)
        .eq("status", "open");

      if (error) throw error;
      setErrorMessage(null);
    } catch (error) {
      console.error("Error cancelling loading completion:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Nao foi possivel cancelar a conclusao da carga."
      );
      setOperations((current) =>
        current.map((item) =>
          item.id === operation.id ? { ...item, loaderCompletedAt: previousCompletedAt } : item
        )
      );
    } finally {
      setPendingCancellations((current) => {
        const next = new Set(current);
        next.delete(operation.id);
        return next;
      });
    }
  }

  async function handleInstallApp() {
    const result = await install();
    if (result === "instructions") {
      setShowInstallHelp(true);
    }
  }

  const inProgressOperations = getInProgressOperations(operations);
  const inProgressByProduct = countInProgressByProduct(inProgressOperations);
  const renderedOperations = getRenderedOperations(operations, departingIds);
  const recentCompletedOperations = getRecentCompletedOperations(operations, now);
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
        <div className="loader-header-actions">
          {!isInstalled ? (
            <button
              type="button"
              onClick={() => void handleInstallApp()}
              className="secondary-action install-button"
            >
              ⬇ Instalar app
            </button>
          ) : null}
          <button onClick={logout} className="secondary-action">
            Sair
          </button>
        </div>
      </header>

      {/* Barra compacta: um card pequeno com o total em aberto + acesso ao
          historico de conclusoes. O foco da tela e a lista de cargas abaixo. */}
      <section className="loader-toolbar" aria-label="Resumo da fila">
        <div
          className="queue-stat queue-stat--compact"
          aria-label={`${inProgressOperations.length} cargas em aberto`}
        >
          <strong>{inProgressOperations.length}</strong>
          <span>em aberto</span>
        </div>
        <button
          type="button"
          className="secondary-action completed-history-button"
          onClick={() => setShowCompletedModal(true)}
        >
          Concluidas ha pouco
          <span className="completed-history-count" aria-hidden="true">
            {recentCompletedOperations.length}
          </span>
        </button>
      </section>

      {/* Quanto de cada produto esta esperando agora, antes da fila em si. */}
      {inProgressByProduct.length > 0 ? (
        <section className="product-counters" role="list" aria-label="Cargas em aberto por produto">
          {inProgressByProduct.map((product) => (
            <span
              key={product.label}
              role="listitem"
              className="product-counter"
              title={`${product.count} ${
                product.count === 1 ? "carga em aberto" : "cargas em aberto"
              } de ${product.label}`}
            >
              <span className="product-counter__label">{product.label}</span>
              <strong className="product-counter__value">{product.count}</strong>
            </span>
          ))}
        </section>
      ) : null}

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
            {/* h1: com o hero removido, o painel da fila e o titulo principal da tela. */}
            <h1 id="in-progress-title" className="queue-panel-title">
              Cargas em andamento
            </h1>
            <p className="queue-panel-subtitle">
              Atenda de cima para baixo. Ao concluir, a carga sai desta lista.
            </p>
          </div>
          <span className="queue-count-badge">{inProgressOperations.length}</span>
        </div>

        {isLoading ? (
          <EmptyState
            title="Carregando fila..."
            description="Buscando cargas em aberto da unidade."
          />
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
                unitTimezone={unitTimezone}
                onComplete={() => void handleCompleteOperation(operation)}
                onDeparted={() => finalizeDeparture(operation.id)}
              />
            ))}
          </div>
        )}
      </section>

      {showCompletedModal ? (
        <CompletedHistoryModal
          operations={recentCompletedOperations}
          pendingCancellations={pendingCancellations}
          unitTimezone={unitTimezone}
          onCancelCompletion={(operation) => void handleCancelCompletion(operation)}
          onClose={() => setShowCompletedModal(false)}
        />
      ) : null}

      {showInstallHelp ? <InstallHelpModal onClose={() => setShowInstallHelp(false)} /> : null}
    </main>
  );
}

/**
 * Historico das cargas concluidas nos ultimos 30 minutos. "Cancelar carga"
 * desfaz a conclusao: a carga volta para a fila em andamento e o desktop apaga
 * o status de carregado na proxima projecao.
 */
function CompletedHistoryModal({
  operations,
  pendingCancellations,
  unitTimezone,
  onCancelCompletion,
  onClose
}: {
  operations: WeighingOperation[];
  pendingCancellations: ReadonlySet<string>;
  unitTimezone: string | null;
  onCancelCompletion: (operation: WeighingOperation) => void;
  onClose: () => void;
}) {
  return (
    <div className="loader-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="loader-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="completed-history-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="loader-modal-header">
          <div>
            <h2 id="completed-history-title" className="loader-modal-title">
              Concluidas nos ultimos 30 min
            </h2>
            <p className="loader-modal-subtitle">
              Concluiu sem querer? Cancele e a carga volta para a fila em andamento.
            </p>
          </div>
          <button type="button" className="secondary-action" onClick={onClose} aria-label="Fechar">
            Fechar
          </button>
        </div>

        {operations.length === 0 ? (
          <p className="loader-modal-empty">
            Nenhuma carga concluida nos ultimos 30 minutos. As cargas que voce concluir aparecem
            aqui por meia hora.
          </p>
        ) : (
          <ul className="completed-list">
            {operations.map((operation) => (
              <li key={operation.id} className="completed-item">
                <div className="completed-item__summary">
                  <div className="operation-headline">
                    <h3 className="operation-plate">{operation.plate || "SEM PLACA"}</h3>
                    <span className="operation-arrival" title="Concluida em">
                      {formatArrival(operation.loaderCompletedAt, unitTimezone)}
                    </span>
                  </div>
                  <p className="operation-customer" title={operation.customerName}>
                    {operation.customerName}
                  </p>
                  <p className="operation-meta">
                    <span className="operation-meta__product">{operation.productDescription}</span>
                    <span className="operation-meta__sep" aria-hidden="true">
                      ·
                    </span>
                    <span className="operation-meta__driver">{operation.driverName}</span>
                  </p>
                </div>
                <button
                  type="button"
                  className="danger-action cancel-completion-button"
                  disabled={pendingCancellations.has(operation.id)}
                  onClick={() => onCancelCompletion(operation)}
                  aria-label={`Cancelar carga da placa ${operation.plate || "sem placa"}`}
                >
                  {pendingCancellations.has(operation.id) ? "..." : "Cancelar carga"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Passo a passo de instalacao manual, para quando o navegador nao oferece o
 * prompt nativo (Safari/iOS, ou Chrome antes de liberar o evento).
 */
function InstallHelpModal({ onClose }: { onClose: () => void }) {
  const ios = isIosDevice();
  return (
    <div className="loader-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="loader-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="loader-modal-header">
          <h2 id="install-help-title" className="loader-modal-title">
            Instalar como aplicativo
          </h2>
          <button type="button" className="secondary-action" onClick={onClose} aria-label="Fechar">
            Fechar
          </button>
        </div>
        {ios ? (
          <ol className="install-steps">
            <li>
              Toque no botao <strong>Compartilhar</strong> do Safari (quadrado com seta para cima).
            </li>
            <li>
              Role a lista e toque em <strong>Adicionar a Tela de Inicio</strong>.
            </li>
            <li>
              Confirme em <strong>Adicionar</strong>. O Carregador vira um icone na tela inicial.
            </li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>
              Abra o menu do navegador (<strong>⋮</strong> no canto superior direito).
            </li>
            <li>
              Toque em <strong>Instalar aplicativo</strong> (ou{" "}
              <strong>Adicionar a tela inicial</strong>).
            </li>
            <li>Confirme. O Carregador abre em tela cheia, como um app.</li>
          </ol>
        )}
      </div>
    </div>
  );
}

function LoadingCard({
  operation,
  position,
  isSubmitting,
  isDeparting,
  isOvertime,
  unitTimezone,
  onComplete,
  onDeparted
}: {
  operation: WeighingOperation;
  position: number;
  isSubmitting: boolean;
  isDeparting: boolean;
  isOvertime: boolean;
  unitTimezone: string | null;
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
        <span className="queue-position">{position}º</span>

        <div className="operation-summary">
          <div className="operation-headline">
            <h3 className="operation-plate">{operation.plate || "SEM PLACA"}</h3>
            <span className="operation-arrival" title="Chegada">
              {formatArrival(operation.createdAt, unitTimezone)}
            </span>
            {isOvertime ? (
              <span className="waiting-pill waiting-pill--overtime">Acima da media</span>
            ) : null}
          </div>
          <p className="operation-customer" title={operation.customerName}>
            {operation.customerName}
          </p>
          <p className="operation-meta">
            <span className="operation-meta__product">{operation.productDescription}</span>
            <span className="operation-meta__sep" aria-hidden="true">
              ·
            </span>
            <span className="operation-meta__driver">{operation.driverName}</span>
          </p>
        </div>

        <button
          onClick={onComplete}
          disabled={isSubmitting}
          className="primary-action complete-button"
          aria-label={`Concluir carga da placa ${operation.plate || "sem placa"}`}
        >
          {isSubmitting ? "..." : "Concluir"}
        </button>
      </div>

      <div className="operation-card__truck" aria-hidden="true">
        <TruckIcon />
        <span className="operation-card__truck-trail" />
      </div>
    </article>
  );
}

function TruckIcon() {
  // Side-view delivery truck facing right (the direction it drives off).
  return (
    <svg
      className="operation-card__truck-svg"
      viewBox="0 0 132 72"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {/* cargo box */}
      <rect x="4" y="14" width="72" height="38" rx="4" fill="#1d4ed8" />
      <rect x="12" y="22" width="56" height="22" rx="2" fill="#3b82f6" opacity="0.55" />
      {/* cab: hood + cabin */}
      <path d="M76 24h18l14 16v12H76z" fill="#0f172a" />
      {/* windshield */}
      <path d="M80 28h11l9 10H80z" fill="#93c5fd" />
      {/* headlight */}
      <rect x="104" y="44" width="6" height="5" rx="1.5" fill="#fde68a" />
      {/* wheels */}
      <circle cx="30" cy="56" r="10" fill="#0f172a" />
      <circle cx="30" cy="56" r="4" fill="#cbd5e1" />
      <circle cx="92" cy="56" r="10" fill="#0f172a" />
      <circle cx="92" cy="56" r="4" fill="#cbd5e1" />
    </svg>
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
