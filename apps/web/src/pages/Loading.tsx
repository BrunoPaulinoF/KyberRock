import { CheckCircle2, Download, History, LogOut, Moon, RotateCcw, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Modal } from "../components/ui";
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
      setError("Nao foi possivel carregar a fila. Confira a internet e tente de novo.");
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
          ? "Nao foi possivel concluir a carga. Tente de novo."
          : "Nao foi possivel devolver a carga para a fila. Tente de novo."
      );
    }
    setBusy((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
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
            Concluidas ha pouco
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

        {error && (
          <Alert kind="error">
            {error}{" "}
            <button type="button" className="btn link" onClick={() => void load()}>
              Tentar de novo
            </button>
          </Alert>
        )}

        {late.length > 0 && (
          <div className="loading-late" role="alert">
            <strong>Acima do tempo medio ({Math.round(avgMinutes ?? 0)} min):</strong>
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
          <div className="loading-empty">
            <strong>Carregando fila...</strong>
            <span>Buscando cargas em aberto da unidade.</span>
          </div>
        ) : queue.length === 0 ? (
          <div className="loading-empty">
            <strong>Nenhuma carga aguardando</strong>
            <span>Quando uma operacao entrar na fila, ela aparecera aqui.</span>
          </div>
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
                  {lateIds.has(item.id) && <span className="badge warn">Acima da media</span>}
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
          title="Concluidas nos ultimos 30 min"
          description="Concluiu sem querer? Cancele e a carga volta para a fila em andamento."
          onClose={() => setShowCompleted(false)}
          footer={
            <button type="button" className="btn" onClick={() => setShowCompleted(false)}>
              Fechar
            </button>
          }
        >
          {completed.length === 0 ? (
            <div className="empty">
              Nenhuma carga concluida nos ultimos 30 minutos. As cargas que voce concluir aparecem
              aqui por meia hora.
            </div>
          ) : (
            <ul className="loading-completed">
              {completed.map((item) => (
                <li key={item.id}>
                  <div className="loading-completed-info">
                    <div className="loading-card-top">
                      <span className="loading-plate">{item.plate || "SEM PLACA"}</span>
                      <span className="loading-time" title="Concluida em">
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
                Toque no botao <strong>Compartilhar</strong> do Safari (quadrado com seta para
                cima).
              </li>
              <li>
                Role a lista e toque em <strong>Adicionar a Tela de Inicio</strong>.
              </li>
              <li>
                Confirme em <strong>Adicionar</strong>. O KyberRock vira um icone na tela inicial.
              </li>
            </ol>
          ) : (
            <ol className="loading-install-steps">
              <li>
                Abra o menu do navegador (<strong>⋮</strong> no canto superior direito).
              </li>
              <li>
                Toque em <strong>Instalar aplicativo</strong> (ou{" "}
                <strong>Adicionar a tela inicial</strong>).
              </li>
              <li>Confirme. O KyberRock abre em tela cheia, como um app.</li>
            </ol>
          )}
        </Modal>
      )}
    </div>
  );
}
