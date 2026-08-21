import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import {
  arrangeReleases,
  hasBuildInProgress,
  isPromotionApplied,
  isPromotionStale,
  nextRefreshDelayMs,
  rollbackActionFor,
  type PendingPromotion,
  type PromotionTarget,
  type ReleaseHighlight,
  type ReleaseState
} from "../lib/desktop-updates";
import {
  Badge,
  Button,
  ButtonGroup,
  DataTable,
  Note,
  PageHead,
  Panel,
  Stat,
  StatGrid,
  type Column,
  type Tone
} from "../components/admin";

// ---------------------------------------------------------------------------
// Distribuicao do desktop.
//
// Compilar deixou de ser distribuir: cada merge gera um build que fica PARADO
// (rascunho de release, que updater nenhum enxerga). Desta tela saem os gestos
// que mexem numa versao:
//
//   Enviar para teste     -> so as balancas marcadas como teste passam a receber
//   Liberar para producao -> todas as balancas passam a receber
//   Reprovar              -> quebrou no teste: sai do ar e trava para sempre
//   Voltar para esta      -> volta atras, em duas etapas (ver abaixo)
//
// Consequencia pratica: tres merges seguidos ficam parados e, liberando so o
// ultimo, a balanca da UM salto em vez de instalar tres vezes.
//
// "Compilando" e "Incompleto" chegam iguais do GitHub (release existe, assets
// nao) e sao separados pelo run do Actions que ainda esta rodando. Sem isso
// todo merge pintava a linha de vermelho por alguns minutos, e vermelho aqui
// tem que querer dizer problema.
//
// As travas de verdade vivem no workflow `desktop-promote.yml` (versao nunca
// testada, versao anterior a producao, release incompleta). Aqui elas so evitam
// oferecer um botao que seria recusado depois — o disparo responde na hora, mas
// o resultado so aparece no run do Actions.
//
// ## As tres linhas do topo
//
// A lista pode ter trinta versoes quase iguais. As tres que respondem as
// perguntas do dia a dia sobem e ganham selo (ver `lib/desktop-updates.ts`): a
// que a frota esta recebendo, o ultimo build que o Actions gerou e ninguem
// distribuiu, e a anterior a atual — que e para onde se volta se der problema.
//
// ## Volta atras em duas etapas, e o que ela NAO faz
//
// Voltar uma versao nunca mexe na frota de primeira: a versao antiga vai para o
// anel de TESTE (onde a balanca de teste roda com `allowDowngrade` e realmente
// desce para ela), e so depois a tela oferece regredir a producao. O botao e
// laranja porque e o unico gesto da tela que anda para tras.
//
// E producao NAO desce sozinha: `allowDowngrade` fica desligado ali de
// proposito (`apps/desktop/src/services/update-channel.ts`) — balanca de
// cliente voltando sozinha e regressao silenciosa de dado e de regra fiscal.
// Regredir a producao faz quem ainda nao atualizou receber a versao antiga e
// quem ja atualizou parar onde esta. A tela diz isso na confirmacao; prometer
// outra coisa seria pior do que nao ter o botao.
//
// ## Por que a tela se atualiza sozinha
//
// Nenhum gesto muda alguma coisa na hora: o painel dispara um run e quem
// publica a release e o Actions, segundos depois. A tela por isso NAO espera
// clique nenhum para reler — ela se recarrega em segundo plano, rapido enquanto
// uma promocao esta a caminho e devagar quando nao ha nada em movimento. Antes
// disso a unica saida era recarregar a pagina, o que jogava o administrador de
// volta na primeira aba do console.
// ---------------------------------------------------------------------------

export interface ReleaseRow {
  version: string;
  tag: string;
  state: ReleaseState;
  isCurrentProduction: boolean;
  publishedAt: string | null;
  installerName: string | null;
  isOlderThanProduction: boolean;
  /** Ausente na funcao antiga; `arrangeReleases` e `rollbackActionFor` tratam como false. */
  isNewerThanProduction?: boolean;
  canSendToTest: boolean;
  canReleaseToProduction: boolean;
  canReject: boolean;
}

interface ReleasesResponse {
  releases: ReleaseRow[];
  channelCounts: { latest: number; beta: number };
  canPromote: boolean;
  actionsUrl: string;
}

/**
 * Um gesto da tela: o que ele dispara, como ele se chama e o que ele avisa.
 *
 * Fica tudo junto de proposito. Alvo, `force` e texto de confirmacao mudam
 * juntos — "liberar para producao" e "regredir producao" disparam o MESMO alvo
 * e sao coisas opostas para quem clica, e a unica diferenca segura entre elas e
 * o que o botao diz antes de agir.
 */
export type PromotionIntent =
  | "beta"
  | "latest"
  | "reprovar"
  | "rollback-test"
  | "rollback-production"
  | "resume";

interface ActionCopy {
  target: PromotionTarget;
  /** O workflow recusa promocao regressiva e producao sem teste sem isto. */
  force: boolean;
  label: string;
  busyLabel: string;
  variant: "default" | "primary" | "warn" | "danger";
  /** `null` = gesto direto, sem confirmacao. */
  confirm: ((version: string, currentVersion: string | null) => string) | null;
  /** Mensagem do clique: o pedido saiu, o resultado ainda vai aparecer sozinho. */
  dispatched: (version: string) => string;
  /** Mensagem de quando o run terminou e a lista JA mostra o novo estado. */
  done: (version: string) => string;
}

export const PROMOTION_ACTIONS: Record<PromotionIntent, ActionCopy> = {
  beta: {
    target: "beta",
    force: false,
    label: "Enviar para teste",
    busyLabel: "Enviando…",
    variant: "default",
    confirm: null,
    dispatched: (v) => `Enviando a versao ${v} para o anel de teste…`,
    done: (v) =>
      `Versao ${v} enviada para o anel de teste. As balancas marcadas como teste recebem na proxima verificacao.`
  },
  latest: {
    target: "latest",
    force: false,
    label: "Liberar para producao",
    busyLabel: "Liberando…",
    variant: "primary",
    confirm: null,
    dispatched: (v) => `Liberando a versao ${v} para producao…`,
    done: (v) =>
      `Versao ${v} liberada para producao. As balancas recebem na proxima verificacao e instalam quando o operador fechar o app.`
  },
  reprovar: {
    target: "reprovar",
    force: false,
    label: "Reprovar",
    busyLabel: "Reprovando…",
    variant: "danger",
    confirm: (version) =>
      `Reprovar a versao ${version}?\n\n` +
      "Ela sai do ar e NUNCA mais podera ir para teste ou producao. " +
      "A balanca de teste volta sozinha para a ultima versao aprovada.",
    dispatched: (v) => `Reprovando a versao ${v}…`,
    done: (v) =>
      `Versao ${v} reprovada. Ela saiu do ar e nao pode mais ser distribuida; a balanca de teste volta para a ultima aprovada na proxima verificacao.`
  },
  "rollback-test": {
    target: "beta",
    force: false,
    label: "Voltar para esta versao",
    busyLabel: "Voltando…",
    variant: "warn",
    confirm: (version, current) =>
      `Voltar para a versao ${version}?\n\n` +
      "Ela vai primeiro para o anel de TESTE: a balanca de teste desce para esta versao sozinha na proxima verificacao, e voce confere antes de mexer na frota.\n\n" +
      `A producao continua ${current ? `na ${current}` : "onde esta"}. Depois de conferir, esta mesma linha oferece regredir a producao.`,
    dispatched: (v) => `Voltando para a versao ${v} no anel de teste…`,
    done: (v) =>
      `Versao ${v} publicada no anel de teste. A balanca de teste desce para ela na proxima verificacao; a producao continua onde estava.`
  },
  "rollback-production": {
    target: "latest",
    force: true,
    label: "Regredir producao para esta versao",
    busyLabel: "Regredindo…",
    variant: "warn",
    confirm: (version, current) =>
      `Regredir a producao para a versao ${version}?\n\n` +
      `A frota passa a receber a ${version} no lugar da ${current ?? "versao atual"}.\n\n` +
      "ATENCAO: quem JA instalou a versao mais nova continua nela — a balanca de producao nao volta sozinha. Na pratica essas maquinas param onde estao ate sair uma versao mais nova com a correcao.",
    dispatched: (v) => `Regredindo a producao para a versao ${v}…`,
    done: (v) =>
      `Producao regredida para a versao ${v}. Quem ainda nao atualizou passa a receber esta versao; quem ja instalou a mais nova permanece nela ate sair uma versao maior.`
  },
  resume: {
    target: "latest",
    force: true,
    label: "Retomar producao nesta versao",
    busyLabel: "Retomando…",
    variant: "primary",
    confirm: (version, current) =>
      `Retomar a producao na versao ${version}?\n\n` +
      `Desfaz a regressao: a frota volta a receber a ${version} no lugar da ${current ?? "versao atual"}.`,
    dispatched: (v) => `Retomando a producao na versao ${v}…`,
    done: (v) => `Producao de volta na versao ${v}. As balancas recebem na proxima verificacao.`
  }
};

const STATE_LABEL: Record<string, { text: string; tone: Tone }> = {
  producao: { text: "Producao", tone: "ok" },
  teste: { text: "Em teste", tone: "info" },
  parado: { text: "Parado", tone: "neutral" },
  compilando: { text: "Compilando", tone: "info" },
  reprovada: { text: "Reprovada", tone: "warn" },
  incompleto: { text: "Incompleto", tone: "danger" }
};

/** Selo das tres linhas que sobem para o topo. */
const HIGHLIGHT_LABEL: Record<ReleaseHighlight, { text: string; tone: Tone }> = {
  atual: { text: "Versao atual", tone: "ok" },
  ultima: { text: "Ultima gerada", tone: "info" },
  anterior: { text: "Versao anterior", tone: "warn" }
};

/**
 * Rotulo da situacao, tolerante a um estado que este bundle ainda nao conhece.
 *
 * As Edge Functions sao implantadas pelo CI a cada push; o loader-web e
 * publicado a mao (Docker/EasyPanel). Nessa janela a funcao ja devolve estados
 * novos para uma tela antiga — e `STATE_LABEL[estado].tone` num estado ausente
 * derruba a aba inteira com TypeError. Uma situacao desconhecida tem que virar
 * um rotulo feio, nunca uma tela em branco.
 */
function stateLabel(state: string): { text: string; tone: Tone } {
  return STATE_LABEL[state] ?? { text: state, tone: "neutral" };
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
}

function formatClock(value: number | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("pt-BR");
}

/**
 * Gestos que a linha oferece, na ordem em que aparecem.
 *
 * Quando ha volta atras, ela e o UNICO botao da linha. Uma versao antiga em
 * teste tambem satisfaz o `canReject` da funcao, e "Reprovar" ali seria uma
 * armadilha: trava para sempre a versao boa que existe justamente para servir
 * de porto seguro.
 */
export function intentsFor(release: ReleaseRow): PromotionIntent[] {
  const rollback = rollbackActionFor(release);
  if (rollback === "test") return ["rollback-test"];
  if (rollback === "production") return ["rollback-production"];
  if (rollback === "resume") return ["resume"];

  const intents: PromotionIntent[] = [];
  if (release.canSendToTest) intents.push("beta");
  if (release.canReleaseToProduction) intents.push("latest");
  if (release.canReject) intents.push("reprovar");
  return intents;
}

interface PendingAction extends PendingPromotion {
  intent: PromotionIntent;
}

export function DesktopUpdates({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  /** Verificacao de fundo em curso: informa, mas nunca esvazia a tela. */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  /** Sobe a cada verificacao concluida (inclusive as que falharam) e reagenda a proxima. */
  const [refreshTick, setRefreshTick] = useState(0);
  /** Gesto disparado cujo resultado ainda nao apareceu na lista. */
  const [pending, setPending] = useState<PendingAction | null>(null);
  /** Versao entre o clique e a resposta do disparo. */
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden"
  );
  const [feedback, setFeedback] = useState<{ tone: Tone; text: string } | null>(null);

  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof AdminSessionExpiredError) {
        onSessionExpired();
        return;
      }
      setFeedback({ tone: "danger", text: error instanceof Error ? error.message : fallback });
    },
    [onSessionExpired]
  );

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (options.silent) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const next = await callAdminFunction<ReleasesResponse>("admin-api", {
          action: "list_desktop_releases"
        });
        setData(next);
        setLastRefreshAt(Date.now());
        // O gesto so termina quando a versao aparece no estado pedido: e isso
        // que devolve os botoes da linha e fecha a mensagem do clique.
        setPending((current) => {
          if (!current || !isPromotionApplied(next.releases, current)) return current;
          setFeedback({
            tone: "ok",
            text: PROMOTION_ACTIONS[current.intent].done(current.version)
          });
          return null;
        });
      } catch (error) {
        if (error instanceof AdminSessionExpiredError) {
          onSessionExpired();
          return;
        }
        // Verificacao de fundo que falhou nao apaga a lista nem pinta a tela de
        // vermelho: a leitura anterior continua valendo e a proxima vem em
        // segundos. So o pedido explicito (abrir a aba, clicar em Atualizar)
        // vira mensagem de erro.
        if (!options.silent) {
          handleError(error, "Nao foi possivel carregar as versoes.");
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
        setRefreshTick((tick) => tick + 1);
      }
    },
    [handleError, onSessionExpired]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Aba escondida nao tem quem olhe: parar de verificar poupa o limite por hora
  // da API do GitHub, e voltar para a aba recarrega na hora — que e justamente
  // quando o administrador quer ver o estado atual.
  useEffect(() => {
    if (typeof document === "undefined") return;
    function handleVisibility() {
      const visible = document.visibilityState !== "hidden";
      setIsVisible(visible);
      if (visible) void load({ silent: true });
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [load]);

  // O run nao respondeu no prazo: quase sempre o workflow recusou o pedido, e
  // recusa nao muda estado nenhum. Devolve os botoes e manda olhar o run em vez
  // de deixar a linha girando para sempre.
  useEffect(() => {
    if (!pending || !isPromotionStale(pending, Date.now())) return;
    setPending(null);
    setFeedback({
      tone: "warn",
      text: `A versao ${pending.version} ainda nao mudou de situacao. O workflow pode ter recusado o pedido — confira o run no GitHub Actions.`
    });
  }, [pending, refreshTick]);

  const refreshDelay = useMemo(
    () =>
      nextRefreshDelayMs({
        isVisible,
        hasPendingPromotion: pending !== null,
        isBuilding: hasBuildInProgress(data?.releases ?? [])
      }),
    [isVisible, pending, data]
  );

  useEffect(() => {
    if (refreshDelay === null || typeof window === "undefined") return;
    const timer = window.setTimeout(() => void load({ silent: true }), refreshDelay);
    return () => window.clearTimeout(timer);
    // `refreshTick` reagenda a proxima verificacao assim que a anterior termina.
  }, [refreshDelay, refreshTick, load]);

  const { ordered, highlights } = useMemo(() => arrangeReleases(data?.releases ?? []), [data]);
  const currentVersion = ordered.find((release) => release.isCurrentProduction)?.version ?? null;

  async function promote(release: ReleaseRow, intent: PromotionIntent) {
    const action = PROMOTION_ACTIONS[intent];
    if (action.confirm && !window.confirm(action.confirm(release.version, currentVersion))) return;

    setDispatching(release.version);
    setFeedback({ tone: "info", text: action.dispatched(release.version) });
    try {
      await callAdminFunction("admin-api", {
        action: "promote_desktop_release",
        payload: { version: release.version, target: action.target, force: action.force }
      });
      // O disparo respondeu; o resultado sai do run. A linha fica em espera e a
      // tela passa a reler de poucos em poucos segundos ate o estado mudar.
      setPending({
        version: release.version,
        target: action.target,
        intent,
        startedAt: Date.now()
      });
      void load({ silent: true });
    } catch (error) {
      setFeedback(null);
      handleError(error, "Nao foi possivel promover a versao.");
    } finally {
      setDispatching(null);
    }
  }

  const columns: Array<Column<ReleaseRow>> = [
    {
      key: "version",
      header: "Versao",
      render: (release) => {
        const highlight = highlights[release.version];
        return (
          <>
            <span className="adm-cell-primary adm-mono">{release.version}</span>
            {highlight && (
              <p className="adm-cell-sub">
                <Badge tone={HIGHLIGHT_LABEL[highlight].tone}>
                  {HIGHLIGHT_LABEL[highlight].text}
                </Badge>
              </p>
            )}
            {release.installerName && <p className="adm-cell-sub">{release.installerName}</p>}
          </>
        );
      }
    },
    {
      key: "state",
      header: "Situacao",
      render: (release) => (
        <>
          <Badge tone={stateLabel(release.state).tone} dot>
            {stateLabel(release.state).text}
          </Badge>
          {pending?.version === release.version && (
            <p className="adm-cell-sub">
              Aplicando no GitHub… a situacao muda aqui sozinha quando o run terminar.
            </p>
          )}
          {release.isCurrentProduction && (
            <p className="adm-cell-sub">E a versao que a frota esta recebendo.</p>
          )}
          {highlights[release.version] === "ultima" && release.state === "parado" && (
            <p className="adm-cell-sub">
              Saiu do GitHub Actions e ainda nao foi distribuida para anel nenhum.
            </p>
          )}
          {release.state === "producao" && release.isNewerThanProduction && (
            <p className="adm-cell-sub">
              Publicada, mas a frota esta numa versao anterior — regressao em vigor.
            </p>
          )}
          {release.state === "producao" && release.isOlderThanProduction && (
            <p className="adm-cell-sub">Estavel anterior: da para voltar a frota para ela.</p>
          )}
          {release.state === "compilando" && (
            <p className="adm-cell-sub">O build esta rodando; os arquivos ainda estao subindo.</p>
          )}
          {release.state === "reprovada" && (
            <p className="adm-cell-sub">Quebrou no teste. Fora do ar e travada para promocao.</p>
          )}
          {release.state === "incompleto" && (
            <p className="adm-cell-sub">
              Faltam arquivos na release (instalador ou metadado) — nao da para distribuir.
            </p>
          )}
        </>
      )
    },
    {
      key: "published",
      header: "Publicada em",
      render: (release) => <span className="adm-mono">{formatDateTime(release.publishedAt)}</span>
    },
    {
      key: "actions",
      header: "",
      actions: true,
      render: (release) => {
        const busy = dispatching === release.version || pending?.version === release.version;
        // Enquanto um run esta a caminho a tela nao oferece outro: o workflow
        // trata um pedido por vez e o segundo clique so viraria confusao.
        const blocked = busy || dispatching !== null || pending !== null;
        const intents = intentsFor(release);
        if (intents.length === 0) {
          return (
            <span className="adm-cell-sub">
              {release.isOlderThanProduction ? "Anterior a producao atual." : "—"}
            </span>
          );
        }
        return (
          <ButtonGroup>
            {intents.map((intent) => (
              <Button
                key={intent}
                size="sm"
                variant={PROMOTION_ACTIONS[intent].variant}
                disabled={blocked}
                onClick={() => void promote(release, intent)}
              >
                {busy ? PROMOTION_ACTIONS[intent].busyLabel : PROMOTION_ACTIONS[intent].label}
              </Button>
            ))}
          </ButtonGroup>
        );
      }
    }
  ];

  return (
    <>
      <PageHead
        title="Atualizacoes do desktop"
        description="Cada merge gera uma versao que fica parada ate voce mandar. Nada chega nas balancas sozinho."
      />

      {feedback && <Note tone={feedback.tone}>{feedback.text}</Note>}

      {data && !data.canPromote && (
        <Note tone="warn">
          Falta o secret <strong className="adm-mono">GH_ACTIONS_TOKEN</strong> no Supabase para
          promover por aqui. Crie um PAT fine-grained deste repositorio com{" "}
          <strong>Actions: write</strong> e <strong>Contents: read and write</strong> (a permissao
          de conteudo e o que faz os builds parados aparecerem nesta lista) e cadastre-o. Enquanto
          isso, a promocao continua disponivel na{" "}
          <a href={data.actionsUrl} target="_blank" rel="noreferrer">
            pagina do workflow no GitHub
          </a>
          .
        </Note>
      )}

      {data && (
        <StatGrid>
          <Stat label="Balancas em producao" value={String(data.channelCounts.latest)} />
          <Stat
            label="Balancas em teste"
            value={String(data.channelCounts.beta)}
            hint={
              data.channelCounts.beta === 0
                ? "Nenhuma balanca avalia as versoes antes da frota. Marque uma em Balancas."
                : undefined
            }
          />
        </StatGrid>
      )}

      <Panel
        title="Versoes publicadas"
        description="No topo: a versao que a frota recebe, o ultimo build gerado pelo GitHub e a versao anterior — que e para onde a volta atras leva."
        flush
        actions={
          <>
            <span className="adm-cell-sub">
              {isLoading || isRefreshing
                ? "Verificando…"
                : pending
                  ? "Acompanhando o run…"
                  : `Atualizado as ${formatClock(lastRefreshAt)}`}
            </span>
            <Button onClick={() => void load()} disabled={isLoading}>
              {isLoading ? "Carregando…" : "Atualizar"}
            </Button>
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={ordered}
          rowKey={(release) => release.tag}
          empty={
            isLoading
              ? "Carregando versoes…"
              : "Nenhuma versao encontrada. Builds parados so aparecem aqui se o GH_ACTIONS_TOKEN tiver Contents: read and write."
          }
        />
      </Panel>
    </>
  );
}
