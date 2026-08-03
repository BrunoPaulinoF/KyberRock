/**
 * Sinal sonoro do envio ao OMIE. Sao dois avisos curtos e discretos, sintetizados na
 * hora com a Web Audio API — sem arquivo de midia para empacotar no instalador e sem
 * depender de codec do Electron:
 *
 * - sucesso: dois tons ascendentes (la -> mi), suaves, volume baixo;
 * - falha: dois tons graves e descendentes, ainda sem estridencia, so o suficiente para
 *   o operador olhar a tela no meio do patio.
 *
 * O contexto de audio e criado sob demanda e reaproveitado (o Chromium so libera audio
 * apos interacao do usuario; no desktop isso ja aconteceu bem antes do primeiro envio).
 */
export type OmieAlertSoundKind = "success" | "error";

type AudioContextConstructor = new () => AudioContext;

interface AudioWindow {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

interface ToneSpec {
  frequency: number;
  /** Atraso em segundos a partir do inicio do aviso. */
  startAt: number;
  durationSeconds: number;
  gain: number;
}

const TONES: Record<OmieAlertSoundKind, ToneSpec[]> = {
  success: [
    { frequency: 880, startAt: 0, durationSeconds: 0.16, gain: 0.06 },
    { frequency: 1318.5, startAt: 0.13, durationSeconds: 0.24, gain: 0.05 }
  ],
  error: [
    { frequency: 392, startAt: 0, durationSeconds: 0.2, gain: 0.07 },
    { frequency: 293.66, startAt: 0.19, durationSeconds: 0.32, gain: 0.07 }
  ]
};

let sharedContext: AudioContext | null = null;

function resolveAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedContext && sharedContext.state !== "closed") return sharedContext;

  const audioWindow = window as unknown as AudioWindow;
  const Ctor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Ctor) return null;

  try {
    sharedContext = new Ctor();
    return sharedContext;
  } catch {
    return null;
  }
}

/**
 * Toca o aviso. Nunca lanca: som e acessorio, e a falta dele (navegador sem Web Audio,
 * politica de autoplay, placa muda) nao pode derrubar o fluxo de sincronizacao.
 */
export function playOmieAlertSound(kind: OmieAlertSoundKind): void {
  const context = resolveAudioContext();
  if (!context) return;

  try {
    if (context.state === "suspended") {
      void context.resume();
    }

    const startedAt = context.currentTime;
    for (const tone of TONES[kind]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = startedAt + tone.startAt;
      const toneEnd = toneStart + tone.durationSeconds;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, toneStart);

      // Envelope curto: sobe em 20 ms e decai ate zero, para o aviso soar como um sino
      // e nao como um bipe cortado.
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(tone.gain, toneStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + 0.02);
    }
  } catch {
    /* som e acessorio: segue sem aviso sonoro */
  }
}
