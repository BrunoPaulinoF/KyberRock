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

/**
 * Alvos que a tela pode disparar (os mesmos aceitos pelo `admin-api`).
 *
 * `parar` devolve a versao ao rascunho: e o cancelamento do teste, e nao uma
 * condenacao — `reprovar` marca a release para sempre, `parar` deixa a versao
 * pronta para ir a teste de novo.
 */
export type PromotionTarget = "beta" | "latest" | "reprovar" | "parar";

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

/** Estado em que a versao fica quando o alvo pedido e aplicado. */
const TARGET_STATE: Record<Exclude<PromotionTarget, "latest">, ReleaseState> = {
  beta: "teste",
  reprovar: "reprovada",
  parar: "parado"
};

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
  return row.state === TARGET_STATE[pending.target];
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
 * As quatro linhas que respondem sozinhas as perguntas do dia a dia:
 *
 *   atual    -> o que a frota esta recebendo agora
 *   teste    -> o que as balancas de teste estao avaliando agora
 *   ultima   -> o build mais novo que o GitHub Actions gerou e ninguem distribuiu
 *   anterior -> para onde da para voltar se a atual der problema
 *
 * Sao marcadas E sobem para o topo, NESSA ordem — que e a ordem em que se
 * pergunta: o que esta na frota, o que esta sendo avaliado para entrar, o que
 * ainda nem entrou na fila, e para onde se recua. Numa lista de trinta versoes
 * quase iguais, "a de cima e a que esta rodando" e mais rapido de ler do que
 * procurar o selo verde no meio da tabela.
 *
 * A versao em teste entrou no topo junto com o cancelamento do teste: o gesto
 * de tirar uma versao do anel de teste so e obvio quando a linha em teste esta
 * a vista — antes ela se perdia no meio da lista, e o anel de teste e
 * justamente o que costuma ficar esquecido ligado.
 */
export type ReleaseHighlight = "atual" | "teste" | "ultima" | "anterior";

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
  // Mais de uma release pode estar publicada como pre-release; a que as
  // balancas de teste realmente recebem e a mais nova, e a lista ja chega do
  // GitHub da mais nova para a mais antiga.
  const teste = releases.find((release) => release.state === "teste");
  const ultima = releases.find((release) => NEVER_DISTRIBUTED.has(release.state));
  // A candidata natural da volta atras: a mais nova entre as anteriores a
  // producao que ainda podem circular.
  const anterior = releases.find(
    (release) => release.isOlderThanProduction && DISTRIBUTABLE.has(release.state)
  );

  const ordered: T[] = [];
  for (const [release, highlight] of [
    [atual, "atual"],
    [teste, "teste"],
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

// ---------------------------------------------------------------------------
// O que a frota esta RODANDO — que nao e o que foi liberado.
// ---------------------------------------------------------------------------

/**
 * Uma balanca, do jeito que o grafico da frota precisa ver.
 *
 * `version` e `null` de proposito quando a balanca ainda nao se reportou
 * (instalacao anterior a este campo, computador desligado desde entao). "Nao
 * sei" e uma resposta diferente de "esta desatualizada" e nao pode ser
 * escondida: e justamente a maquina de que ninguem tem noticia que costuma ser
 * o problema.
 */
export interface FleetDeviceLike {
  id: string;
  name: string;
  unitName?: string | null;
  version: string | null;
  updateChannel?: "latest" | "beta";
  isActive?: boolean;
  /** Versao para a qual esta balanca ja foi chamada a atualizar. */
  noticeVersion?: string | null;
  /** Quando o aviso chegou na balanca. Nulo com aviso pendente = maquina desligada. */
  noticeSeenAt?: string | null;
}

/**
 * Papel de uma versao dentro da frota — e a cor da barra no grafico.
 *
 *   producao     -> a versao que o painel liberou para todas as balancas
 *   teste        -> a que esta no anel de teste
 *   desconhecida -> balanca que nunca reportou versao
 *   outra        -> qualquer outra: a frota atrasada, ou adiantada apos uma
 *                   volta atras (a maquina que ja instalou a versao mais nova
 *                   NAO desce sozinha)
 */
export type FleetVersionRole = "producao" | "teste" | "desconhecida" | "outra";

export interface FleetVersionGroup {
  /** `null` na faixa das balancas que ainda nao se reportaram. */
  version: string | null;
  role: FleetVersionRole;
  devices: FleetDeviceLike[];
  count: number;
  /** Fracao da frota (0 a 1) — e o comprimento da barra. */
  share: number;
}

/** Compara versoes numero a numero: 0.8.9 < 0.8.10, que um compare de texto erra. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Agrupa a frota por versao instalada, da mais nova para a mais antiga.
 *
 * Responde a pergunta que a lista de versoes nao respondia: liberar para
 * producao nao instala nada — a balanca verifica a cada 30 min e so troca
 * quando o operador fecha o app. Entre o clique e a frota inteira atualizada
 * passam horas ou dias, e a maquina que fica dias sem fechar o app ficava
 * invisivel.
 *
 * As balancas sem noticia ficam por ULTIMO, e nao junto das versoes antigas:
 * elas nao sao uma versao, sao a ausencia de resposta.
 */
export function groupFleetVersions(
  devices: readonly FleetDeviceLike[],
  rings: { productionVersion?: string | null; testVersion?: string | null } = {}
): FleetVersionGroup[] {
  const byVersion = new Map<string, FleetDeviceLike[]>();
  const unknown: FleetDeviceLike[] = [];

  for (const device of devices) {
    if (!device.version) {
      unknown.push(device);
      continue;
    }
    const bucket = byVersion.get(device.version);
    if (bucket) bucket.push(device);
    else byVersion.set(device.version, [device]);
  }

  const total = devices.length;
  const share = (count: number) => (total > 0 ? count / total : 0);

  const groups: FleetVersionGroup[] = [...byVersion.entries()]
    .sort((left, right) => compareVersions(right[0], left[0]))
    .map(([version, list]) => ({
      version,
      role:
        version === rings.productionVersion
          ? ("producao" as const)
          : version === rings.testVersion
            ? ("teste" as const)
            : ("outra" as const),
      devices: list,
      count: list.length,
      share: share(list.length)
    }));

  if (unknown.length > 0) {
    groups.push({
      version: null,
      role: "desconhecida",
      devices: unknown,
      count: unknown.length,
      share: share(unknown.length)
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Chamar a frota para atualizar
// ---------------------------------------------------------------------------

/**
 * Quais balancas o aviso de atualizacao deve alcancar.
 *
 * Liberar uma versao nao instala nada: a balanca verifica a cada 30 min e so
 * aplica quando o operador fecha o app. A que fica dias sem fechar continua na
 * versao velha, e ate agora apressar isso era telefonar para a pedreira.
 *
 * Fica de fora quem ja ALCANCOU a versao pedida — mandar o recado ali seria
 * inofensivo (a nuvem o apaga no primeiro ping), mas apareceria no painel como
 * um aviso pendente que ninguem pediu. Balanca BLOQUEADA tambem fica de fora:
 * ela nao recebe atualizacao nenhuma, entao o pedido nunca sairia de pendente.
 *
 * E fica de fora, sobretudo, quem esta A FRENTE da versao pedida. Isso acontece
 * depois de uma VOLTA ATRAS: a producao passa a ser uma versao mais velha do que
 * a que a frota ja instalou, e o botao chamava a pedreira inteira para regredir.
 * A balanca de producao nao sabe regredir (`allowDowngrade` desligado no
 * desktop), entao esse aviso nunca era cumprido, nunca era apagado e voltava a
 * cada abertura do KyberRock. Numa regressao quem desce de versao e o instalador,
 * a mao, e nao um recado de tela.
 *
 * Quem nunca reportou versao ENTRA: nao saber onde a maquina esta e o motivo
 * mais forte para chama-la, nao um motivo para ignora-la.
 */
export function devicesNeedingUpdateNotice<T extends FleetDeviceLike>(
  devices: readonly T[],
  version: string | null
): T[] {
  if (!version) return [];
  return devices.filter(
    (device) =>
      device.isActive !== false && (!device.version || compareVersions(device.version, version) < 0)
  );
}

/** Balancas com aviso pendente — as que o botao de cancelar alcanca. */
export function devicesWithPendingNotice<T extends FleetDeviceLike>(devices: readonly T[]): T[] {
  return devices.filter((device) => Boolean(device.noticeVersion));
}
