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
