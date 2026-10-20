import { describe, expect, it } from 'vitest';
import { createOpenAiTts, parseTtsRequest, TTS_TEXT_MAX, TTS_VOICES, ttsFromEnv } from './tts';

describe('parseTtsRequest', () => {
  it('aceita texto, voz conhecida e idioma', () => {
    expect(parseTtsRequest({ text: '  Olá,\n tudo bem? ', voice: 'sage', lang: 'pt-BR' })).toEqual({ text: 'Olá, tudo bem?', voice: 'sage', lang: 'pt-BR' });
  });

  it('voz desconhecida vira a primeira; idioma estranho vira pt-BR', () => {
    expect(parseTtsRequest({ text: 'oi', voice: 'robô', lang: '../../x' })).toEqual({ text: 'oi', voice: TTS_VOICES[0], lang: 'pt-BR' });
  });

  it('recusa vazio e longo demais', () => {
    expect(parseTtsRequest({ text: '   ' })).toHaveProperty('error');
    expect(parseTtsRequest({ text: 'a'.repeat(TTS_TEXT_MAX + 1) })).toHaveProperty('error');
    expect(parseTtsRequest(null)).toHaveProperty('error');
  });
});

describe('createOpenAiTts', () => {
  it('chama a OpenAI com a chave, o modelo e as instruções, e devolve o áudio', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;
    const tts = createOpenAiTts({ key: 'sk-test-123', fetchImpl: fake });
    const audio = await tts.synthesize({ text: 'Feito.', voice: 'coral', lang: 'pt-BR' });
    expect([...audio]).toEqual([1, 2, 3]);
    expect(seen!.url).toBe('https://api.openai.com/v1/audio/speech');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-123');
    const body = JSON.parse(String(seen!.init.body));
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'coral', input: 'Feito.', response_format: 'mp3' });
    expect(body.instructions).toMatch(/português do Brasil/);
  });

  it('modelos sem instruções (tts-1) não as recebem', async () => {
    let body: Record<string, unknown> = {};
    const fake = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(new Uint8Array([0]), { status: 200 });
    }) as unknown as typeof fetch;
    await createOpenAiTts({ key: 'k', model: 'tts-1', fetchImpl: fake }).synthesize({ text: 'x', voice: 'ash', lang: 'en' });
    expect(body.instructions).toBeUndefined();
  });

  it('tenta de novo quando a conexão trava ou dá 5xx, mas não num 4xx', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls === 1) throw new DOMException('timeout', 'TimeoutError');
      return new Response(new Uint8Array([9]), { status: 200 });
    }) as unknown as typeof fetch;
    expect([...(await createOpenAiTts({ key: 'k', fetchImpl: flaky }).synthesize({ text: 'x', voice: 'ash', lang: 'pt-BR' }))]).toEqual([9]);
    expect(calls).toBe(2);

    calls = 0;
    const bad = (async () => {
      calls++;
      return new Response('{}', { status: 400 });
    }) as unknown as typeof fetch;
    await expect(createOpenAiTts({ key: 'k', fetchImpl: bad }).synthesize({ text: 'x', voice: 'ash', lang: 'pt-BR' })).rejects.toThrow(/400/);
    expect(calls).toBe(1);

    calls = 0;
    const down = (async () => {
      calls++;
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(createOpenAiTts({ key: 'k', fetchImpl: down }).synthesize({ text: 'x', voice: 'ash', lang: 'pt-BR' })).rejects.toThrow(/não respondeu/);
    expect(calls).toBe(2);
  });

  it('erro da OpenAI vira mensagem curta, sem a chave', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-abcdef123456.' } }), { status: 401 })) as unknown as typeof fetch;
    const err = await createOpenAiTts({ key: 'sk-abcdef123456', fetchImpl: fake })
      .synthesize({ text: 'x', voice: 'ash', lang: 'pt-BR' })
      .catch((e: Error) => e.message);
    expect(err).toMatch(/401/);
    expect(err).not.toContain('sk-abcdef123456');
  });
});

describe('ttsFromEnv', () => {
  it('lê a chave e a apaga do ambiente', () => {
    const env: NodeJS.ProcessEnv = { HABBLAUD_TTS_OPENAI_KEY: 'k1', OPENAI_API_KEY: 'k2', HABBLAUD_TTS_MODEL: 'tts-1' };
    const tts = ttsFromEnv(env);
    expect(tts?.model).toBe('tts-1');
    expect(env.HABBLAUD_TTS_OPENAI_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('sem chave ou com HABBLAUD_TTS=0: sem voz natural (e a chave some do mesmo jeito)', () => {
    expect(ttsFromEnv({})).toBeUndefined();
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'k', HABBLAUD_TTS: '0' };
    expect(ttsFromEnv(env)).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});
