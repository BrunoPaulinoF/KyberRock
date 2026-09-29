import { useMemo, useState, type FormEvent } from "react";

import { IconAction, NewButton, Pill, SearchBar, SectionHead } from "../components/desk";
import { Picker } from "../components/Picker";
import { DeleteDialog } from "../components/PricePassword";
import { Alert, DataTable, Field, Modal, Warnings, useToast } from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { dedupeBy, dedupeDrivers, dedupeVehicles, type DedupedGroup } from "../lib/dedupe";
import { formatDocument, formatPlate, isValidDocument, normalizeDocument } from "../lib/format";
import { q, type Carrier, type Driver, type Vehicle } from "../lib/queries";
import { useAsync } from "../lib/use-async";

/*
 * A aba Transporte da tela Cadastros: Motoristas, Transportadoras e Placas, cada um com a
 * lista no molde do desktop (`DriverCrud`, `CarrierCrud`, `VehicleCrud`).
 *
 * A mesma placa (ou o mesmo motorista) cadastrada em duas balancas aparece UMA vez
 * (`lib/dedupe.ts`); inativar e excluir valem para todas as copias do grupo.
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
    ids: string[],
    isActive: boolean
  ) => {
    try {
      for (const id of ids) await callWebApi(action, { id, isActive });
      toast.push(isActive ? "Reativado." : "Inativado.");
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  };
}

type DeleteAction = "delete_driver" | "delete_vehicle" | "delete_carrier";

/** Excluir um cadastro (e as copias dele): senha rotativa para quem precisa, como o preco. */
function DeleteGroup({
  action,
  label,
  ids,
  onClose,
  onDeleted
}: {
  action: DeleteAction;
  label: string;
  ids: string[];
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const user = useUser();
  const toast = useToast();
  return (
    <DeleteDialog
      title={`Excluir ${label}`}
      description={
        ids.length > 1
          ? `Este cadastro esta repetido em ${ids.length} balancas: todas as copias saem. As pesagens antigas continuam com o nome/placa gravados.`
          : "O cadastro sai das telas do site e das balancas. As pesagens antigas continuam com o nome/placa gravados."
      }
      askPassword={user.requiresPricePassword}
      onClose={onClose}
      onConfirm={async (pricePassword) => {
        try {
          for (const id of ids) await callWebApi(action, { id, pricePassword });
          toast.push("Cadastro excluido.");
          onClose();
          await onDeleted();
          return null;
        } catch (caught) {
          return errorMessage(caught);
        }
      }}
    />
  );
}

export function DriversSection() {
  const user = useUser();
  const { data, loading, error, reload, refresh } = useAsync(
    () => q.drivers(user.companyId),
    [user.companyId]
  );
  useOnCadastroChange(refresh, CADASTRO_TABLES.drivers);
  const toggle = useToggleActive(reload);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [driver, setDriver] = useState<Driver | "new" | null>(null);
  const [removing, setRemoving] = useState<DedupedGroup<Driver> | null>(null);
  const groups = useMemo(() => dedupeDrivers(data ?? []), [data]);
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      groups.filter(
        ({ row: d }) =>
          (showInactive || d.is_active) &&
          (!needle ||
            d.name.toLowerCase().includes(needle) ||
            (d.document ?? "").toLowerCase().includes(needle))
      ),
    [groups, needle, showInactive]
  );

  return (
    <>
      <SectionHead
        title="Motoristas"
        count={groups.filter((g) => g.row.is_active).length}
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
        rowKey={(g) => g.row.id}
        rowClassName={(g) => (g.row.is_active ? undefined : "inactive")}
        empty={loading ? "Carregando..." : "Nenhum motorista."}
        pageKey={`${needle}|${showInactive}`}
        columns={[
          { key: "name", header: "Nome", render: ({ row: d }) => <strong>{d.name}</strong> },
          {
            key: "details",
            header: "Detalhes",
            render: ({ row: d }) =>
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
            render: (group) =>
              user.canEditFleet && (
                <span className="row-actions">
                  <IconAction
                    icon="edit"
                    label="Editar motorista"
                    onClick={() => setDriver(group.row)}
                  />
                  <IconAction
                    icon="power"
                    label={group.row.is_active ? "Inativar" : "Reativar"}
                    tone={group.row.is_active ? "danger" : "neutral"}
                    onClick={() =>
                      void toggle("set_driver_active", group.ids, !group.row.is_active)
                    }
                  />
                  <IconAction
                    icon="trash"
                    label="Excluir motorista"
                    tone="danger"
                    onClick={() => setRemoving(group)}
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
      {removing && (
        <DeleteGroup
          action="delete_driver"
          label={removing.row.name}
          ids={removing.ids}
          onClose={() => setRemoving(null)}
          onDeleted={reload}
        />
      )}
    </>
  );
}

export function VehiclesSection() {
  const user = useUser();
  const { data, loading, error, reload, refresh } = useAsync(
    () => Promise.all([q.vehicles(user.companyId), q.carriers(user.companyId)]),
    [user.companyId]
  );
  useOnCadastroChange(refresh, [...CADASTRO_TABLES.vehicles, ...CADASTRO_TABLES.carriers]);
  const toggle = useToggleActive(reload);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [vehicle, setVehicle] = useState<Vehicle | "new" | null>(null);
  const [removing, setRemoving] = useState<DedupedGroup<Vehicle> | null>(null);
  const [vehicles, carriers] = data ?? [[], []];
  const carrierNames = useMemo(
    () => new Map(carriers.map((carrier) => [carrier.id, carrier.name])),
    [carriers]
  );
  const carrierName = (id: string | null) => (id ? carrierNames.get(id) : undefined) ?? "—";
  const groups = useMemo(() => dedupeVehicles(vehicles), [vehicles]);
  const needle = search.trim().toLowerCase().replace(/[\s-]/g, "");
  const rows = useMemo(
    () =>
      groups.filter(
        ({ row: v }) =>
          (showInactive || v.is_active) &&
          (!needle ||
            v.plate.toLowerCase().replace(/[\s-]/g, "").includes(needle) ||
            (v.description ?? "").toLowerCase().includes(needle))
      ),
    [groups, needle, showInactive]
  );

  return (
    <>
      <SectionHead
        title="Placas"
        count={groups.filter((g) => g.row.is_active).length}
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
        rowKey={(g) => g.row.id}
        rowClassName={(g) => (g.row.is_active ? undefined : "inactive")}
        empty={loading ? "Carregando..." : "Nenhum veiculo."}
        pageKey={`${needle}|${showInactive}`}
        columns={[
          {
            key: "plate",
            header: "Placa",
            render: ({ row: v }) => <strong className="plate-badge">{formatPlate(v.plate)}</strong>
          },
          { key: "desc", header: "Descricao", render: ({ row: v }) => v.description || "—" },
          {
            key: "carrier",
            header: "Transportadora",
            render: ({ row: v }) => (
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
            render: (group) =>
              user.canEditFleet && (
                <span className="row-actions">
                  <IconAction
                    icon="edit"
                    label="Editar veiculo"
                    onClick={() => setVehicle(group.row)}
                  />
                  <IconAction
                    icon="power"
                    label={group.row.is_active ? "Inativar" : "Reativar"}
                    tone={group.row.is_active ? "danger" : "neutral"}
                    onClick={() =>
                      void toggle("set_vehicle_active", group.ids, !group.row.is_active)
                    }
                  />
                  <IconAction
                    icon="trash"
                    label="Excluir veiculo"
                    tone="danger"
                    onClick={() => setRemoving(group)}
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
      {removing && (
        <DeleteGroup
          action="delete_vehicle"
          label={formatPlate(removing.row.plate)}
          ids={removing.ids}
          onClose={() => setRemoving(null)}
          onDeleted={reload}
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
          <Picker
            value={carrierId}
            options={carriers
              .filter((c) => c.is_active)
              .map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCarrierId}
            placeholder="Buscar transportadora..."
            allowEmpty
            emptyLabel="Sem transportadora"
          />
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
  const { data, loading, error, reload, refresh } = useAsync(
    () => q.carriers(user.companyId),
    [user.companyId]
  );
  useOnCadastroChange(refresh, CADASTRO_TABLES.carriers);
  const toggle = useToggleActive(reload);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Carrier | "new" | null>(null);
  const [removing, setRemoving] = useState<DedupedGroup<Carrier> | null>(null);
  // Mesma transportadora cadastrada em duas balancas: o documento e quem diz. Sem documento,
  // cada uma fica sozinha (nome igual nao prova que e a mesma empresa).
  const groups = useMemo(
    () => dedupeBy(data ?? [], (carrier) => normalizeDocument(carrier.document ?? "")),
    [data]
  );
  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      groups.filter(
        ({ row: c }) =>
          (showInactive || c.is_active) &&
          (!needle || c.name.toLowerCase().includes(needle) || (c.document ?? "").includes(needle))
      ),
    [groups, needle, showInactive]
  );

  return (
    <>
      <SectionHead
        title="Transportadoras"
        count={groups.filter((g) => g.row.is_active).length}
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
        rowKey={(g) => g.row.id}
        rowClassName={(g) => (g.row.is_active ? undefined : "inactive")}
        empty={loading ? "Carregando..." : "Nenhuma transportadora."}
        pageKey={`${needle}|${showInactive}`}
        columns={[
          {
            key: "name",
            header: "Transportadora",
            render: ({ row: c }) => <strong>{c.name}</strong>
          },
          {
            key: "doc",
            header: "Documento",
            render: ({ row: c }) => formatDocument(c.document) || "—"
          },
          {
            key: "origin",
            header: "Origem",
            render: ({ row: c }) => (
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
            render: (group) =>
              user.canEditFleet && (
                <span className="row-actions">
                  <IconAction
                    icon="edit"
                    label="Editar transportadora"
                    onClick={() => setEditing(group.row)}
                  />
                  <IconAction
                    icon="power"
                    label={group.row.is_active ? "Inativar" : "Reativar"}
                    tone={group.row.is_active ? "danger" : "neutral"}
                    onClick={() =>
                      void toggle("set_carrier_active", group.ids, !group.row.is_active)
                    }
                  />
                  <IconAction
                    icon="trash"
                    label="Excluir transportadora"
                    tone="danger"
                    onClick={() => setRemoving(group)}
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
      {removing && (
        <DeleteGroup
          action="delete_carrier"
          label={removing.row.name}
          ids={removing.ids}
          onClose={() => setRemoving(null)}
          onDeleted={reload}
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
