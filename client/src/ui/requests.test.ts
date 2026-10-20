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
