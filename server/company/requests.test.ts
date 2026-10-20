import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ceoMessage, createAsCeo, orderRequests, parseCeoReply, parseCeoRequest, parseRequest, readCompanyRequests, replyAsCeo, type CompanyRequest } from './requests';

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

describe('o CEO pelo painel', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'empresa-'));
    dirs.push(d);
    mkdirSync(join(d, 'pedidos'));
    return d;
  };

  it('valida resposta e pedido novo', () => {
    expect(parseCeoReply({ text: ' ok ', status: 'feito' })).toEqual({ text: 'ok', status: 'feito' });
    expect(() => parseCeoReply({ text: '' })).toThrow();
    expect(() => parseCeoReply({ text: 'x', status: 'talvez' })).toThrow();
    expect(parseCeoRequest({ to: 'marketing', title: 'Post', text: '' })).toEqual({ to: 'marketing', title: 'Post', text: 'Post' });
    expect(() => parseCeoRequest({ to: 'ceo', title: 'x' })).toThrow();
    expect(() => parseCeoRequest({ to: 'marketing', title: ' ' })).toThrow();
  });

  it('aprovar um pedido feito ao CEO: grava no histórico, muda o status e avisa quem pediu', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'pedidos', 'a.json'), JSON.stringify(raw({ id: 'a', de: 'produto-design', para: 'ceo', historico: [] })));
    const out = await replyAsCeo(dir, 'a', { text: 'Aprovado', status: 'feito' }, new Date('2026-10-21T10:00:00Z'));
    expect(out.notify).toBe('produto-design');
    expect(out.request.status).toBe('feito');
    const saved = JSON.parse(readFileSync(join(dir, 'pedidos', 'a.json'), 'utf8'));
    expect(saved.historico).toEqual([{ at: '2026-10-21T10:00:00.000Z', setor: 'ceo', texto: 'Aprovado', status: 'feito' }]);
    await expect(replyAsCeo(dir, 'nao-existe', { text: 'x' })).rejects.toThrow();
    await expect(replyAsCeo(dir, '../x', { text: 'x' })).rejects.toThrow();
  });

  it('pedido novo do CEO vira arquivo que a ferramenta lê', async () => {
    const dir = tmp();
    const r = await createAsCeo(dir, { to: 'marketing', title: 'App novo: X', text: 'ideia' });
    expect(r).toMatchObject({ from: 'ceo', to: 'marketing', status: 'aberto', title: 'App novo: X' });
    expect((await readCompanyRequests(dir)).requests.map((x) => x.id)).toEqual([r.id]);
    expect(ceoMessage('new', r, r.text)).toContain(`responder ${r.id}`);
  });
});
