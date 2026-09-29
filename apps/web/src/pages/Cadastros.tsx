import { useMemo, useState, type FormEvent } from "react";

import { IconAction, NewButton, PlateBadge, SearchBar, SectionHead } from "../components/desk";
import { Picker } from "../components/Picker";
import { DeleteDialog } from "../components/PricePassword";
import {
  Alert,
  DataTable,
  ErrorState,
  Field,
  Modal,
  Pill,
  Warnings,
  useDiscardGuard,
  useToast
} from "../components/ui";
import { callWebApi, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { CADASTRO_TABLES } from "../lib/cadastro-live";
import { useOnCadastroChange } from "../lib/cadastro-live-provider";
import { dedupeBy, dedupeDrivers, dedupeVehicles, type DedupedGroup } from "../lib/dedupe";
import { formatDocument, formatPlate, isValidDocument, normalizeDocument } from "../lib/format";
import { maskDocument, maskPhone, maskPlate } from "../lib/masks";
import { q, type Carrier, type Driver, type Vehicle } from "../lib/queries";
import { useAsync } from "../lib/use-async";
import {
  documentToSave,
  fieldOfError,
  maskPhoneInput,
  maskStored,
  phoneToSave
} from "./cadastro-form";

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

type ActiveAction = "set_vehicle_active" | "set_driver_active" | "set_carrier_active";

const ACTIVE_TEXT: Record<ActiveAction, { off: string; on: string }> = {
  set_driver_active: { off: "Motorista inativado.", on: "Motorista reativado." },
  set_vehicle_active: { off: "Veículo inativado.", on: "Veículo reativado." },
  set_carrier_active: { off: "Transportadora inativada.", on: "Transportadora reativada." }
};

/**
 * Inativar/reativar (todas as copias do grupo). Inativar tem volta: faz na hora e o "Desfazer"
 * da mensagem reativa pela mesma chamada do botao Reativar — em vez de perguntar antes.
 */
function useToggleActive(reload: () => Promise<void>) {
  const toast = useToast();
  const toggle = async (action: ActiveAction, ids: string[], isActive: boolean) => {
    try {
      for (const id of ids) await callWebApi(action, { id, isActive });
      if (isActive) toast.push(ACTIVE_TEXT[action].on);
      else {
        toast.push(ACTIVE_TEXT[action].off, "ok", {
          action: { label: "Desfazer", onClick: () => void toggle(action, ids, true) }
        });
      }
      await reload();
    } catch (caught) {
      toast.push(errorMessage(caught), "error");
    }
  };
  return toggle;
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
          ? `Este cadastro está repetido em ${ids.length} balanças: todas as cópias saem. As pesagens antigas continuam com o nome/placa gravados.`
          : "O cadastro sai das telas do site e das balanças. As pesagens antigas continuam com o nome/placa gravados."
      }
      askPassword={user.requiresPricePassword}
      onClose={onClose}
      onConfirm={async (pricePassword) => {
        try {
          for (const id of ids) await callWebApi(action, { id, pricePassword });
          toast.push("Cadastro excluído.");
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
    [user.companyId],
    { key: `cadastros:motoristas:${user.companyId}` }
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
        description="Motoristas usados na identificação do caminhão e impressos no cupom."
        action={
          user.canEditFleet && (
            <NewButton onClick={() => setDriver("new")}>Novo motorista</NewButton>
          )
        }
      />
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
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
        loading={loading}
        empty="Nenhum motorista."
        pageKey={`${needle}|${showInactive}`}
        columns={[
          {
            key: "name",
            header: "Nome",
            sortValue: ({ row: d }) => d.name,
            render: ({ row: d }) => <strong>{d.name}</strong>
          },
          {
            key: "details",
            header: "Detalhes",
            render: ({ row: d }) =>
              [
                d.document ? `CPF: ${d.document}` : null,
                d.phone ? `Tel: ${d.phone}` : null,
                d.is_independent ? "Autônomo" : null,
                d.is_active ? null : "Inativo"
              ]
                .filter(Boolean)
                .join(" · ") || "—"
          },
          {
            key: "actions",
            header: "Ações",
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
    [user.companyId],
    { key: `cadastros:placas:${user.companyId}` }
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
        description="Caminhões identificados pela placa. A mesma placa pode atender vários clientes e transportadoras."
        action={
          user.canEditFleet && <NewButton onClick={() => setVehicle("new")}>Novo veículo</NewButton>
        }
      />
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
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
        loading={loading}
        empty="Nenhum veículo."
        pageKey={`${needle}|${showInactive}`}
        columns={[
          {
            key: "plate",
            header: "Placa",
            sortValue: ({ row: v }) => v.plate.toUpperCase().replace(/[\s-]/g, ""),
            render: ({ row: v }) => <PlateBadge plate={formatPlate(v.plate)} />
          },
          {
            key: "desc",
            header: "Descrição",
            sortValue: ({ row: v }) => v.description,
            render: ({ row: v }) => v.description || "—"
          },
          {
            key: "carrier",
            header: "Transportadora",
            sortValue: ({ row: v }) =>
              v.carrier_id ? (carrierNames.get(v.carrier_id) ?? null) : null,
            render: ({ row: v }) => (
              <>
                {carrierName(v.carrier_id)}
                {!v.is_active && <span className="cell-sub">Inativo</span>}
              </>
            )
          },
          {
            key: "actions",
            header: "Ações",
            numeric: true,
            render: (group) =>
              user.canEditFleet && (
                <span className="row-actions">
                  <IconAction
                    icon="edit"
                    label="Editar veículo"
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
                    label="Excluir veículo"
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
  const [plateError, setPlateError] = useState<string | null>(null);
  // A web-api normaliza a placa (sem traco, maiuscula): a mascara nao muda o que e gravado.
  const [initial] = useState(() => ({
    plate: maskStored(vehicle?.plate, maskPlate),
    description: vehicle?.description ?? "",
    carrierId: vehicle?.carrier_id ?? ""
  }));
  const [plate, setPlate] = useState(initial.plate);
  const [description, setDescription] = useState(initial.description);
  const [carrierId, setCarrierId] = useState(initial.carrierId);
  const dirty =
    plate !== initial.plate ||
    description !== initial.description ||
    carrierId !== initial.carrierId;
  const guard = useDiscardGuard(dirty);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setPlateError(null);
    try {
      await callWebApi("upsert_vehicle", {
        ...(vehicle ? { id: vehicle.id } : {}),
        plate,
        description: description.trim() || null,
        carrierId: carrierId || null
      });
      toast.push("Veículo salvo.");
      await onSaved();
    } catch (caught) {
      const message = errorMessage(caught);
      if (fieldOfError(message, [["plate", /placa/i]])) setPlateError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }
  const formId = "vehicle-form";
  return (
    <Modal
      title={vehicle ? `Editar ${formatPlate(vehicle.plate)}` : "Novo veículo"}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void guard(onClose)}>
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
        <Field label="Placa" error={plateError}>
          <input
            className="input"
            value={plate}
            onChange={(e) => {
              setPlate(maskPlate(e.target.value));
              setPlateError(null);
            }}
            required
            autoFocus
            autoComplete="off"
            placeholder="ABC1D23"
          />
        </Field>
        <Field label="Descrição" hint="Ex.: Truck, Carreta, Toco">
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
  const [nameError, setNameError] = useState<string | null>(null);
  const [initial] = useState(() => ({
    name: driver?.name ?? "",
    document: maskStored(driver?.document, maskDocument),
    phone: maskStored(driver?.phone, maskPhone),
    isIndependent: driver?.is_independent ?? false
  }));
  const [name, setName] = useState(initial.name);
  const [document, setDocument] = useState(initial.document);
  const [phone, setPhone] = useState(initial.phone);
  const [isIndependent, setIsIndependent] = useState(initial.isIndependent);
  const dirty =
    name !== initial.name ||
    document !== initial.document ||
    phone !== initial.phone ||
    isIndependent !== initial.isIndependent;
  const guard = useDiscardGuard(dirty);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNameError(null);
    try {
      await callWebApi("upsert_driver", {
        ...(driver ? { id: driver.id } : {}),
        name,
        // O gravado sobe como estava se ninguem mexeu; o digitado com a mascara sobe sem a
        // pontuacao, como a balanca grava.
        document: documentToSave(document, initial.document, driver?.document),
        phone: phoneToSave(phone, initial.phone, driver?.phone),
        isIndependent
      });
      toast.push("Motorista salvo.");
      await onSaved();
    } catch (caught) {
      const message = errorMessage(caught);
      if (fieldOfError(message, [["name", /nome/i]])) setNameError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }
  const formId = "driver-form";
  return (
    <Modal
      title={driver ? `Editar ${driver.name}` : "Novo motorista"}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void guard(onClose)}>
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
        <Field label="Nome" error={nameError}>
          <input
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            required
            autoFocus
          />
        </Field>
        <div className="grid-2">
          <Field label="CPF / CNH">
            <input
              className="input"
              value={document}
              onChange={(e) => setDocument(maskDocument(e.target.value))}
              autoComplete="off"
            />
          </Field>
          <Field label="Telefone">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(maskPhoneInput(e.target.value))}
              placeholder="(15) 99999-9999"
            />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={isIndependent}
            onChange={(e) => setIsIndependent(e.target.checked)}
          />
          Motorista autônomo
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
    [user.companyId],
    { key: `cadastros:transportadoras:${user.companyId}` }
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
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
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
        loading={loading}
        empty="Nenhuma transportadora."
        pageKey={`${needle}|${showInactive}`}
        columns={[
          {
            key: "name",
            header: "Transportadora",
            sortValue: ({ row: c }) => c.name,
            render: ({ row: c }) => <strong>{c.name}</strong>
          },
          {
            key: "doc",
            header: "Documento",
            sortValue: ({ row: c }) => normalizeDocument(c.document ?? ""),
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
            header: "Ações",
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
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; document?: string }>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  // O documento sobe como esta no campo: a web-api tira a pontuacao (sem perder letra).
  const [initial] = useState(() => ({
    name: carrier?.name ?? "",
    document: formatDocument(carrier?.document)
  }));
  const [name, setName] = useState(initial.name);
  const [document, setDocument] = useState(initial.document);
  const dirty = !saved && (name !== initial.name || document !== initial.document);
  const guard = useDiscardGuard(dirty);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (document.trim() && !isValidDocument(document)) {
      setFieldErrors({ document: "CNPJ/CPF inválido." });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await callWebApi("upsert_carrier", {
        ...(carrier ? { id: carrier.id } : {}),
        name,
        document: document.trim() || null
      });
      setSaved(true);
      setWarnings(result.warnings);
      toast.push("Transportadora salva.");
      if (result.warnings.length === 0) await onSaved();
    } catch (caught) {
      const message = errorMessage(caught);
      const field = fieldOfError(message, [
        ["document", /CNPJ\/CPF/i],
        ["name", /nome/i]
      ] as const);
      if (field) setFieldErrors({ [field]: message });
      else setError(message);
    } finally {
      setBusy(false);
    }
  }
  const formId = "carrier-form";
  return (
    <Modal
      title={carrier ? `Editar ${carrier.name}` : "Nova transportadora"}
      onClose={onClose}
      dirty={dirty}
      footer={
        warnings.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => void onSaved()}>
            Entendi
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => void guard(onClose)}>
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
        <Field label="Nome" error={fieldErrors.name}>
          <input
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors((current) => ({ ...current, name: undefined }));
            }}
            required
            autoFocus
          />
        </Field>
        <Field
          label="CNPJ/CPF"
          hint="Sem documento a transportadora fica só aqui; com ele vai ao OMIE."
          error={fieldErrors.document}
        >
          <input
            className="input"
            value={document}
            onChange={(e) => {
              setDocument(maskDocument(e.target.value));
              setFieldErrors((current) => ({ ...current, document: undefined }));
            }}
            autoComplete="off"
          />
        </Field>
      </form>
    </Modal>
  );
}
