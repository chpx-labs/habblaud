import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ceoMessage, createAsCeo, orderRequests, parseCeoReply, parseCeoRequest, parseRequest, readCompanyRequests, replyAsCeo, type CompanyRequest } from './requests';

const raw = (over: Record<string, unknown> = {}) => ({
  id: '20261020-2017-abc',
  from: 'marketing',
  to: 'development',
  title: 'Botão novo',
  text: 'Preciso de um botão',
  status: 'open',
  created: '2026-10-20T20:17:00.000Z',
  updated: '2026-10-20T20:17:00.000Z',
  history: [{ at: '2026-10-20T20:20:00.000Z', sector: 'development', text: 'ok', status: 'in_progress' }],
  ...over,
});

describe('pedidos entre setores', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('lê o pedido da ferramenta e recusa o que não tem formato', () => {
    const r = parseRequest(raw());
    expect(r).toMatchObject({ id: '20261020-2017-abc', from: 'marketing', to: 'development', status: 'open', title: 'Botão novo' });
    expect(r?.history[0]).toEqual({ at: Date.parse('2026-10-20T20:20:00.000Z'), sector: 'development', text: 'ok', status: 'in_progress' });
    expect(parseRequest(raw({ status: 'talvez' }))).toBeNull();
    expect(parseRequest(raw({ id: '../x' }))).toBeNull();
    expect(parseRequest(raw({ from: 'Mar keting' }))).toBeNull();
    expect(parseRequest(null)).toBeNull();
  });

  it('abertos primeiro (mais antigos no topo), depois fechados mais recentes', () => {
    const mk = (id: string, status: CompanyRequest['status'], t: number) => parseRequest(raw({ id, status, created: new Date(t).toISOString(), updated: new Date(t).toISOString() }))!;
    const list = orderRequests([mk('a', 'done', 1), mk('b', 'open', 5), mk('c', 'in_progress', 2), mk('d', 'declined', 9)]);
    expect(list.map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('lê a pasta: pedidos, nomes dos setores e ignora arquivo estragado', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'company-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'requests'));
    writeFileSync(join(dir, 'requests', 'a.json'), JSON.stringify(raw()));
    writeFileSync(join(dir, 'requests', 'b.json'), '{estragado');
    writeFileSync(join(dir, 'sectors.json'), JSON.stringify({ marketing: 'Marketing', 'Ruim!': 'x' }));
    const r = await readCompanyRequests(dir);
    expect(r.sectors).toEqual({ marketing: 'Marketing' });
    expect(r.requests.map((x) => x.id)).toEqual(['20261020-2017-abc']);
    expect(await readCompanyRequests(join(dir, 'nao-existe'))).toEqual({ sectors: {}, requests: [] });
  });
});

describe('o CEO pelo painel', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'company-'));
    dirs.push(d);
    mkdirSync(join(d, 'requests'));
    return d;
  };

  it('valida resposta e pedido novo', () => {
    expect(parseCeoReply({ text: ' ok ', status: 'done' })).toEqual({ text: 'ok', status: 'done' });
    expect(() => parseCeoReply({ text: '' })).toThrow();
    expect(() => parseCeoReply({ text: 'x', status: 'talvez' })).toThrow();
    expect(parseCeoRequest({ to: 'marketing', title: 'Post', text: '' })).toEqual({ to: 'marketing', title: 'Post', text: 'Post' });
    expect(() => parseCeoRequest({ to: 'ceo', title: 'x' })).toThrow();
    expect(() => parseCeoRequest({ to: 'marketing', title: ' ' })).toThrow();
  });

  it('aprovar um pedido feito ao CEO: grava no histórico, muda o status e avisa quem pediu', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'requests', 'a.json'), JSON.stringify(raw({ id: 'a', from: 'product-design', to: 'ceo', history: [] })));
    const out = await replyAsCeo(dir, 'a', { text: 'Aprovado', status: 'done' }, new Date('2026-10-21T10:00:00Z'));
    expect(out.notify).toBe('product-design');
    expect(out.request.status).toBe('done');
    const saved = JSON.parse(readFileSync(join(dir, 'requests', 'a.json'), 'utf8'));
    expect(saved.history).toEqual([{ at: '2026-10-21T10:00:00.000Z', sector: 'ceo', text: 'Aprovado', status: 'done' }]);
    await expect(replyAsCeo(dir, 'nao-existe', { text: 'x' })).rejects.toThrow();
    await expect(replyAsCeo(dir, '../x', { text: 'x' })).rejects.toThrow();
  });

  it('pedido novo do CEO vira arquivo que a ferramenta lê', async () => {
    const dir = tmp();
    const r = await createAsCeo(dir, { to: 'marketing', title: 'App novo: X', text: 'ideia' });
    expect(r).toMatchObject({ from: 'ceo', to: 'marketing', status: 'open', title: 'App novo: X' });
    expect((await readCompanyRequests(dir)).requests.map((x) => x.id)).toEqual([r.id]);
    expect(ceoMessage('new', r, r.text)).toContain(`reply ${r.id}`);
  });
});
