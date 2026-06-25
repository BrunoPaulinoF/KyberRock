export const OMIE_ENDPOINTS = {
  customers: "/geral/clientes/",
  products: "/geral/produtos/",
  salesOrders: "/produtos/pedido/",
  serviceOrders: "/servicos/os/",
  receivables: "/financas/contareceber/"
} as const;

export type OmieEndpoint = (typeof OMIE_ENDPOINTS)[keyof typeof OMIE_ENDPOINTS];

export interface OmieRequestBody<TParam> {
  call: string;
  param: TParam[];
}

export function createOmieRequestBody<TParam>(
  call: string,
  param: TParam
): OmieRequestBody<TParam> {
  if (!call.trim()) {
    throw new Error("OMIE call cannot be empty.");
  }

  return {
    call,
    param: [param]
  };
}

export function buildOmieIntegrationCode(unitId: string, entityId: string, action: string): string {
  return ["kyberrock", unitId, entityId, action].map((part) => part.replaceAll(":", "_")).join(":");
}
