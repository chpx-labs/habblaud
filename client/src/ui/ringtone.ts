// Toque de chamada da ligação (ui/call.ts), sintetizado na hora (Web Audio, sem arquivo): "tuuu… tuuu…" de telefone
// chamando (440 + 480 Hz) e o bipe de quem atendeu. Sem Web Audio (testes, navegador antigo) não toca nada e o tempo
// da chamada continua o mesmo.

/** Duração de cada toque e o intervalo entre eles (ms). */
export const RING_ON_MS = 850;
export const RING_GAP_MS = 450;

type AudioCtor = typeof AudioContext;

let shared: AudioContext | null = null;

function audioContext(): AudioContext | null {
  const Ctor: AudioCtor | undefined =
    typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    shared ??= new Ctor();
    if (shared.state === 'suspended') void shared.resume();
    return shared;
  } catch {
    return null;
  }
}

export interface Ringing {
  /** Para o som na hora (desligou antes de atender). */
  stop(): void;
}

/** Tom com envelope suave (sem estalo) de `at` a `at + dur` (s, no relógio do AudioContext). */
function tone(ac: AudioContext, out: AudioNode, freqs: number[], at: number, dur: number, vol: number): OscillatorNode[] {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.03);
  g.gain.setValueAtTime(vol, at + Math.max(0.03, dur - 0.06));
  g.gain.linearRampToValueAtTime(0, at + dur);
  g.connect(out);
  return freqs.map((f) => {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.02);
    return o;
  });
}

/**
 * Toca `rings` toques de chamada e, no fim, o bipe de "atendeu". Chamar dentro do clique (o navegador só libera o
 * áudio assim). Devolve como parar.
 */
export function playRing(rings: number, volume = 0.12): Ringing {
  const ac = audioContext();
  if (!ac) return { stop() {} };
  const master = ac.createGain();
  master.gain.value = 1;
  master.connect(ac.destination);
  const oscs: OscillatorNode[] = [];
  let t = ac.currentTime + 0.05;
  for (let i = 0; i < rings; i++) {
    oscs.push(...tone(ac, master, [440, 480], t, RING_ON_MS / 1000, volume));
    t += (RING_ON_MS + RING_GAP_MS) / 1000;
  }
  // atendeu: dois bipes subindo
  oscs.push(...tone(ac, master, [660], t - RING_GAP_MS / 1000 + 0.08, 0.09, volume * 0.9));
  oscs.push(...tone(ac, master, [990], t - RING_GAP_MS / 1000 + 0.2, 0.12, volume * 0.9));
  return {
    stop() {
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.setValueAtTime(0, ac.currentTime);
      for (const o of oscs) {
        try {
          o.stop();
        } catch {
          // já parou
        }
      }
      master.disconnect();
    },
  };
}

/** Quanto dura a chamada com `rings` toques até "atender" (ms). */
export function ringMs(rings: number): number {
  return rings * (RING_ON_MS + RING_GAP_MS);
}
