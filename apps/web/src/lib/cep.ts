/**
 * Endereco pelo CEP (ViaCEP), para o formulario de cliente preencher rua, bairro, cidade e UF
 * sozinho. E so ajuda de digitacao: falha, demora ou CEP inexistente devolvem `null` e o
 * formulario continua como estava — nunca bloqueia o salvamento.
 */
export interface CepAddress {
  street: string;
  district: string;
  city: string;
  state: string;
}

const CEP_TIMEOUT_MS = 5000;

export async function lookupCep(
  cep: string,
  fetchImpl: typeof fetch = fetch
): Promise<CepAddress | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CEP_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://viacep.com.br/ws/${digits}/json/`, {
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    if (data.erro) return null;
    const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");
    const address = {
      street: text("logradouro"),
      district: text("bairro"),
      city: text("localidade"),
      state: text("uf")
    };
    return address.city ? address : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
