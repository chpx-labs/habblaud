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
    const dir = mkdtempSync(join(tmpdir(), 'empresa-'));
    dirs.push(dir);
    const now = new Date(2026, 9, 21, 12, 0);
    writeFileSync(join(dir, 'setores.json'), JSON.stringify({ marketing: 'Marketing', ceo: 'CEO' }));
    mkdirSync(join(dir, 'marketing', 'entregas'), { recursive: true });
    writeFileSync(join(dir, 'marketing', 'diario.md'), '- 2026-10-21 09:20: Post do ai-fitness\n');
    writeFileSync(join(dir, 'marketing', 'entregas', 'post.md'), 'x');
    const old = join(dir, 'marketing', 'entregas', 'velho.md');
    writeFileSync(old, 'x');
    utimesSync(old, new Date(2026, 9, 18), new Date(2026, 9, 18));
    utimesSync(join(dir, 'marketing', 'entregas', 'post.md'), new Date(2026, 9, 21, 9, 30), new Date(2026, 9, 21, 9, 30));
    writeFileSync(join(dir, 'turnos.json'), JSON.stringify({ setores: { marketing: { ativo: true, horario: '09:20' } } }));
    writeFileSync(join(dir, '.turnos-estado.json'), JSON.stringify({ marketing: '2026-10-21' }));
    mkdirSync(join(dir, 'pedidos'));
    const req = (id: string, de: string, para: string, at: Date) => ({ id, de, para, titulo: id, texto: '', status: 'aberto', criado: at.toISOString(), atualizado: at.toISOString(), historico: [] });
    writeFileSync(join(dir, 'pedidos', 'a.json'), JSON.stringify(req('a', 'marketing', 'ceo', new Date(2026, 9, 21, 8))));
    writeFileSync(join(dir, 'pedidos', 'b.json'), JSON.stringify(req('b', 'ceo', 'marketing', new Date(2026, 9, 19))));
    writeFileSync(join(dir, 'pedidos', 'c.json'), JSON.stringify(req('c', 'ceo', 'marketing', new Date(2026, 9, 21, 10))));

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
});
