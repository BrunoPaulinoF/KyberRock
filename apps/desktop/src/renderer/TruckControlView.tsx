import { useCallback, useEffect, useMemo, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { TruckControlReport } from "../services/reports";
import { filterTruckControlReport } from "../services/truck-control-report";
import { IconActionButton } from "./IconActionButton";
import { HelpTooltip } from "./Tooltip";

// Formata minutos como "1h 05min" / "42min".
export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}min`;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const styles = {
  page: {
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
    minHeight: 0,
    flex: 1
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
    gap: "10px",
    flexShrink: 0
  },
  title: { margin: 0, color: "var(--kr-text-strong)", fontSize: "18px" },
  subtitle: { margin: "4px 0 0 0", color: "var(--kr-muted)", maxWidth: "720px", fontSize: "13px" },
  filters: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap" as const,
    alignItems: "flex-end",
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    padding: "12px 14px",
    boxShadow: "var(--kr-shadow)",
    flexShrink: 0
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--kr-text-strong)"
  },
  input: {
    border: "1px solid var(--kr-input-border)",
    borderRadius: "10px",
    padding: "8px 10px",
    font: "inherit",
    fontSize: "13px",
    background: "var(--kr-input-bg)",
    color: "var(--kr-text-strong)"
  },
  primaryButton: {
    border: "none",
    background: "var(--kr-primary-strong)",
    color: "var(--kr-primary-text)",
    borderRadius: "10px",
    padding: "10px 16px",
    cursor: "pointer",
    fontWeight: 700
  },
  secondaryButton: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface)",
    color: "var(--kr-text-strong)",
    borderRadius: "10px",
    padding: "9px 14px",
    cursor: "pointer",
    fontWeight: 700
  },
  summary: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "10px",
    flexShrink: 0
  },
  card: {
    background: "var(--kr-surface)",
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    padding: "12px 14px",
    boxShadow: "var(--kr-shadow)"
  },
  cardLabel: { display: "block", color: "var(--kr-muted)", fontSize: "12px", fontWeight: 700 },
  cardValue: { fontSize: "20px", fontWeight: 800, color: "var(--kr-text-strong)" },
  tableScroll: {
    overflow: "auto" as const,
    flex: 1,
    minHeight: 0,
    border: "1px solid var(--kr-border)",
    borderRadius: "14px",
    background: "var(--kr-surface)",
    boxShadow: "var(--kr-shadow)"
  },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: "13px" },
  th: {
    padding: "9px 12px",
    textAlign: "left" as const,
    color: "var(--kr-muted)",
    background: "var(--kr-surface-soft)",
    borderBottom: "1px solid var(--kr-border)",
    position: "sticky" as const,
    top: 0,
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    whiteSpace: "nowrap" as const
  },
  td: {
    padding: "10px 12px",
    borderTop: "1px solid var(--kr-border)",
    verticalAlign: "top" as const
  },
  num: { textAlign: "right" as const },
  plate: {
    display: "inline-block",
    fontWeight: 800,
    letterSpacing: "0.06em",
    background: "var(--kr-surface-soft)",
    border: "1px solid var(--kr-border)",
    borderRadius: "8px",
    padding: "2px 8px"
  },
  muted: { color: "var(--kr-muted)", fontSize: "12px", margin: 0 },
  error: {
    color: "#b91c1c",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "13px"
  },
  aboveAvg: { color: "#b45309", fontWeight: 800 },
  linkButton: {
    border: "1px solid var(--kr-border)",
    background: "var(--kr-surface-soft)",
    color: "var(--kr-text-strong)",
    borderRadius: "8px",
    padding: "4px 8px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "12px",
    whiteSpace: "nowrap" as const
  },
  tripCell: { padding: "0 12px 12px", borderTop: "none", background: "var(--kr-surface-soft)" },
  tripTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "12px",
    background: "var(--kr-surface)"
  },
  tripTh: {
    padding: "6px 8px",
    textAlign: "left" as const,
    color: "var(--kr-muted)",
    borderBottom: "1px solid var(--kr-border)",
    fontSize: "10px",
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    whiteSpace: "nowrap" as const
  },
  tripTd: { padding: "6px 8px", borderTop: "1px solid var(--kr-border)" }
};

/** Data e hora da balanca (o banco guarda em UTC) para a lista de cargas da placa. */
function formatDay(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function formatClock(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function TruckControlView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
  const [startDate, setStartDate] = useState<string>(isoDaysAgo(30));
  const [endDate, setEndDate] = useState<string>(todayIso());
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<TruckControlReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Placa com a lista de cargas aberta. Uma de cada vez: a lista e longa e o que interessa
  // e conferir uma placa por vez, do mesmo jeito que se olha a relacao por placa do OMIE.
  const [openPlate, setOpenPlate] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!desktopApi) return;
    setLoading(true);
    setError(null);
    try {
      const result = await desktopApi.getTruckControl(startDate, endDate);
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar controle de caminhoes.");
    } finally {
      setLoading(false);
    }
  }, [desktopApi, startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Recorte da busca (placa ou motorista) aplicado com a mesma funcao que o main usa ao
  // gerar o PDF e a planilha: o que esta na lista e exatamente o que sai no arquivo.
  const visible = useMemo(
    () => (report ? filterTruckControlReport(report, search) : null),
    [report, search]
  );
  const filteredTrucks = visible?.trucks ?? [];
  const filtered = Boolean(visible?.search);

  async function handleExport(format: "pdf" | "excel"): Promise<void> {
    if (!desktopApi) return;
    setExporting(format);
    setNotice(null);
    setError(null);
    try {
      const result = await desktopApi.exportTruckControl(format, startDate, endDate, search);
      if (result?.path) {
        setNotice(`${format === "pdf" ? "PDF" : "Excel"} salvo em: ${result.path}`);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Falha ao gerar o ${format === "pdf" ? "PDF" : "Excel"}.`
      );
    } finally {
      setExporting(null);
    }
  }

  // Media do periodo inteiro: e contra ela que se destaca o caminhao demorado, mesmo com
  // a lista filtrada. Os cartoes mostram os numeros do recorte que esta na tela.
  const periodAverageMinutes = report?.averageMinutes ?? 0;
  const averageMinutes = visible?.averageMinutes ?? 0;

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h2 style={styles.title}>Controle de caminhoes</h2>
          <HelpTooltip
            content="Tempo dentro da pedreira, numero de operacoes, clientes atendidos e peso por produto de cada caminhao no periodo. Em 'Cargas' voce ve carga a carga: data, cliente, produto, peso e horarios. Caminhoes acima do tempo medio do periodo ficam destacados. O PDF e o Excel saem com os caminhoes que estao na lista (e com as mesmas cargas e clientes): com a busca preenchida, o arquivo traz so eles."
            placement="right"
          />
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <IconActionButton
            icon="file-text"
            label="Gerar PDF"
            tip={
              exporting === "pdf"
                ? "Gerando PDF..."
                : filtered
                  ? "Gerar PDF so com os caminhoes da busca"
                  : "Gerar PDF"
            }
            tone="primary"
            placement="top"
            disabled={exporting !== null || loading}
            onClick={() => void handleExport("pdf")}
          />
          <IconActionButton
            icon="table"
            label="Baixar Excel"
            tip={
              exporting === "excel"
                ? "Gerando Excel..."
                : filtered
                  ? "Baixar Excel so com os caminhoes da busca"
                  : "Baixar Excel"
            }
            tone="primary"
            placement="top"
            disabled={exporting !== null || loading}
            onClick={() => void handleExport("excel")}
          />
        </div>
      </header>

      <div style={styles.filters}>
        <label style={styles.field}>
          De
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.field}>
          Ate
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={{ ...styles.field, flex: 1, minWidth: "200px" }}>
          Buscar caminhao (placa ou motorista) — vale para o PDF e o Excel
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex: ABC1D23"
            style={styles.input}
          />
        </label>
        <IconActionButton
          icon="retry"
          label="Atualizar"
          tip="Atualizar"
          tone="neutral"
          placement="top"
          onClick={() => void load()}
        />
      </div>

      {error ? <p style={styles.error}>{error}</p> : null}
      {notice ? <p style={styles.muted}>{notice}</p> : null}
      {filtered ? (
        <p style={styles.muted}>
          Busca &quot;{visible?.search}&quot;: {filteredTrucks.length} de{" "}
          {report?.trucks.length ?? 0} caminhoes. Os cartoes e os arquivos (PDF/Excel) usam so
          esses. Tempo medio do periodo, com todos os caminhoes:{" "}
          {formatMinutes(periodAverageMinutes)}.
        </p>
      ) : null}

      <div style={styles.summary}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Caminhoes</span>
          <span style={styles.cardValue}>{filteredTrucks.length}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Operacoes</span>
          <span style={styles.cardValue}>{visible?.totalOperations ?? 0}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Tempo medio na pedreira</span>
          <span style={styles.cardValue}>{formatMinutes(averageMinutes)}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Tonelagem</span>
          <span style={styles.cardValue}>
            {((visible?.totalNetWeightKg ?? 0) / 1000).toLocaleString("pt-BR", {
              maximumFractionDigits: 2
            })}{" "}
            t
          </span>
        </div>
      </div>

      <div style={styles.tableScroll}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Placa</th>
              <th style={styles.th}>Motorista</th>
              <th style={{ ...styles.th, ...styles.num }}>Operacoes</th>
              <th style={{ ...styles.th, ...styles.num }}>Tempo medio</th>
              <th style={{ ...styles.th, ...styles.num }}>Tempo total</th>
              <th style={{ ...styles.th, ...styles.num }}>Peso (kg)</th>
              <th style={styles.th}>Clientes atendidos</th>
              <th style={styles.th}>Peso por produto</th>
              <th style={styles.th}>Cargas</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={styles.td} colSpan={10}>
                  Carregando...
                </td>
              </tr>
            ) : filteredTrucks.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={10}>
                  {filtered ? "Nenhum caminhao para essa busca." : "Nenhum caminhao no periodo."}
                </td>
              </tr>
            ) : (
              filteredTrucks.flatMap((truck) => {
                const aboveAvg =
                  truck.avgMinutes > periodAverageMinutes && periodAverageMinutes > 0;
                const open = openPlate === truck.plate;
                return [
                  <tr key={truck.plate}>
                    <td style={styles.td}>
                      <span style={styles.plate}>{truck.plate}</span>
                    </td>
                    <td style={styles.td}>{truck.driverName ?? "-"}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{truck.operations}</td>
                    <td
                      style={{ ...styles.td, ...styles.num, ...(aboveAvg ? styles.aboveAvg : {}) }}
                    >
                      {formatMinutes(truck.avgMinutes)}
                      {aboveAvg ? " ▲" : ""}
                    </td>
                    <td style={{ ...styles.td, ...styles.num }}>
                      {formatMinutes(truck.totalMinutes)}
                    </td>
                    <td style={{ ...styles.td, ...styles.num }}>
                      {truck.totalNetWeightKg.toLocaleString("pt-BR")}
                    </td>
                    <td style={styles.td}>
                      {truck.customers.length === 0
                        ? "-"
                        : truck.customers.map((customer) => (
                            <div key={customer.customerName}>
                              {customer.customerName}:{" "}
                              {customer.totalNetWeightKg.toLocaleString("pt-BR")} (
                              {customer.operations}x)
                            </div>
                          ))}
                    </td>
                    <td style={styles.td}>
                      {truck.products.length === 0
                        ? "-"
                        : truck.products.map((product) => (
                            <div key={product.productDescription}>
                              {product.productDescription}:{" "}
                              {product.totalNetWeightKg.toLocaleString("pt-BR")}
                            </div>
                          ))}
                    </td>
                    <td style={styles.td}>
                      <button
                        type="button"
                        style={styles.linkButton}
                        onClick={() => setOpenPlate(open ? null : truck.plate)}
                      >
                        {open ? "Ocultar cargas" : `Ver ${truck.trips.length} carga(s)`}
                      </button>
                    </td>
                  </tr>
                ].concat(
                  open
                    ? [
                        <tr key={`${truck.plate}-trips`}>
                          <td style={styles.tripCell} colSpan={10}>
                            <table style={styles.tripTable}>
                              <thead>
                                <tr>
                                  <th style={styles.tripTh}>Data</th>
                                  <th style={styles.tripTh}>Cliente</th>
                                  <th style={styles.tripTh}>Produto</th>
                                  <th style={{ ...styles.tripTh, ...styles.num }}>Peso (kg)</th>
                                  <th style={{ ...styles.tripTh, ...styles.num }}>Entrada</th>
                                  <th style={{ ...styles.tripTh, ...styles.num }}>Saida</th>
                                  <th style={{ ...styles.tripTh, ...styles.num }}>Tempo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {truck.trips.length === 0 ? (
                                  <tr>
                                    <td style={styles.tripTd} colSpan={7}>
                                      Sem cargas no periodo.
                                    </td>
                                  </tr>
                                ) : (
                                  truck.trips.map((trip) => (
                                    <tr key={trip.operationId}>
                                      <td style={styles.tripTd}>{formatDay(trip.entryAt)}</td>
                                      <td style={styles.tripTd}>{trip.customerName}</td>
                                      <td style={styles.tripTd}>{trip.productDescription}</td>
                                      <td style={{ ...styles.tripTd, ...styles.num }}>
                                        {trip.netWeightKg.toLocaleString("pt-BR")}
                                      </td>
                                      <td style={{ ...styles.tripTd, ...styles.num }}>
                                        {formatClock(trip.entryAt)}
                                      </td>
                                      <td style={{ ...styles.tripTd, ...styles.num }}>
                                        {formatClock(trip.exitAt)}
                                      </td>
                                      <td style={{ ...styles.tripTd, ...styles.num }}>
                                        {formatMinutes(trip.minutes)}
                                      </td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ]
                    : []
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
