import { CheckCircle2, Download, History, LogOut, Moon, RotateCcw, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, Modal, Pill, Skeleton, useToast } from "../components/ui";
import { useAuth, useUser } from "../lib/auth";
import {
  countByProduct,
  formatArrival,
  inProgress,
  overtime,
  recentlyCompleted,
  type LoadingItem
} from "../lib/loading";
import { isIosDevice, useInstallPrompt } from "../lib/pwa-install";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

const COLUMNS =
  "id,plate,customer_name,driver_name,product_description,created_at,loader_completed_at";

/**
 * Tela do carregador: a fila de carregamento da unidade dele, e nada mais. Mesmas regras e as
 * mesmas informacoes da tela que existia no KyberRock Portal (`apps/loader-web`), que deixou de
 * receber o carregador. Feita para o celular na mao e para o tablet no patio: botoes grandes,
 * "Concluir" na largura do cartao, faixa de produtos que rola de lado, e em tablet os cartoes
 * vao para duas colunas. Instala como app (o mesmo "Instalar app" do portal).
 *
 * Unica escrita direta do site: marcar/desmarcar `loader_completed_at`. E um carimbo
 * operacional da solicitacao (nao cadastro), a politica "loader can mark loading request as
 * completed" so deixa mexer em solicitacao ABERTA da propria unidade, e e o mesmo caminho que
 * o carregador ja usa hoje — a balanca le o carimbo no pull e mostra "carregado".
 */
export function Loading() {
  const user = useUser();
  const { logout } = useAuth();
  const { theme, toggle } = useTheme();
  const toast = useToast();
  const [items, setItems] = useState<LoadingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [avgMinutes, setAvgMinutes] = useState<number | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showCompleted, setShowCompleted] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const { isInstalled, install } = useInstallPrompt();

  async function installApp() {
    if ((await install()) === "instructions") setShowInstallHelp(true);
  }

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("loading_requests")
      .select(COLUMNS)
      .eq("unit_id", user.unitId)
      .eq("status", "open")
      .order("created_at", { ascending: true });
    if (loadError) {
      setError("Não foi possível carregar a fila. Confira a internet e tente de novo.");
      setLoading(false);
      return;
    }
    setItems(
      (data ?? []).map((row) => ({
        id: row.id,
        plate: row.plate ?? "",
        customerName: row.customer_name ?? "",
        driverName: row.driver_name ?? "",
        productDescription: row.product_description ?? "",
        createdAt: row.created_at,
        loaderCompletedAt: row.loader_completed_at
      }))
    );
    setError(null);
    setLoading(false);
    // Tempo medio dentro da pedreira (a balanca projeta na unidade): destaca quem passou dele.
    const { data: unit } = await supabase
      .from("units")
      .select("avg_quarry_minutes,timezone")
      .eq("id", user.unitId)
      .maybeSingle();
    const avg = Number(unit?.avg_quarry_minutes ?? 0);
    setAvgMinutes(Number.isFinite(avg) && avg > 0 ? avg : null);
    setTimeZone(unit?.timezone?.trim() || null);
  }, [user.unitId]);

  // Realtime avisa na hora; o tique de 15 s cobre evento perdido e queda de conexao.
  useEffect(() => {
    void load();
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
        () => void load()
      )
      .subscribe();
    const poll = window.setInterval(() => void load(), 15_000);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      void supabase.removeChannel(channel);
    };
  }, [load, user.unitId]);

  async function mark(item: LoadingItem, completedAt: string | null) {
    if (busy.has(item.id)) return;
    setBusy((current) => new Set(current).add(item.id));
    const previous = item.loaderCompletedAt;
    setItems((current) =>
      current.map((row) => (row.id === item.id ? { ...row, loaderCompletedAt: completedAt } : row))
    );
    const { error: updateError } = await supabase
      .from("loading_requests")
      .update({ loader_completed_at: completedAt })
      .eq("id", item.id)
      .eq("unit_id", user.unitId)
      .eq("status", "open");
    if (updateError) {
      setItems((current) =>
        current.map((row) => (row.id === item.id ? { ...row, loaderCompletedAt: previous } : row))
      );
      setError(
        completedAt
          ? "Não foi possível concluir a carga. Tente de novo."
          : "Não foi possível devolver a carga para a fila. Tente de novo."
      );
    }
    setBusy((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    if (!updateError && completedAt) {
      // Concluiu sem querer: o "Desfazer" e o mesmo "Cancelar carga" da lista "Concluídas há
      // pouco" (a carga volta para a fila), sem precisar abrir a lista.
      const done = { ...item, loaderCompletedAt: completedAt };
      toast.push("Carga concluída.", "ok", {
        action: { label: "Desfazer", onClick: () => void mark(done, null) }
      });
    }
  }

  const queue = useMemo(() => inProgress(items), [items]);
  const products = useMemo(() => countByProduct(queue), [queue]);
  const late = useMemo(() => overtime(queue, avgMinutes, now), [queue, avgMinutes, now]);
  const lateIds = useMemo(() => new Set(late.map((item) => item.id)), [late]);
  const completed = useMemo(() => recentlyCompleted(items, now), [items, now]);

  return (
    <div className="loading-shell">
      <header className="loading-top">
        <span className="loading-avatar" aria-hidden="true">
          {(user.name || "C").slice(0, 1).toUpperCase()}
        </span>
        <div className="loading-top-title">
          <strong>{user.name}</strong>
          <span>Carregador</span>
        </div>
        {!isInstalled && (
          <button
            type="button"
            className="loading-top-btn"
            onClick={() => void installApp()}
            title="Instalar como aplicativo"
          >
            <Download size={18} />
            <span className="loading-top-label">Instalar app</span>
          </button>
        )}
        <button
          type="button"
          className="loading-top-btn"
          onClick={toggle}
          aria-label="Alternar tema"
          title={theme === "light" ? "Tema escuro" : "Tema claro"}
        >
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <button
          type="button"
          className="loading-top-btn"
          onClick={() => void logout()}
          aria-label="Sair da conta"
          title="Sair da conta"
        >
          <LogOut size={18} />
          <span className="loading-top-label">Sair</span>
        </button>
      </header>

      <main className="loading-main">
        <section className="loading-toolbar" aria-label="Resumo da fila">
          <div className="loading-stat" aria-label={`${queue.length} cargas em aberto`}>
            <strong>{queue.length}</strong>
            <span>em aberto</span>
          </div>
          <button type="button" className="loading-history" onClick={() => setShowCompleted(true)}>
            <History size={18} />
            Concluídas há pouco
            <span className="loading-history-count">{completed.length}</span>
          </button>
        </section>

        {products.length > 0 && (
          <div className="loading-products" role="list" aria-label="Cargas em aberto por produto">
            {products.map((product) => (
              <span
                key={product.label}
                role="listitem"
                className="loading-product"
                title={`${product.count} ${product.count === 1 ? "carga" : "cargas"} de ${product.label}`}
              >
                <span>{product.label}</span>
                <strong>{product.count}</strong>
              </span>
            ))}
          </div>
        )}

        {error && <ErrorState message={error} onRetry={() => void load()} />}

        {late.length > 0 && (
          <div className="loading-late" role="alert">
            <strong>Acima do tempo médio ({Math.round(avgMinutes ?? 0)} min):</strong>
            <span>
              {late.map((item) => (
                <span key={item.id} className="loading-plate small">
                  {item.plate || "SEM PLACA"}
                </span>
              ))}
            </span>
          </div>
        )}

        <div className="loading-head">
          <div>
            <h1>Cargas em andamento</h1>
            <p>Atenda de cima para baixo. Ao concluir, a carga sai desta lista.</p>
          </div>
          <span className="loading-head-count">{queue.length}</span>
        </div>

        {loading ? (
          <QueueSkeleton />
        ) : queue.length === 0 ? (
          <EmptyState
            title="Nenhuma carga aguardando"
            hint="Quando uma operação entrar na fila, ela aparecerá aqui."
          />
        ) : (
          <ol className="loading-list">
            {queue.map((item, index) => (
              <li key={item.id} className={`loading-card${lateIds.has(item.id) ? " late" : ""}`}>
                <div className="loading-card-top">
                  <span className="loading-position">{index + 1}º</span>
                  <span className="loading-plate">{item.plate || "SEM PLACA"}</span>
                  <span className="loading-time" title="Chegada">
                    {formatArrival(item.createdAt, timeZone, now)}
                  </span>
                  {lateIds.has(item.id) && <Pill tone="warning">Acima da média</Pill>}
                </div>
                <strong className="loading-customer" title={item.customerName}>
                  {item.customerName}
                </strong>
                <span className="loading-meta">
                  <span className="loading-product-name">{item.productDescription}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.driverName}</span>
                </span>
                <button
                  type="button"
                  className="loading-done"
                  disabled={busy.has(item.id)}
                  onClick={() => void mark(item, new Date().toISOString())}
                  aria-label={`Concluir carga da placa ${item.plate || "sem placa"}`}
                >
                  <CheckCircle2 size={20} />
                  {busy.has(item.id) ? "..." : "Concluir"}
                </button>
              </li>
            ))}
          </ol>
        )}
      </main>

      {showCompleted && (
        <Modal
          title="Concluídas nos últimos 30 min"
          description="Concluiu sem querer? Cancele e a carga volta para a fila em andamento."
          onClose={() => setShowCompleted(false)}
          footer={
            <button type="button" className="btn" onClick={() => setShowCompleted(false)}>
              Fechar
            </button>
          }
        >
          {completed.length === 0 ? (
            <EmptyState
              title="Nenhuma carga concluída nos últimos 30 minutos"
              hint="As cargas que você concluir aparecem aqui por meia hora."
            />
          ) : (
            <ul className="loading-completed">
              {completed.map((item) => (
                <li key={item.id}>
                  <div className="loading-completed-info">
                    <div className="loading-card-top">
                      <span className="loading-plate">{item.plate || "SEM PLACA"}</span>
                      <span className="loading-time" title="Concluída em">
                        {formatArrival(item.loaderCompletedAt, timeZone, now)}
                      </span>
                    </div>
                    <strong className="loading-customer">{item.customerName}</strong>
                    <span className="loading-meta">
                      {item.productDescription} · {item.driverName}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn ghost-danger loading-undo"
                    disabled={busy.has(item.id)}
                    onClick={() => void mark(item, null)}
                    aria-label={`Cancelar carga da placa ${item.plate || "sem placa"}`}
                  >
                    <RotateCcw size={16} />
                    {busy.has(item.id) ? "..." : "Cancelar carga"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {showInstallHelp && (
        <Modal
          title="Instalar como aplicativo"
          onClose={() => setShowInstallHelp(false)}
          footer={
            <button type="button" className="btn" onClick={() => setShowInstallHelp(false)}>
              Fechar
            </button>
          }
        >
          {isIosDevice() ? (
            <ol className="loading-install-steps">
              <li>
                Toque no botão <strong>Compartilhar</strong> do Safari (quadrado com seta para
                cima).
              </li>
              <li>
                Role a lista e toque em <strong>Adicionar à Tela de Início</strong>.
              </li>
              <li>
                Confirme em <strong>Adicionar</strong>. O KyberRock vira um ícone na tela inicial.
              </li>
            </ol>
          ) : (
            <ol className="loading-install-steps">
              <li>
                Abra o menu do navegador (<strong>⋮</strong> no canto superior direito).
              </li>
              <li>
                Toque em <strong>Instalar aplicativo</strong> (ou{" "}
                <strong>Adicionar à tela inicial</strong>).
              </li>
              <li>Confirme. O KyberRock abre em tela cheia, como um app.</li>
            </ol>
          )}
        </Modal>
      )}
    </div>
  );
}

/** A fila enquanto a primeira leitura chega: cartoes cinzas no formato dos de verdade. */
function QueueSkeleton() {
  return (
    <div role="status" aria-label="Carregando a fila">
      <ol className="loading-list" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="loading-card">
            <div className="loading-card-top">
              <Skeleton width={26} height={18} />
              <Skeleton width={104} height={28} radius={6} />
              <span className="loading-time">
                <Skeleton width={44} height={14} />
              </span>
            </div>
            <Skeleton width="65%" height={16} />
            <Skeleton width="45%" height={12} />
            <Skeleton height={52} radius={12} />
          </li>
        ))}
      </ol>
    </div>
  );
}
