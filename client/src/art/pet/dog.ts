// O mascote do CEO: um cachorro chibi em pixel art procedural (puro: desenha num PixelBuf, como os personagens).
// Folha de 23x18 px com âncora (12, 17) no chão, entre as patas. De lado o desenho olha para a direita; a esquerda é o
// espelho. Cabeça grande, corpo pequeno, orelhas caídas, coleira vermelha com plaquinha.
import type { Dir } from '../api';
import { ramp } from '../core/color';
import { PixelBuf } from '../core/pixbuf';
import type { BufSprite } from '../core/sprite';

export type PetPose = 'stand' | 'walk' | 'run' | 'sit' | 'lie' | 'sleep' | 'wag' | 'scratch';
export type PetCoat = 'caramel' | 'chocolate' | 'black' | 'white';

export const PET_COATS: readonly PetCoat[] = ['caramel', 'chocolate', 'black', 'white'];

export interface PetFrameRequest {
  coat: PetCoat;
  dir: Dir;
  pose: PetPose;
  frame: number;
}

export const PET_W = 23;
export const PET_H = 18;
export const PET_AX = 12;
export const PET_AY = 17;

export const PET_FRAMES: Readonly<Record<PetPose, number>> = { stand: 2, walk: 4, run: 4, sit: 2, lie: 2, sleep: 2, wag: 2, scratch: 2 };
export const PET_DURATION: Readonly<Record<PetPose, number>> = { stand: 700, walk: 130, run: 90, sit: 650, lie: 1100, sleep: 1400, wag: 120, scratch: 110 };

interface DogPal {
  B: string; // pelo
  D: string; // sombra do pelo, orelhas
  L: string; // focinho, peito, patas
  H: string; // brilho do pelo
  N: string; // nariz
  E: string; // olho
  C: string; // coleira
  G: string; // plaquinha
  T: string; // língua
}

const COAT: Readonly<Record<PetCoat, { base: string; light: string; ears?: string }>> = {
  caramel: { base: '#c98a3c', light: '#f3dcae' },
  chocolate: { base: '#7a4b2c', light: '#c99a72' },
  black: { base: '#3b3742', light: '#d8cfc4' },
  white: { base: '#efe9df', light: '#ffffff', ears: '#d2a46c' },
};

export function isPetCoat(v: unknown): v is PetCoat {
  return typeof v === 'string' && (PET_COATS as readonly string[]).includes(v);
}

function paletteOf(coat: PetCoat): DogPal {
  const c = COAT[coat] ?? COAT.caramel;
  const r = ramp(c.base, 0.1);
  return {
    B: r.base,
    D: c.ears ?? r.dk,
    L: c.light,
    H: r.lt,
    N: '#1d1826',
    E: coat === 'black' ? '#0c0910' : '#1d1826',
    C: '#d8434b',
    G: '#f5c84a',
    T: '#ef7c8e',
  };
}

/** Retângulo com os cantos arredondados (tira 1px de cada canto). */
function round(b: PixelBuf, x: number, y: number, w: number, h: number, c: string): void {
  b.rect(x + 1, y, w - 2, h, c);
  b.rect(x, y + 1, w, h - 2, c);
}

// ------------------------------------------------------------------ de lado (olhando para a direita)

function side(b: PixelBuf, p: DogPal, pose: PetPose, f: number): void {
  if (pose === 'lie' || pose === 'sleep') return sideLying(b, p, pose, f);
  if (pose === 'sit' || pose === 'scratch') return sideSitting(b, p, pose, f);
  const moving = pose === 'walk' || pose === 'run';
  const bob = moving && (f === 1 || f === 3) ? -1 : 0;
  const sw = moving ? [1, 0, -1, 0][f] * (pose === 'run' ? 2 : 1) : 0;
  // patas do lado de lá (mais escuras), depois as de cá
  const leg = (x: number, c: string, lift: number) => {
    b.rect(x, 12 + bob, 2, 3 - lift, c);
    b.rect(x, 14 - lift, 2, 1, lift ? c : p.L);
  };
  leg(6 - sw, p.D, 0);
  leg(12 + sw, p.D, 0);
  // rabo: sobe e balança (abanando: rápido)
  const wag = pose === 'wag' || pose === 'stand' ? f : 0;
  const tail = wag ? [[4, 8], [3, 7], [3, 6], [3, 5]] : [[4, 8], [3, 7], [2, 6], [1, 5]];
  for (const [x, y] of tail) b.set(x, y + bob, p.B);
  b.set(tail[3][0], tail[3][1] + bob, p.H);
  // corpo
  round(b, 4, 8 + bob, 10, 5, p.B);
  b.hline(6, 11, 12 + bob, p.L);
  b.hline(6, 11, 8 + bob, p.H);
  leg(5 + sw, p.B, moving && f === 3 ? 1 : 0);
  leg(11 - sw, p.B, moving && f === 1 ? 1 : 0);
  // cabeça
  const hy = 2 + bob;
  round(b, 11, hy, 7, 7, p.B);
  b.hline(12, 16, hy, p.H);
  // focinho e nariz
  b.rect(16, hy + 4, 3, 3, p.L);
  b.set(18, hy + 3, p.L);
  b.set(19, hy + 4, p.N);
  b.set(18, hy + 4, p.N);
  b.set(17, hy + 6, p.D);
  if (pose === 'wag' || pose === 'run') {
    b.set(17, hy + 7, p.T);
    b.set(18, hy + 7, p.T);
  }
  // olho e orelha caída
  b.set(15, hy + 3, p.E);
  b.rect(11, hy + 1, 3, 5, p.D);
  b.set(12, hy, p.D);
  // coleira
  b.vline(12, hy + 6, hy + 8, p.C);
  b.vline(13, hy + 6, hy + 8, p.C);
  b.set(14, hy + 8, p.G);
}

function sideSitting(b: PixelBuf, p: DogPal, pose: PetPose, f: number): void {
  // rabo no chão, balançando a ponta
  b.hline(1, 4, 14, p.B);
  b.set(1, 13 - (pose === 'sit' ? f : 0), p.H);
  // traseiro (coxa) e corpo inclinado
  round(b, 3, 9, 8, 6, p.B);
  round(b, 7, 6, 6, 8, p.B);
  b.rect(9, 8, 3, 5, p.L);
  b.hline(5, 8, 14, p.L);
  // patas da frente retas
  b.rect(10, 11, 2, 4, p.B);
  b.rect(10, 14, 2, 1, p.L);
  // coçando: a pata de trás sobe até a orelha
  const scratch = pose === 'scratch';
  if (scratch) {
    const y = f ? 5 : 6;
    b.rect(5, y, 2, 4, p.D);
    b.set(6, y - 1, p.L);
  }
  // cabeça (inclinada quando coça)
  const hy = scratch ? 1 + f : 0;
  round(b, 10, hy, 7, 7, p.B);
  b.hline(11, 15, hy, p.H);
  b.rect(15, hy + 4, 3, 3, p.L);
  b.set(17, hy + 3, p.L);
  b.set(18, hy + 4, p.N);
  b.set(17, hy + 4, p.N);
  b.set(16, hy + 6, p.D);
  if (scratch) b.hline(13, 14, hy + 3, p.E);
  else b.set(14, hy + 3, p.E);
  b.rect(10, hy + 1, 3, 5, p.D);
  b.set(11, hy, p.D);
  b.vline(11, hy + 6, hy + 7, p.C);
  b.vline(12, hy + 6, hy + 7, p.C);
  b.set(13, hy + 8, p.G);
}

function sideLying(b: PixelBuf, p: DogPal, pose: PetPose, f: number): void {
  const breath = f === 1 ? 1 : 0;
  b.hline(0, 3, 14, p.B);
  b.set(0, 13, p.H);
  round(b, 2, 10 + breath, 11, 5 - breath, p.B);
  b.hline(4, 10, 10 + breath, p.H);
  // patas da frente esticadas
  b.rect(12, 13, 6, 2, p.B);
  b.rect(16, 13, 2, 2, p.L);
  b.set(14, 14, p.L);
  // cabeça apoiada nas patas
  const hy = 7;
  round(b, 11, hy, 7, 6, p.B);
  b.hline(12, 16, hy, p.H);
  b.rect(16, hy + 3, 3, 3, p.L);
  b.set(18, hy + 3, p.N);
  b.set(17, hy + 3, p.N);
  if (pose === 'sleep') b.hline(14, 15, hy + 3, p.D);
  else b.set(15, hy + 2, p.E);
  b.rect(11, hy + 1, 3, 4, p.D);
  b.set(12, hy, p.D);
  b.set(12, hy + 5, p.C);
  b.set(13, hy + 5, p.C);
}

// ------------------------------------------------------------------ de frente

function front(b: PixelBuf, p: DogPal, pose: PetPose, f: number): void {
  const lying = pose === 'lie' || pose === 'sleep';
  const sitting = pose === 'sit' || pose === 'scratch';
  const moving = pose === 'walk' || pose === 'run';
  const bob = moving && (f === 1 || f === 3) ? -1 : 0;
  if (lying) {
    // só a cabeça sobre as patas, o corpo atrás
    const breath = f === 1 ? 1 : 0;
    round(b, 5, 10 + breath, 12, 5 - breath, p.B);
    b.rect(6, 14, 3, 1, p.L);
    b.rect(14, 14, 3, 1, p.L);
  } else {
    if (pose === 'wag') {
      // o rabo aparece de um lado e do outro, atrás do corpo
      b.rect(f ? 15 : 6, 7, 2, 3, p.B);
    }
    if (sitting) {
      round(b, 6, 10, 11, 5, p.B);
      b.hline(6, 8, 14, p.L);
      b.hline(14, 16, 14, p.L);
    }
    round(b, 8, 9 + bob, 7, 5, p.B);
    b.rect(10, 10 + bob, 3, 4, p.L);
    const la = moving ? [0, -1, 0, 0][f] : 0;
    const lb = moving ? [0, 0, 0, -1][f] : 0;
    b.rect(8, 12 + bob + la, 2, 3 - bob - la, p.B);
    b.rect(13, 12 + bob + lb, 2, 3 - bob - lb, p.B);
    b.rect(8, 14 + la, 2, 1, p.L);
    b.rect(13, 14 + lb, 2, 1, p.L);
  }
  const hy = lying ? 5 : sitting ? 1 : 1 + bob;
  const tilt = pose === 'scratch' ? f : 0;
  // cabeça grande e orelhas caídas
  round(b, 6, hy + tilt, 11, 9, p.B);
  b.hline(8, 14, hy + tilt, p.H);
  b.rect(4, hy + 1, 3, 6 - tilt, p.D);
  b.rect(16, hy + 1 + tilt, 3, 6, p.D);
  b.set(5, hy + 7 - tilt, p.D);
  b.set(17, hy + 7 + tilt, p.D);
  // focinho, nariz, olhos
  const fy = hy + tilt;
  b.rect(9, fy + 5, 5, 3, p.L);
  b.rect(10, fy + 5, 3, 1, p.N);
  b.set(11, fy + 7, p.D);
  if (pose === 'sleep') {
    b.hline(8, 9, fy + 4, p.D);
    b.hline(13, 14, fy + 4, p.D);
  } else if (pose === 'scratch') {
    b.hline(8, 9, fy + 3, p.E);
    b.hline(13, 14, fy + 3, p.E);
  } else {
    b.rect(8, fy + 3, 2, 2, p.E);
    b.rect(13, fy + 3, 2, 2, p.E);
    b.set(8, fy + 3, '#ffffff');
    b.set(13, fy + 3, '#ffffff');
  }
  if (pose === 'wag' || pose === 'run') b.rect(11, fy + 8, 1, 2, p.T);
  // coleira
  if (!lying) {
    b.hline(8, 14, fy + 9, p.C);
    b.set(11, fy + 10, p.G);
  }
}

// ------------------------------------------------------------------ de costas

function back(b: PixelBuf, p: DogPal, pose: PetPose, f: number): void {
  const lying = pose === 'lie' || pose === 'sleep';
  const sitting = pose === 'sit' || pose === 'scratch';
  const moving = pose === 'walk' || pose === 'run';
  const bob = moving && (f === 1 || f === 3) ? -1 : 0;
  if (lying) {
    round(b, 5, 10, 12, 5, p.B);
    b.hline(7, 15, 10, p.H);
  } else if (sitting) {
    round(b, 6, 9, 11, 6, p.B);
  } else {
    round(b, 8, 9 + bob, 7, 5, p.B);
    const la = moving ? [0, -1, 0, 0][f] : 0;
    const lb = moving ? [0, 0, 0, -1][f] : 0;
    b.rect(8, 12 + bob + la, 2, 3 - bob - la, p.B);
    b.rect(13, 12 + bob + lb, 2, 3 - bob - lb, p.B);
    b.rect(8, 14 + la, 2, 1, p.D);
    b.rect(13, 14 + lb, 2, 1, p.D);
  }
  const hy = lying ? 5 : 1 + bob;
  round(b, 6, hy, 11, 9, p.B);
  b.hline(8, 14, hy, p.H);
  b.rect(4, hy + 1, 3, 6, p.D);
  b.rect(16, hy + 1, 3, 6, p.D);
  if (!lying) b.hline(8, 14, hy + 8, p.C);
  // rabo para cima, balançando
  const wagging = pose === 'wag' || pose === 'stand' || moving;
  const tx = wagging ? (f % 2 ? 12 : 10) : 11;
  const ty = lying ? 12 : sitting ? 12 : 9 + bob;
  b.rect(tx, ty - 3, 1, 4, p.B);
  b.set(tx, ty - 4, p.H);
}

// ------------------------------------------------------------------ folha

export function renderDog(req: PetFrameRequest): BufSprite {
  const n = PET_FRAMES[req.pose] ?? 1;
  const f = ((Math.floor(req.frame) % n) + n) % n;
  const p = paletteOf(req.coat);
  const buf = new PixelBuf(PET_W, PET_H);
  buf.ox = 1;
  buf.oy = 2;
  if (req.dir === 'down') front(buf, p, req.pose, f);
  else if (req.dir === 'up') back(buf, p, req.pose, f);
  else side(buf, p, req.pose, f);
  buf.ox = 0;
  buf.oy = 0;
  buf.outline();
  if (req.dir === 'left') return { buf: buf.flipped(), ax: PET_W - 1 - PET_AX, ay: PET_AY };
  return { buf, ax: PET_AX, ay: PET_AY };
}
