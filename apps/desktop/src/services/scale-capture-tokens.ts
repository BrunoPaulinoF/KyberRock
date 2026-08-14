import { randomUUID } from "node:crypto";

import type { ScaleReading } from "@kyberrock/scale-adapters";

import type { ScaleCaptureOperationType } from "./scale-capture.js";

/**
 * Quanto tempo um peso ja capturado continua valendo para abrir ou fechar a
 * operacao.
 *
 * O peso e lido com o caminhao parado na balanca, mas quem confirma e uma
 * pessoa: depois de "Capturar peso de saida" ainda ha o tipo de fechamento a
 * escolher, o motorista a atender, o telefone que toca. Com a janela anterior de
 * 30 segundos, essa conversa normal na guarita ja estourava o prazo — e o
 * conselho da mensagem ("capture o peso novamente") era impossivel de seguir,
 * porque a essa altura o caminhao ja tinha descido da balanca. A operacao ficava
 * presa sem peso de saida.
 *
 * A assimetria decide o valor: guardar o peso por mais tempo nao o torna menos
 * verdadeiro — o token e de uso unico, preso ao tipo de operacao e a propria
 * operacao, e a leitura carrega `capturedAt` na auditoria da pesagem —, enquanto
 * vencer o prazo custa a pesagem inteira. Por isso a janela cobre uma parada
 * real na balanca, e nao o tempo de um clique.
 */
export const SCALE_CAPTURE_TOKEN_TTL_MS = 15 * 60_000;

export interface IssueScaleCaptureInput {
  operationType: ScaleCaptureOperationType;
  reading: ScaleReading;
  /**
   * Operacao dona do peso. A saida sempre sabe qual operacao esta fechando; a
   * entrada ainda nao tem operacao criada e por isso fica sem vinculo.
   */
  operationId?: string;
}

export interface ConsumeScaleCaptureInput {
  operationType: ScaleCaptureOperationType;
  operationId?: string;
}

interface PendingScaleCapture extends IssueScaleCaptureInput {
  expiresAt: number;
}

/**
 * Guarda os pesos capturados pela balanca ate a tela confirmar a operacao. O
 * renderer nunca envia peso: ele devolve o `captureId` emitido aqui, e so o peso
 * que saiu do indicador chega ao banco.
 */
export class ScaleCaptureTokenStore {
  private readonly pending = new Map<string, PendingScaleCapture>();
  private readonly ttlMs: number;

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs ?? SCALE_CAPTURE_TOKEN_TTL_MS;
  }

  /** Registra um peso recem-capturado e devolve o token de uso unico. */
  issue(input: IssueScaleCaptureInput, now: number = Date.now()): string {
    this.prune(now);
    const captureId = randomUUID();
    this.pending.set(captureId, { ...input, expiresAt: now + this.ttlMs });
    return captureId;
  }

  /**
   * Consome o token e devolve o peso capturado. `undefined` significa "a tela nao
   * capturou nada" — quem chama decide falar com a balanca na hora. Token
   * desconhecido, de outro tipo de operacao, de outra operacao ou vencido e erro:
   * melhor recusar do que gravar peso de outra pesagem.
   */
  consume(
    captureId: string | undefined,
    expected: ConsumeScaleCaptureInput,
    now: number = Date.now()
  ): ScaleReading | null {
    if (!captureId) return null;

    const capture = this.pending.get(captureId);
    this.pending.delete(captureId);

    if (!capture) {
      throw new Error("Captura de peso nao encontrada ou ja utilizada. Capture o peso novamente.");
    }
    if (capture.operationType !== expected.operationType) {
      throw new Error("Captura de peso nao pertence a este tipo de operacao.");
    }
    // So confere quando o token nasceu vinculado: a captura de entrada acontece
    // antes de a operacao existir e nunca carrega operacao nenhuma.
    if (capture.operationId !== undefined && capture.operationId !== expected.operationId) {
      throw new Error("Captura de peso pertence a outra operacao. Capture o peso novamente.");
    }
    if (capture.expiresAt <= now) {
      throw new Error(
        `Captura de peso expirada (o peso capturado vale por ${Math.round(this.ttlMs / 60_000)} minutos). ` +
          "Capture o peso novamente com o caminhao sobre a balanca."
      );
    }

    return capture.reading;
  }

  /** Descarta tokens vencidos para o mapa nao crescer ao longo do expediente. */
  prune(now: number = Date.now()): void {
    for (const [captureId, capture] of this.pending.entries()) {
      if (capture.expiresAt <= now) {
        this.pending.delete(captureId);
      }
    }
  }

  /** Quantidade de tokens vivos — usado apenas nos testes. */
  get size(): number {
    return this.pending.size;
  }
}
