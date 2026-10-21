// Painel do CEO (GET /api/company/dashboard): o dia da empresa (HABBLAUD_COMPANY_DIR) num lugar só, lido dos arquivos
// que os setores mantêm: as linhas de hoje do log.md de cada setor ("- AAAA-MM-DD HH:MM: o que fez"), as entregas
// alteradas nas últimas 24 h (<setor>/deliverables/*), o turno de cada setor (shifts.json e .shifts-state.json) e, dos
// pedidos (requests.ts), os que esperam o CEO e os parados há mais de um dia. O "hoje" é o do fuso do expediente
// (shifts.json `hours.timezone`; sem ele, o do computador). Só leitura.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readCompanyRequests, type CompanyRequest } from './requests';

export interface SectorDay {
  slug: string;
  name: string;
  /** Linhas do diário de hoje (as mais recentes por último), sem o "- data". */
  diary: { time?: string; text: string }[];
  /** Arquivos de deliverables/ alterados nas últimas 24 h (mais recentes primeiro). */
  deliveries: { name: string; at: number }[];
  /** Turno do setor (shifts.json), ou null se não há turnos ou o setor não tem turno diário. */
  turn: { active: boolean; time: string; ranToday: boolean } | null;
}

export interface CompanyDashboard {
  /** Dia de hoje (no fuso do expediente), AAAA-MM-DD. */
  day: string;
  sectors: SectorDay[];
  /** Pedidos abertos feitos ao CEO (mais antigos primeiro). */
  waiting: CompanyRequest[];
  /** Pedidos abertos entre setores parados há mais de STALE_MS (sem resposta nem mudança). */
  stale: CompanyRequest[];
  /** Total de pedidos abertos. */
  open: number;
}

export const STALE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DIARY_MAX = 8;
const DELIVERIES_MAX = 8;

export function localDay(d: Date, timeZone?: string): string {
  if (timeZone) {
    try {
      // en-CA escreve AAAA-MM-DD
      return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch {
      // fuso desconhecido: o do computador
    }
  }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Linhas do diário de um dia. Aceita "- 2026-10-21 09:15: texto", "- 2026-10-21: texto", "- 21/10/2026 09:15 texto" e
 * variações com "—" ou "-" depois da data.
 */
export function diaryLines(md: string, day: string): { time?: string; text: string }[] {
  const [y, m, d] = day.split('-');
  const out: { time?: string; text: string }[] = [];
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s*/, '').trim();
    let rest: string | null = null;
    if (line.startsWith(day)) rest = line.slice(day.length);
    else if (line.startsWith(`${d}/${m}/${y}`)) rest = line.slice(10);
    if (rest === null) continue;
    const t = /^[ T]+(\d{1,2}:\d{2})/.exec(rest);
    const text = (t ? rest.slice(t[0].length) : rest).replace(/^\s*[:—–-]?\s*/, '').trim();
    if (text) out.push({ ...(t ? { time: t[1] } : {}), text: text.slice(0, 300) });
  }
  return out.slice(-DIARY_MAX);
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function recentDeliveries(dir: string, now: number): Promise<{ name: string; at: number }[]> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => !n.startsWith('.')).slice(0, 500);
  } catch {
    return [];
  }
  const items = await Promise.all(
    names.map(async (name) => {
      try {
        const s = await stat(join(dir, name));
        return { name, at: s.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  return items
    .filter((x): x is { name: string; at: number } => !!x && now - x.at <= DAY_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, DELIVERIES_MAX);
}

export async function readCompanyDashboard(dir: string, now = new Date()): Promise<CompanyDashboard> {
  const shifts = await readJson(join(dir, 'shifts.json'));
  const tz = (shifts?.hours as { timezone?: unknown } | undefined)?.timezone;
  const day = localDay(now, typeof tz === 'string' ? tz : undefined);
  const { sectors: names, requests } = await readCompanyRequests(dir);
  const config = shifts?.sectors as Record<string, { active?: boolean; start?: string; daily?: boolean }> | undefined;
  const ran = ((await readJson(join(dir, '.shifts-state.json')))?.shift ?? {}) as Record<string, unknown>;
  const slugs = Object.keys(names).filter((s) => s !== 'ceo');
  const sectors = await Promise.all(
    slugs.map(async (slug): Promise<SectorDay> => {
      let diary: SectorDay['diary'] = [];
      try {
        diary = diaryLines(await readFile(join(dir, slug, 'log.md'), 'utf8'), day);
      } catch {
        // sem diário
      }
      const t = config?.[slug];
      return {
        slug,
        name: names[slug] ?? slug,
        diary,
        deliveries: await recentDeliveries(join(dir, slug, 'deliverables'), now.getTime()),
        // sem turno diário (daily: false, só plantão): o cartão não mostra turno
        turn: t && t.daily !== false ? { active: t.active !== false, time: String(t.start ?? ''), ranToday: ran[slug] === day } : null,
      };
    }),
  );
  const open = requests.filter((r) => r.status === 'open' || r.status === 'in_progress');
  const nowMs = now.getTime();
  return {
    day,
    sectors,
    waiting: open.filter((r) => r.to === 'ceo'),
    stale: open.filter((r) => r.to !== 'ceo' && nowMs - Math.max(r.updatedAt, r.createdAt) > STALE_MS),
    open: open.length,
  };
}
