// O mascote do CEO (sim/pet.ts): aparece ao lado dele, segue quando ele anda, deita quando ele senta, dorme na espera
// longa e vai cumprimentar quem acena.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS } from '../api';
import { TILE } from '../constants';
import { ceoRect } from '../layout/geometry';
import { Sim } from './sim';
import { petGreet, petPat } from './pet';
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

describe('mascote do CEO', () => {
  it('aparece ao lado do CEO sentado, deitado, num lugar livre', () => {
    const { sim } = office();
    const pet = sim.setPet({ name: 'Billy', coat: 'caramel' })!;
    const v = sim.visitor!;
    expect(pet.name).toBe('Billy');
    expect(canStand(sim.building.grid, pet.x, pet.y)).toBe(true);
    expect(Math.hypot(pet.x - v.x, pet.y - v.y) / TILE).toBeLessThan(2.5);
    expect(pet.pose).toBe('lie');
  });

  it('segue o CEO quando ele anda e para do lado dele', () => {
    const { sim, clock } = office();
    const pet = sim.setPet({ name: 'Billy', coat: 'caramel' })!;
    const v = sim.visitor!;
    let walked = false;
    for (let i = 0; i < 180; i++) {
      sim.visitorIntent = i < 45 ? { dx: 0, dy: -1, run: false } : i < 90 ? { dx: -1, dy: 0, run: false } : { dx: 0, dy: 0, run: false };
      run(sim, clock, 1 / 30);
      if (pet.pose === 'walk' || pet.pose === 'run') walked = true;
    }
    expect(walked).toBe(true);
    expect(Math.hypot(pet.x - v.x, pet.y - v.y) / TILE).toBeLessThan(2.5);
    expect(pet.pose).not.toBe('walk');
  });

  it('com o CEO sentado, deita e depois de um tempo dorme', () => {
    const { sim, clock } = office();
    const pet = sim.setPet({ name: 'Billy', coat: 'caramel' })!;
    run(sim, clock, 2);
    expect(pet.pose).toBe('lie');
    run(sim, clock, 31);
    expect(pet.pose).toBe('sleep');
  });

  it('vai cumprimentar quem acena e abana o rabo com um coração', () => {
    const { sim, clock } = office();
    const pet = sim.setPet({ name: 'Billy', coat: 'caramel' })!;
    const v = sim.visitor!;
    sim.visitorStand();
    run(sim, clock, 1);
    // alguém a uns 3 tiles, num lugar onde se pode ficar
    const at = [...Array(9 * 9).keys()].map((i) => ({ x: v.x + ((i % 9) - 4) * TILE, y: v.y + (Math.floor(i / 9) - 4) * TILE })).find((p) => Math.hypot(p.x - v.x, p.y - v.y) / TILE >= 3 && canStand(sim.building.grid, p.x, p.y))!;
    petGreet(pet, at, clock.now);
    run(sim, clock, 3, () => pet.pose === 'wag');
    expect(pet.pose).toBe('wag');
    expect(pet.icon).toBe('heart');
    run(sim, clock, 3);
    expect(pet.greet).toBeNull();
  });

  it('o carinho (clique) faz abanar o rabo; trocar o nome mantém o lugar; null tira', () => {
    const { sim, clock } = office();
    const pet = sim.setPet({ name: 'Billy', coat: 'caramel' })!;
    petPat(pet, clock.now);
    run(sim, clock, 0.5);
    expect(pet.pose).toBe('wag');
    const at = { x: pet.x, y: pet.y };
    const same = sim.setPet({ name: 'Rex', coat: 'black' })!;
    expect(same).toBe(pet);
    expect({ x: same.x, y: same.y }).toEqual(at);
    expect(same.coat).toBe('black');
    expect(sim.setPet(null)).toBeNull();
    expect(sim.pet).toBeNull();
  });
});
