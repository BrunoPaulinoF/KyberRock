export interface CustomerCacheEntry {
  id: string;
  tradeName: string;
  legalName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  creditLimitCents: number | null;
  creditMode: "normal" | "prepaid";
  openReceivablesCents: number;
  omieBillingBlocked: boolean;
  source: string;
  syncStatus: string;
  needsPush: boolean;
  lastSyncedAt: string | null;
  observations: string | null;
  defaultCarrierId: string | null;
  defaultPaymentTermId: string | null;
  defaultPaymentMethodId: string | null;
  creditAccountEnabled: boolean;
  creditClosingDay: number | null;
  creditBoletoDays: number | null;
  nfRequired: boolean;
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
  phone: string | null;
  email: string | null;
  zipcode: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  nfRequired: boolean;
  source: string;
  isActive: boolean;
}

export interface PaymentTermCacheEntry {
  id: string;
  name: string;
  omieCode: string | null;
  rulesJson: string;
  installmentCount: number | null;
  isActive: boolean;
}

export interface PaymentMethodCacheEntry {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  isCustomerCredit: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface CustomerFormData {
  tradeName: string;
  legalName: string;
  document: string;
  phone: string;
  email: string;
  creditLimitReais: string;
  creditMode: "normal" | "prepaid";
  omieBillingBlocked: boolean;
  observations: string;
  defaultCarrierId: string;
  defaultPaymentTermId: string;
  defaultPaymentMethodId: string;
  creditAccountEnabled: boolean;
  creditClosingDay: string;
  creditBoletoDays: string;
  nfRequired: boolean;
  zipcode: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
}
