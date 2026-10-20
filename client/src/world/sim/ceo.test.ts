// Integração da simulação sem DOM: snapshots -> personagens andando, sentando, apagando a luz e indo embora.
// O CEO do próprio escritório (sim/visitor.ts com `at`): senta e levanta nos assentos da sala dele, que nenhum agente
// usa; fala com quem está perto; e os agentes acenam quando ele chega.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { TILE } from '../constants';
import { ceoRect } from '../layout/geometry';
import { Sim } from './sim';
import { canStand, visitorInfo } from './visitor';

const theme: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

const appearance: Appearance = {
  skin: '#f0c8a0',
  hair: '#3a2a20',
  hairStyle: 'short',
  eyes: '#222',
  top: '#3f7fd8',
  topAccent: '#fff',
  topStyle: 'tshirt',
  bottom: '#333',
  shoes: '#111',
  accessory: 'none',
  accessoryColor: '#000',
  lanyard: null,
  look: 'm',
};

const art = {
  appearanceFromSeed: () => appearance,
  roomTheme: () => theme,
} as unknown as ArtModule;

const T0 = 1_700_000_000_000;

function room(id: string, slot: number): RoomInfo {
  return { id, name: id.replace('/', ''), path: id, slot, seed: slot * 99 + 7, createdAt: T0 };
}

function agent(id: string, roomId: string, status: AgentInfo['status'], extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId,
    name: id,
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: '.claude',
    status,
    recent: [],
    tasks: [],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: id.length * 1234567,
    ...extra,
  };
}

function snap(rooms: RoomInfo[], agents: AgentInfo[], rev = 1): OfficeSnapshot {
  return {
    rev,
    serverTime: T0,
    rooms,
    agents,
    accounts: [{ id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' }],
    meta: { demo: true, sources: [], startedAt: T0, version: 't' },
  };
}

/** Avança a simulação em passos de 1/30 s. */
function run(sim: Sim, clock: { now: number }, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    clock.now += 1000 / 30;
    sim.update(1 / 30, clock.now);
    if (until?.()) return;
  }
}

function newSim(): Sim {
  return new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }));
}

/** Escritório com uma sala e o CEO sentado à mesa dele. */
function office(agents: AgentInfo[] = []): { sim: Sim; clock: { now: number } } {
  const sim = newSim();
  const clock = { now: T0 };
  sim.applySnapshot(snap([room('/a', 0)], agents), clock.now);
  const r = ceoRect();
  sim.setVisitor(visitorInfo({ name: 'Eu', look: 'm' }, clock.now), clock.now, { at: { tx: r.x + 7, ty: r.y + 8, dir: 'up' }, badge: 'CEO' });
  sim.visitorSitAtDesk();
  run(sim, clock, 0.2);
  return { sim, clock };
}

describe('CEO', () => {
  it('começa sentado na cadeira da mesa dele', () => {
    const { sim } = office();
    const v = sim.visitor!;
    expect(sim.visitorSeated).toBe(true);
    expect(sim.spots.get(v.atSpot)?.kind).toBe('ceo_seat');
    expect(v.pose).toBe('sit');
  });

  it('o teclado levanta o CEO e ele anda (sai de cima do assento)', () => {
    const { sim, clock } = office();
    const seat = sim.visitor!.atSpot!;
    const seatTy = sim.spots.get(seat)!.ty;
    sim.visitorIntent = { dx: 0, dy: -1, run: false };
    run(sim, clock, 1);
    const v = sim.visitor!;
    expect(sim.visitorSeated).toBe(false);
    expect(sim.spots.isFree(seat)).toBe(true);
    expect(canStand(sim.building.grid, v.x, v.y)).toBe(true);
    expect(v.ty).toBeLessThan(seatTy);
  });

  it('perto de um assento, senta nele andando; sentado, levanta para um tile livre ao lado', () => {
    const { sim, clock } = office();
    expect(sim.visitorStand()).toBe(true);
    const v = sim.visitor!;
    expect(canStand(sim.building.grid, v.x, v.y)).toBe(true);
    const near = sim.visitorSeat();
    expect(near?.kind).toBe('ceo_seat');
    expect(sim.visitorSit(near!.id)).toBe(true);
    run(sim, clock, 3, () => sim.visitorSeated);
    expect(sim.visitorSeated).toBe(true);
    run(sim, clock, 0.1);
    expect(v.pose).toBe('sit');
  });

  it('nenhum agente usa os assentos da sala do CEO', () => {
    const ids = ['ana', 'bia', 'caio', 'duda', 'eva', 'fabi'];
    const { sim, clock } = office(ids.map((id) => agent(id, '/a', 'idle', { statusSince: T0 - 3_600_000, lastEventAt: T0 - 3_600_000 })));
    sim.visitorStand();
    const seats = sim.spots.ofKind('ceo_seat');
    expect(seats.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 20; i++) {
      run(sim, clock, 15);
      for (const s of seats) expect(sim.spots.ownerOf(s.id)).toBeUndefined();
      for (const ch of sim.chars.values()) expect(seats.some((s) => s.id === ch.atSpot)).toBe(false);
    }
  });

  it('perto de um agente: "Falar" com ele, e ele acena (uma vez, não sem parar)', () => {
    const { sim, clock } = office([agent('ana', '/a', 'working')]);
    run(sim, clock, 1);
    const ana = sim.chars.get('ana')!;
    expect(sim.visitorNearAgent()).toBeNull();
    sim.visitorStand();
    const v = sim.visitor!;
    // leva o CEO para o lado da Ana (num tile livre)
    let placed = false;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1]]) {
      const x = (ana.tx + dx) * TILE + TILE / 2;
      const y = (ana.ty + dy) * TILE + 11;
      if (!canStand(sim.building.grid, x, y)) continue;
      v.placeAtTile(ana.tx + dx, ana.ty + dy);
      placed = true;
      break;
    }
    expect(placed).toBe(true);
    expect(sim.visitorNearAgent()).toBe('ana');
    run(sim, clock, 0.5);
    expect(ana.icon).toBe('wave');
    run(sim, clock, 3);
    expect(ana.icon).not.toBe('wave');
    run(sim, clock, 5);
    expect(ana.icon).not.toBe('wave');
  });
});
