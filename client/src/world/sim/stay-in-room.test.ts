import { describe, expect, it } from 'vitest';
import { isLongIdle, LONG_IDLE_MS, longIdleMs, mayLeaveRoom, STAY_IN_ROOM_MS } from './behavior';

const MIN = 60_000;

describe('ociosos ficam na sala', () => {
  it('sem a trava, sai sempre', () => {
    expect(mayLeaveRoom('idle', 0, 1_000, false)).toBe(true);
    expect(mayLeaveRoom('working', 0, 1_000, undefined)).toBe(true);
  });

  it('com a trava, só depois de 15 min sem atividade', () => {
    expect(STAY_IN_ROOM_MS).toBe(15 * MIN);
    expect(mayLeaveRoom('idle', 0, 14 * MIN, true)).toBe(false);
    expect(mayLeaveRoom('idle', 0, 15 * MIN, true)).toBe(true);
    expect(mayLeaveRoom('done', 0, 20 * MIN, true)).toBe(true);
  });

  it('com a trava, quem trabalha, espera você ou espera um comando nunca sai', () => {
    for (const s of ['working', 'waiting', 'shell'] as const) expect(mayLeaveRoom(s, 0, 60 * MIN, true)).toBe(false);
  });

  it('com a trava, o cochilo vem 10 min depois de poder sair', () => {
    expect(longIdleMs(false)).toBe(LONG_IDLE_MS);
    expect(longIdleMs(true)).toBe(25 * MIN);
    expect(isLongIdle('idle', 0, 20 * MIN, longIdleMs(true))).toBe(false);
    expect(isLongIdle('idle', 0, 26 * MIN, longIdleMs(true))).toBe(true);
    expect(isLongIdle('idle', 0, 11 * MIN)).toBe(true);
  });
});
