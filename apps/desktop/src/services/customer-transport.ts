import type { DesktopDatabase } from "../database/sqlite.js";
import { createCarrier, findCarrierByDocument } from "./carriers.js";
import {
  linkCustomerCarrier,
  listCarriersByCustomer,
  setCustomerDefaultCarrier
} from "./customer-carriers.js";
import {
  linkCustomerVehicle,
  listVehiclesByCustomer,
  unlinkCustomerVehicle,
  type CustomerVehicleSummary
} from "./customer-vehicles.js";
import { isFreightModality, type FreightModality } from "./freight.js";
import { createVehicle } from "./vehicles.js";

/**
 * A aba TRANSPORTE do cadastro do cliente, num lugar so: como o frete dele costuma sair,
 * quem transporta e quais placas sao dele.
 *
 * Antes eram tres coisas espalhadas — uma lista com TODAS as transportadoras da pedreira
 * para marcar no checkbox, o tipo de frete escolhido de novo a cada entrada, e placa
 * nenhuma ligada ao cliente. Quem registra a entrada tem o caminhao em cima da balanca: o
 * que o cadastro souber de antemao e o que ele nao precisa procurar na hora.
 */

export interface CustomerTransport {
  /** Tipo de frete que este cliente costuma usar; null = sem padrao (o de sempre). */
  defaultFreightModality: FreightModality | null;
  /** Transportadoras vinculadas a este cliente. */
  carriers: Array<{ id: string; name: string; document: string | null }>;
  /** Transportadora padrao dele — a que a nova entrada ja traz preenchida. */
  defaultCarrierId: string | null;
  /**
   * A transportadora que E o proprio cliente (mesmo CNPJ/CPF), quando existe. Com ela como
   * padrao, o cliente transporta na propria placa.
   */
  ownCarrierId: string | null;
  isOwnTransport: boolean;
  plates: CustomerVehicleSummary[];
}

export function getCustomerTransport(
  database: DesktopDatabase,
  companyId: string,
  customerId: string
): CustomerTransport {
  const customer = database
    .prepare(
      `SELECT trade_name, legal_name, document, default_carrier_id, default_freight_modality
       FROM customers WHERE id = ? AND deleted_at IS NULL`
    )
    .get(customerId) as
    | {
        trade_name: string | null;
        legal_name: string | null;
        document: string | null;
        default_carrier_id: string | null;
        default_freight_modality: string | null;
      }
    | undefined;

  if (!customer) {
    return {
      defaultFreightModality: null,
      carriers: [],
      defaultCarrierId: null,
      ownCarrierId: null,
      isOwnTransport: false,
      plates: []
    };
  }

  const ownCarrierId = customer.document
    ? (findCarrierByDocument(database, companyId, customer.document)?.id ?? null)
    : null;

  const modality = customer.default_freight_modality;
  return {
    defaultFreightModality: isFreightModality(modality) ? modality : null,
    carriers: listCarriersByCustomer(database, customerId),
    defaultCarrierId: customer.default_carrier_id,
    ownCarrierId,
    isOwnTransport: Boolean(ownCarrierId) && customer.default_carrier_id === ownCarrierId,
    plates: listVehiclesByCustomer(database, customerId)
  };
}

/**
 * Grava o tipo de frete padrao. Valor que nao seja uma modalidade conhecida vira "sem
 * padrao": um texto solto aqui iria preencher a nova entrada com uma escolha que a tela
 * nao sabe desenhar.
 */
export function setCustomerDefaultFreightModality(
  database: DesktopDatabase,
  customerId: string,
  modality: string | null,
  now: Date = new Date()
): FreightModality | null {
  const value = isFreightModality(modality) ? modality : null;
  const nowIso = now.toISOString();
  database
    .prepare(
      `UPDATE customers
       SET default_freight_modality = ?, needs_push = 1, local_updated_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(value, nowIso, nowIso, customerId);
  return value;
}

/**
 * Liga o cliente ao "transporte proprio": a transportadora com o NOME e o CNPJ/CPF dele.
 *
 * O cliente que carrega no proprio caminhao continua precisando de uma transportadora no
 * pedido — e o que sai na nota. Sem isto, ou ficava a transportadora marcadora
 * "<cliente> (padrao)", que nao e um cadastro de verdade, ou o operador criava a mao um
 * cadastro com o nome do cliente, de novo a cada balanca, gerando duplicatas.
 *
 * A busca e por DOCUMENTO, o mesmo criterio do OMIE (find-or-create por CNPJ/CPF): duas
 * linhas com o mesmo documento virariam o mesmo cadastro la. Cliente sem documento cai na
 * busca por nome, que e o que sobra.
 */
export function useCustomerOwnCarrier(
  database: DesktopDatabase,
  companyId: string,
  customerId: string,
  now: Date = new Date()
): { carrierId: string; created: boolean } {
  const customer = database
    .prepare(
      `SELECT trade_name, legal_name, document, phone, email
       FROM customers WHERE id = ? AND deleted_at IS NULL`
    )
    .get(customerId) as
    | {
        trade_name: string | null;
        legal_name: string | null;
        document: string | null;
        phone: string | null;
        email: string | null;
      }
    | undefined;
  if (!customer) throw new Error("Cliente nao encontrado.");

  const name = (customer.trade_name || customer.legal_name || "").trim();
  if (!name) throw new Error("Cliente sem nome: complete o cadastro antes.");

  const existing =
    (customer.document ? findCarrierByDocument(database, companyId, customer.document) : null) ??
    findCarrierByName(database, companyId, name);

  if (existing) {
    linkCustomerCarrier(database, customerId, existing.id, now);
    setCustomerDefaultCarrier(database, customerId, existing.id, now);
    return { carrierId: existing.id, created: false };
  }

  const created = createCarrier(
    database,
    {
      companyId,
      name,
      document: customer.document ?? undefined,
      phone: customer.phone ?? undefined,
      email: customer.email ?? undefined
    },
    now
  ) as { id: string };

  linkCustomerCarrier(database, customerId, created.id, now);
  setCustomerDefaultCarrier(database, customerId, created.id, now);
  return { carrierId: created.id, created: true };
}

/** Desfaz o transporte proprio: o cliente volta a nao ter transportadora padrao. */
export function clearCustomerOwnCarrier(
  database: DesktopDatabase,
  companyId: string,
  customerId: string,
  now: Date = new Date()
): void {
  const transport = getCustomerTransport(database, companyId, customerId);
  if (!transport.isOwnTransport) return;
  const fallback = transport.carriers.find((carrier) => carrier.id !== transport.ownCarrierId);
  setCustomerDefaultCarrier(database, customerId, fallback?.id ?? null, now);
}

/**
 * Vincula uma placa ao cliente, cadastrando-a se ainda nao existir.
 *
 * `createVehicle` ja reaproveita a placa existente em vez de recusar ou duplicar (a mesma
 * placa roda para varios clientes), entao criar e selecionar sao o mesmo gesto — que e
 * exatamente como a operacao pensa: "a placa tal e desse cliente".
 */
export function addCustomerPlate(
  database: DesktopDatabase,
  companyId: string,
  customerId: string,
  plate: string,
  now: Date = new Date()
): CustomerVehicleSummary {
  const text = plate.trim().toUpperCase();
  if (!text) throw new Error("Informe a placa.");

  const vehicle = createVehicle(database, { companyId, plate: text }, now);
  linkCustomerVehicle(database, customerId, vehicle.id, now);
  return { id: vehicle.id, plate: vehicle.plate, description: vehicle.description };
}

export function removeCustomerPlate(
  database: DesktopDatabase,
  customerId: string,
  vehicleId: string,
  now: Date = new Date()
): void {
  unlinkCustomerVehicle(database, customerId, vehicleId, now);
}

/** Transportadora ativa com este nome (sem acento e sem caixa) — a saida para cliente sem documento. */
function findCarrierByName(
  database: DesktopDatabase,
  companyId: string,
  name: string
): { id: string; name: string } | null {
  const rows = database
    .prepare(
      `SELECT id, name FROM carriers
       WHERE company_id = ? AND deleted_at IS NULL AND is_active = 1`
    )
    .all(companyId) as Array<{ id: string; name: string }>;
  const target = comparableName(name);
  return rows.find((row) => comparableName(row.name) === target) ?? null;
}

function comparableName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
