import { describe, expect, it } from 'vitest';
import { isOpen, parseRequests, sectorName } from './requests';

describe('pedidos entre setores (página)', () => {
  it('valida a resposta da API', () => {
    const ok = { id: 'a', from: 'marketing', to: 'desenvolvimento', title: 't', text: 'x', status: 'aberto', createdAt: 1, updatedAt: 1, history: [] };
    const r = parseRequests({ sectors: { marketing: 'Marketing', ruim: 3 }, requests: [ok, { ...ok, status: 'talvez' }, null] });
    expect(r.sectors).toEqual({ marketing: 'Marketing' });
    expect(r.requests.map((x) => x.id)).toEqual(['a']);
    expect(parseRequests(null)).toEqual({ sectors: {}, requests: [] });
  });

  it('nome do setor e abertos', () => {
    expect(sectorName({ marketing: 'Marketing' }, 'marketing')).toBe('Marketing');
    expect(sectorName({}, 'comercial-suporte')).toBe('Comercial suporte');
    expect(isOpen({ status: 'andamento' })).toBe(true);
    expect(isOpen({ status: 'feito' })).toBe(false);
  });
});

describe('envelopes nas salas', () => {
  it('conta os abertos na sala do setor de destino e os do CEO na sala dele', async () => {
    const { roomBadges, CEO_ROOM } = await import('./requests');
    const base = { from: 'x', title: 't', text: '', createdAt: 1, updatedAt: 1, history: [] };
    const reqs = [
      { ...base, id: '1', to: 'marketing', status: 'aberto' as const },
      { ...base, id: '2', to: 'marketing', status: 'andamento' as const },
      { ...base, id: '3', to: 'marketing', status: 'feito' as const },
      { ...base, id: '4', to: 'ceo', status: 'aberto' as const },
      { ...base, id: '5', to: 'desenvolvimento', status: 'aberto' as const },
    ];
    const rooms = [{ id: 'C:\empresa\marketing', sector: 'marketing' }, { id: '/outro' }];
    expect([...roomBadges(reqs, rooms)]).toEqual([
      ['C:\empresa\marketing', 2],
      [CEO_ROOM, 1],
    ]);
  });
});

describe('painel do CEO', () => {
  it('estado de cada setor pelo escritório', async () => {
    const { sectorLive, sectorState } = await import('./ceo-dashboard');
    const stats = (n: number) => ({ toolCalls: 0, tokensIn: n, tokensOut: n, subagents: 0 });
    const snap = {
      rooms: [{ id: 'R1', sector: 'marketing' }, { id: 'R2' }],
      agents: [
        { name: 'Glória', kind: 'main', roomId: 'R1', status: 'idle', stats: stats(10) },
        { name: 'Sub', kind: 'sub', roomId: 'R1', status: 'working', stats: stats(5) },
        { name: 'Outro', kind: 'main', roomId: 'R2', status: 'working', stats: stats(1) },
      ],
    } as never;
    const live = sectorLive(snap);
    expect(live.get('marketing')).toEqual({ agents: [{ name: 'Glória', status: 'idle' }], tokens: 30 });
    expect(sectorState(live.get('marketing'))).toBe('idle');
    expect(sectorState(undefined)).toBe('closed');
    expect(sectorState({ agents: [{ name: 'a', status: 'working' }, { name: 'b', status: 'waiting' }], tokens: 0 })).toBe('waiting');
  });
});
