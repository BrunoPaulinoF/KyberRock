import { useCallback, useEffect, useState } from "react";

import { AdminSessionExpiredError, callAdminFunction } from "../lib/admin-api";
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
// (rascunho de release, que updater nenhum enxerga). Desta tela saem os tres
// gestos que mexem numa versao:
//
//   Enviar para teste     -> so as balancas marcadas como teste passam a receber
//   Liberar para producao -> todas as balancas passam a receber
//   Reprovar              -> quebrou no teste: sai do ar e trava para sempre
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
// ---------------------------------------------------------------------------

type ReleaseState = "producao" | "teste" | "parado" | "compilando" | "reprovada" | "incompleto";

interface ReleaseRow {
  version: string;
  tag: string;
  state: ReleaseState;
  isCurrentProduction: boolean;
  publishedAt: string | null;
  installerName: string | null;
  isOlderThanProduction: boolean;
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

const STATE_LABEL: Record<ReleaseState, { text: string; tone: Tone }> = {
  producao: { text: "Producao", tone: "ok" },
  teste: { text: "Em teste", tone: "info" },
  parado: { text: "Parado", tone: "neutral" },
  compilando: { text: "Compilando", tone: "info" },
  reprovada: { text: "Reprovada", tone: "warn" },
  incompleto: { text: "Incompleto", tone: "danger" }
};

const PROMOTE_FEEDBACK: Record<"beta" | "latest" | "reprovar", (version: string) => string> = {
  beta: (v) =>
    `Versao ${v} enviada para o anel de teste. As balancas marcadas como teste recebem na proxima verificacao.`,
  latest: (v) =>
    `Versao ${v} liberada para producao. As balancas recebem na proxima verificacao e instalam quando o operador fechar o app.`,
  reprovar: (v) =>
    `Versao ${v} reprovada. Ela saiu do ar e nao pode mais ser distribuida; a balanca de teste volta para a ultima aprovada na proxima verificacao.`
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR");
}

export function DesktopUpdates({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<ReleasesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyVersion, setBusyVersion] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const handleError = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof AdminSessionExpiredError) {
        onSessionExpired();
        return;
      }
      setFeedback({ tone: "error", text: error instanceof Error ? error.message : fallback });
    },
    [onSessionExpired]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(
        await callAdminFunction<ReleasesResponse>("admin-api", {
          action: "list_desktop_releases"
        })
      );
    } catch (error) {
      handleError(error, "Nao foi possivel carregar as versoes.");
    } finally {
      setIsLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function promote(release: ReleaseRow, target: "beta" | "latest" | "reprovar") {
    if (target === "reprovar") {
      const confirmed = window.confirm(
        `Reprovar a versao ${release.version}?\n\n` +
          "Ela sai do ar e NUNCA mais podera ir para teste ou producao. " +
          "A balanca de teste volta sozinha para a ultima versao aprovada."
      );
      if (!confirmed) return;
    }
    setFeedback(null);
    setBusyVersion(release.version);
    try {
      await callAdminFunction("admin-api", {
        action: "promote_desktop_release",
        payload: { version: release.version, target, force: false }
      });
      setFeedback({
        tone: "ok",
        text: PROMOTE_FEEDBACK[target](release.version)
      });
      // O workflow leva alguns segundos para publicar a release; a lista so
      // reflete o novo estado no proximo carregamento.
      window.setTimeout(() => void load(), 4000);
    } catch (error) {
      handleError(error, "Nao foi possivel promover a versao.");
    } finally {
      setBusyVersion(null);
    }
  }

  const columns: Array<Column<ReleaseRow>> = [
    {
      key: "version",
      header: "Versao",
      render: (release) => (
        <>
          <span className="adm-cell-primary adm-mono">{release.version}</span>
          {release.installerName && <p className="adm-cell-sub">{release.installerName}</p>}
        </>
      )
    },
    {
      key: "state",
      header: "Situacao",
      render: (release) => (
        <>
          <Badge tone={STATE_LABEL[release.state].tone} dot>
            {STATE_LABEL[release.state].text}
          </Badge>
          {release.isCurrentProduction && (
            <p className="adm-cell-sub">E a versao que a frota esta recebendo.</p>
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
        const busy = busyVersion === release.version;
        if (!release.canSendToTest && !release.canReleaseToProduction && !release.canReject) {
          return (
            <span className="adm-cell-sub">
              {release.isOlderThanProduction && release.state !== "producao"
                ? "Anterior a producao atual."
                : "—"}
            </span>
          );
        }
        return (
          <ButtonGroup>
            {release.canSendToTest && (
              <Button size="sm" disabled={busy} onClick={() => void promote(release, "beta")}>
                {busy ? "Enviando…" : "Enviar para teste"}
              </Button>
            )}
            {release.canReleaseToProduction && (
              <Button
                size="sm"
                variant="primary"
                disabled={busy}
                onClick={() => void promote(release, "latest")}
              >
                {busy ? "Liberando…" : "Liberar para producao"}
              </Button>
            )}
            {release.canReject && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => void promote(release, "reprovar")}
              >
                {busy ? "Reprovando…" : "Reprovar"}
              </Button>
            )}
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

      {feedback && <Note tone={feedback.tone === "ok" ? "ok" : "danger"}>{feedback.text}</Note>}

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
        flush
        actions={
          <Button onClick={() => void load()} disabled={isLoading}>
            {isLoading ? "Carregando…" : "Atualizar"}
          </Button>
        }
      >
        <DataTable
          columns={columns}
          rows={data?.releases ?? []}
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
