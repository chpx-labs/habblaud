import { describe, expect, it } from 'vitest';
import { addressedTo, chunks, finalReplyStep, joinReply, midTurn, pickVoice, seedOf, speakableText, voicesFor, voiceStyle, waitingAnnouncement, withSpeaker } from './call-model';

describe('speakableText', () => {
  it('tira blocos de código, tabelas e links', () => {
    const md = [
      '## Pronto',
      'Rodei os testes e **todos passaram**. Veja [o PR](https://github.com/x/y/pull/1).',
      '```ts',
      'const a = 1;',
      '```',
      '| arquivo | linhas |',
      '| --- | --- |',
      '| a.ts | 10 |',
      '- corrigi o `parser`',
      '- mais detalhes em https://example.com/doc',
    ].join('\n');
    expect(speakableText(md)).toBe('Pronto. Rodei os testes e todos passaram. Veja o PR. corrigi o parser. mais detalhes em.');
  });

  it('some com código longo em linha e mantém o curto', () => {
    expect(speakableText('Rode `npm test` e depois `node scripts/build-server.mjs --watch --verbose`.')).toBe('Rode npm test e depois.');
  });

  it('corta respostas longas no fim de uma frase e avisa', () => {
    const md = Array.from({ length: 40 }, (_, i) => `Frase número ${i}.`).join(' ');
    const out = speakableText(md, 120);
    expect(out.length).toBeLessThan(170);
    expect(out).toMatch(/^Frase número 0\..*\. O resto está no terminal\.$/);
  });

  it('não deixa pontuação dupla onde havia código', () => {
    expect(speakableText('Deixei rodando em segundo plano: `npm run test:e2e -- --watch`. Volto assim que terminar.')).toBe(
      'Deixei rodando em segundo plano. Volto assim que terminar.',
    );
    expect(speakableText('Rode isto:\n```\nnpm test\n```\nDepois me avise.')).toBe('Rode isto: Depois me avise.');
  });

  it('só código = nada para falar', () => {
    expect(speakableText('```\nls\n```')).toBe('');
  });
});

describe('addressedTo', () => {
  const people = [
    { id: 'a', name: 'Marina' },
    { id: 'b', name: 'Ana' },
    { id: 'c', name: 'Ana Clara' },
    { id: 'd', name: 'Júlio' },
  ];

  it('acha o nome no começo, com ou sem vírgula, e tira o vocativo', () => {
    expect(addressedTo('Marina, roda os testes.', people)).toEqual({ id: 'a', text: 'Roda os testes.' });
    expect(addressedTo('marina roda os testes', people)).toEqual({ id: 'a', text: 'Roda os testes' });
    expect(addressedTo('Ô Marina: e o build?', people)).toEqual({ id: 'a', text: 'E o build?' });
  });

  it('ignora acentos e prefere o nome mais longo', () => {
    expect(addressedTo('Julio, pode parar.', people)?.id).toBe('d');
    expect(addressedTo('Ana Clara, revisa o PR', people)?.id).toBe('c');
    expect(addressedTo('Ana, revisa o PR', people)?.id).toBe('b');
  });

  it('não confunde nome com começo de palavra nem fala sem nome', () => {
    expect(addressedTo('Anabela chegou?', people)).toBeNull();
    expect(addressedTo('roda os testes', people)).toBeNull();
  });
});

describe('vozes', () => {
  const voices = [
    { name: 'Microsoft Maria', lang: 'pt-BR' },
    { name: 'Google português do Brasil', lang: 'pt-BR' },
    { name: 'Joana', lang: 'pt-PT' },
    { name: 'Samantha', lang: 'en-US' },
  ];

  it('prefere o idioma exato e as vozes naturais', () => {
    expect(voicesFor(voices, 'pt-BR').map((v) => v.name)).toEqual(['Google português do Brasil', 'Microsoft Maria', 'Joana']);
    expect(voicesFor(voices, 'fr-FR')).toEqual([]);
  });

  it('espalha os participantes entre as vozes e muda o tom quando repete', () => {
    expect(pickVoice(voices, 'pt-BR', 0)?.name).toBe('Google português do Brasil');
    expect(pickVoice(voices, 'pt-BR', 1)?.name).toBe('Microsoft Maria');
    expect(pickVoice(voices, 'pt-BR', 3)?.name).toBe('Google português do Brasil');
    const seed = seedOf('agente-1');
    expect(voiceStyle(seed, 0, 3).pitch).not.toBe(voiceStyle(seed, 3, 3).pitch);
    expect(seedOf('agente-1')).toBe(seed);
  });
});

describe('avisos', () => {
  it('avisa só quando passa a precisar de você', () => {
    expect(waitingAnnouncement('working', 'waiting', 'Marina', 'aprovar uma permissão')).toBe('Marina precisa de você: aprovar uma permissão.');
    expect(waitingAnnouncement('waiting', 'waiting', 'Marina')).toBeNull();
    expect(waitingAnnouncement(undefined, 'waiting', 'Marina')).toBeNull();
    expect(waitingAnnouncement('working', 'idle', 'Marina')).toBeNull();
  });

  it('põe o nome na frente só com vários na ligação', () => {
    expect(withSpeaker('Feito.', 'Marina', false)).toBe('Feito.');
    expect(withSpeaker('Feito.', 'Marina', true)).toBe('Marina diz: Feito.');
  });
});

describe('chunks', () => {
  it('divide nas frases sem passar do limite', () => {
    const text = 'Primeira frase curta. Segunda frase também curta. Terceira!';
    expect(chunks(text, 30)).toEqual(['Primeira frase curta.', 'Segunda frase também curta.', 'Terceira!']);
    expect(chunks(text, 500)).toEqual([text]);
  });

  it('corta uma frase longa demais em pedaços', () => {
    const out = chunks('a'.repeat(50), 20);
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.length <= 20)).toBe(true);
  });
});

describe('só a resposta final', () => {
  const a = (id: string, text: string) => ({ kind: 'assistant', id, text });
  const tool = { kind: 'tool', id: 't' };

  it('texto seguido de ação era um passo e some; o último texto da demanda sai quando ela termina', () => {
    let s = finalReplyStep([], a('1', 'Vou rodar os testes.'), true);
    expect(s.emit).toEqual([]);
    s = finalReplyStep(s.pending, tool, true);
    expect(s.pending).toEqual([]);
    s = finalReplyStep(s.pending, a('2', 'Pronto: **tudo passando**.'), true);
    expect(s.emit).toEqual([]);
    expect(joinReply(s.pending)).toBe('Pronto: **tudo passando**.');
  });

  it('texto que chega com o agente já parado sai na hora, junto com o que estava guardado', () => {
    const s = finalReplyStep([{ id: '1', md: 'Primeira parte.' }], a('2', 'Segunda parte.'), false);
    expect(s.pending).toEqual([]);
    expect(joinReply(s.emit)).toBe('Primeira parte.\n\nSegunda parte.');
  });

  it('prompt novo descarta o guardado; raciocínio e resultados não mexem', () => {
    expect(finalReplyStep([{ id: '1', md: 'x' }], { kind: 'user', id: 'u' }, true).pending).toEqual([]);
    expect(finalReplyStep([{ id: '1', md: 'x' }], { kind: 'thinking', id: 'th' }, true).pending).toHaveLength(1);
  });

  it('meio da demanda = trabalhando ou esperando você', () => {
    expect(midTurn('working')).toBe(true);
    expect(midTurn('waiting')).toBe(true);
    for (const s of ['idle', 'shell', 'done', 'offline', undefined] as const) expect(midTurn(s)).toBe(false);
  });
});
