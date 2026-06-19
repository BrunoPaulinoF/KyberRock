export interface CustomerCacheEntry {
  id: string;
  tradeName: string;
  legalName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  creditLimitCents: number | null;
  openReceivablesCents: number;
  omieBillingBlocked: boolean;
  source: string;
  syncStatus: string;
  needsPush: boolean;
  lastSyncedAt: string | null;
  observations: string | null;
  defaultCarrierId: string | null;
  defaultPaymentTermId: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
}

export interface CarrierCacheEntry {
  id: string;
  name: string;
  document: string | null;
  source: string;
  isActive: boolean;
}

export interface PaymentTermCacheEntry {
  id: string;
  name: string;
  omieCode: string | null;
  isActive: boolean;
}

export interface CustomerFormData {
  tradeName: string;
  legalName: string;
  document: string;
  phone: string;
  email: string;
  creditLimitReais: string;
  omieBillingBlocked: boolean;
  observations: string;
  defaultCarrierId: string;
  defaultPaymentTermId: string;
  priceTableId: string;
  zipcode: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
}
