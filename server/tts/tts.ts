// Voz natural da ligação (ui/call.ts): o texto que o navegador já limpou (sem código nem links) vira áudio MP3 na
// OpenAI (POST /v1/audio/speech). Só existe com a chave em HABBLAUD_TTS_OPENAI_KEY (ou OPENAI_API_KEY), lida uma vez
// na partida: index.ts a apaga do ambiente logo depois, para os agentes que o Habblaud abre (terminal interativo,
// Novo agente) não a herdarem. Sem a chave, a ligação usa a voz do navegador. Só sai o texto das respostas; a voz de
// quem fala continua no Whisper local.
import { tr } from '../../shared/i18n';

/** Vozes da OpenAI, na ordem em que os participantes da ligação as recebem. */
export const TTS_VOICES = ['coral', 'ash', 'sage', 'verse', 'ballad', 'nova', 'onyx', 'shimmer', 'alloy', 'echo', 'fable'] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];
export const TTS_TEXT_MAX = 1_200;
export const TTS_BODY_MAX = 16 * 1024;
/**
 * Prazo de cada tentativa: a OpenAI costuma responder em ~1 s, mas de vez em quando a conexão trava sem resposta.
 * Melhor desistir cedo e tentar de novo do que deixar a ligação muda por 30 s.
 */
export const TTS_TIMEOUT_MS = 8_000;
/** Tentativas por fala (a segunda só quando a primeira travou, caiu ou deu erro 5xx/429). */
export const TTS_ATTEMPTS = 2;
/** Pedidos ao mesmo tempo (a ligação busca a próxima fala enquanto a atual toca). */
export const TTS_MAX_OPEN = 4;
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';

export interface TtsRequest {
  text: string;
  voice: TtsVoice;
  lang: string;
}

export interface TtsService {
  readonly model: string;
  readonly voices: readonly TtsVoice[];
  /** Áudio MP3 do texto. Lança com uma mensagem curta (nunca com a chave). */
  synthesize(req: TtsRequest): Promise<Buffer>;
}

/** Confere o corpo de POST /api/tts: {text, voice, lang?}. */
export function parseTtsRequest(raw: unknown): TtsRequest | { error: string } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) return { error: tr('nada para falar') };
  if (text.length > TTS_TEXT_MAX) return { error: tr('texto longo demais para a voz') };
  const voice = TTS_VOICES.find((v) => v === r.voice) ?? TTS_VOICES[0];
  const lang = typeof r.lang === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(r.lang) ? r.lang : 'pt-BR';
  return { text, voice, lang };
}

/** Como falar (só os modelos gpt-4o-*-tts aceitam instruções). */
export function ttsInstructions(lang: string): string {
  if (/^pt/i.test(lang)) {
    return 'Fale em português do Brasil, com naturalidade e ritmo de conversa, como um colega de trabalho numa ligação. Tom calmo, simpático e direto.';
  }
  return 'Speak naturally, at a conversational pace, like a coworker on a phone call. Calm, friendly and direct.';
}

export interface OpenAiTtsOptions {
  key: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Tentativas por fala (padrão TTS_ATTEMPTS). */
  attempts?: number;
}

export function createOpenAiTts(opts: OpenAiTtsOptions): TtsService {
  const model = opts.model?.trim() || DEFAULT_TTS_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;
  const key = opts.key;
  let open = 0;
  return {
    model,
    voices: TTS_VOICES,
    async synthesize(req) {
      if (open >= TTS_MAX_OPEN) throw new Error(tr('falas demais ao mesmo tempo'));
      open++;
      try {
        const body: Record<string, string> = { model, voice: req.voice, input: req.text, response_format: 'mp3' };
        if (/^gpt-4o/.test(model)) body.instructions = ttsInstructions(req.lang);
        const attempts = Math.max(1, opts.attempts ?? TTS_ATTEMPTS);
        let res: Response | null = null;
        for (let i = 0; i < attempts; i++) {
          try {
            const signal = AbortSignal.timeout(opts.timeoutMs ?? TTS_TIMEOUT_MS);
            const r = await doFetch('https://api.openai.com/v1/audio/speech', {
              method: 'POST',
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal,
            });
            // O corpo também pode travar: lê dentro do mesmo prazo.
            if (r.ok) return Buffer.from(await r.arrayBuffer());
            res = r;
            if (r.status < 500 && r.status !== 429) break;
          } catch {
            res = null;
          }
        }
        if (!res) throw new Error(tr('a OpenAI não respondeu'));
        // Só o status e a mensagem da OpenAI (que nunca traz a chave inteira), curta.
        let detail = '';
        try {
          const j = (await res.json()) as { error?: { message?: unknown } };
          if (typeof j.error?.message === 'string') detail = j.error.message.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-…').slice(0, 160);
        } catch {
          // sem corpo legível
        }
        throw new Error(tr('a OpenAI recusou ({0}){1}', [res.status, detail ? `: ${detail}` : '']));
      } finally {
        open--;
      }
    },
  };
}

/**
 * Lê a chave do ambiente e a APAGA dele (os processos filhos do servidor não a herdam). undefined = sem voz natural
 * (sem chave ou HABBLAUD_TTS=0).
 */
export function ttsFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): TtsService | undefined {
  const key = env.HABBLAUD_TTS_OPENAI_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  delete env.HABBLAUD_TTS_OPENAI_KEY;
  delete env.OPENAI_API_KEY;
  if (!key || env.HABBLAUD_TTS === '0') return undefined;
  return createOpenAiTts({ key, model: env.HABBLAUD_TTS_MODEL, fetchImpl });
}
