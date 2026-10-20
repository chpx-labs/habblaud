// Ligação (conversa por voz com os agentes): a lógica pura de ui/call.ts, testada em call-model.test.ts.
// - speakableText: a resposta do agente (markdown) vira texto para falar, sem código, tabelas, links nem marcações.
// - addressedTo: "Marina, roda os testes" vai para a Marina (com vários agentes na ligação).
// - pickVoice/voiceStyle: cada agente com uma voz (ou um tom) própria, sempre a mesma para o mesmo agente.
// - waitingAnnouncement: o aviso falado quando alguém da ligação passa a precisar de você.
import type { AgentStatus } from '../../../shared/types';
import { tr } from '../../../shared/i18n';

/** Quanto de cada resposta é falado (o resto fica no terminal). */
export const SPEAK_MAX = 600;

/** Resposta do agente em markdown -> frase para a voz. Vazio = nada para falar. */
export function speakableText(md: string, max = SPEAK_MAX): string {
  let t = md.replace(/\r/g, '');
  // Blocos de código e tabelas não se leem em voz alta.
  t = t.replace(/```[\s\S]*?(```|$)/g, '\n');
  t = t
    .split('\n')
    .filter((l) => !/^\s*\|.*\|\s*$/.test(l) && !/^\s*[-:|\s]{3,}\s*$/.test(l))
    .join('\n');
  // Links: fica o texto; endereços soltos somem.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/\bhttps?:\/\/\S+/g, '');
  // Código curto em linha: fica o conteúdo; longo (caminhos, comandos), some.
  t = t.replace(/`([^`\n]*)`/g, (_m, code: string) => (code.length <= 24 ? code : ''));
  // Marcações de título, lista, citação, ênfase.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s*>\s?/gm, '');
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '');
  t = t.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2');
  t = t.replace(/~~(.+?)~~/g, '$1');
  // Quebras de linha viram pausas.
  const lines = t
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((l) => (/[.!?:;…]$/.test(l) ? l : `${l}.`));
  t = lines
    .join(' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    // Pontuação que sobrou do código tirado ("rode isto: `cmd`." -> "rode isto.").
    .replace(/[,;:]+([.!?])/g, '$1')
    .replace(/([.!?])[.,;:]+/g, '$1')
    .trim();
  if (t.length <= max) return t;
  // Corta no fim da última frase que cabe; sem nenhuma, no último espaço.
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  const short = end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim()}…`;
  return `${short} ${tr('O resto está no terminal.')}`;
}

/** Texto sem acentos e em minúsculas (para comparar nomes ditos com os dos agentes). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface Participant {
  id: string;
  name: string;
}

/**
 * A quem a fala se dirige: o nome no começo ("Marina, ...", "Ô Marina: ...", "Marina roda os testes"). Devolve o
 * agente e o texto sem o vocativo; null quando não começa com o nome de ninguém da ligação.
 */
export function addressedTo(text: string, people: readonly Participant[]): { id: string; text: string } | null {
  const raw = text.trim();
  const lead = /^(?:(?:ô|ó|oi|ei|hey|e aí|olá|ola)[\s,!]+)?/i.exec(raw)?.[0] ?? '';
  const rest = raw.slice(lead.length);
  const folded = fold(rest);
  // Nomes mais longos primeiro ("Ana Clara" antes de "Ana").
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  for (const p of sorted) {
    const name = fold(p.name.trim());
    if (!name || !folded.startsWith(name)) continue;
    const after = rest.slice(p.name.trim().length);
    // O nome precisa terminar ali (Ana != Anabela).
    if (after && !/^[\s,.:;!?-]/.test(after)) continue;
    const body = after.replace(/^[\s,.:;!?-]+/, '').trim();
    return { id: p.id, text: body ? body.charAt(0).toUpperCase() + body.slice(1) : '' };
  }
  return null;
}

/** O mínimo de SpeechSynthesisVoice usado aqui (os testes passam objetos simples). */
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

/** Número estável a partir de um texto (o id do agente): a mesma voz para o mesmo agente. */
export function seedOf(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

/** Vozes do idioma (pt-BR antes de pt-PT quando o idioma é "pt-BR"), as "naturais"/online primeiro. */
export function voicesFor(voices: readonly VoiceLike[], lang: string): VoiceLike[] {
  const want = lang.toLowerCase().replace('_', '-');
  const base = want.split('-')[0];
  const norm = (v: VoiceLike) => v.lang.toLowerCase().replace('_', '-');
  const exact = voices.filter((v) => norm(v) === want);
  const same = voices.filter((v) => norm(v) !== want && norm(v).split('-')[0] === base);
  const rank = (v: VoiceLike) => (/natural|neural|online|google|premium|enhanced/i.test(v.name) ? 0 : 1);
  const byQuality = (a: VoiceLike, b: VoiceLike) => rank(a) - rank(b) || a.name.localeCompare(b.name);
  return [...exact.sort(byQuality), ...same.sort(byQuality)];
}

/** Voz de cada participante: espalha os agentes entre as vozes do idioma, cada um na sua posição da ligação. */
export function pickVoice(voices: readonly VoiceLike[], lang: string, index: number): VoiceLike | undefined {
  const list = voicesFor(voices, lang);
  if (!list.length) return undefined;
  return list[index % list.length];
}

/** Tom e velocidade: quando duas pessoas caem na mesma voz, o tom as diferencia. */
export function voiceStyle(seed: number, index: number, voiceCount: number): { pitch: number; rate: number } {
  const lap = voiceCount > 0 ? Math.floor(index / voiceCount) : index;
  const pitches = [1, 0.8, 1.2, 0.9, 1.1];
  const pitch = pitches[lap % pitches.length] + ((seed % 5) - 2) * 0.02;
  return { pitch: Math.round(pitch * 100) / 100, rate: 1.05 };
}

/** Aviso falado quando alguém da ligação passa a precisar de você (só na transição para 'waiting'). */
export function waitingAnnouncement(prev: AgentStatus | undefined, next: AgentStatus, name: string, waitingFor?: string): string | null {
  if (next !== 'waiting' || prev === 'waiting' || prev === undefined) return null;
  return waitingFor ? tr('{0} precisa de você: {1}.', [name, waitingFor]) : tr('{0} precisa de você.', [name]);
}

/** Fala do agente com o nome na frente quando há mais de um na ligação ("Marina diz: ..."). */
export function withSpeaker(text: string, name: string, many: boolean): string {
  return many ? tr('{0} diz: {1}', [name, text]) : text;
}

/** Pedaço máximo por fala: o Chrome corta falas longas no meio. */
export const CHUNK_MAX = 180;

/** Divide a fala em pedaços curtos, nas frases (o Chrome interrompe falas longas). */
export function chunks(text: string, max = CHUNK_MAX): string[] {
  const out: string[] = [];
  let cur = '';
  for (const s of text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text]) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** O que a ligação lê: só a resposta final de cada demanda (padrão) ou cada texto do agente no caminho. */
export type Narrate = 'final' | 'all';

export interface ReplyPart {
  id: string;
  md: string;
}

/** O agente ainda está no meio da demanda (trabalhando, ou parado num pedido seu no meio dela)? */
export function midTurn(status: AgentStatus | undefined): boolean {
  return status === 'working' || status === 'waiting';
}

/**
 * Modo "só a resposta final": um texto do agente seguido de uma ação (ferramenta) era só um passo e some; o que
 * sobra quando ele termina a demanda é a resposta. `busy` = midTurn do agente quando a entrada chegou.
 * Devolve o que continua guardado e o que já pode ser mostrado/lido (vazio enquanto ele trabalha).
 */
export function finalReplyStep(
  pending: readonly ReplyPart[],
  e: { kind: string; id: string; text?: string },
  busy: boolean,
): { pending: ReplyPart[]; emit: ReplyPart[] } {
  if (e.kind === 'assistant') {
    const next = [...pending, { id: e.id, md: e.text ?? '' }];
    return busy ? { pending: next, emit: [] } : { pending: [], emit: next };
  }
  // Ação depois do texto (era um passo) ou prompt novo (outra demanda): o guardado não é resposta.
  if (e.kind === 'tool' || e.kind === 'user') return { pending: [], emit: [] };
  return { pending: [...pending], emit: [] };
}

/** Junta as partes da resposta final num texto só (às vezes ela vem em mais de um bloco seguido). */
export function joinReply(parts: readonly ReplyPart[]): string {
  return parts
    .map((p) => p.md.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Última resposta final no histórico (ao abrir a ligação): o texto que fechou a última demanda terminada. Com o
 * agente no meio de uma (`busyNow`), é a da demanda anterior; o que ele escreveu na atual ainda é passo.
 */
export function lastFinalReply(entries: readonly { kind: string; id: string; text?: string }[], busyNow: boolean): ReplyPart[] {
  let last: ReplyPart[] = [];
  let pending: ReplyPart[] = [];
  for (const e of entries) {
    // Prompt novo: o que estava guardado fechou a demanda anterior.
    if (e.kind === 'user' && pending.length) last = pending;
    pending = finalReplyStep(pending, e, true).pending;
  }
  if (!busyNow && pending.length) last = pending;
  return last;
}
