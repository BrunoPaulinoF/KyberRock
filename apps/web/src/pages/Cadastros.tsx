import { useMemo, useState, type FormEvent } from "react";

import { IconAction, NewButton, Pill, SearchBar, SectionHead } from "../components/desk";
import { Alert, DataTable, Field, Modal, Warnings, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { formatDocument, formatPlate, isValidDocument } from "../lib/format";
import { q, type Carrier, type Driver, type Vehicle } from "../lib/queries";
import { useAsync } from "../lib/use-async";

/*
 * A aba Transporte da tela Cadastros: Motoristas, Transportadoras e Placas, cada um com a
 * lista no molde do desktop (`DriverCrud`, `CarrierCrud`, `VehicleCrud`).
 */

function InactiveToggle({
  checked,
  onChange,
  label = "Inativos"
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <label className="check" style={{ margin: 0, whiteSpace: "nowrap" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function useToggleActive(reload: () => Promise<void>) {
  const toast = useToast();
  return async (
    action: "set_vehicle_active" | "set_driver_active" | "set_carrier_active",
    id: string,
    isActive: boolean
  ) => {
    try {
      await callWebApi(action, { id, isActive });
      toast.push(isActive ? "Reativado." : "Inativado.");
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  };
}

export function DriversSection() {
  const user = useUser();
  const { data, loading, error, reload } = useAsync(
    () => q.drivers(user.companyId),
    [user.companyId]
  );
  const toggle = useToggleActive(reload);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [driver, setDriver] = useState<Driver | "new" | null>(null);
  const drivers = data ?? [];
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      drivers.filter(
        (d) =>
          (showInactive || d.is_active) &&
          (!needle ||
            d.name.toLowerCase().includes(needle) ||
            (d.document ?? "").toLowerCase().includes(needle))
      ),
    [drivers, needle, showInactive]
  );

  return (
    <>
      <SectionHead
        title="Motoristas"
        count={drivers.filter((d) => d.is_active).length}
        description="Motoristas usados na identificacao do caminhao e impressos no cupom."
        action={
          user.canEditFleet && (
            <NewButton onClick={() => setDriver("new")}>Novo motorista</NewButton>
          )
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar motoristas..."
        onRefresh={() => void reload()}
      >
        <InactiveToggle checked={showInactive} onChange={setShowInactive} />
      </SearchBar>
      <DataTable
        rows={rows}
        rowKey={(d) => d.id}
        rowClassName={(d) => (d.is_active ? undefined : "inactive")}
        empty={loading ? "Carregando..." : "Nenhum motorista."}
        columns={[
          { key: "name", header: "Nome", render: (d) => <strong>{d.name}</strong> },
          {
            key: "details",
            header: "Detalhes",
            render: (d) =>
              [
                d.document ? `CPF: ${d.document}` : null,
                d.phone ? `Tel: ${d.phone}` : null,
                d.is_independent ? "Autonomo" : null,
                d.is_active ? null : "Inativo"
              ]
                .filter(Boolean)
                .join(" · ") || "—"
          },
          {
            key: "actions",
            header: "Acoes",
            numeric: true,
            render: (d) =>
              user.canEditFleet && (
                <span className="row-actions">
                  <IconAction icon="edit" label="Editar motorista" onClick={() => setDriver(d)} />
                  <IconAction
                    icon="power"
                    label={d.is_active ? "Inativar" : "Reativar"}
                    tone={d.is_active ? "danger" : "neutral"}
                    onClick={() => void toggle("set_driver_active", d.id, !d.is_active)}
                  />
                </span>
              )
          }
        ]}
      />
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

export function VehiclesSection() {
  const user = useUser();
  const { data, loading, error, reload } = useAsync(
    () => Promise.all([q.vehicles(user.companyId), q.carriers(user.companyId)]),
    [user.companyId]
  );
  const toggle = useToggleActive(reload);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | "new" | null>(null);
  const [vehicles, carriers] = data ?? [[], []];
  const carrierName = (id: string | null) => carriers.find((c) => c.id === id)?.name ?? "—";
  const needle = search.trim().toLowerCase().replace(/[\s-]/g, "");
  const rows = useMemo(
    () =>
      vehicles.filter(
        (v) =>
          (showInactive || v.is_active) &&
          (!needle ||
            v.plate.toLowerCase().includes(needle) ||
            (v.description ?? "").toLowerCase().includes(needle))
      ),
    [vehicles, needle, showInactive]
  );

  return (
    <>
      <SectionHead
        title="Placas"
        count={vehicles.filter((v) => v.is_active).length}
        description="Caminhoes identificados pela placa. A mesma placa pode atender varios clientes e transportadoras."
        action={
          user.canEditFleet && <NewButton onClick={() => setVehicle("new")}>Novo veiculo</NewButton>
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar por placa..."
        onRefresh={() => void reload()}
      >
        <InactiveToggle checked={showInactive} onChange={setShowInactive} />
      </SearchBar>
      <DataTable
        rows={rows}
        rowKey={(v) => v.id}
        rowClassName={(v) => (v.is_active ? undefined : "inactive")}
        empty={loading ? "Carregando..." : "Nenhum veiculo."}
        columns={[
          {
            key: "plate",
            header: "Placa",
            render: (v) => <strong className="plate-badge">{formatPlate(v.plate)}</strong>
          },
          { key: "desc", header: "Descricao", render: (v) => v.description || "—" },
          {
            key: "carrier",
            header: "Transportadora",
            render: (v) => (
              <>
                {carrierName(v.carrier_id)}
                {!v.is_active && <span className="cell-sub">Inativo</span>}
              </>
            )
          },
          {
            key: "actions",
            header: "Acoes",
            numeric: true,
            render: (v) =>
              user.canEditFleet && (
                <span className="row-actions">
                  <IconAction icon="edit" label="Editar veiculo" onClick={() => setVehicle(v)} />
                  <IconAction
                    icon="power"
                    label={v.is_active ? "Inativar" : "Reativar"}
                    tone={v.is_active ? "danger" : "neutral"}
                    onClick={() => void toggle("set_vehicle_active", v.id, !v.is_active)}
                  />
                </span>
              )
          }
        ]}
      />
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

export function CarriersSection() {
  const user = useUser();
  const { data, loading, error, reload } = useAsync(
    () => q.carriers(user.companyId),
    [user.companyId]
  );
  const toggle = useToggleActive(reload);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Carrier | "new" | null>(null);
  const carriers = data ?? [];
  const needle = search.trim().toLowerCase();
  const rows = carriers.filter(
    (c) =>
      (showInactive || c.is_active) &&
      (!needle || c.name.toLowerCase().includes(needle) || (c.document ?? "").includes(needle))
  );

  return (
    <>
      <SectionHead
        title="Transportadoras"
        count={carriers.filter((c) => c.is_active).length}
        description="Sincronizadas do OMIE pela tag 'transportadora' ou criadas aqui. Com CNPJ, sobem ao OMIE como transportador."
        action={
          user.canEditFleet && (
            <NewButton onClick={() => setEditing("new")}>Nova transportadora</NewButton>
          )
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Buscar por nome ou documento..."
        onRefresh={() => void reload()}
      >
        <InactiveToggle checked={showInactive} onChange={setShowInactive} label="Inativas" />
      </SearchBar>
      <DataTable
        rows={rows}
        rowKey={(c) => c.id}
        rowClassName={(c) => (c.is_active ? undefined : "inactive")}
        empty={loading ? "Carregando..." : "Nenhuma transportadora."}
        columns={[
          { key: "name", header: "Transportadora", render: (c) => <strong>{c.name}</strong> },
          { key: "doc", header: "Documento", render: (c) => formatDocument(c.document) || "—" },
          {
            key: "origin",
            header: "Origem",
            render: (c) => (
              <span className="row-actions" style={{ justifyContent: "flex-start" }}>
                {c.omie_customer_id ? (
                  <Pill tone="warning">OMIE</Pill>
                ) : (
                  <Pill tone="success">LOCAL</Pill>
                )}
                {!c.is_active && <Pill>INATIVA</Pill>}
              </span>
            )
          },
          {
            key: "actions",
            header: "Acoes",
            numeric: true,
            render: (c) =>
              user.canEditFleet && (
                <span className="row-actions">
                  <IconAction
                    icon="edit"
                    label="Editar transportadora"
                    onClick={() => setEditing(c)}
                  />
                  <IconAction
                    icon="power"
                    label={c.is_active ? "Inativar" : "Reativar"}
                    tone={c.is_active ? "danger" : "neutral"}
                    onClick={() => void toggle("set_carrier_active", c.id, !c.is_active)}
                  />
                </span>
              )
          }
        ]}
      />
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
