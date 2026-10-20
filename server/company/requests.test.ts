import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { orderRequests, parseRequest, readCompanyRequests, type CompanyRequest } from './requests';

const raw = (over: Record<string, unknown> = {}) => ({
  id: '20261020-2017-abc',
  de: 'marketing',
  para: 'desenvolvimento',
  titulo: 'Botão novo',
  texto: 'Preciso de um botão',
  status: 'aberto',
  criado: '2026-10-20T20:17:00.000Z',
  atualizado: '2026-10-20T20:17:00.000Z',
  historico: [{ at: '2026-10-20T20:20:00.000Z', setor: 'desenvolvimento', texto: 'ok', status: 'andamento' }],
  ...over,
});

describe('pedidos entre setores', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('lê o pedido da ferramenta e recusa o que não tem formato', () => {
    const r = parseRequest(raw());
    expect(r).toMatchObject({ id: '20261020-2017-abc', from: 'marketing', to: 'desenvolvimento', status: 'aberto', title: 'Botão novo' });
    expect(r?.history[0]).toEqual({ at: Date.parse('2026-10-20T20:20:00.000Z'), sector: 'desenvolvimento', text: 'ok', status: 'andamento' });
    expect(parseRequest(raw({ status: 'talvez' }))).toBeNull();
    expect(parseRequest(raw({ id: '../x' }))).toBeNull();
    expect(parseRequest(raw({ de: 'Mar keting' }))).toBeNull();
    expect(parseRequest(null)).toBeNull();
  });

  it('abertos primeiro (mais antigos no topo), depois fechados mais recentes', () => {
    const mk = (id: string, status: CompanyRequest['status'], t: number) => parseRequest(raw({ id, status, criado: new Date(t).toISOString(), atualizado: new Date(t).toISOString() }))!;
    const list = orderRequests([mk('a', 'feito', 1), mk('b', 'aberto', 5), mk('c', 'andamento', 2), mk('d', 'recusado', 9)]);
    expect(list.map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('lê a pasta: pedidos, nomes dos setores e ignora arquivo estragado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'empresa-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'pedidos'));
    writeFileSync(join(dir, 'pedidos', 'a.json'), JSON.stringify(raw()));
    writeFileSync(join(dir, 'pedidos', 'b.json'), '{estragado');
    writeFileSync(join(dir, 'setores.json'), JSON.stringify({ marketing: 'Marketing', 'Ruim!': 'x' }));
    const r = await readCompanyRequests(dir);
    expect(r.sectors).toEqual({ marketing: 'Marketing' });
    expect(r.requests.map((x) => x.id)).toEqual(['20261020-2017-abc']);
    expect(await readCompanyRequests(join(dir, 'nao-existe'))).toEqual({ sectors: {}, requests: [] });
  });
});
