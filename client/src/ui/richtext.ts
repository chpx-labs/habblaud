// Texto dos pedidos entre setores (ui/requests.ts) com um pouco de formatação, para ler melhor: parágrafos, listas
// ("- item", "1. item", "1) item" e também a numeração corrida que os agentes escrevem numa linha só, "(1) ... (2) ..."),
// **negrito**, `código`, caminhos de arquivo (C:\...) em fonte de código e links https clicáveis. Monta os nós com o DOM
// (nunca innerHTML): o texto vem dos agentes e é tratado como texto.

/** Um pedaço de linha: texto comum, negrito, código ou link. */
export type Inline = { t: 'text' | 'bold' | 'code'; v: string } | { t: 'link'; v: string; href: string };

/** Um bloco: parágrafo ou lista (com os itens já quebrados em pedaços). */
export type Block = { t: 'p'; parts: Inline[] } | { t: 'ul' | 'ol'; items: Inline[][]; start?: number };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\(?(\d{1,2})[.)]\s+(.*)$/;
/** "(1) a; (2) b" ou "1) a 2) b" numa linha só: precisa de pelo menos dois números seguidos (1, 2...). */
const INLINE_ENUM = /(?:^|\s)\(?(\d{1,2})\)\s+/g;

const TOKEN = /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|([A-Za-z]:[\\/][^\s,;)"'`]*[^\s,;)"'`.:])/g;

/** Quebra uma linha em pedaços (negrito, código, link, caminho). */
export function inline(line: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ t: 'text', v: line.slice(last, i) });
    if (m[1]) out.push({ t: 'bold', v: m[1].slice(2, -2) });
    else if (m[2]) out.push({ t: 'code', v: m[2].slice(1, -1) });
    else if (m[3]) out.push({ t: 'link', v: m[3], href: m[3] });
    else if (m[4]) out.push({ t: 'code', v: m[4] });
    last = i + m[0].length;
  }
  if (last < line.length) out.push({ t: 'text', v: line.slice(last) });
  return out;
}

/**
 * Numeração corrida numa linha: "Passos: 1) a; 2) b; 3) c." vira [intro, [a, b, c]]. Só quando os números
 * começam em 1 e seguem em ordem (1, 2, 3...), para não confundir "versão 2) ..." com lista.
 */
export function splitInlineEnum(line: string): { intro: string; items: string[]; rest: string } | null {
  const hits = [...line.matchAll(INLINE_ENUM)];
  if (hits.length < 2) return null;
  const nums = hits.map((h) => Number(h[1]));
  if (nums[0] !== 1 || nums.some((n, i) => n !== i + 1)) return null;
  const intro = line.slice(0, hits[0].index ?? 0).trim();
  const items = hits.map((h, i) => {
    const from = (h.index ?? 0) + h[0].length;
    const to = i + 1 < hits.length ? (hits[i + 1].index ?? line.length) : line.length;
    return line
      .slice(from, to)
      .trim()
      .replace(/[;,]\s*$/, '');
  });
  // o último item vai só até o fim da frase dele; o resto da linha volta a ser parágrafo
  let rest = '';
  const last = items[items.length - 1];
  const end = /[.!?]\s+(?=[A-ZÀ-Ý])/.exec(last);
  if (end) {
    rest = last.slice(end.index + 1).trim();
    items[items.length - 1] = last.slice(0, end.index + 1).trim();
  }
  return items.every((s) => s.length > 0) ? { intro, items, rest } : null;
}

/** O texto inteiro em blocos. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[]; start?: number } | null = null;
  const flushPara = () => {
    if (para.length) out.push({ t: 'p', parts: inline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) out.push({ t: list.t, items: list.items.map(inline), ...(list.start && list.start !== 1 ? { start: list.start } : {}) });
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flushPara();
      const kind = b ? 'ul' : 'ol';
      if (!list || list.t !== kind) {
        flushList();
        list = { t: kind, items: [], ...(n ? { start: Number(n[1]) } : {}) };
      }
      list.items.push((b ? b[1] : n![2]).trim());
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // continuação recuada do último item
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    const e = splitInlineEnum(line);
    if (e) {
      flushPara();
      if (e.intro) out.push({ t: 'p', parts: inline(e.intro) });
      out.push({ t: 'ol', items: e.items.map(inline) });
      if (e.rest) para.push(e.rest);
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out;
}

function inlineNodes(parts: readonly Inline[]): Node[] {
  return parts.map((p) => {
    if (p.t === 'text') return document.createTextNode(p.v);
    if (p.t === 'bold') {
      const b = document.createElement('strong');
      b.textContent = p.v;
      return b;
    }
    if (p.t === 'code') {
      const c = document.createElement('code');
      c.textContent = p.v;
      return c;
    }
    if (p.t !== 'link') return document.createTextNode(p.v);
    const a = document.createElement('a');
    a.href = p.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = p.v;
    return a;
  });
}

/** O texto formatado, num `div.ui-rich`. */
export function richText(text: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ui-rich';
  for (const b of blocks(text)) {
    if (b.t === 'p') {
      const p = document.createElement('p');
      p.append(...inlineNodes(b.parts));
      root.append(p);
      continue;
    }
    const list = b.t === 'ol' ? document.createElement('ol') : document.createElement('ul');
    if (list instanceof HTMLOListElement && b.t === 'ol' && b.start) list.start = b.start;
    for (const item of b.items) {
      const li = document.createElement('li');
      li.append(...inlineNodes(item));
      list.append(li);
    }
    root.append(list);
  }
  return root;
}
