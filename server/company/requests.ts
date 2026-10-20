// Pedidos entre setores da empresa (HABBLAUD_COMPANY_DIR, ex.: C:\empresa): cada pedido é um JSON em
// <pasta>/pedidos/<id>.json, escrito pela ferramenta dos setores (bin/pedido.mjs). Aqui só se lê, para o painel
// Pedidos da página (GET /api/company/requests). Os nomes dos setores vêm de <pasta>/setores.json ({slug: nome}),
// quando existe. Arquivo estragado ou fora do formato fica de fora.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tr } from '../../shared/i18n';

export type RequestStatus = 'aberto' | 'andamento' | 'feito' | 'recusado';

export interface CompanyRequestEntry {
  at: number;
  sector: string;
  text: string;
  status?: RequestStatus;
}

export interface CompanyRequest {
  id: string;
  from: string;
  to: string;
  title: string;
  text: string;
  status: RequestStatus;
  createdAt: number;
  updatedAt: number;
  history: CompanyRequestEntry[];
}

export interface CompanyRequests {
  /** slug -> nome do setor ("produto-design" -> "Produto e Design"). */
  sectors: Record<string, string>;
  /** Abertos primeiro (os mais antigos no topo), depois os fechados mais recentes. */
  requests: CompanyRequest[];
}

const STATUS = new Set<RequestStatus>(['aberto', 'andamento', 'feito', 'recusado']);
const OPEN = new Set<RequestStatus>(['aberto', 'andamento']);
/** Quantos pedidos fechados a lista leva (os abertos vão todos). */
export const CLOSED_MAX = 50;
const TEXT_MAX = 8_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

const str = (v: unknown, max = TEXT_MAX): string => (typeof v === 'string' ? v.slice(0, max) : '');
const time = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Um pedido do arquivo (o JSON da ferramenta), ou null se não tiver o formato. */
export function parseRequest(raw: unknown): CompanyRequest | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const id = str(r.id, 64);
  const from = str(r.de, 41);
  const to = str(r.para, 41);
  const status = r.status as RequestStatus;
  if (!/^[\w-]{1,64}$/.test(id) || !SLUG.test(from) || !SLUG.test(to) || !STATUS.has(status)) return null;
  const history = (Array.isArray(r.historico) ? r.historico : [])
    .map((h): CompanyRequestEntry | null => {
      const e = h as Record<string, unknown> | null;
      if (!e || typeof e !== 'object' || !SLUG.test(str(e.setor, 41))) return null;
      const st = e.status as RequestStatus;
      return { at: time(e.at), sector: str(e.setor, 41), text: str(e.texto), ...(STATUS.has(st) ? { status: st } : {}) };
    })
    .filter((e): e is CompanyRequestEntry => !!e)
    .slice(-50);
  const createdAt = time(r.criado);
  return { id, from, to, title: str(r.titulo, 200) || id, text: str(r.texto), status, createdAt, updatedAt: time(r.atualizado) || createdAt, history };
}

/** Ordena: abertos (mais antigos primeiro), depois os fechados mais recentes, até CLOSED_MAX. */
export function orderRequests(list: readonly CompanyRequest[]): CompanyRequest[] {
  const open = list.filter((r) => OPEN.has(r.status)).sort((a, b) => a.createdAt - b.createdAt);
  const closed = list
    .filter((r) => !OPEN.has(r.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CLOSED_MAX);
  return [...open, ...closed];
}

export async function readCompanyRequests(dir: string): Promise<CompanyRequests> {
  let sectors: Record<string, string> = {};
  try {
    const raw = JSON.parse(await readFile(join(dir, 'setores.json'), 'utf8')) as Record<string, unknown>;
    sectors = Object.fromEntries(Object.entries(raw).filter(([k, v]) => SLUG.test(k) && typeof v === 'string').map(([k, v]) => [k, (v as string).slice(0, 60)]));
  } catch {
    // sem nomes: a página mostra o slug
  }
  let files: string[] = [];
  try {
    files = (await readdir(join(dir, 'pedidos'))).filter((f) => f.endsWith('.json')).slice(0, 2_000);
  } catch {
    return { sectors, requests: [] };
  }
  const parsed = await Promise.all(
    files.map(async (f) => {
      try {
        return parseRequest(JSON.parse(await readFile(join(dir, 'pedidos', f), 'utf8')));
      } catch {
        return null;
      }
    }),
  );
  return { sectors, requests: orderRequests(parsed.filter((r): r is CompanyRequest => !!r)) };
}

// ------------------------------------------------------------------ o CEO pelo painel (escrita)

/** Corpo de POST /api/company/requests/:id/reply. */
export interface CeoReply {
  text: string;
  status?: RequestStatus;
}

/** Corpo de POST /api/company/requests (pedido novo do CEO). */
export interface CeoRequest {
  to: string;
  title: string;
  text: string;
}

export class CompanyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const REPLY_MAX = 4_000;

export function parseCeoReply(raw: unknown): CeoReply {
  const r = (raw ?? {}) as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, REPLY_MAX) : '';
  const status = r.status as RequestStatus | undefined;
  if (status !== undefined && !STATUS.has(status)) throw new CompanyError(400, tr('status inválido'));
  if (!text && !status) throw new CompanyError(400, tr('escreva a resposta'));
  return { text, ...(status ? { status } : {}) };
}

export function parseCeoRequest(raw: unknown): CeoRequest {
  const r = (raw ?? {}) as Record<string, unknown>;
  const to = typeof r.to === 'string' ? r.to.trim() : '';
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 200) : '';
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, TEXT_MAX) : '';
  if (!SLUG.test(to) || to === 'ceo') throw new CompanyError(400, tr('escolha o setor'));
  if (!title) throw new CompanyError(400, tr('dê um título ao pedido'));
  return { to, title, text: text || title };
}

function newId(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const rnd = Math.random().toString(36).slice(2, 5);
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}-${rnd}`;
}

async function writeAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, file);
}

/**
 * Resposta do CEO a um pedido (o mesmo formato que a ferramenta grava em `historico`). Devolve o pedido atualizado
 * e o setor que deve ser avisado (quem pediu; se o CEO comenta um pedido entre dois setores, quem está com ele).
 */
export async function replyAsCeo(dir: string, id: string, reply: CeoReply, now = new Date()): Promise<{ request: CompanyRequest; notify: string }> {
  if (!/^[\w-]{1,64}$/.test(id)) throw new CompanyError(400, tr('id inválido'));
  const file = join(dir, 'pedidos', `${id}.json`);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new CompanyError(404, tr('pedido não encontrado'));
  }
  if (!parseRequest(raw)) throw new CompanyError(422, tr('pedido em formato desconhecido'));
  const at = now.toISOString();
  if (reply.status) raw.status = reply.status;
  raw.atualizado = at;
  const hist = Array.isArray(raw.historico) ? raw.historico : [];
  hist.push({ at, setor: 'ceo', texto: reply.text, ...(reply.status ? { status: reply.status } : {}) });
  raw.historico = hist;
  await writeAtomic(file, raw);
  const request = parseRequest(raw)!;
  return { request, notify: request.from === 'ceo' ? request.to : request.to === 'ceo' ? request.from : request.to };
}

/** Pedido novo do CEO para um setor. */
export async function createAsCeo(dir: string, req: CeoRequest, now = new Date()): Promise<CompanyRequest> {
  await mkdir(join(dir, 'pedidos'), { recursive: true });
  const at = now.toISOString();
  const raw = { id: newId(now), de: 'ceo', para: req.to, titulo: req.title, texto: req.text, status: 'aberto', criado: at, atualizado: at, historico: [] };
  await writeAtomic(join(dir, 'pedidos', `${raw.id}.json`), raw);
  return parseRequest(raw)!;
}

/** O texto que chega ao agente do setor (o mesmo jeito da ferramenta bin/pedido.mjs). */
export function ceoMessage(kind: 'reply' | 'new', r: CompanyRequest, text: string, toolCmd = 'node C:/empresa/bin/pedido.mjs'): string {
  if (kind === 'new') return `📨 Pedido novo do CEO (${r.id}): ${r.title}\n\n${r.text}\n\nQuando puder, trate e responda com: ${toolCmd} responder ${r.id} "<resposta>" --status feito`;
  return `📬 Resposta do CEO ao pedido ${r.id} ("${r.title}") [${r.status}]:\n\n${text || '(sem comentário)'}\n\n(Siga o seu trabalho com isso; para ver tudo: ${toolCmd} ver ${r.id})`;
}
