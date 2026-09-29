import "./loading.css";

import {
  Bell,
  BellOff,
  CheckCircle2,
  Download,
  History,
  LogOut,
  Moon,
  RotateCcw,
  Sun,
  SunMedium
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, ErrorState, Modal, Pill, Skeleton, useToast } from "../components/ui";
import { useAuth, useUser } from "../lib/auth";
import { readDeviceFlag, writeDeviceFlag } from "../lib/device-prefs";
import {
  LOADER_SOUND_STORAGE_KEY,
  LOADER_SUN_STORAGE_KEY,
  countByProduct,
  formatArrival,
  inProgress,
  newQueueArrivals,
  overtime,
  recentlyCompleted,
  type LoadingItem
} from "../lib/loading";
import { isIosDevice, useInstallPrompt } from "../lib/pwa-install";
import { supabase } from "../lib/supabase";
import { useTheme } from "../lib/theme";

const COLUMNS =
  "id,plate,customer_name,driver_name,product_description,created_at,loader_completed_at";

/** Vibra, para, vibra: da para sentir no bolso com o caminhao ligado do lado. */
const NEW_LOAD_VIBRATION = [220, 120, 220];

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  if ("AudioContext" in window) return window.AudioContext;
  // Safari antigo (iPhone com iOS < 14.5) so tem o nome com prefixo.
  return (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null;
}

/** Um bipe curto gerado na hora (sem arquivo de som): sobe rapido, dura 1/4 de segundo e some. */
function playBeep(context: AudioContext): void {
  try {
    const start = context.currentTime + 0.01;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.27);
  } catch {
    // Aparelho sem saida de audio: o aviso fica so na vibracao.
  }
}

/**
 * O aviso de carga nova: vibra (se o aparelho vibra) e, com o som ligado, toca o bipe. O
 * navegador so deixa tocar som depois de um toque da pessoa, entao o audio nasce no toque que
 * liga o som (`unlock`) — e, com o som ja ligado de uma visita anterior, no primeiro toque na tela.
 */
function useNewLoadAlert(soundOn: boolean) {
  const contextRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(soundOn);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  /** Chamar DENTRO de um toque: cria o audio (ou acorda o que estava parado). */
  const unlock = useCallback((): AudioContext | null => {
    let context = contextRef.current;
    if (!context) {
      const Ctor = audioContextCtor();
      if (!Ctor) return null;
      try {
        context = new Ctor();
      } catch {
        return null;
      }
      contextRef.current = context;
    }
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  }, []);

  useEffect(() => {
    if (!soundOn) return undefined;
    const onGesture = () => {
      if (contextRef.current?.state !== "running") unlock();
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [soundOn, unlock]);

  useEffect(
    () => () => {
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    },
    []
  );

  const alert = useCallback(() => {
    try {
      if (typeof navigator.vibrate === "function") navigator.vibrate(NEW_LOAD_VIBRATION);
    } catch {
      // Sem vibracao (ou bloqueada ate o primeiro toque): segue so com o som.
    }
    const context = contextRef.current;
    // Audio ainda travado (ninguem tocou na tela desde que abriu): tocar agora sairia atrasado
    // no proximo toque, fora de hora. Melhor nao tocar.
    if (soundOnRef.current && context?.state === "running") playBeep(context);
  }, []);

  /** Ligou o som: destrava o audio e toca um bipe de amostra (a pessoa ouve que funciona). */
  const preview = useCallback((): boolean => {
    const context = unlock();
    if (!context) return false;
    if (context.state === "running") playBeep(context);
    else
      void context
        .resume()
        .then(() => playBeep(context))
        .catch(() => undefined);
    return true;
  }, [unlock]);

  return { alert, preview };
}

/**
 * Tela do carregador: a fila de carregamento da unidade dele, e nada mais. Mesmas regras e as
 * mesmas informacoes da tela que existia no KyberRock Portal (`apps/loader-web`), que deixou de
 * receber o carregador. Feita para o celular na mao e para o tablet no patio: botoes grandes,
 * "Concluir" na largura do cartao, faixa de produtos que rola de lado, e em tablet os cartoes
 * vao para duas colunas. Instala como app (o mesmo "Instalar app" do portal).
 *
 * Carga nova na fila (id que nao estava na leitura anterior) vibra o aparelho e, com o "Som de
 * nova carga" ligado, toca um bipe. O "Modo sol" troca a tela por alto contraste (fundo branco,
 * texto preto, placa e "Concluir" maiores) para ler no patio. As duas escolhas ficam no aparelho
 * (`loading.css` tem o visual; `styles.css` continua com o resto das classes `loading-*`).
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
  const [soundOn, setSoundOn] = useState(() => readDeviceFlag(LOADER_SOUND_STORAGE_KEY, false));
  const [sunOn, setSunOn] = useState(() => readDeviceFlag(LOADER_SUN_STORAGE_KEY, false));
  const { isInstalled, install } = useInstallPrompt();
  const { alert: alertNewLoad, preview: previewSound } = useNewLoadAlert(soundOn);
  /** Ids da leitura anterior (todas as abertas, inclusive as ja concluidas); `null` antes da 1a. */
  const seenIdsRef = useRef<ReadonlySet<string> | null>(null);

  async function installApp() {
    if ((await install()) === "instructions") setShowInstallHelp(true);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    writeDeviceFlag(LOADER_SOUND_STORAGE_KEY, next);
    if (next && !previewSound()) {
      toast.push("Este aparelho não toca o aviso sonoro. A carga nova só vibra.", "warn");
    }
  }

  function toggleSun() {
    const next = !sunOn;
    setSunOn(next);
    writeDeviceFlag(LOADER_SUN_STORAGE_KEY, next);
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
    const next: LoadingItem[] = (data ?? []).map((row) => ({
      id: row.id,
      plate: row.plate ?? "",
      customerName: row.customer_name ?? "",
      driverName: row.driver_name ?? "",
      productDescription: row.product_description ?? "",
      createdAt: row.created_at,
      loaderCompletedAt: row.loader_completed_at
    }));
    // Compara com a leitura anterior DEPOIS da resposta: duas leituras cruzadas (aviso do
    // Realtime + tique) nao apitam duas vezes a mesma carga.
    const arrivals = newQueueArrivals(seenIdsRef.current, next);
    seenIdsRef.current = new Set(next.map((item) => item.id));
    if (arrivals.length > 0) alertNewLoad();
    setItems(next);
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
  }, [user.unitId, alertNewLoad]);

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
    <div className={`loading-shell${sunOn ? " is-sun" : ""}`}>
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
        {/* No modo sol a tela e sempre clara: o tema claro/escuro volta quando ele desliga. */}
        {!sunOn && (
          <button
            type="button"
            className="loading-top-btn"
            onClick={toggle}
            aria-label="Alternar tema"
            title={theme === "light" ? "Tema escuro" : "Tema claro"}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        )}
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
        <div className="loading-prefs" role="group" aria-label="Preferências deste aparelho">
          <button
            type="button"
            className={`loading-pref${soundOn ? " is-on" : ""}`}
            aria-pressed={soundOn}
            onClick={toggleSound}
            title={
              soundOn
                ? "Desligar o bipe quando entrar carga nova"
                : "Tocar um bipe quando entrar carga nova"
            }
          >
            {soundOn ? (
              <Bell size={20} aria-hidden="true" />
            ) : (
              <BellOff size={20} aria-hidden="true" />
            )}
            <span className="loading-pref-text">
              <span className="loading-pref-label">Som de nova carga</span>
              <span className="loading-pref-state">{soundOn ? "Ligado" : "Desligado"}</span>
            </span>
          </button>
          <button
            type="button"
            className={`loading-pref${sunOn ? " is-on" : ""}`}
            aria-pressed={sunOn}
            onClick={toggleSun}
            title={sunOn ? "Voltar ao tema normal" : "Alto contraste para ler no sol"}
          >
            <SunMedium size={20} aria-hidden="true" />
            <span className="loading-pref-text">
              <span className="loading-pref-label">Modo sol</span>
              <span className="loading-pref-state">{sunOn ? "Ligado" : "Desligado"}</span>
            </span>
          </button>
        </div>

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
