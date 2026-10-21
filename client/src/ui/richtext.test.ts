// Formatação dos textos dos pedidos (ui/richtext.ts): blocos, listas, numeração corrida e trechos em destaque.
import { describe, expect, it } from 'vitest';
import { blocks, inline, splitInlineEnum } from './richtext';

describe('texto dos pedidos', () => {
  it('parágrafos separados por linha em branco; linhas seguidas viram um parágrafo só', () => {
    const b = blocks('Primeira linha\ncontinua aqui.\n\nSegundo parágrafo.');
    expect(b).toEqual([
      { t: 'p', parts: [{ t: 'text', v: 'Primeira linha continua aqui.' }] },
      { t: 'p', parts: [{ t: 'text', v: 'Segundo parágrafo.' }] },
    ]);
  });

  it('listas com "-" e numeradas, com continuação recuada', () => {
    const b = blocks('Faça:\n- um\n- dois\n  e mais\n\n3. três\n4) quatro');
    expect(b[1]).toEqual({ t: 'ul', items: [[{ t: 'text', v: 'um' }], [{ t: 'text', v: 'dois e mais' }]] });
    expect(b[2]).toEqual({ t: 'ol', start: 3, items: [[{ t: 'text', v: 'três' }], [{ t: 'text', v: 'quatro' }]] });
  });

  it('numeração corrida numa linha vira lista (só 1, 2, 3 em ordem)', () => {
    expect(splitInlineEnum('Passos: 1) conferir o PR; 2) qa revisa; 3) juntar ao main.')).toEqual({
      intro: 'Passos:',
      items: ['conferir o PR', 'qa revisa', 'juntar ao main.'],
      rest: '',
    });
    expect(splitInlineEnum('Faça: (1) isto; (2) aquilo. Depois me avise.')).toEqual({ intro: 'Faça:', items: ['isto', 'aquilo.'], rest: 'Depois me avise.' });
    expect(splitInlineEnum('Critérios: (1) dor real; (2) IA no centro')?.items).toEqual(['dor real', 'IA no centro']);
    expect(splitInlineEnum('versão 2) saiu e a 3) também')).toBeNull();
    expect(splitInlineEnum('só 1) um')).toBeNull();
  });

  it('negrito, código, links https e caminhos de arquivo', () => {
    expect(inline('Veja **isto**, rode `npm test`, abra https://x.example/a. Arquivo C:\\dev\\work\\app\\README.md.')).toEqual([
      { t: 'text', v: 'Veja ' },
      { t: 'bold', v: 'isto' },
      { t: 'text', v: ', rode ' },
      { t: 'code', v: 'npm test' },
      { t: 'text', v: ', abra ' },
      { t: 'link', v: 'https://x.example/a', href: 'https://x.example/a' },
      { t: 'text', v: '. Arquivo ' },
      { t: 'code', v: 'C:\\dev\\work\\app\\README.md' },
      { t: 'text', v: '.' },
    ]);
  });

  it('texto com cara de HTML continua texto (nada é interpretado)', () => {
    expect(inline('<img src=x onerror=alert(1)>')).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }]);
  });
});
