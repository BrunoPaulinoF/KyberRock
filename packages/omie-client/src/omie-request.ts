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
  const raw = ["kyberrock", unitId, entityId, action].map((part) => part.replaceAll(":", "_")).join(":");
  if (raw.length <= 60) {
    return raw;
  }
  return `kr:${fnv1a64(raw)}`;
}

function fnv1a64(input: string): string {
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash *= prime;
  }
  hash &= BigInt("0xFFFFFFFFFFFFFFFF");
  return hash.toString(16).padStart(16, "0");
}
