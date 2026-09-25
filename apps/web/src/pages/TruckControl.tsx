import "./truck-control.css";

import { FileText, Lightbulb, RefreshCw, Table } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { useUser } from "../lib/auth";
import { todayIso } from "../lib/format";
import { downloadSpreadsheet, printReportHtml } from "../lib/report-output";
import {
  filterTruckControlReport,
  formatClock,
  formatMinutes,
  formatTripDay,
  isoDaysBefore,
  loadTruckControl,
  truckControlDocument
} from "../lib/truck-control";
import { useAsync } from "../lib/use-async";

const HELP =
  "Tempo dentro da pedreira, numero de operacoes, clientes atendidos e peso por produto de cada caminhao no periodo. Em 'Cargas' voce ve carga a carga: data, cliente, produto, peso e horarios. Caminhoes acima do tempo medio do periodo ficam destacados. O PDF e o Excel saem com os caminhoes que estao na lista (e com as mesmas cargas e clientes): com a busca preenchida, o arquivo traz so eles.";

/**
 * Controle de caminhoes — a tela `TruckControlView` do desktop, lendo a nuvem. O periodo e
 * pela ENTRADA do caminhao (patio), nao pelo fechamento. O "Gerar PDF" e o "Baixar Excel" saem
 * IGUAIS aos do desktop (`truckControlDocument`, copia fiel do renderizador): o PDF abre a
 * impressao do navegador com o A4 do desktop ("Salvar como PDF") e o Excel baixa o `.xls` com
 * o mesmo nome de arquivo. Os dois partem do recorte da tela (periodo + busca).
 */
export function TruckControl() {
  const user = useUser();
  const today = todayIso();
  const [startDate, setStartDate] = useState(() => isoDaysBefore(today, 30));
  const [endDate, setEndDate] = useState(today);
  const [search, setSearch] = useState("");
  // Uma placa aberta por vez, como no desktop.
  const [openPlate, setOpenPlate] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    data: report,
    loading,
    error,
    reload
  } = useAsync(
    () => loadTruckControl(user.companyId, user.unitId, startDate, endDate),
    [user.companyId, user.unitId, startDate, endDate]
  );

  // A mesma funcao de recorte vale para a lista e para os arquivos.
  const visible = useMemo(
    () => (report ? filterTruckControlReport(report, search) : null),
    [report, search]
  );
  const filteredTrucks = visible?.trucks ?? [];
  const filtered = Boolean(visible?.search);

  // Media do periodo inteiro: e contra ela que se destaca o caminhao demorado.
  const periodAverageMinutes = report?.averageMinutes ?? 0;
  const averageMinutes = visible?.averageMinutes ?? 0;

  // O arquivo parte do MESMO recorte da lista (periodo + busca), como o
  // `desktop:export-truck-control` do desktop.
  async function handleExport(format: "pdf" | "excel"): Promise<void> {
    if (!visible) return;
    setExporting(format);
    setNotice(null);
    setExportError(null);
    try {
      const file = truckControlDocument(format, visible);
      if (format === "pdf") {
        await printReportHtml(file.html, file.filename);
      } else {
        downloadSpreadsheet(file);
        setNotice(`Excel salvo em: ${file.filename}`);
      }
    } catch (err) {
      setExportError(
        err instanceof Error
          ? err.message
          : `Falha ao gerar o ${format === "pdf" ? "PDF" : "Excel"}.`
      );
    } finally {
      setExporting(null);
    }
  }

  return (
    <section className="truck-control">
      <header className="truck-control-header">
        <div className="truck-control-title-row">
          <h2 className="truck-control-title">Controle de caminhoes</h2>
          <span className="truck-control-help" role="img" aria-label="Dica" title={HELP}>
            <Lightbulb size={14} />
          </span>
        </div>
        <div className="truck-control-actions">
          <button
            type="button"
            className="icon-action primary"
            aria-label="Gerar PDF"
            title={
              exporting === "pdf"
                ? "Gerando PDF..."
                : filtered
                  ? "Gerar PDF so com os caminhoes da busca"
                  : "Gerar PDF"
            }
            disabled={exporting !== null || loading || !visible}
            onClick={() => void handleExport("pdf")}
          >
            <FileText size={16} />
          </button>
          <button
            type="button"
            className="icon-action primary"
            aria-label="Baixar Excel"
            title={
              exporting === "excel"
                ? "Gerando Excel..."
                : filtered
                  ? "Baixar Excel so com os caminhoes da busca"
                  : "Baixar Excel"
            }
            disabled={exporting !== null || loading || !visible}
            onClick={() => void handleExport("excel")}
          >
            <Table size={16} />
          </button>
        </div>
      </header>

      <div className="truck-control-filters">
        <label className="truck-control-field">
          De
          <input
            type="date"
            className="truck-control-input"
            value={startDate}
            max={endDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="truck-control-field">
          Ate
          <input
            type="date"
            className="truck-control-input"
            value={endDate}
            min={startDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        <label className="truck-control-field truck-control-search">
          Buscar caminhao (placa ou motorista) — vale para o PDF e o Excel
          <input
            type="search"
            className="truck-control-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ex: ABC1D23"
          />
        </label>
        <button
          type="button"
          className="icon-action"
          aria-label="Atualizar"
          title="Atualizar"
          onClick={() => void reload()}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {error ? <p className="truck-control-error">{error}</p> : null}
      {exportError ? <p className="truck-control-error">{exportError}</p> : null}
      {notice ? <p className="truck-control-muted">{notice}</p> : null}
      {filtered ? (
        <p className="truck-control-muted">
          Busca &quot;{visible?.search}&quot;: {filteredTrucks.length} de{" "}
          {report?.trucks.length ?? 0} caminhoes. Os cartoes e os arquivos (PDF/Excel) usam so
          esses. Tempo medio do periodo, com todos os caminhoes:{" "}
          {formatMinutes(periodAverageMinutes)}.
        </p>
      ) : null}

      <div className="truck-control-summary">
        <div className="truck-control-card">
          <span className="truck-control-card-label">Caminhoes</span>
          <span className="truck-control-card-value">{filteredTrucks.length}</span>
        </div>
        <div className="truck-control-card">
          <span className="truck-control-card-label">Operacoes</span>
          <span className="truck-control-card-value">{visible?.totalOperations ?? 0}</span>
        </div>
        <div className="truck-control-card">
          <span className="truck-control-card-label">Tempo medio na pedreira</span>
          <span className="truck-control-card-value">{formatMinutes(averageMinutes)}</span>
        </div>
        <div className="truck-control-card">
          <span className="truck-control-card-label">Tonelagem</span>
          <span className="truck-control-card-value">
            {((visible?.totalNetWeightKg ?? 0) / 1000).toLocaleString("pt-BR", {
              maximumFractionDigits: 2
            })}{" "}
            t
          </span>
        </div>
      </div>

      <div className="truck-control-table-scroll">
        <table className="truck-control-table">
          <thead>
            <tr>
              <th>Placa</th>
              <th>Motorista</th>
              <th className="num">Operacoes</th>
              <th className="num">Tempo medio</th>
              <th className="num">Tempo total</th>
              <th className="num">Peso (kg)</th>
              <th>Clientes atendidos</th>
              <th>Peso por produto</th>
              <th>Cargas</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10}>Carregando...</td>
              </tr>
            ) : filteredTrucks.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  {filtered ? "Nenhum caminhao para essa busca." : "Nenhum caminhao no periodo."}
                </td>
              </tr>
            ) : (
              filteredTrucks.map((truck) => {
                const aboveAvg =
                  truck.avgMinutes > periodAverageMinutes && periodAverageMinutes > 0;
                const open = openPlate === truck.plate;
                return (
                  <Fragment key={truck.plate}>
                    <tr>
                      <td>
                        <span className="truck-control-plate">{truck.plate}</span>
                      </td>
                      <td>{truck.driverName ?? "-"}</td>
                      <td className="num">{truck.operations}</td>
                      <td className={`num${aboveAvg ? " truck-control-above" : ""}`}>
                        {formatMinutes(truck.avgMinutes)}
                        {aboveAvg ? " ▲" : ""}
                      </td>
                      <td className="num">{formatMinutes(truck.totalMinutes)}</td>
                      <td className="num">{truck.totalNetWeightKg.toLocaleString("pt-BR")}</td>
                      <td>
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
                      <td>
                        {truck.products.length === 0
                          ? "-"
                          : truck.products.map((product) => (
                              <div key={product.productDescription}>
                                {product.productDescription}:{" "}
                                {product.totalNetWeightKg.toLocaleString("pt-BR")}
                              </div>
                            ))}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="truck-control-link"
                          onClick={() => setOpenPlate(open ? null : truck.plate)}
                        >
                          {open ? "Ocultar cargas" : `Ver ${truck.trips.length} carga(s)`}
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td className="truck-control-trip-cell" colSpan={10}>
                          <table className="truck-control-trip-table">
                            <thead>
                              <tr>
                                <th>Data</th>
                                <th>Cliente</th>
                                <th>Produto</th>
                                <th className="num">Peso (kg)</th>
                                <th className="num">Entrada</th>
                                <th className="num">Saida</th>
                                <th className="num">Tempo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {truck.trips.length === 0 ? (
                                <tr>
                                  <td colSpan={7}>Sem cargas no periodo.</td>
                                </tr>
                              ) : (
                                truck.trips.map((trip) => (
                                  <tr key={trip.operationId}>
                                    <td>{formatTripDay(trip.entryAt)}</td>
                                    <td>{trip.customerName}</td>
                                    <td>{trip.productDescription}</td>
                                    <td className="num">
                                      {trip.netWeightKg.toLocaleString("pt-BR")}
                                    </td>
                                    <td className="num">{formatClock(trip.entryAt)}</td>
                                    <td className="num">{formatClock(trip.exitAt)}</td>
                                    <td className="num">{formatMinutes(trip.minutes)}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
