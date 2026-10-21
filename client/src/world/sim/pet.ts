// O mascote do CEO (o Billy, por padrão): um cachorro que anda atrás do CEO no próprio escritório. Segue de perto (pelo
// caminho do A* quando está longe), para do lado quando o CEO para, deita ao lado quando ele senta e dorme se a espera
// for longa. Parado, de vez em quando faz alguma coisa sozinho: senta, abana o rabo, coça a orelha, deita. Quando um
// agente acena para o CEO, o mascote vai até ele e abana o rabo (com um coração). Só existe no navegador: não é agente,
// não vai ao servidor nem ao Habblaud World. Regras puras (sem DOM).
import type { Dir, IconName } from '../../art/api';
import type { PetCoat, PetPose } from '../../art/pet/dog';
import { FOOT_DX, FOOT_DY, TILE, WALK_SPEED, RUN_SPEED } from '../constants';
import { BLOCKED, type WalkGrid } from '../path/grid';
import { dirOf } from './character';
import { canStand, tileAt } from './visitor';

export interface PetConfig {
  name: string;
  coat: PetCoat;
}

/** Perto o bastante do dono (tiles): para de andar. */
const NEAR = 1.6;
/** Longe o bastante (tiles): volta a seguir. */
const FOLLOW = 2.4;
/** Corre para alcançar (tiles). */
const RUN_FROM = 4.5;
/** Muito longe ou preso: reaparece ao lado do dono. */
const TELEPORT = 18;
const STUCK_MS = 2500;
/** Refaz o caminho a cada (ms). */
const REPATH_MS = 600;
/** Dono parado e o mascote deitado: dorme depois de (ms). */
const SLEEP_AFTER = 30_000;
const GREET_MS = 1800;

export class Pet {
  name: string;
  coat: PetCoat;
  x = 0;
  y = 0;
  dir: Dir = 'down';
  pose: PetPose = 'stand';
  animT = 0;
  /** Ícone sobre a cabeça (coração ao cumprimentar). */
  icon: IconName | null = null;
  iconUntil = 0;
  iconAt = 0;
  /** Gracinha em andamento até (ms epoch). */
  trickUntil = 0;
  /** Próxima gracinha (ms epoch). */
  nextTrickAt = 0;
  /** Desde quando está deitado ao lado do dono sentado/parado (ms epoch; 0 = não está). */
  restingSince = 0;
  /** Indo cumprimentar alguém: posição do alvo e até quando. */
  greet: { x: number; y: number; until: number; wagging: boolean } | null = null;
  path: number[] = [];
  pathI = 0;
  pathAt = 0;
  pathGoal = -1;
  stuckSince = 0;
  /** Andou há pouco: mantém a pose de andar até aqui (não pisca entre andar e parar). */
  walkUntil = 0;
  private readonly rng: () => number;

  constructor(cfg: PetConfig, rng: () => number = Math.random) {
    this.name = cfg.name;
    this.coat = cfg.coat;
    this.rng = rng;
  }

  setPose(pose: PetPose): void {
    if (this.pose !== pose) {
      this.pose = pose;
      this.animT = 0;
    }
  }

  setIcon(icon: IconName | null, ms: number, now: number): void {
    this.icon = icon;
    this.iconAt = now;
    this.iconUntil = icon ? now + ms : 0;
  }

  /** Um número de 0 a 1 (para as gracinhas). */
  roll(): number {
    return this.rng();
  }
}

/** O dono (o CEO), como o mascote o vê. */
export interface PetOwner {
  x: number;
  y: number;
  dir: Dir;
  seated: boolean;
  moving: boolean;
}

export interface PetWorld {
  grid: WalkGrid;
  /** Caminho de tiles (x0, y0, x1, y1, ...) do tile (sx, sy) ao (gx, gy). */
  path(sx: number, sy: number, gx: number, gy: number, out: number[]): boolean;
}

/** Um tile onde o mascote cabe perto de (x, y) (px de mundo), do mais perto ao mais longe; null se nenhum. */
export function spotNear(grid: WalkGrid, x: number, y: number, prefer?: Dir): { x: number; y: number } | null {
  const t = tileAt(x, y);
  const order: [number, number][] = [];
  const back: Record<Dir, [number, number]> = { down: [0, -1], up: [0, 1], left: [1, 0], right: [-1, 0] };
  if (prefer) {
    const [bx, by] = back[prefer];
    order.push([by, bx], [-by, -bx], [bx, by]);
  }
  for (let r = 1; r <= 3; r++)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) order.push([dx, dy]);
  for (const [dx, dy] of order) {
    const px = (t.x + dx) * TILE + FOOT_DX;
    const py = (t.y + dy) * TILE + FOOT_DY;
    if (grid.get(t.x + dx, t.y + dy) !== BLOCKED && canStand(grid, px, py)) return { x: px, y: py };
  }
  return null;
}

/** Põe o mascote ao lado do dono (ao aparecer, ao se perder). */
export function placePet(pet: Pet, owner: PetOwner, grid: WalkGrid): void {
  const s = spotNear(grid, owner.x, owner.y, owner.dir) ?? { x: owner.x + TILE, y: owner.y };
  pet.x = s.x;
  pet.y = s.y;
  pet.dir = dirOf(owner.x - pet.x, owner.y - pet.y, 'down');
  pet.path.length = 0;
  pet.pathGoal = -1;
  pet.stuckSince = 0;
  pet.setPose(owner.seated ? 'lie' : 'sit');
}

/** Agente acenou para o dono: o mascote vai até ele abanar o rabo. */
export function petGreet(pet: Pet, at: { x: number; y: number }, now: number): void {
  if (pet.greet) return;
  pet.greet = { x: at.x, y: at.y, until: now + 6000, wagging: false };
  pet.restingSince = 0;
  pet.trickUntil = 0;
}

/** Carinho (clique no mascote): abana o rabo com um coração. */
export function petPat(pet: Pet, now: number): void {
  pet.greet = null;
  pet.restingSince = 0;
  pet.trickUntil = now + GREET_MS;
  pet.setPose('wag');
  pet.setIcon('heart', GREET_MS, now);
}

/** Anda `dist` px em direção a (gx, gy). Devolve se chegou. */
function moveToward(pet: Pet, gx: number, gy: number, dist: number): boolean {
  const dx = gx - pet.x;
  const dy = gy - pet.y;
  const d = Math.hypot(dx, dy);
  if (d <= dist || d < 0.01) {
    pet.x = gx;
    pet.y = gy;
    return true;
  }
  pet.x += (dx / d) * dist;
  pet.y += (dy / d) * dist;
  pet.dir = dirOf(dx, dy, pet.dir);
  return false;
}

/** Segue o caminho do A* até o tile (gx, gy); o último trecho vai direto ao ponto (px, py). */
function walkTo(pet: Pet, w: PetWorld, px: number, py: number, speed: number, dt: number, now: number): void {
  const t = tileAt(px, py);
  const goal = t.y * 100_000 + t.x;
  if (goal !== pet.pathGoal || now - pet.pathAt > REPATH_MS) {
    const from = tileAt(pet.x, pet.y);
    pet.path.length = 0;
    pet.pathI = 0;
    pet.pathAt = now;
    pet.pathGoal = goal;
    if (!w.path(from.x, from.y, t.x, t.y, pet.path)) pet.path.length = 0;
  }
  let left = speed * dt;
  while (left > 0) {
    let gx: number;
    let gy: number;
    if (pet.pathI + 1 < pet.path.length - 2) {
      gx = pet.path[pet.pathI] * TILE + FOOT_DX;
      gy = pet.path[pet.pathI + 1] * TILE + FOOT_DY;
    } else {
      gx = px;
      gy = py;
    }
    const before = Math.hypot(gx - pet.x, gy - pet.y);
    const arrived = moveToward(pet, gx, gy, left);
    left -= Math.min(left, before);
    if (!arrived) break;
    if (gx === px && gy === py) break;
    pet.pathI += 2;
  }
}

/** Um quadro do mascote. */
export function updatePet(pet: Pet, owner: PetOwner, w: PetWorld, dt: number, now: number): void {
  pet.animT += dt * 1000;
  if (pet.icon && now >= pet.iconUntil) pet.icon = null;
  const dOwner = Math.hypot(owner.x - pet.x, owner.y - pet.y) / TILE;
  if (dOwner > TELEPORT) {
    placePet(pet, owner, w.grid);
    return;
  }

  // cumprimentando um agente
  const g = pet.greet;
  if (g) {
    if (now > g.until || dOwner > RUN_FROM + 2) pet.greet = null;
    else {
      const d = Math.hypot(g.x - pet.x, g.y - pet.y) / TILE;
      const s = spotNear(w.grid, g.x, g.y) ?? g;
      if (!g.wagging && d > 1.5 && Math.hypot(s.x - pet.x, s.y - pet.y) >= 1) {
        walkTo(pet, w, s.x, s.y, WALK_SPEED * 1.15, dt, now);
        pet.setPose('walk');
        return;
      }
      if (!g.wagging) {
        g.wagging = true;
        g.until = now + GREET_MS;
        pet.dir = dirOf(g.x - pet.x, g.y - pet.y, pet.dir);
        pet.setIcon('heart', GREET_MS, now);
      }
      pet.setPose('wag');
      return;
    }
  }

  // seguindo o dono
  const moving = pet.pose === 'walk' || pet.pose === 'run';
  // o dono andando: acompanha já (sem parar e arrancar); parado: só sai do lugar se ficou longe
  if (dOwner > FOLLOW || ((moving || owner.moving) && dOwner > NEAR)) {
    pet.restingSince = 0;
    pet.trickUntil = 0;
    const run = dOwner > RUN_FROM;
    const target = spotNear(w.grid, owner.x, owner.y, owner.dir) ?? owner;
    const bx = pet.x;
    const by = pet.y;
    walkTo(pet, w, target.x, target.y, run ? RUN_SPEED : WALK_SPEED * 1.1, dt, now);
    const stepped = Math.hypot(pet.x - bx, pet.y - by) > 0.01;
    if (stepped) pet.walkUntil = now + 250;
    if (Math.hypot(target.x - pet.x, target.y - pet.y) < 1) {
      // chegou ao lado do dono
      pet.setPose(now < pet.walkUntil ? pet.pose : 'stand');
      pet.dir = dirOf(owner.x - pet.x, owner.y - pet.y, pet.dir);
      pet.nextTrickAt = now + 2500 + pet.roll() * 3000;
      return;
    }
    if (!stepped) {
      if (!pet.stuckSince) pet.stuckSince = now;
      else if (now - pet.stuckSince > STUCK_MS) placePet(pet, owner, w.grid);
    } else pet.stuckSince = 0;
    pet.setPose(run ? 'run' : 'walk');
    return;
  }
  pet.stuckSince = 0;
  // acabou de chegar: termina o passo antes de parar
  if (moving && now < pet.walkUntil) return;

  // perto do dono (o carinho termina antes)
  if (pet.pose === 'wag' && now < pet.trickUntil) return;
  if (owner.seated) {
    // deita ao lado e, depois de um tempo, dorme
    if (!pet.restingSince) pet.restingSince = now;
    pet.trickUntil = 0;
    pet.setPose(now - pet.restingSince > SLEEP_AFTER ? 'sleep' : 'lie');
    return;
  }
  if (moving) {
    pet.setPose('stand');
    pet.dir = dirOf(owner.x - pet.x, owner.y - pet.y, pet.dir);
    pet.nextTrickAt = now + 2500 + pet.roll() * 3000;
  }
  if (owner.moving) {
    // o dono anda por perto: fica de pé olhando para ele, sem gracinha
    pet.trickUntil = 0;
    pet.restingSince = 0;
    if (now < pet.walkUntil) return;
    pet.setPose('stand');
    pet.dir = dirOf(owner.x - pet.x, owner.y - pet.y, pet.dir);
    pet.nextTrickAt = now + 2500 + pet.roll() * 3000;
    return;
  }
  if (now < pet.trickUntil) return;
  if (pet.pose === 'lie' || pet.pose === 'sleep') {
    // deitado ao lado do dono parado: fica, e dorme se demorar
    if (!pet.restingSince) pet.restingSince = now;
    pet.setPose(now - pet.restingSince > SLEEP_AFTER ? 'sleep' : 'lie');
    return;
  }
  if (now >= pet.nextTrickAt) {
    const r = pet.roll();
    const [pose, ms]: [PetPose, number] =
      r < 0.35 ? ['sit', 5000 + pet.roll() * 6000] : r < 0.55 ? ['wag', 1600] : r < 0.7 ? ['scratch', 1300] : r < 0.85 ? ['lie', 1e9] : ['stand', 2500];
    pet.setPose(pose);
    pet.trickUntil = now + ms;
    pet.nextTrickAt = now + ms + 2000 + pet.roll() * 5000;
    if (pose === 'lie') pet.restingSince = now;
    else pet.dir = dirOf(owner.x - pet.x, owner.y - pet.y, pet.dir);
    return;
  }
  pet.setPose(pet.pose === 'sit' ? 'sit' : 'stand');
}
