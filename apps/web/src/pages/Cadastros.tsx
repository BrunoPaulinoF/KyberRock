import { useMemo, useState, type FormEvent } from "react";

import {
  Alert,
  Badge,
  DataTable,
  Field,
  Modal,
  PageHead,
  Warnings,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { formatDocument, formatPlate, isValidDocument } from "../lib/format";
import { q, type Carrier, type Driver, type Vehicle } from "../lib/queries";
import { useAsync } from "../lib/use-async";

/** Veiculos e motoristas numa tela so: e assim que a portaria pensa neles. */
export function VehiclesAndDrivers() {
  const user = useUser();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(
    () =>
      Promise.all([
        q.vehicles(user.companyId),
        q.drivers(user.companyId),
        q.carriers(user.companyId)
      ]),
    [user.companyId]
  );
  const [tab, setTab] = useState<"vehicles" | "drivers">("vehicles");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | "new" | null>(null);
  const [driver, setDriver] = useState<Driver | "new" | null>(null);
  const [vehicles, drivers, carriers] = data ?? [[], [], []];
  const carrierName = (id: string | null) => carriers.find((c) => c.id === id)?.name ?? "—";

  const needle = search.trim().toLowerCase();
  const vehicleRows = useMemo(
    () =>
      vehicles.filter(
        (v) =>
          (showInactive || v.is_active) &&
          (!needle ||
            v.plate.toLowerCase().includes(needle.replace(/[\s-]/g, "")) ||
            (v.description ?? "").toLowerCase().includes(needle))
      ),
    [vehicles, needle, showInactive]
  );
  const driverRows = useMemo(
    () =>
      drivers.filter(
        (d) => (showInactive || d.is_active) && (!needle || d.name.toLowerCase().includes(needle))
      ),
    [drivers, needle, showInactive]
  );

  async function toggle(
    action: "set_vehicle_active" | "set_driver_active",
    id: string,
    isActive: boolean
  ) {
    try {
      await callWebApi(action, { id, isActive });
      toast.push(isActive ? "Reativado." : "Inativado.");
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      <PageHead
        kicker="Cadastro"
        title="Veiculos e motoristas"
        description="Cadastro compartilhado com as balancas; a portaria tambem cadastra na hora quando o caminhao chega."
        actions={
          <button
            className="btn primary"
            onClick={() => (tab === "vehicles" ? setVehicle("new") : setDriver("new"))}
          >
            {tab === "vehicles" ? "Novo veiculo" : "Novo motorista"}
          </button>
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="tabs">
        <button
          className={`tab ${tab === "vehicles" ? "active" : ""}`}
          onClick={() => setTab("vehicles")}
        >
          Veiculos ({vehicles.length})
        </button>
        <button
          className={`tab ${tab === "drivers" ? "active" : ""}`}
          onClick={() => setTab("drivers")}
        >
          Motoristas ({drivers.length})
        </button>
      </div>
      <div className="panel">
        <div className="toolbar">
          <input
            className="input"
            placeholder="Buscar"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Mostrar inativos
          </label>
        </div>
        {tab === "vehicles" ? (
          <DataTable
            rows={vehicleRows}
            rowKey={(v) => v.id}
            rowClassName={(v) => (v.is_active ? undefined : "inactive")}
            empty={loading ? "Carregando..." : "Nenhum veiculo."}
            columns={[
              {
                key: "plate",
                header: "Placa",
                render: (v) => <strong>{formatPlate(v.plate)}</strong>
              },
              { key: "desc", header: "Descricao", render: (v) => v.description || "—" },
              {
                key: "carrier",
                header: "Transportadora",
                render: (v) => carrierName(v.carrier_id)
              },
              {
                key: "status",
                header: "Situacao",
                render: (v) =>
                  v.is_active ? <Badge kind="ok">ativo</Badge> : <Badge>inativo</Badge>
              },
              {
                key: "actions",
                header: "",
                render: (v) => (
                  <span className="actions">
                    <button className="btn small" onClick={() => setVehicle(v)}>
                      Editar
                    </button>
                    <button
                      className="btn small"
                      onClick={() => void toggle("set_vehicle_active", v.id, !v.is_active)}
                    >
                      {v.is_active ? "Inativar" : "Reativar"}
                    </button>
                  </span>
                )
              }
            ]}
          />
        ) : (
          <DataTable
            rows={driverRows}
            rowKey={(d) => d.id}
            rowClassName={(d) => (d.is_active ? undefined : "inactive")}
            empty={loading ? "Carregando..." : "Nenhum motorista."}
            columns={[
              { key: "name", header: "Motorista", render: (d) => <strong>{d.name}</strong> },
              { key: "doc", header: "Documento", render: (d) => d.document || "—" },
              { key: "phone", header: "Telefone", render: (d) => d.phone || "—" },
              { key: "ind", header: "Autonomo", render: (d) => (d.is_independent ? "sim" : "nao") },
              {
                key: "status",
                header: "Situacao",
                render: (d) =>
                  d.is_active ? <Badge kind="ok">ativo</Badge> : <Badge>inativo</Badge>
              },
              {
                key: "actions",
                header: "",
                render: (d) => (
                  <span className="actions">
                    <button className="btn small" onClick={() => setDriver(d)}>
                      Editar
                    </button>
                    <button
                      className="btn small"
                      onClick={() => void toggle("set_driver_active", d.id, !d.is_active)}
                    >
                      {d.is_active ? "Inativar" : "Reativar"}
                    </button>
                  </span>
                )
              }
            ]}
          />
        )}
      </div>

      {vehicle && (
        <VehicleForm
          vehicle={vehicle === "new" ? null : vehicle}
          carriers={carriers}
          onClose={() => setVehicle(null)}
          onSaved={async () => {
            setVehicle(null);
            await reload();
          }}
        />
      )}
      {driver && (
        <DriverForm
          driver={driver === "new" ? null : driver}
          onClose={() => setDriver(null)}
          onSaved={async () => {
            setDriver(null);
            await reload();
          }}
        />
      )}
    </>
  );
}

function VehicleForm({
  vehicle,
  carriers,
  onClose,
  onSaved
}: {
  vehicle: Vehicle | null;
  carriers: Carrier[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [description, setDescription] = useState(vehicle?.description ?? "");
  const [carrierId, setCarrierId] = useState(vehicle?.carrier_id ?? "");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await callWebApi("upsert_vehicle", {
        ...(vehicle ? { id: vehicle.id } : {}),
        plate,
        description: description.trim() || null,
        carrierId: carrierId || null
      });
      toast.push("Veiculo salvo.");
      await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
  const formId = "vehicle-form";
  return (
    <Modal
      title={vehicle ? `Editar ${formatPlate(vehicle.plate)}` : "Novo veiculo"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <form id={formId} onSubmit={(e) => void onSubmit(e)}>
        <Field label="Placa">
          <input
            className="input"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            required
            autoFocus
            placeholder="ABC1D23"
          />
        </Field>
        <Field label="Descricao" hint="Ex.: Truck, Carreta, Toco">
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Transportadora">
          <select
            className="select"
            value={carrierId}
            onChange={(e) => setCarrierId(e.target.value)}
          >
            <option value="">—</option>
            {carriers
              .filter((c) => c.is_active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

function DriverForm({
  driver,
  onClose,
  onSaved
}: {
  driver: Driver | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(driver?.name ?? "");
  const [document, setDocument] = useState(driver?.document ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [isIndependent, setIsIndependent] = useState(driver?.is_independent ?? false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await callWebApi("upsert_driver", {
        ...(driver ? { id: driver.id } : {}),
        name,
        document: document.trim() || null,
        phone: phone.trim() || null,
        isIndependent
      });
      toast.push("Motorista salvo.");
      await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
  const formId = "driver-form";
  return (
    <Modal
      title={driver ? `Editar ${driver.name}` : "Novo motorista"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" type="submit" form={formId} disabled={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <form id={formId} onSubmit={(e) => void onSubmit(e)}>
        <Field label="Nome">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <div className="grid-2">
          <Field label="CPF / CNH">
            <input
              className="input"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
            />
          </Field>
          <Field label="Telefone">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={isIndependent}
            onChange={(e) => setIsIndependent(e.target.checked)}
          />
          Motorista autonomo
        </label>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export function Carriers() {
  const user = useUser();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(
    () => q.carriers(user.companyId),
    [user.companyId]
  );
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Carrier | "new" | null>(null);
  const carriers = data ?? [];
  const needle = search.trim().toLowerCase();
  const rows = carriers.filter(
    (c) => (showInactive || c.is_active) && (!needle || c.name.toLowerCase().includes(needle))
  );

  async function toggle(carrier: Carrier) {
    try {
      await callWebApi("set_carrier_active", { id: carrier.id, isActive: !carrier.is_active });
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  }

  return (
    <>
      <PageHead
        kicker="Cadastro"
        title="Transportadoras"
        description="Transportadora com CNPJ sobe para o OMIE como cadastro de transportador."
        actions={
          <button className="btn primary" onClick={() => setEditing("new")}>
            Nova transportadora
          </button>
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="panel">
        <div className="toolbar">
          <input
            className="input"
            placeholder="Buscar"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Mostrar inativas
          </label>
        </div>
        <DataTable
          rows={rows}
          rowKey={(c) => c.id}
          rowClassName={(c) => (c.is_active ? undefined : "inactive")}
          empty={loading ? "Carregando..." : "Nenhuma transportadora."}
          columns={[
            { key: "name", header: "Transportadora", render: (c) => <strong>{c.name}</strong> },
            { key: "doc", header: "CNPJ/CPF", render: (c) => formatDocument(c.document) || "—" },
            {
              key: "omie",
              header: "OMIE",
              render: (c) =>
                c.omie_customer_id ? (
                  <Badge kind="ok">{c.omie_customer_id}</Badge>
                ) : (
                  <Badge kind="warn">nao enviada</Badge>
                )
            },
            {
              key: "status",
              header: "Situacao",
              render: (c) => (c.is_active ? <Badge kind="ok">ativa</Badge> : <Badge>inativa</Badge>)
            },
            {
              key: "actions",
              header: "",
              render: (c) => (
                <span className="actions">
                  <button className="btn small" onClick={() => setEditing(c)}>
                    Editar
                  </button>
                  <button className="btn small" onClick={() => void toggle(c)}>
                    {c.is_active ? "Inativar" : "Reativar"}
                  </button>
                </span>
              )
            }
          ]}
        />
      </div>
      {editing && (
        <CarrierForm
          carrier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </>
  );
}

function CarrierForm({
  carrier,
  onClose,
  onSaved
}: {
  carrier: Carrier | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [name, setName] = useState(carrier?.name ?? "");
  const [document, setDocument] = useState(formatDocument(carrier?.document));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (document.trim() && !isValidDocument(document)) {
      setError("CNPJ/CPF invalido.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await callWebApi("upsert_carrier", {
        ...(carrier ? { id: carrier.id } : {}),
        name,
        document: document.trim() || null
      });
      setWarnings(result.warnings);
      toast.push("Transportadora salva.");
      if (result.warnings.length === 0) await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }
  const formId = "carrier-form";
  return (
    <Modal
      title={carrier ? `Editar ${carrier.name}` : "Nova transportadora"}
      onClose={onClose}
      footer={
        warnings.length > 0 ? (
          <button className="btn primary" onClick={() => void onSaved()}>
            Entendi
          </button>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn primary" type="submit" form={formId} disabled={busy}>
              {busy ? "Salvando..." : "Salvar"}
            </button>
          </>
        )
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <Warnings items={warnings} />
      <form id={formId} onSubmit={(e) => void onSubmit(e)}>
        <Field label="Nome">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field
          label="CNPJ/CPF"
          hint="Sem documento a transportadora fica so aqui; com ele vai ao OMIE."
        >
          <input className="input" value={document} onChange={(e) => setDocument(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
