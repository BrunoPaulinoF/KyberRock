import { useCallback, useEffect, useMemo, useState } from "react";

import type { KyberRockDesktopApi } from "../preload/api-types";
import type { TruckControlReport } from "../services/reports";
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
  field: { display: "flex", flexDirection: "column" as const, gap: "4px", fontSize: "12px", fontWeight: 700, color: "var(--kr-text-strong)" },
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
  summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px", flexShrink: 0 },
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
  td: { padding: "10px 12px", borderTop: "1px solid var(--kr-border)", verticalAlign: "top" as const },
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
  aboveAvg: { color: "#b45309", fontWeight: 800 }
};

export function TruckControlView({ desktopApi }: { desktopApi: KyberRockDesktopApi | null }) {
  const [startDate, setStartDate] = useState<string>(isoDaysAgo(30));
  const [endDate, setEndDate] = useState<string>(todayIso());
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<TruckControlReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const filteredTrucks = useMemo(() => {
    if (!report) return [];
    const term = search.trim().toUpperCase();
    if (!term) return report.trucks;
    return report.trucks.filter(
      (truck) =>
        truck.plate.toUpperCase().includes(term) ||
        (truck.driverName ?? "").toUpperCase().includes(term)
    );
  }, [report, search]);

  async function handleExportPdf(): Promise<void> {
    if (!desktopApi) return;
    setExporting(true);
    setNotice(null);
    setError(null);
    try {
      const result = await desktopApi.exportTruckControlPdf(startDate, endDate);
      if (result?.path) {
        setNotice(`PDF salvo em: ${result.path}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar o PDF.");
    } finally {
      setExporting(false);
    }
  }

  const averageMinutes = report?.averageMinutes ?? 0;

  return (
    <section style={styles.page}>
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <h2 style={styles.title}>Controle de caminhoes</h2>
          <HelpTooltip
            content="Tempo dentro da pedreira, numero de operacoes e peso por produto de cada caminhao no periodo. Caminhoes acima do tempo medio ficam destacados."
            placement="right"
          />
        </div>
        <IconActionButton
          icon="file-text"
          label="Gerar PDF"
          tip={exporting ? "Gerando PDF..." : "Gerar PDF"}
          tone="primary"
          placement="top"
          disabled={exporting || loading}
          onClick={() => void handleExportPdf()}
        />
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
          Buscar caminhao (placa ou motorista)
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

      <div style={styles.summary}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Caminhoes</span>
          <span style={styles.cardValue}>{report?.trucks.length ?? 0}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Operacoes</span>
          <span style={styles.cardValue}>{report?.totalOperations ?? 0}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Tempo medio na pedreira</span>
          <span style={styles.cardValue}>{formatMinutes(averageMinutes)}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Tonelagem</span>
          <span style={styles.cardValue}>
            {((report?.totalNetWeightKg ?? 0) / 1000).toLocaleString("pt-BR", {
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
              <th style={styles.th}>Peso por produto</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td style={styles.td} colSpan={7}>
                  Carregando...
                </td>
              </tr>
            ) : filteredTrucks.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={7}>
                  Nenhum caminhao no periodo.
                </td>
              </tr>
            ) : (
              filteredTrucks.map((truck) => {
                const aboveAvg = truck.avgMinutes > averageMinutes && averageMinutes > 0;
                return (
                  <tr key={truck.plate}>
                    <td style={styles.td}>
                      <span style={styles.plate}>{truck.plate}</span>
                    </td>
                    <td style={styles.td}>{truck.driverName ?? "-"}</td>
                    <td style={{ ...styles.td, ...styles.num }}>{truck.operations}</td>
                    <td style={{ ...styles.td, ...styles.num, ...(aboveAvg ? styles.aboveAvg : {}) }}>
                      {formatMinutes(truck.avgMinutes)}
                      {aboveAvg ? " ▲" : ""}
                    </td>
                    <td style={{ ...styles.td, ...styles.num }}>{formatMinutes(truck.totalMinutes)}</td>
                    <td style={{ ...styles.td, ...styles.num }}>
                      {truck.totalNetWeightKg.toLocaleString("pt-BR")}
                    </td>
                    <td style={styles.td}>
                      {truck.products.length === 0
                        ? "-"
                        : truck.products.map((product) => (
                            <div key={product.productDescription}>
                              {product.productDescription}:{" "}
                              {product.totalNetWeightKg.toLocaleString("pt-BR")} kg
                            </div>
                          ))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
