import { useCallback, useEffect, useMemo, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
import {
  arrangeReleases,
  groupFleetVersions,
  hasBuildInProgress,
  isPromotionApplied,
  isPromotionStale,
  nextRefreshDelayMs,
  rollbackActionFor,
  type FleetDeviceLike,
  type FleetVersionGroup,
  type PendingPromotion,
  type PromotionTarget,
  type ReleaseHighlight,
  type ReleaseState
} from "../lib/desktop-updates";
import { parseReleaseNotes, type NoteBlock, type NoteSpan } from "../lib/release-notes";
import {
  Badge,
  Button,
  ButtonGroup,
  DataTable,
  LinkButton,
  Modal,
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
// ## As quatro linhas do topo
//
// A lista pode ter trinta versoes quase iguais. As quatro que respondem as
// perguntas do dia a dia sobem e ganham selo (ver `lib/desktop-updates.ts`): a
// que a frota esta recebendo, a que esta em teste, o ultimo build que o Actions
// gerou e ninguem distribuiu, e a anterior a atual — que e para onde se volta
// se der problema. As duas primeiras aparecem tambem como cartao no topo da
// tela, porque sao as unicas que se consulta sem intencao de clicar em nada.
//
// ## Cancelar teste nao e reprovar
//
// Sair do anel de teste tinha uma porta so, e ela era definitiva: `reprovar`
// marca a release para sempre e nem `force` a traz de volta. Mas quase toda
// saida do teste e "a avaliacao acabou", nao "quebrou" — por isso o cancelar,
// que devolve a versao a PARADO, de onde ela pode ir a teste de novo.
//
// ## O grafico da frota
//
// Liberar nao e instalar. Depois do clique a frota passa horas ou dias com duas
// ou tres versoes ao mesmo tempo, e a maquina que fica dias sem fechar o app era
// invisivel. O grafico mostra qual computador esta em qual versao, com o dado
// que o proprio desktop reporta no `desktop-status`.
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
  /** Ausente na funcao antiga: sem o campo a tela simplesmente nao oferece o botao. */
  canCancelTest?: boolean;
}

/**
 * Uma balanca e a versao que ELA esta rodando (`desktop-status` -> `app_version`).
 *
 * Ausente na funcao antiga; a tela trata lista vazia como "ainda nao da para
 * saber" e esconde o grafico, em vez de mostrar uma frota vazia.
 */
export interface FleetDeviceRow extends FleetDeviceLike {
  id: string;
  name: string;
  unitName: string | null;
  version: string | null;
  versionSeenAt: string | null;
  updateChannel: "latest" | "beta";
  isActive: boolean;
  lastSeenAt: string | null;
}

interface ReleasesResponse {
  releases: ReleaseRow[];
  devices?: FleetDeviceRow[];
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
  | "cancel-test"
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
  /**
   * Tira a versao do anel de teste sem condenar a release.
   *
   * Existe porque "reprovar" era a unica saida do teste e ela e definitiva: a
   * release fica marcada para sempre e nao volta nem com `force`. Mas a maior
   * parte das saidas do anel de teste nao e "quebrou" — e "a avaliacao acabou",
   * "entrou outra versao no lugar" ou "subiu por engano". Nesses casos a versao
   * volta para PARADO, de onde pode ir a teste de novo.
   *
   * A balanca de teste nao fica sem canal: com a pre-release fora do ar ela
   * passa a enxergar a ultima aprovada, como antes de a versao subir.
   */
  "cancel-test": {
    target: "parar",
    force: false,
    label: "Cancelar teste",
    busyLabel: "Cancelando…",
    variant: "warn",
    confirm: (version) =>
      `Cancelar o teste da versao ${version}?\n\n` +
      "Ela sai do anel de teste e volta para parada — as balancas de teste voltam para a ultima versao aprovada na proxima verificacao.\n\n" +
      "Nao e reprovar: a versao continua podendo ir para teste de novo depois.",
    dispatched: (v) => `Cancelando o teste da versao ${v}…`,
    done: (v) =>
      `Teste da versao ${v} cancelado. Ela voltou para parada e as balancas de teste voltam para a ultima aprovada na proxima verificacao.`
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
  teste: { text: "Em teste agora", tone: "info" },
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
  // A volta atras publicou esta versao antiga no anel de teste. Alem de seguir
  // para a frota, precisa dar para DESISTIR: sem isso a unica saida seria
  // reprovar a versao boa que existe justamente para servir de porto seguro.
  if (rollback === "production") return ["rollback-production", "cancel-test"];
  if (rollback === "resume") return ["resume"];

  const intents: PromotionIntent[] = [];
  if (release.canSendToTest) intents.push("beta");
  if (release.canReleaseToProduction) intents.push("latest");
  if (release.canCancelTest) intents.push("cancel-test");
  if (release.canReject) intents.push("reprovar");
  return intents;
}

// ---------------------------------------------------------------------------
// "O que mudou nesta versao"
//
// A lista responde QUAL versao a frota recebe; nao respondia o que essa versao
// mudou — que e a pergunta de quem esta com o dedo no botao de liberar para
// todas as pedreiras de uma vez. Ate agora a unica saida era abrir o GitHub e
// cruzar tag com PR na mao.
//
// O texto vem dos PRs mesclados entre esta versao e a ANTERIOR (`admin-api` ->
// `get_desktop_release_notes`), e nao de nota de release: ninguem escreve
// changelog aqui, e o PR ja e onde a mudanca foi explicada. Comparar com a
// versao anterior tambem cobre os merges que nao geraram build proprio — o
// `desktop-release.yml` tem filtro de paths, mas o build e um checkout da main
// inteira.
//
// A leitura e SOB DEMANDA e fica em cache por versao enquanto a aba estiver
// aberta: cada abertura custa chamadas na API do GitHub (que tem limite por
// hora), e esta aba ja se recarrega sozinha de poucos em poucos segundos.
// ---------------------------------------------------------------------------

/** Um PR (ou um commit direto na main) que entrou na versao. */
export interface ReleaseNoteEntry {
  sha: string;
  pullNumber: number | null;
  title: string;
  /** Texto do PR. Vazio quando o PR nao tem descricao — ou nao deu para ler. */
  body: string;
  author: string | null;
  date: string | null;
  url: string;
}

export interface ReleaseNotes {
  version: string;
  tag: string;
  /** Versao com que a comparacao foi feita. `null` na mais antiga da janela. */
  baseVersion: string | null;
  entries: ReleaseNoteEntry[];
  /** PRs alem do limite exibido. */
  omitted: number;
  releaseUrl: string | null;
  compareUrl: string | null;
  /**
   * Ha PR na versao e nenhum texto veio: falta `Pull requests: read` no PAT.
   * A tela diz isso em vez de deixar parecer que os PRs sao todos vazios.
   */
  bodiesUnavailable: boolean;
}

function NoteSpans({ spans }: { spans: readonly NoteSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.kind === "strong") return <strong key={index}>{span.text}</strong>;
        if (span.kind === "code")
          return (
            <code key={index} className="adm-note-code">
              {span.text}
            </code>
          );
        if (span.kind === "link")
          return (
            <a key={index} href={span.href} target="_blank" rel="noreferrer">
              {span.text}
            </a>
          );
        return <span key={index}>{span.text}</span>;
      })}
    </>
  );
}

function NoteBlockView({ block }: { block: NoteBlock }) {
  switch (block.kind) {
    case "heading": {
      // O titulo do modal e um h3; os do texto do PR entram abaixo dele.
      const Tag = `h${block.level + 3}` as "h4" | "h5" | "h6";
      return (
        <Tag className="adm-note-heading">
          <NoteSpans spans={block.spans} />
        </Tag>
      );
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="adm-note-list">
          {block.items.map((item, index) => (
            <li key={index} className={item.depth === 1 ? "adm-note-item-deep" : undefined}>
              <NoteSpans spans={item.spans} />
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="adm-note-quote">
          <NoteSpans spans={block.spans} />
        </blockquote>
      );
    case "code":
      return (
        <pre className="adm-note-pre">
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="adm-note-tablewrap">
          <table className="adm-note-table">
            {block.head.length > 0 && (
              <thead>
                <tr>
                  {block.head.map((cell, index) => (
                    <th key={index}>
                      <NoteSpans spans={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <NoteSpans spans={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="adm-note-rule" />;
    default:
      return (
        <p className="adm-note-p">
          <NoteSpans spans={block.spans} />
        </p>
      );
  }
}

/**
 * Texto do PR renderizado.
 *
 * Nada aqui vira HTML: o parser (`lib/release-notes.ts`) devolve dados e esta
 * arvore monta elementos React a partir deles. O corpo do PR e conteudo que
 * chega do GitHub, e conteudo de fora nao pode virar marcacao executavel dentro
 * do painel.
 */
function NoteBody({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseReleaseNotes(markdown), [markdown]);
  return (
    <div className="adm-note-body">
      {blocks.map((block, index) => (
        <NoteBlockView key={index} block={block} />
      ))}
    </div>
  );
}

function ReleaseNoteCard({
  entry,
  bodiesUnavailable
}: {
  entry: ReleaseNoteEntry;
  bodiesUnavailable: boolean;
}) {
  return (
    <article className="adm-note-entry">
      <header className="adm-note-entry-head">
        <div>
          <p className="adm-note-entry-title">{entry.title}</p>
          <p className="adm-cell-sub">
            {[
              entry.pullNumber === null ? "Commit direto na main" : `PR #${entry.pullNumber}`,
              entry.author,
              entry.date ? formatDateTime(entry.date) : null
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {entry.url && (
          <LinkButton href={entry.url} size="sm">
            Abrir no GitHub
          </LinkButton>
        )}
      </header>
      {entry.body ? (
        <NoteBody markdown={entry.body} />
      ) : bodiesUnavailable ? null : (
        <p className="adm-cell-sub">Mesclado sem texto de descricao.</p>
      )}
    </article>
  );
}

export function ReleaseNotesModal({
  version,
  notes,
  isLoading,
  error,
  onClose
}: {
  version: string;
  notes: ReleaseNotes | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`O que mudou na versao ${version}`}
      description={
        notes?.baseVersion
          ? `Tudo o que foi mesclado depois da versao ${notes.baseVersion}.`
          : "Os PRs que entraram nesta versao."
      }
      onClose={onClose}
      footer={
        notes?.compareUrl ? (
          <LinkButton href={notes.compareUrl} size="sm">
            Ver a comparacao no GitHub
          </LinkButton>
        ) : notes?.releaseUrl ? (
          <LinkButton href={notes.releaseUrl} size="sm">
            Ver a versao no GitHub
          </LinkButton>
        ) : undefined
      }
    >
      {isLoading && <p className="adm-cell-sub">Lendo os PRs desta versao no GitHub…</p>}

      {error && <Note tone="danger">{error}</Note>}

      {notes && notes.bodiesUnavailable && (
        <Note tone="warn">
          Da para ver <strong>quais</strong> PRs entraram, mas nao o texto deles: o PAT{" "}
          <strong className="adm-mono">GH_ACTIONS_TOKEN</strong> precisa tambem de{" "}
          <strong>Pull requests: read</strong>. Enquanto isso, cada PR abre no GitHub pelo botao ao
          lado do titulo.
        </Note>
      )}

      {notes && notes.entries.length === 0 && !isLoading && (
        <Note tone="neutral">
          Nenhum PR entre esta versao e a anterior. Costuma ser um build refeito da mesma base — o
          instalador muda, o codigo nao.
        </Note>
      )}

      {notes?.entries.map((entry) => (
        <ReleaseNoteCard
          key={entry.sha || String(entry.pullNumber)}
          entry={entry}
          bodiesUnavailable={notes.bodiesUnavailable}
        />
      ))}

      {notes && notes.omitted > 0 && (
        <p className="adm-cell-sub">
          E mais {notes.omitted} {notes.omitted === 1 ? "PR" : "PRs"} nesta versao — a lista
          completa esta na comparacao no GitHub.
        </p>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// O que a frota esta RODANDO
//
// A lista de versoes responde o que foi LIBERADO. Nao respondia o que chegou:
// liberar para producao nao instala nada — a balanca verifica a cada 30 min e so
// troca quando o operador fecha o app. Entre o clique e a frota inteira
// atualizada passam horas ou dias, e a maquina que fica dias sem fechar o app
// era invisivel: ninguem sabia que ela estava tres versoes atras.
//
// O grafico e uma barra por versao instalada, da mais nova para a mais antiga, e
// abaixo dela os computadores que estao nela — porque a pergunta que se faz de
// verdade nao e "quantos por cento", e "QUAL balanca ficou para tras".
//
// A versao vem do proprio desktop (`desktop-status` -> `app_version`), entao
// balanca offline mantem a ultima leitura e balanca que nunca se reportou
// aparece em "sem informacao" — que fica por ultimo e nao se mistura com as
// versoes antigas: nao saber e diferente de estar atrasado.
// ---------------------------------------------------------------------------

const FLEET_ROLE_LABEL: Record<FleetVersionGroup["role"], { text: string; tone: Tone }> = {
  producao: { text: "Producao", tone: "ok" },
  teste: { text: "Teste", tone: "info" },
  outra: { text: "Fora dos aneis", tone: "warn" },
  desconhecida: { text: "Sem informacao", tone: "neutral" }
};

export function FleetVersionBars({
  groups,
  total
}: {
  groups: readonly FleetVersionGroup[];
  total: number;
}) {
  return (
    <div className="adm-fleet">
      {groups.map((group) => {
        const role = FLEET_ROLE_LABEL[group.role];
        return (
          <div className="adm-fleet-row" key={group.version ?? "sem-informacao"}>
            <div className="adm-fleet-head">
              <span className="adm-cell-primary adm-mono">{group.version ?? "Sem informacao"}</span>
              <Badge tone={role.tone}>{role.text}</Badge>
              <span className="adm-fleet-count">
                {group.count} de {total} {total === 1 ? "balanca" : "balancas"}
              </span>
            </div>
            <div className="adm-fleet-bar">
              <div
                className={`adm-fleet-fill adm-fleet-fill-${group.role}`}
                style={{ width: `${Math.max(group.share * 100, 2)}%` }}
              />
            </div>
            <div className="adm-fleet-devices">
              {group.devices.map((device) => (
                <span
                  key={device.id}
                  className={`adm-fleet-chip${device.isActive === false ? " adm-fleet-chip-off" : ""}`}
                  title={
                    device.isActive === false
                      ? "Balanca bloqueada: nao recebe atualizacao."
                      : undefined
                  }
                >
                  {device.name}
                  {device.unitName ? <em> · {device.unitName}</em> : null}
                  {device.updateChannel === "beta" ? <strong> · teste</strong> : null}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
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
  /** Versao com o modal de "o que mudou" aberto. */
  const [notesVersion, setNotesVersion] = useState<string | null>(null);
  /**
   * Texto ja lido, por versao.
   *
   * Guardar importa: abrir a mesma linha duas vezes e comum (compara-se uma
   * versao com a outra antes de liberar) e cada leitura custa chamadas na API
   * do GitHub. O cache morre com a aba, entao um PR editado depois aparece
   * atualizado no proximo carregamento da tela.
   */
  const [notesCache, setNotesCache] = useState<Record<string, ReleaseNotes>>({});
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

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

  const openNotes = useCallback(
    async (version: string) => {
      setNotesVersion(version);
      setNotesError(null);
      if (notesCache[version]) return;

      setIsLoadingNotes(true);
      try {
        const notes = await callAdminFunction<ReleaseNotes>("admin-api", {
          action: "get_desktop_release_notes",
          payload: { version }
        });
        setNotesCache((current) => ({ ...current, [version]: notes }));
      } catch (error) {
        if (error instanceof AdminSessionExpiredError) {
          onSessionExpired();
          return;
        }
        // Erro aqui fica DENTRO do modal: nao ler o texto de uma versao nao e
        // motivo para pintar de vermelho a tela que distribui as versoes.
        setNotesError(
          error instanceof Error ? error.message : "Nao foi possivel ler o que mudou nesta versao."
        );
      } finally {
        setIsLoadingNotes(false);
      }
    },
    [notesCache, onSessionExpired]
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
  // A versao publicada como pre-release mais nova e a que as balancas de teste
  // realmente recebem — a lista chega do GitHub da mais nova para a mais antiga.
  const testRelease = ordered.find((release) => release.state === "teste") ?? null;
  const productionRelease = ordered.find((release) => release.isCurrentProduction) ?? null;

  const devices = data?.devices;
  const fleet = useMemo(
    () =>
      groupFleetVersions(devices ?? [], {
        productionVersion: currentVersion,
        testVersion: testRelease?.version ?? null
      }),
    [devices, currentVersion, testRelease]
  );

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
            <p className="adm-cell-sub">
              <button
                type="button"
                className="adm-linkish"
                onClick={() => void openNotes(release.version)}
              >
                O que mudou
              </button>
            </p>
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

      {/*
        Os dois primeiros cartoes respondem, sem ler a tabela, as duas perguntas
        que se faz ao abrir esta aba: o que a frota recebe hoje e o que esta
        sendo avaliado para entrar. Sao a mesma verdade da lista (os selos
        "Versao atual" e "Em teste agora"), so que legivel de longe.
      */}
      {data && (
        <StatGrid>
          <Stat
            label="Versao em producao"
            value={productionRelease?.version ?? "—"}
            tone={productionRelease ? "ok" : "warn"}
            hint={
              productionRelease
                ? `Publicada em ${formatDateTime(productionRelease.publishedAt)}`
                : "Nenhuma versao estavel publicada."
            }
          />
          <Stat
            label="Versao em teste"
            value={testRelease?.version ?? "—"}
            tone={testRelease ? "accent" : "neutral"}
            hint={
              testRelease
                ? `Publicada em ${formatDateTime(testRelease.publishedAt)}`
                : "Nenhuma versao no anel de teste."
            }
          />
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
        description="No topo: a versao que a frota recebe, a que esta em teste, o ultimo build gerado pelo GitHub e a versao anterior — que e para onde a volta atras leva. O link de cada linha abre o texto dos PRs que entraram naquela versao."
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

      {devices !== undefined && (
        <Panel
          title="Versoes instaladas na frota"
          description="O que cada computador esta RODANDO — que nao e o que foi liberado: a balanca verifica a cada 30 min e so troca de versao quando o operador fecha o app."
        >
          {devices.length === 0 ? (
            <p className="adm-cell-sub">Nenhuma balanca ativada ainda.</p>
          ) : (
            <>
              <FleetVersionBars groups={fleet} total={devices.length} />
              {fleet.some((group) => group.version === null) && (
                <p className="adm-cell-sub">
                  "Sem informacao" e a balanca que ainda nao reportou a versao — instalacao anterior
                  a este campo ou computador que nao se conectou desde entao. Nao quer dizer
                  desatualizada.
                </p>
              )}
            </>
          )}
        </Panel>
      )}

      {notesVersion && (
        <ReleaseNotesModal
          version={notesVersion}
          notes={notesCache[notesVersion] ?? null}
          isLoading={isLoadingNotes}
          error={notesError}
          onClose={() => {
            setNotesVersion(null);
            setNotesError(null);
          }}
        />
      )}
    </>
  );
}
