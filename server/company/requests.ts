// Pedidos entre setores da empresa (HABBLAUD_COMPANY_DIR, ex.: C:\empresa): cada pedido é um JSON em
// <pasta>/pedidos/<id>.json, escrito pela ferramenta dos setores (bin/pedido.mjs). Aqui só se lê, para o painel
// Pedidos da página (GET /api/company/requests). Os nomes dos setores vêm de <pasta>/setores.json ({slug: nome}),
// quando existe. Arquivo estragado ou fora do formato fica de fora.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
