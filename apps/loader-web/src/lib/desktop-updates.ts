/**
 * Regras de atualizacao ao vivo da aba "Atualizacoes do desktop".
 *
 * A tela nao manda em nada sozinha: promover dispara um run do
 * `desktop-promote.yml` e o estado da versao so muda no GitHub quando aquele
 * run termina — segundos depois, as vezes um minuto. Enquanto isso a lista
 * continua mostrando a leitura antiga, e sem recarregar a pagina a tela parecia
 * travada logo depois do clique que mais importa.
 *
 * Por isso o recarregamento aqui e RITMADO PELO QUE ESTA ACONTECENDO, e nao um
 * intervalo fixo: rapido enquanto uma promocao esta a caminho, moderado
 * enquanto um build compila, lento quando nao ha nada em movimento (cada
 * verificacao gasta duas chamadas na API do GitHub, que tem limite por hora).
 *
 * O mesmo modulo decide o que a lista mostra primeiro e que gesto cada linha
 * oferece — inclusive a VOLTA ATRAS, que e o gesto mais perigoso da tela e o
 * unico com duas etapas (ver `rollbackActionFor`).
 *
 * Modulo puro para ter teste: e ele que decide quando a tela desiste de esperar
 * um run — desistir cedo demais reabre os botoes de uma versao que ainda esta
 * mudando, e nao desistir nunca deixa a linha em "Aplicando…" para sempre.
 */

export type ReleaseState =
  | "producao"
  | "teste"
  | "parado"
  | "compilando"
  | "reprovada"
  | "incompleto";

/** Alvos que a tela pode disparar (os mesmos aceitos pelo `admin-api`). */
export type PromotionTarget = "beta" | "latest" | "reprovar";

export interface PendingPromotion {
  version: string;
  target: PromotionTarget;
  /** `Date.now()` do disparo — base do prazo de espera. */
  startedAt: number;
}

/**
 * O minimo que este modulo precisa saber de uma versao.
 *
 * `isNewerThanProduction` e opcional de proposito: as Edge Functions sao
 * implantadas pelo CI a cada push e o loader-web e publicado a mao, entao
 * existe uma janela em que a tela nova conversa com a funcao velha, que ainda
 * nao manda esse campo. Ausente vale `false` — a tela deixa de oferecer o
 * botao de retomar producao, nunca quebra.
 */
export interface ReleaseLike {
  version: string;
  state: ReleaseState;
  isCurrentProduction: boolean;
  isOlderThanProduction: boolean;
  isNewerThanProduction?: boolean;
}

/**
 * Quanto tempo a tela espera o run antes de parar de tratar a promocao como
 * "a caminho".
 *
 * O workflow costuma resolver em menos de um minuto; passar disso quase sempre
 * quer dizer que ele recusou o pedido (versao nunca testada, regressiva,
 * release incompleta) — e recusa nao muda estado nenhum, entao esperar mais nao
 * traria resposta. Ao vencer o prazo a tela devolve os botoes e manda o
 * administrador olhar o run, em vez de ficar girando.
 */
export const PROMOTION_TIMEOUT_MS = 3 * 60_000;

const PENDING_REFRESH_MS = 3_000;
const BUILDING_REFRESH_MS = 8_000;
const IDLE_REFRESH_MS = 30_000;

/**
 * A promocao ja apareceu na lista?
 *
 * Compara a LINHA PEDIDA, e nao "a lista mudou": o run mexe em outras linhas no
 * caminho (liberar producao rebaixa a anterior), e so a versao promovida diz
 * que o gesto do administrador pegou.
 *
 * Producao se confere por `isCurrentProduction`, nao pelo estado: numa volta
 * atras a versao de destino JA e uma release estavel — ela estaria em
 * "producao" desde antes do clique, e a tela daria o gesto por concluido sem o
 * run ter feito nada. Quem responde de verdade e o `/releases/latest`, que e
 * de onde esse campo vem.
 */
export function isPromotionApplied(
  releases: ReadonlyArray<ReleaseLike>,
  pending: PendingPromotion | null
): boolean {
  if (!pending) return false;
  const row = releases.find((release) => release.version === pending.version);
  if (!row) return false;
  if (pending.target === "latest") return row.isCurrentProduction;
  return row.state === (pending.target === "beta" ? "teste" : "reprovada");
}

/** Venceu o prazo de espera do run (ver `PROMOTION_TIMEOUT_MS`). */
export function isPromotionStale(pending: PendingPromotion | null, now: number): boolean {
  if (!pending) return false;
  return now - pending.startedAt >= PROMOTION_TIMEOUT_MS;
}

/**
 * Intervalo ate a proxima verificacao.
 *
 * `null` quer dizer "nao verifique agora": aba escondida nao tem quem olhe, e
 * continuar consultando o GitHub em segundo plano so gasta o limite por hora
 * que as promocoes de verdade vao precisar. Ao voltar para a aba a tela
 * recarrega na hora.
 */
export function nextRefreshDelayMs(options: {
  isVisible: boolean;
  hasPendingPromotion: boolean;
  isBuilding: boolean;
}): number | null {
  if (!options.isVisible) return null;
  if (options.hasPendingPromotion) return PENDING_REFRESH_MS;
  if (options.isBuilding) return BUILDING_REFRESH_MS;
  return IDLE_REFRESH_MS;
}

/** Uma versao esta compilando: os arquivos ainda estao subindo e o estado vai mudar sozinho. */
export function hasBuildInProgress(releases: ReadonlyArray<{ state: ReleaseState }>): boolean {
  return releases.some((release) => release.state === "compilando");
}

// ---------------------------------------------------------------------------
// O que a lista mostra primeiro, e o que cada linha oferece.
// ---------------------------------------------------------------------------

/**
 * As tres linhas que respondem sozinhas as perguntas do dia a dia:
 *
 *   atual    -> o que a frota esta recebendo agora
 *   ultima   -> o build mais novo que o GitHub Actions gerou e ninguem distribuiu
 *   anterior -> para onde da para voltar se a atual der problema
 *
 * Sao marcadas E sobem para o topo, nessa ordem. Numa lista de trinta versoes
 * quase iguais, "a de cima e a que esta rodando" e mais rapido de ler do que
 * procurar o selo verde no meio da tabela.
 */
export type ReleaseHighlight = "atual" | "ultima" | "anterior";

/** Estados de um build que saiu do Actions e ainda nao foi para anel nenhum. */
const NEVER_DISTRIBUTED: ReadonlySet<ReleaseState> = new Set<ReleaseState>([
  "parado",
  "compilando",
  "incompleto"
]);

/** So estes podem voltar a circular: os outros nao tem binario ou estao travados. */
const DISTRIBUTABLE: ReadonlySet<ReleaseState> = new Set<ReleaseState>([
  "producao",
  "teste",
  "parado"
]);

/**
 * Gesto de volta atras que esta linha oferece — ou `null`, que e o caso comum.
 *
 *   "test"       -> manda a versao antiga para o anel de teste. E a PRIMEIRA
 *                   etapa, e de proposito: a balanca de teste roda com
 *                   `allowDowngrade`, entao ela realmente volta para essa versao
 *                   e alguem consegue conferir antes de mexer na frota.
 *   "production" -> ja esta em teste e mais antiga que a producao: agora sim da
 *                   para regredir a frota (o workflow so aceita com `force`).
 *   "resume"     -> versao estavel MAIS NOVA que a producao, situacao que so
 *                   existe depois de uma regressao. E o caminho de volta para a
 *                   frente; sem ele a volta atras seria porta de uma via so.
 *
 * O que o botao NAO faz, e por isso a tela precisa dizer: regredir producao nao
 * puxa de volta quem ja instalou a versao nova. Producao roda com
 * `allowDowngrade` desligado (`apps/desktop/src/services/update-channel.ts`) —
 * balanca de cliente andando para tras sozinha e regressao silenciosa de dado e
 * de regra fiscal. Na pratica a frota PARA na versao em que esta e volta a
 * andar quando existir uma versao mais nova; quem ainda nao atualizou passa a
 * receber a versao antiga.
 */
export function rollbackActionFor(release: ReleaseLike): "test" | "production" | "resume" | null {
  if (release.isCurrentProduction) return null;
  if (!DISTRIBUTABLE.has(release.state)) return null;

  if (release.isOlderThanProduction) {
    return release.state === "teste" ? "production" : "test";
  }

  // Estavel e a frente da producao: e a versao de onde se voltou.
  if (release.isNewerThanProduction === true && release.state === "producao") return "resume";

  return null;
}

/**
 * Ordena a lista e diz quais linhas ganham selo.
 *
 * Recebe as versoes na ordem do GitHub (mais nova primeiro) e devolve as tres
 * destacadas na frente, seguidas do resto na mesma ordem em que chegaram. A
 * ordem de origem e preservada de proposito: ela ja e a cronologia dos builds, e
 * reordenar por numero de versao aqui so criaria uma segunda regra para manter.
 */
export function arrangeReleases<T extends ReleaseLike>(
  releases: readonly T[]
): { ordered: T[]; highlights: Record<string, ReleaseHighlight> } {
  const highlights: Record<string, ReleaseHighlight> = {};

  const atual = releases.find((release) => release.isCurrentProduction);
  const ultima = releases.find((release) => NEVER_DISTRIBUTED.has(release.state));
  // A candidata natural da volta atras: a mais nova entre as anteriores a
  // producao que ainda podem circular.
  const anterior = releases.find(
    (release) => release.isOlderThanProduction && DISTRIBUTABLE.has(release.state)
  );

  const ordered: T[] = [];
  for (const [release, highlight] of [
    [atual, "atual"],
    [ultima, "ultima"],
    [anterior, "anterior"]
  ] as Array<[T | undefined, ReleaseHighlight]>) {
    // Uma versao so pode ganhar um selo: a mesma linha pode ser candidata a
    // mais de um (nao ha build novo, e a "ultima" acaba sendo a anterior) e o
    // primeiro da lista acima vence.
    if (!release || highlights[release.version]) continue;
    highlights[release.version] = highlight;
    ordered.push(release);
  }

  for (const release of releases) {
    if (highlights[release.version] === undefined) ordered.push(release);
  }

  return { ordered, highlights };
}
