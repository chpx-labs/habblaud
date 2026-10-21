import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diaryLines, readCompanyDashboard } from './dashboard';

describe('painel do CEO', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('linhas do diário de hoje, em vários formatos de data', () => {
    const md = [
      '# Diário',
      '- 2026-10-20 18:00: ontem',
      '- 2026-10-21 09:15: Revisei o roadmap',
      '- 2026-10-21: Mandei pedido ao Dev',
      '* 21/10/2026 10:30 — Rascunho do post',
      'texto solto 2026-10-21',
    ].join('\n');
    expect(diaryLines(md, '2026-10-21')).toEqual([
      { time: '09:15', text: 'Revisei o roadmap' },
      { text: 'Mandei pedido ao Dev' },
      { time: '10:30', text: 'Rascunho do post' },
    ]);
  });

  it('junta diários, entregas do dia, turnos e pedidos (esperando o CEO e parados)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'company-'));
    dirs.push(dir);
    const now = new Date(2026, 9, 21, 12, 0);
    writeFileSync(join(dir, 'sectors.json'), JSON.stringify({ marketing: 'Marketing', ceo: 'CEO' }));
    mkdirSync(join(dir, 'marketing', 'deliverables'), { recursive: true });
    writeFileSync(join(dir, 'marketing', 'log.md'), '- 2026-10-21 09:20: Post do ai-fitness\n');
    writeFileSync(join(dir, 'marketing', 'deliverables', 'post.md'), 'x');
    const old = join(dir, 'marketing', 'deliverables', 'velho.md');
    writeFileSync(old, 'x');
    utimesSync(old, new Date(2026, 9, 18), new Date(2026, 9, 18));
    utimesSync(join(dir, 'marketing', 'deliverables', 'post.md'), new Date(2026, 9, 21, 9, 30), new Date(2026, 9, 21, 9, 30));
    writeFileSync(join(dir, 'shifts.json'), JSON.stringify({ sectors: { marketing: { active: true, start: '09:20' } } }));
    writeFileSync(join(dir, '.shifts-state.json'), JSON.stringify({ shift: { marketing: '2026-10-21' } }));
    mkdirSync(join(dir, 'requests'));
    const req = (id: string, from: string, to: string, at: Date) => ({ id, from, to, title: id, text: '', status: 'open', created: at.toISOString(), updated: at.toISOString(), history: [] });
    writeFileSync(join(dir, 'requests', 'a.json'), JSON.stringify(req('a', 'marketing', 'ceo', new Date(2026, 9, 21, 8))));
    writeFileSync(join(dir, 'requests', 'b.json'), JSON.stringify(req('b', 'ceo', 'marketing', new Date(2026, 9, 19))));
    writeFileSync(join(dir, 'requests', 'c.json'), JSON.stringify(req('c', 'ceo', 'marketing', new Date(2026, 9, 21, 10))));

    const d = await readCompanyDashboard(dir, now);
    expect(d.day).toBe('2026-10-21');
    expect(d.sectors).toEqual([
      {
        slug: 'marketing',
        name: 'Marketing',
        diary: [{ time: '09:20', text: 'Post do ai-fitness' }],
        deliveries: [{ name: 'post.md', at: new Date(2026, 9, 21, 9, 30).getTime() }],
        turn: { active: true, time: '09:20', ranToday: true },
      },
    ]);
    expect(d.waiting.map((r) => r.id)).toEqual(['a']);
    expect(d.stale.map((r) => r.id)).toEqual(['b']);
    expect(d.open).toBe(3);
  });

  it('o "hoje" é o do fuso do expediente (shifts.json hours.timezone)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'company-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'shifts.json'), JSON.stringify({ hours: { timezone: 'America/Sao_Paulo' }, sectors: {} }));
    // 02:00 UTC do dia 22 = 23:00 do dia 21 em Brasília
    expect((await readCompanyDashboard(dir, new Date('2026-10-22T02:00:00Z'))).day).toBe('2026-10-21');
  });
});
