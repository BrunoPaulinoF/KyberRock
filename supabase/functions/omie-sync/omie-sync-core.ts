export const OMIE_BASE_URL = "https://app.omie.com.br/api/v1";
export const OMIE_REQUEST_DELAY_MS = 3_000;
export const OMIE_MAX_RETRIES = 4;
export const OMIE_BASE_BACKOFF_MS = 5_000;
export const OMIE_DEFAULT_LIMIT_WAIT_MS = 60_000;
export const OMIE_MAX_BACKOFF_MS = 120_000;

/**
 * Acima disto a espera NAO cabe dentro de uma passada — e o bloqueio de consumo do OMIE,
 * que vem em dezenas de minutos ("Tente novamente em 1797 segundos"), nao em segundos.
 *
 * Insistir nesse caso e o pior dos mundos: cada tentativa e mais uma chamada recusada que
 * conta para o mesmo bloqueio que a causou, e a passada gasta o tempo de vida da funcao
 * inteiro para voltar sem nada. Quando a espera pedida passa daqui, a fila desiste da
 * passada e guarda o horario da liberacao (ver `blockedUntil`).
 */
export const OMIE_BLOCK_WAIT_THRESHOLD_MS = OMIE_MAX_BACKOFF_MS;

export type OmieCredentials = {
  appKey: string;
  appSecret: string;
};

export type OmieQueueManagerOptions = {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  minDelayMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
};

export type OmieRequestInput<TParam> = {
  credentials: OmieCredentials;
  endpoint: string;
  call: string;
  param: TParam;
};

export type OmieRequester = Pick<OmieQueueManager, "request">;

export type PushCustomerPayload = {
  localCustomerId: string;
  omieCustomerId?: number;
  razaoSocial: string;
  nomeFantasia?: string;
  cnpjCpf?: string;
  /** E-mail de CONTATO do cliente (campo `email` do cadastro do OMIE). */
  email?: string;
  /**
   * Destinatarios da NF-e e do boleto (aba Fiscal do cadastro do KyberRock -> tag
   * `email_fatura` do OMIE). String vazia limpa o campo la; `undefined` (chamador que
   * nao gerencia o campo, como o push de transportadora) nao mexe nele.
   */
  fiscalEmails?: string;
  telefone1Ddd?: string;
  telefone1Numero?: string;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  defaultPaymentTermId?: string;
  /**
   * Observacoes internas do cadastro (campo `observacao` do cliente no OMIE).
   *
   * O KyberRock gerencia este campo, e por isso a string vazia LIMPA a observacao la, em
   * vez de preservar como fazem os demais campos: sem isso a operadora nao conseguiria
   * apagar o que escreveu. `undefined` (chamador que nao gerencia o campo, como o push de
   * transportadora) nao mexe nele.
   */
  observations?: string;
  /** Bloqueia/libera o faturamento do cliente no OMIE (bloquear_faturamento S/N). */
  billingBlocked?: boolean;
  tags?: string[];
};

export type PushCarrierPayload = Omit<PushCustomerPayload, "razaoSocial" | "nomeFantasia"> & {
  name: string;
  razaoSocial?: string;
  nomeFantasia?: string;
};

export class OmieHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detail: string | null,
    readonly retryAfterMs: number | null
  ) {
    super(message);
    this.name = "OmieHttpError";
  }
}

export class OmieQueueManager {
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly nowFn: () => number;
  private readonly minDelayMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private gate: Promise<void> = Promise.resolve();
  private lastFinishedAt = 0;
  /**
   * Ate quando o OMIE fechou a API desta fila (0 = aberta).
   *
   * O bloqueio por consumo indevido nao vale para a chamada que o levou: ele vale para a
   * app_key inteira, por meia hora. Sem esta memoria, cada uma das chamadas restantes da
   * passada saia assim mesmo, era recusada igual e ainda contava para o mesmo bloqueio —
   * o log ficava cheio de 425 e a passada voltava sem nada.
   */
  private blockedUntil = 0;
  private blockedDetail: string | null = null;

  constructor(options: OmieQueueManagerOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleepFn ?? sleep;
    this.nowFn = options.nowFn ?? Date.now;
    this.minDelayMs = options.minDelayMs ?? OMIE_REQUEST_DELAY_MS;
    this.maxRetries = options.maxRetries ?? OMIE_MAX_RETRIES;
    this.baseBackoffMs = options.baseBackoffMs ?? OMIE_BASE_BACKOFF_MS;
  }

  async request<TParam, TResponse>(input: OmieRequestInput<TParam>): Promise<TResponse> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const blocked = this.blockedError(input);
      if (blocked) throw blocked;

      try {
        return await this.requestOnce<TParam, TResponse>(input);
      } catch (error) {
        if (isOmieApiBlockedError(error) && error instanceof OmieHttpError) {
          this.openBreaker(error);
        }
        if (
          !isOmieLimitError(error) ||
          !(error instanceof OmieHttpError) ||
          attempt >= this.maxRetries ||
          // Espera que nao cabe na passada: repetir aqui so gastaria o tempo de vida da
          // funcao em chamadas que o OMIE ja avisou que vai recusar.
          (error.retryAfterMs ?? 0) > OMIE_BLOCK_WAIT_THRESHOLD_MS
        ) {
          throw error;
        }
        const retryDelayMs = getRetryDelayMs(error, attempt, this.baseBackoffMs);
        await this.sleepFn(retryDelayMs);
      }
    }

    throw new Error(`OMIE retry esgotado em ${input.call} (${input.endpoint})`);
  }

  /** O bloqueio ainda de pe, como o erro que a chamada teria recebido do OMIE. */
  private blockedError<TParam>(input: OmieRequestInput<TParam>): OmieHttpError | null {
    if (this.blockedUntil === 0) return null;
    const remainingMs = this.blockedUntil - this.nowFn();
    if (remainingMs <= 0) {
      this.blockedUntil = 0;
      this.blockedDetail = null;
      return null;
    }
    const detail = this.blockedDetail ?? "API bloqueada por consumo indevido";
    return new OmieHttpError(
      `OMIE bloqueou a API em ${input.call} (${input.endpoint}) - ${detail}`,
      425,
      detail,
      remainingMs
    );
  }

  private openBreaker(error: OmieHttpError): void {
    const waitMs = error.retryAfterMs ?? OMIE_DEFAULT_LIMIT_WAIT_MS;
    this.blockedUntil = Math.max(this.blockedUntil, this.nowFn() + waitMs);
    this.blockedDetail = error.detail ?? error.message;
  }

  private async requestOnce<TParam, TResponse>(
    input: OmieRequestInput<TParam>
  ): Promise<TResponse> {
    const release = await this.acquireRequestSlot();
    let response: Response | null = null;
    let data: unknown = null;

    try {
      response = await this.fetchFn(`${OMIE_BASE_URL}${input.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call: input.call,
          param: [input.param],
          app_key: input.credentials.appKey,
          app_secret: input.credentials.appSecret
        })
      });
      data = await readOmieResponseBody(response);
    } finally {
      release();
    }

    if (!response) throw new Error(`Falha de transporte OMIE em ${input.call}`);

    const detail = getOmieFaultString(data);
    if (!response.ok || detail) {
      const retryAfterMs = parseOmieRetryDelayMs(detail, response.headers.get("retry-after"));
      const status = response.ok ? null : response.status;
      const statusText = response.ok ? "faultstring" : `HTTP ${response.status}`;
      // Diagnostico: registra a chamada, o erro e o corpo enviado (sem credenciais) para
      // depurar rejeicoes de campo obrigatorio do OMIE (ex: "tag [valor] obrigatorio").
      //
      // "Nao cadastrado" sai como LOG, nao como erro: e uma resposta, nao uma falha. O
      // OMIE usa o mesmo HTTP 500 para "o registro nao existe" e para "a chamada esta
      // errada", e quem pergunta aqui ja trata o primeiro caso como fato (ver
      // `isOmieNotFoundFault`). Registrado como erro, ele inflava o painel de erros do
      // projeto com o resultado esperado de uma consulta que funcionou.
      const expected = detail !== null && isOmieNotFoundFault(detail);
      try {
        const line = `[omie] falha em ${input.call} (${input.endpoint}) ${statusText}: ${detail ?? "sem detalhe"} | param=${JSON.stringify(input.param)}`;
        if (expected) console.log(line);
        else console.error(line);
      } catch {
        /* logging best-effort */
      }
      throw new OmieHttpError(
        `OMIE ${statusText} em ${input.call} (${input.endpoint})${detail ? ` - ${detail}` : ""}`,
        status,
        detail,
        retryAfterMs
      );
    }

    return data as TResponse;
  }

  private async acquireRequestSlot(): Promise<() => void> {
    let releaseSlot: () => void = () => undefined;
    const nextSlot = new Promise<void>((resolve) => {
      releaseSlot = resolve;
    });
    const previousSlot = this.gate;
    this.gate = previousSlot.then(() => nextSlot);
    await previousSlot;

    const elapsedMs = this.nowFn() - this.lastFinishedAt;
    if (this.lastFinishedAt > 0 && elapsedMs >= 0 && elapsedMs < this.minDelayMs) {
      await this.sleepFn(this.minDelayMs - elapsedMs);
    }

    return () => {
      this.lastFinishedAt = this.nowFn();
      releaseSlot();
    };
  }
}

// O OMIE rejeita codigos de integracao com caracteres especiais (hifens de UUID,
// ":" das chaves de idempotencia) — "caracteres especiais nao permitidos para um codigo".
// Esta funcao mapeia qualquer valor para um codigo aceito: mantem valores curtos que ja
// sao alfanumericos e, para o resto, deriva um hash estavel (mesma entrada => mesmo
// codigo, preservando a idempotencia no OMIE).
export const OMIE_INTEGRATION_CODE_MAX_LENGTH = 20;

export function toOmieIntegrationCode(value: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9]+$/.test(trimmed) && trimmed.length <= OMIE_INTEGRATION_CODE_MAX_LENGTH) {
    return trimmed;
  }
  return `KR${fnv1a64(trimmed).toString(36).toUpperCase()}`;
}

function fnv1a64(input: string): bigint {
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  const mask = BigInt("0xFFFFFFFFFFFFFFFF");
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash;
}

/**
 * Tamanho maximo de cada campo do cadastro de cliente/fornecedor no OMIE. Estourar o
 * limite faz o OMIE recusar a chamada INTEIRA ("a razao social ultrapassa 60 caracteres")
 * — e, no fechamento, o pedido morre junto com o cadastro. O KyberRock aceita qualquer
 * tamanho localmente (o cadastro completo continua no SQLite e nos relatorios/cupom) e
 * encurta apenas o que sobe para o OMIE.
 *
 * `nome_fantasia` usa o mesmo limite da razao social de proposito: quando o cadastro nao
 * tem fantasia proprio ele recebe a razao social como fallback (ver buildCustomerPayload),
 * entao um limite maior aqui deixaria passar exatamente o valor que a razao social ja
 * provou ser grande demais. O documento (cnpj_cpf) fica de fora: encurtar um CNPJ/CPF
 * mandaria um documento errado para o OMIE, o que e pior do que a recusa. O `email` tambem
 * fica de fora — e uma LISTA de destinatarios, que precisa ser cortada por endereco
 * inteiro (ver OMIE_EMAIL_FIELD_MAX_LENGTH / formatOmieEmailList).
 */
export const OMIE_CUSTOMER_FIELD_MAX_LENGTHS = {
  razao_social: 60,
  nome_fantasia: 60,
  telefone1_ddd: 5,
  telefone1_numero: 15,
  endereco: 60,
  endereco_numero: 20,
  bairro: 60,
  cidade: 40,
  cep: 10,
  // O OMIE nao publica o tamanho do campo de observacao do cadastro. O corte aqui e
  // conservador e serve so para nao mandar um texto sem fim e levar a recusa do cadastro
  // inteiro por causa de uma anotacao interna.
  observacao: 500
} as const;

/**
 * Encurta um texto para caber no campo do OMIE. Normaliza espacos, corta na ultima
 * palavra inteira quando isso nao joga fora um pedaco grande demais do limite (assim
 * "... LOGISTICA INTEGRADA LTDA - FILIAL" vira "... LOGISTICA INTEGRADA LTDA", e nao
 * "... LOGISTICA INTEGRADA LTDA - FIL") e limpa a pontuacao que sobra na ponta.
 * Deterministico: a mesma entrada gera sempre a mesma saida, entao reenvios continuam
 * idempotentes no OMIE.
 */
export function clampOmieText(value: string | undefined, maxLength: number): string | undefined {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (text.length === 0) return undefined;
  if (text.length <= maxLength) return text;

  const hardCut = text.slice(0, maxLength);
  const lastSpace = hardCut.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor(maxLength * 0.75) ? hardCut.slice(0, lastSpace) : hardCut;
  return cut.replace(/[\s,;:./-]+$/, "").trim() || hardCut.trim();
}

export function buildCustomerPayload(payload: PushCustomerPayload): Record<string, unknown> {
  const document = onlyDigits(payload.cnpjCpf);
  const razaoSocial = clampOmieText(
    payload.razaoSocial,
    OMIE_CUSTOMER_FIELD_MAX_LENGTHS.razao_social
  );
  const state = normalizeOmieState(payload.state);
  const tags = (payload.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0);

  const body = dropEmptyFields({
    codigo_cliente_omie: payload.omieCustomerId,
    // Sem id local nao ha codigo de integracao a informar (o campo cai em dropEmptyFields);
    // chamar toOmieIntegrationCode com vazio geraria um codigo que nao aponta para nada.
    codigo_cliente_integracao: payload.localCustomerId
      ? toOmieIntegrationCode(payload.localCustomerId)
      : undefined,
    razao_social: razaoSocial,
    // O OMIE exige razao social E nome fantasia no IncluirCliente; sem o fantasia o
    // cadastro volta com "O preenchimento da tag [nome_fantasia] e obrigatorio!" e o
    // fechamento inteiro morre junto. Repetir a razao social e o padrao do cadastro.
    nome_fantasia:
      clampOmieText(payload.nomeFantasia, OMIE_CUSTOMER_FIELD_MAX_LENGTHS.nome_fantasia) ??
      razaoSocial,
    cnpj_cpf: document,
    // 11 digitos = CPF. Sem `pessoa_fisica: "S"` o OMIE valida o documento como CNPJ
    // e recusa o cadastro de qualquer cliente pessoa fisica.
    pessoa_fisica: document ? (document.length === 11 ? "S" : "N") : undefined,
    // O e-mail tem regra propria (lista de destinatarios cortada por endereco inteiro):
    // ver formatOmieEmailList / OMIE_EMAIL_FIELD_MAX_LENGTH. Este campo entrega so ao
    // primeiro endereco; os demais destinatarios da NF-e/boleto entram no `email_fatura`
    // da aba "Recomendacoes" (ver syncCustomerInvoiceEmails no index.ts).
    email: formatOmieEmailList(payload.email),
    telefone1_ddd: clampOmieText(
      payload.telefone1Ddd,
      OMIE_CUSTOMER_FIELD_MAX_LENGTHS.telefone1_ddd
    ),
    telefone1_numero: clampOmieText(
      payload.telefone1Numero,
      OMIE_CUSTOMER_FIELD_MAX_LENGTHS.telefone1_numero
    ),
    endereco: clampOmieText(payload.addressStreet, OMIE_CUSTOMER_FIELD_MAX_LENGTHS.endereco),
    endereco_numero: clampOmieText(
      payload.addressNumber,
      OMIE_CUSTOMER_FIELD_MAX_LENGTHS.endereco_numero
    ),
    bairro: clampOmieText(payload.neighborhood, OMIE_CUSTOMER_FIELD_MAX_LENGTHS.bairro),
    // O OMIE identifica a cidade no formato "Cidade (UF)" (e devolve assim nas
    // consultas); mandar so o nome faz o cadastro cair em "Cidade nao encontrada".
    cidade: buildOmieCity(payload.city, state),
    estado: state,
    cep: clampOmieText(payload.zipcode, OMIE_CUSTOMER_FIELD_MAX_LENGTHS.cep),
    // Campo omitido quando o chamador nao informa (ex.: transportadoras), para
    // nao mexer no bloqueio configurado direto no OMIE.
    bloquear_faturamento:
      payload.billingBlocked === undefined ? undefined : payload.billingBlocked ? "S" : "N",
    tags: tags.length > 0 ? tags.map((tag) => ({ tag })) : undefined
  });

  // Fora do dropEmptyFields de proposito: nele a string vazia e descartada para um
  // AlterarCliente nunca APAGAR no OMIE o que o KyberRock nao tem. Com a observacao e o
  // contrario — quem manda no campo e o cadastro daqui, entao apagar a anotacao aqui tem
  // de apagar la. `undefined` continua nao mexendo no campo (e o caso da transportadora,
  // que reaproveita este mesmo builder e nao gerencia observacao).
  if (payload.observations !== undefined) {
    body.observacao = clampOmieObservation(payload.observations);
  }

  return body;
}

/**
 * Corte da observacao, sem passar pelo `clampOmieText`.
 *
 * Aquele normaliza espaco em branco (`\s+` vira um espaco so), o que e o certo para razao
 * social e endereco e o errado aqui: a observacao e um campo de varias linhas, e colapsar
 * as quebras reescreveria o texto da operadora a cada ida e volta ao OMIE.
 */
function clampOmieObservation(value: string): string {
  const text = value.trim();
  return text.length <= OMIE_CUSTOMER_FIELD_MAX_LENGTHS.observacao
    ? text
    : text.slice(0, OMIE_CUSTOMER_FIELD_MAX_LENGTHS.observacao).trimEnd();
}

/**
 * Remove campos vazios do corpo enviado ao OMIE. Alem de encurtar o payload, evita que
 * um `AlterarCliente` apague no OMIE um dado que o KyberRock nao tem (string vazia
 * sobrescreve; ausencia preserva).
 */
function dropEmptyFields(body: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    clean[key] = value;
  }
  return clean;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

/** Tamanho maximo do campo `email` do cadastro de cliente/fornecedor do OMIE. */
export const OMIE_EMAIL_FIELD_MAX_LENGTH = 500;

/**
 * Tamanho maximo do `email_fatura` — o "Utilizar os seguintes enderecos de e-mail" da aba
 * "Recomendacoes" do cadastro. E menor que o do campo de contato.
 */
export const OMIE_INVOICE_EMAIL_FIELD_MAX_LENGTH = 200;

/**
 * Tamanho maximo do "Enderecos de e-mail que recebem a NF" do PEDIDO/OS
 * (`informacoes_adicionais.utilizar_emails` / `Email.cEnviarPara`). E um `text` no OMIE,
 * sem limite documentado; cortamos em 500 so para nao mandar um texto sem fim.
 */
export const OMIE_ORDER_INVOICE_EMAIL_FIELD_MAX_LENGTH = 500;

/** Enderecos da lista guardada no cadastro, em minusculas, sem vazios nem repetidos. */
export function parseOmieEmailList(value: string | undefined): string[] {
  const emails: string[] = [];
  for (const part of (value ?? "").split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (email.length > 0 && !emails.includes(email)) emails.push(email);
  }
  return emails;
}

/**
 * Junta os enderecos com virgula simples ate o limite do campo. O corte e feito por
 * endereco INTEIRO: truncar no meio de um e-mail geraria um destinatario invalido e o
 * OMIE recusaria o cadastro inteiro.
 */
function joinOmieEmails(emails: string[], maxLength: number): string {
  const accepted: string[] = [];
  for (const email of emails) {
    const candidate = [...accepted, email].join(", ");
    if (candidate.length > maxLength) break;
    accepted.push(email);
  }
  return accepted.join(", ");
}

/**
 * Campo `email` do cadastro: o e-mail de CONTATO do cliente. Aceita mais de um endereco
 * (virgula simples, dentro dos 500 caracteres), mas quem recebe a NF-e e o boleto e o
 * `email_fatura` da aba "Recomendacoes" — ver `formatOmieInvoiceEmailList`.
 */
export function formatOmieEmailList(value: string | undefined): string | undefined {
  const joined = joinOmieEmails(parseOmieEmailList(value), OMIE_EMAIL_FIELD_MAX_LENGTH);
  return joined.length > 0 ? joined : undefined;
}

/**
 * Lista da aba Fiscal no formato do `email_fatura` do OMIE ("Utilizar os seguintes
 * enderecos de e-mail"): virgula simples, dentro dos 200 caracteres. Lista vazia devolve
 * string vazia, que e o valor que LIMPA o campo la.
 */
export function formatOmieInvoiceEmailList(value: string | undefined): string {
  return joinOmieEmails(parseOmieEmailList(value), OMIE_INVOICE_EMAIL_FIELD_MAX_LENGTH);
}

/**
 * Mesma lista da aba Fiscal, agora no formato do campo do DOCUMENTO: os "Enderecos de
 * e-mail que recebem a NF" do pedido de venda (`utilizar_emails`) e da OS
 * (`Email.cEnviarPara`). Virgula simples, dentro dos 500 caracteres. Lista vazia devolve
 * string vazia — nesse caso o campo nao e enviado e o OMIE cai no cadastro do cliente.
 *
 * Existe separado de `formatOmieInvoiceEmailList` porque o campo do documento nao tem o
 * limite de 200 do `email_fatura` do cadastro: cortar a lista do pedido nesse limite
 * deixaria destinatarios da aba Fiscal de fora sem necessidade.
 */
export function formatOmieOrderInvoiceEmailList(value: string | undefined): string {
  return joinOmieEmails(parseOmieEmailList(value), OMIE_ORDER_INVOICE_EMAIL_FIELD_MAX_LENGTH);
}

function onlyDigits(value: string | undefined): string | undefined {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : undefined;
}

/** UF em duas letras maiusculas; qualquer outra coisa nao e UF e fica de fora. */
function normalizeOmieState(value: string | undefined): string | undefined {
  const uf = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(uf) ? uf : undefined;
}

/**
 * Cidade no formato do OMIE: "Cidade (UF)". Ja formatada ou sem UF, segue como veio.
 * O nome e encurtado ANTES do sufixo para o "(UF)" nunca ser o pedaco que estoura o
 * limite do campo — sem a UF o OMIE responde "Cidade nao encontrada".
 */
function buildOmieCity(city: string | undefined, state: string | undefined): string | undefined {
  const maxLength = OMIE_CUSTOMER_FIELD_MAX_LENGTHS.cidade;
  const name = trimOrUndefined(city);
  if (!name) return undefined;

  // Separa o "(UF)" que ja tenha vindo junto, para o corte cair sempre no nome.
  const suffixPattern = /\s*\(([A-Za-z]{2})\)\s*$/;
  const suffixMatch = suffixPattern.exec(name);
  const baseName = suffixMatch ? name.replace(suffixPattern, "").trim() : name;
  const uf = suffixMatch ? suffixMatch[1].toUpperCase() : state;
  if (!uf) return clampOmieText(baseName, maxLength);

  const suffix = ` (${uf})`;
  return `${clampOmieText(baseName, maxLength - suffix.length)}${suffix}`;
}

/**
 * Campos que o OMIE cobrou como obrigatorios na recusa ("O preenchimento da tag
 * [email] e obrigatorio!"), traduzidos para o nome que o operador ve no cadastro.
 * Vazio quando a recusa nao e de campo faltante.
 */
export function extractOmieRequiredFields(message: string): string[] {
  const text = message ?? "";
  const labels: string[] = [];
  const pattern = /tag\s*\[([a-z0-9_]+)\]/gi;
  for (const match of text.matchAll(pattern)) {
    const field = match[1].toLowerCase();
    const label = OMIE_CUSTOMER_FIELD_LABELS[field] ?? field;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

const OMIE_CUSTOMER_FIELD_LABELS: Record<string, string> = {
  cnpj_cpf: "CNPJ/CPF",
  email: "E-mail",
  razao_social: "Razao Social",
  nome_fantasia: "Nome Fantasia",
  endereco: "Endereco",
  endereco_numero: "Numero do Endereco",
  bairro: "Bairro",
  cidade: "Cidade",
  estado: "Estado (UF)",
  cep: "CEP",
  telefone1_ddd: "DDD do Telefone",
  telefone1_numero: "Telefone"
};

/**
 * Marca das falhas de CADASTRO do cliente no envio do fechamento. O desktop reconhece
 * este prefixo para tratar a recusa como pendencia de cadastro (bloqueia o job em vez de
 * re-tentar em loop) e para mostrar ao operador o que falta preencher.
 */
export const CUSTOMER_REGISTRATION_FAULT_PREFIX = "Cadastro do cliente recusado pelo OMIE";

/** Mensagem determinista da recusa do cadastro do cliente, com o que falta preencher. */
export function customerRegistrationFaultMessage(error: unknown, customerName?: string): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const fields = extractOmieRequiredFields(detail);
  const who = trimOrUndefined(customerName);
  return [
    `${CUSTOMER_REGISTRATION_FAULT_PREFIX}${who ? ` (${who})` : ""}.`,
    fields.length > 0 ? `Falta preencher: ${fields.join(", ")}.` : null,
    "Complete o cadastro do cliente e reenvie.",
    `Detalhe OMIE: ${detail}`
  ]
    .filter((part): part is string => part !== null)
    .join(" ");
}

/**
 * Tags de papel que o KyberRock grava no cadastro do OMIE. Sao elas que fazem o cadastro
 * voltar classificado na sincronizacao seguinte (ver `classifyOmieCustomer`): cliente
 * cadastrado aqui vai como "cliente", transportadora vai como "transportadora".
 */
export const OMIE_CUSTOMER_TAG = "cliente";
export const OMIE_CARRIER_TAG = "transportadora";

export function buildCarrierPayload(payload: PushCarrierPayload): Record<string, unknown> {
  const tags = forceOmieTag(payload.tags, OMIE_CARRIER_TAG);
  return buildCustomerPayload({
    ...payload,
    localCustomerId: payload.localCustomerId,
    razaoSocial: payload.razaoSocial ?? payload.name,
    nomeFantasia: payload.nomeFantasia ?? payload.name,
    tags
  });
}

/**
 * Cadastro de cliente do KyberRock no OMIE, sempre com a tag "cliente" (ver
 * `buildCarrierPayload`, que faz o mesmo com "transportadora"). Sem a tag, o cadastro
 * criado aqui volta na sincronizacao seguinte sem papel declarado e a classificacao
 * precisa adivinhar o que ele e.
 */
export function buildCustomerCadastroPayload(
  payload: PushCustomerPayload
): Record<string, unknown> {
  return buildCustomerPayload({ ...payload, tags: forceOmieTag(payload.tags, OMIE_CUSTOMER_TAG) });
}

export async function pushCustomerToOmieCore(
  queue: OmieRequester,
  credentials: OmieCredentials,
  payload: PushCustomerPayload
): Promise<number> {
  const omieCustomerId = await pushCustomerBodyToOmie(queue, credentials, {
    createBody: buildCustomerCadastroPayload(payload),
    updateBody: buildCustomerPayload(payload),
    omieCustomerId: payload.omieCustomerId,
    requiredTag: OMIE_CUSTOMER_TAG
  });
  await syncCustomerInvoiceEmails(queue, credentials, omieCustomerId, payload.fiscalEmails);
  return omieCustomerId;
}

/**
 * Bloco `recomendacoes` do cadastro de cliente do OMIE (aba "Recomendacoes"). Reenviado
 * INTEIRO no AlterarCliente: ver `syncCustomerInvoiceEmails`.
 */
export type OmieCustomerRecommendations = {
  numero_parcelas?: unknown;
  codigo_vendedor?: unknown;
  email_fatura?: unknown;
  gerar_boletos?: string | null;
  codigo_transportadora?: unknown;
  tipo_assinante?: unknown;
};

/**
 * Espelha os e-mails da aba Fiscal do cadastro no `email_fatura` do OMIE — o "Utilizar os
 * seguintes enderecos de e-mail" da aba "Recomendacoes", que e quem manda nos
 * destinatarios da NF-e e do boleto.
 *
 * Por que nao usar o `email` do cadastro: aquele campo e o e-mail de CONTATO do cliente e
 * o OMIE entrega a um endereco so, por mais que a lista caiba nele — foi isso que o
 * operador viu ao cadastrar varios e-mails e so um receber. Sao dois dados distintos, e o
 * KyberRock trata assim: contato na aba Contato, destinatarios da nota na aba Fiscal.
 *
 * `fiscalEmails` undefined = o chamador nao gerencia este campo (ex.: push de
 * transportadora); nada e consultado nem alterado. String vazia = a aba Fiscal esta vazia,
 * e o campo e LIMPO no OMIE — o cadastro local e a fonte da verdade dele, e o pull do OMIE
 * traz o valor de la para a aba Fiscal, entao o que foi configurado a mao aparece aqui
 * antes de qualquer envio em vez de ser sobrescrito as cegas.
 *
 * Ja igual ao desejado: nao gasta um AlterarCliente (o OMIE cobra rate limit por chamada).
 *
 * O bloco `recomendacoes` volta INTEIRO no AlterarCliente: nao esta documentado se o OMIE
 * faz merge parcial do complexo, e reenviar o que o ConsultarCliente devolveu garante que
 * nada configurado a mao (vendedor, transportadora, numero de parcelas, gerar boletos) se
 * perca.
 *
 * Nunca lanca. Os destinatarios da nota sao um detalhe do faturamento, nao um requisito do
 * cadastro: se a consulta ou a alteracao falhar, o cadastro — e o fechamento que depende
 * dele — segue, com o log dizendo o que nao foi gravado.
 */
export async function syncCustomerInvoiceEmails(
  queue: OmieRequester,
  credentials: OmieCredentials,
  omieCustomerId: number,
  fiscalEmails: string | undefined
): Promise<void> {
  if (fiscalEmails === undefined) return;
  const desired = formatOmieInvoiceEmailList(fiscalEmails);

  try {
    const customer = await queue.request<
      { codigo_cliente_omie: number },
      { recomendacoes?: OmieCustomerRecommendations } | null
    >({
      credentials,
      endpoint: "/geral/clientes/",
      call: "ConsultarCliente",
      param: { codigo_cliente_omie: omieCustomerId }
    });

    const recomendacoes: OmieCustomerRecommendations = customer?.recomendacoes ?? {};
    const current =
      typeof recomendacoes.email_fatura === "string" ? recomendacoes.email_fatura.trim() : "";
    if (current.toLowerCase() === desired) return;

    await queue.request<Record<string, unknown>, unknown>({
      credentials,
      endpoint: "/geral/clientes/",
      call: "AlterarCliente",
      param: {
        codigo_cliente_omie: omieCustomerId,
        recomendacoes: { ...recomendacoes, email_fatura: desired }
      }
    });
  } catch (error) {
    console.error(
      "[omie] falha ao gravar os e-mails de NF-e/boleto (recomendacoes.email_fatura) do " +
        "cliente; o cadastro segue com o e-mail principal",
      error
    );
  }
}

export async function pushCarrierToOmie(
  queue: OmieRequester,
  credentials: OmieCredentials,
  payload: PushCarrierPayload
): Promise<number> {
  return pushCustomerBodyToOmie(queue, credentials, {
    createBody: buildCarrierPayload(payload),
    omieCustomerId: payload.omieCustomerId,
    requiredTag: OMIE_CARRIER_TAG
  });
}

/**
 * Tags a gravar num `AlterarCliente`: as que o cadastro ja tem no OMIE mais a tag do papel
 * que o KyberRock esta enviando.
 *
 * O OMIE substitui a lista inteira a cada alteracao, entao os dois extremos erram: mandar
 * so a tag do papel apaga as outras (um cliente que tambem e transportadora sumiria de uma
 * das listas na sincronizacao seguinte) e nao mandar tag nenhuma deixa sem marcacao todo
 * cadastro que ja existia no OMIE — justamente o caso do cliente reaproveitado por CNPJ.
 * Cadastro ilegivel no OMIE: segue so com a tag do papel, que e o essencial.
 */
export async function mergeOmieCustomerTags(
  queue: OmieRequester,
  credentials: OmieCredentials,
  omieCustomerId: number,
  requiredTag: string
): Promise<string[]> {
  try {
    const current = await queue.request<
      { codigoClienteOmie: number },
      { tags?: Record<string, unknown> | unknown[] }
    >({
      credentials,
      endpoint: "/geral/clientes/",
      call: "ConsultarCliente",
      param: { codigoClienteOmie: omieCustomerId }
    });
    const existing = readOmieTagValues(current?.tags).filter((tag) => tag.trim().length > 0);
    return forceOmieTag(existing, requiredTag);
  } catch {
    return [requiredTag];
  }
}

/** Valores de tag de um cadastro do OMIE, aceitando os formatos que a API devolve. */
function readOmieTagValues(tags: Record<string, unknown> | unknown[] | null | undefined): string[] {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : (tags as { tags?: unknown }).tags;
  if (!Array.isArray(list)) return [];
  return list.map((tag) =>
    typeof tag === "object" && tag !== null && "tag" in tag
      ? String((tag as { tag?: unknown }).tag ?? "")
      : String(tag ?? "")
  );
}

export function forceOmieTag(tags: string[] | undefined, requiredTag: string): string[] {
  const normalizedRequired = normalizeTag(requiredTag);
  const unique = new Map<string, string>();
  for (const tag of tags ?? []) {
    const normalized = normalizeTag(tag);
    if (normalized) unique.set(normalized, tag);
  }
  unique.set(normalizedRequired, requiredTag);
  return [...unique.values()];
}

/**
 * O texto de um fault do OMIE sem acento, para ser comparado por regex.
 *
 * Os faults vem ACENTUADOS ("NF nao cadastrada" chega como "NF nao cadastrada" com til), e
 * os padroes daqui sempre foram escritos sem acento — entao nenhum deles casava. O efeito
 * era silencioso: um fault conhecido passava por falha desconhecida, ia para o log como
 * erro e disparava o caminho caro de recuperacao.
 */
export function normalizeOmieFault(message: string): string {
  return message.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Faults do OMIE quando o registro ja nao existe (cancelamento idempotente) ou quando o
 * pedido consultado nao gerou nota.
 *
 * Verificado contra a resposta real do OMIE: `ConsultarNF` de um pedido sem nota devolve
 * "ERROR: NF nao cadastrada para o pedido [...]" — com til em "nao". Sem a normalizacao
 * acima, `nao cadastrad` nao casava com `nao cadastrada` acentuado.
 */
export function isOmieNotFoundFault(message: string): boolean {
  return /nao cadastrad|nao encontrad|not found|inexistente|nao existe/i.test(
    normalizeOmieFault(message)
  );
}

/**
 * O OMIE fechou a API INTEIRA desta credencial por excesso de chamadas.
 *
 * E diferente do "Consumo redundante" (a mesma pergunta repetida) e do 429 de pico: aqui
 * ele para de atender QUALQUER chamada da app_key por meia hora — "HTTP 425: ERROR: API
 * bloqueada por consumo indevido. Tente novamente em 1797 segundos.".
 *
 * Precisa de nome proprio porque a reacao e outra. Nos outros dois vale esperar e repetir
 * dentro da mesma passada; neste nao existe espera que caiba, e cada tentativa a mais so
 * alimenta o bloqueio. Quem detectava so `limite|limit|rate|Aguarde N segundos` nao casava
 * com nenhuma palavra desta frase: o 425 saia como falha comum, sem backoff nenhum, e a
 * passada seguia chamando o OMIE ate o fim do lote — foram ~628 recusas em 24h assim.
 */
export function isOmieApiBlockedError(error: unknown): boolean {
  if (!(error instanceof OmieHttpError)) return false;
  if (error.status === 425) return true;
  return /API\s+bloqueada|consumo\s+indevido/i.test(error.detail ?? error.message);
}

export function isOmieLimitError(error: unknown): boolean {
  if (!(error instanceof OmieHttpError)) return false;
  if (error.status === 429) return true;
  if (isOmieApiBlockedError(error)) return true;
  return /REDUNDANT|Consumo redundante|limite|limit|rate|Aguarde\s+\d+\s+segundos?/i.test(
    error.detail ?? error.message
  );
}

/**
 * Quanto o OMIE mandou esperar, SEM teto.
 *
 * O teto e de quem espera (`getRetryDelayMs` limita ao `OMIE_MAX_BACKOFF_MS`), nao de quem
 * le: cortar aqui apagava a informacao que decide a passada inteira — "1797 segundos" e
 * "120 segundos" chegavam ao disjuntor como o mesmo numero, e ele reabriria a fila cedo
 * demais, em cima de uma API ainda bloqueada.
 *
 * Duas grafias, porque sao dois casos diferentes do OMIE: "Aguarde N segundos" vem do
 * consumo redundante e "Tente novamente em N segundos" vem do bloqueio por consumo
 * indevido. So a primeira estava aqui, e por isso o bloqueio de meia hora era lido como
 * "sem tempo informado".
 */
const OMIE_RETRY_DELAY_PATTERNS = [
  /Aguarde\s+(\d+)\s+segundos?/i,
  /Tente\s+novamente\s+em\s+(\d+)\s+segundos?/i
];

export function parseOmieRetryDelayMs(
  message: string | null | undefined,
  retryAfterHeader?: string | null
): number | null {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  for (const pattern of OMIE_RETRY_DELAY_PATTERNS) {
    const match = pattern.exec(message ?? "");
    const seconds = match ? Number(match[1]) : NaN;
    // Um segundo a mais do que ele pediu: a borda exata costuma voltar recusada.
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000 + 1000;
  }

  return null;
}

function getRetryDelayMs(error: OmieHttpError, attempt: number, baseBackoffMs: number): number {
  return Math.min(error.retryAfterMs ?? baseBackoffMs * Math.pow(2, attempt), OMIE_MAX_BACKOFF_MS);
}

// Quando o cadastro ja existe no OMIE, o IncluirCliente falha com o codigo do registro
// existente na propria mensagem, em duas grafias:
//   - por documento: "Cliente ja cadastrado para o CPF/CNPJ [...] com o Id [123] ...";
//   - por codigo de integracao (reenvio nosso que ja tinha entrado la):
//     "Cliente ja cadastrado para o Codigo de Integracao [KR...] com o nCod [123]!".
// Extraimos o codigo existente para converter o insert em update — sem isso o reenvio
// vira falha de cadastro e o fechamento trava esperando uma correcao que nao existe.
const EXISTING_CUSTOMER_ID_PATTERNS = [
  /\bnCod\w*\s*\[(\d+)\]/i,
  /\bId\s*\[(\d+)\]/i,
  /\bcodigo_cliente_omie\s*\[(\d+)\]/i
];

export function extractExistingCustomerId(error: unknown): number | null {
  if (!(error instanceof OmieHttpError)) return null;
  const text = error.detail ?? error.message;
  if (!isDuplicateCustomerFault(text)) return null;
  for (const pattern of EXISTING_CUSTOMER_ID_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Recusa do IncluirCliente por o cadastro ja existir no OMIE (nao e dado faltando). */
export function isDuplicateCustomerFault(message: string | null | undefined): boolean {
  return /j[aá] cadastrad/i.test(message ?? "");
}

// O AlterarCliente localiza o registro pelo codigo_cliente_integracao quando presente.
// Para cadastros adotados (criados fora do KyberRock) o codigo nao confere e o OMIE
// responde "Cliente nao cadastrado para o Codigo de Integracao [...]". Em updates,
// identificamos apenas pelo codigo_cliente_omie.
export function toCustomerUpdateBody(
  body: Record<string, unknown>,
  omieCustomerId: number
): Record<string, unknown> {
  const updateBody: Record<string, unknown> = { ...body, codigo_cliente_omie: omieCustomerId };
  delete updateBody.codigo_cliente_integracao;
  return updateBody;
}

/**
 * Codigo do cliente que ja existe no OMIE depois de o IncluirCliente ser recusado por
 * duplicidade. Primeiro le o codigo da propria mensagem; se a grafia do OMIE mudar de
 * novo, consulta o cadastro pelo codigo de integracao (e depois pelo CPF/CNPJ) antes de
 * desistir — assim uma variacao de texto nao volta a travar o fechamento.
 */
export async function resolveDuplicateCustomerId(
  queue: OmieRequester,
  credentials: OmieCredentials,
  body: Record<string, unknown>,
  error: unknown
): Promise<number | null> {
  const fromMessage = extractExistingCustomerId(error);
  if (fromMessage !== null) return fromMessage;
  if (!(error instanceof OmieHttpError)) return null;
  if (!isDuplicateCustomerFault(error.detail ?? error.message)) return null;

  const integrationCode =
    typeof body.codigo_cliente_integracao === "string" && body.codigo_cliente_integracao.trim()
      ? body.codigo_cliente_integracao.trim()
      : null;
  const document =
    typeof body.cnpj_cpf === "string" ? body.cnpj_cpf.replace(/\D/g, "") : ("" as string);
  const lookups: Array<Record<string, unknown>> = [];
  if (integrationCode) lookups.push({ codigo_cliente_integracao: integrationCode });
  if (document) lookups.push({ cnpj_cpf: document });

  for (const param of lookups) {
    try {
      const found = await queue.request<
        unknown,
        { codigo_cliente_omie?: number; codigoClienteOmie?: number }
      >({
        credentials,
        endpoint: "/geral/clientes/",
        call: "ConsultarCliente",
        param
      });
      const id = found.codigo_cliente_omie ?? found.codigoClienteOmie;
      if (typeof id === "number" && id > 0) return id;
    } catch {
      // Criterio nao achou (ou o OMIE recusou o filtro): tenta o proximo.
    }
  }
  return null;
}

type PushCustomerBodyInput = {
  /** Corpo do `IncluirCliente`, ja com a tag do papel (ver `buildCustomerCadastroPayload`). */
  createBody: Record<string, unknown>;
  /** Corpo do `AlterarCliente`. Sem ele, o proprio `createBody` e reaproveitado. */
  updateBody?: Record<string, unknown>;
  omieCustomerId?: number;
  /** Tag do papel garantida no cadastro (cliente/transportadora), no create e no update. */
  requiredTag: string;
};

/**
 * Envia o cadastro ao OMIE: `IncluirCliente` quando e novo, `AlterarCliente` quando o
 * codigo ja e conhecido ou quando o OMIE recusa a inclusao por duplicidade.
 *
 * A tag do papel e garantida nos dois caminhos: no create ela ja vem no `createBody`; no
 * update as tags sao remontadas a partir do que o cadastro tem hoje no OMIE, porque o
 * `AlterarCliente` substitui a lista inteira (ver `mergeOmieCustomerTags`).
 */
async function pushCustomerBodyToOmie(
  queue: OmieRequester,
  credentials: OmieCredentials,
  input: PushCustomerBodyInput
): Promise<number> {
  const { createBody, updateBody = createBody, omieCustomerId, requiredTag } = input;

  const alterCustomer = async (targetOmieId: number): Promise<void> => {
    await queue.request<unknown, unknown>({
      credentials,
      endpoint: "/geral/clientes/",
      call: "AlterarCliente",
      param: await buildCustomerUpdateBody(queue, credentials, {
        body: updateBody,
        omieCustomerId: targetOmieId,
        requiredTag
      })
    });
  };

  if (omieCustomerId) {
    await alterCustomer(omieCustomerId);
    return omieCustomerId;
  }

  let response: { codigo_cliente_omie?: number; codigoClienteOmie?: number };
  try {
    response = await queue.request<
      unknown,
      { codigo_cliente_omie?: number; codigoClienteOmie?: number }
    >({
      credentials,
      endpoint: "/geral/clientes/",
      call: "IncluirCliente",
      param: createBody
    });
  } catch (error) {
    const existingId = await resolveDuplicateCustomerId(queue, credentials, createBody, error);
    if (existingId === null) throw error;
    await alterCustomer(existingId);
    return existingId;
  }
  const id = response.codigo_cliente_omie ?? response.codigoClienteOmie;
  if (!id) throw new Error("OMIE nao retornou codigoClienteOmie");
  return id;
}

/**
 * Corpo do `AlterarCliente` com a tag do papel somada as que o cadastro ja tem no OMIE.
 * Usado tambem pelo index.ts, que faz o find-or-create por CNPJ/CPF antes de alterar.
 */
export async function buildCustomerUpdateBody(
  queue: OmieRequester,
  credentials: OmieCredentials,
  input: { body: Record<string, unknown>; omieCustomerId: number; requiredTag: string }
): Promise<Record<string, unknown>> {
  const tags = await mergeOmieCustomerTags(
    queue,
    credentials,
    input.omieCustomerId,
    input.requiredTag
  );
  return toCustomerUpdateBody(
    { ...input.body, tags: tags.map((tag) => ({ tag })) },
    input.omieCustomerId
  );
}

async function readOmieResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getOmieFaultString(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("faultstring" in data)) return null;
  return String((data as { faultstring?: unknown }).faultstring ?? "Falha OMIE");
}

function normalizeTag(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
