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

export function LoaderDashboard() {
  const { user, logout } = useAuth();
  const [operations, setOperations] = useState<WeighingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingCompletions, setPendingCompletions] = useState<Set<string>>(new Set());

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
    } catch (error) {
      console.error("Error loading operations:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Nao foi possivel carregar a fila de cargas."
      );
    } finally {
      setIsLoading(false);
    }
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
    } catch (error) {
      console.error("Error completing loading operation:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "Nao foi possivel marcar a carga como concluida."
      );
      setOperations((current) =>
        current.map((item) =>
          item.id === operation.id ? { ...item, loaderCompletedAt: null } : item
        )
      );
    } finally {
      setPendingCompletions((current) => {
        const next = new Set(current);
        next.delete(operation.id);
        return next;
      });
    }
  }

  const inProgressOperations = operations.filter((operation) => !operation.loaderCompletedAt);
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
        ) : inProgressOperations.length === 0 ? (
          <EmptyState
            title="Nenhuma carga aguardando"
            description="Quando uma operacao entrar na fila, ela aparecera aqui."
          />
        ) : (
          <div className="card-list">
            {inProgressOperations.map((operation, index) => (
              <LoadingCard
                key={operation.id}
                operation={operation}
                position={index + 1}
                isSubmitting={pendingCompletions.has(operation.id)}
                onComplete={() => void handleCompleteOperation(operation)}
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
  onComplete
}: {
  operation: WeighingOperation;
  position: number;
  isSubmitting: boolean;
  onComplete: () => void;
}) {
  return (
    <article className="operation-card">
      <div className="operation-top-row">
        <span className="queue-position">{position}º</span>
        <div className="operation-identity">
          <h3 className="operation-plate">{operation.plate}</h3>
          <p className="operation-customer">{operation.customerName}</p>
        </div>
        <span className="waiting-pill">Aguardando</span>
      </div>

      <dl className="details-grid">
        <InfoItem label="Motorista" value={operation.driverName} />
        <InfoItem label="Produto" value={operation.productDescription} />
        <InfoItem label="Quantidade" value={formatWeight(operation.entryWeightKg)} />
        <InfoItem label="Chegada" value={formatDateTime(operation.createdAt)} />
      </dl>

      <button onClick={onComplete} disabled={isSubmitting} className="primary-action complete-button">
        {isSubmitting ? "Enviando..." : "Concluir carga"}
      </button>
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
