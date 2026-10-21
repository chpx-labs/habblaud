// O desenho do mascote (art/pet/dog.ts): toda pose, direção e quadro desenha algo dentro da folha, com as patas no chão.
import { describe, expect, it } from 'vitest';
import { PET_AY, PET_COATS, PET_FRAMES, PET_H, PET_W, renderDog, type PetPose } from './dog';

const POSES = Object.keys(PET_FRAMES) as PetPose[];
const DIRS = ['down', 'up', 'left', 'right'] as const;

describe('cachorro', () => {
  it('desenha toda pose, direção e quadro, com as patas tocando o chão', () => {
    for (const coat of PET_COATS)
      for (const pose of POSES)
        for (const dir of DIRS)
          for (let frame = 0; frame < PET_FRAMES[pose]; frame++) {
            const s = renderDog({ coat, dir, pose, frame });
            expect(s.buf.w).toBe(PET_W);
            expect(s.buf.h).toBe(PET_H);
            const b = s.buf.bounds()!;
            expect(b, `${coat} ${pose} ${dir} ${frame}`).not.toBeNull();
            // o contorno de baixo fica na linha da âncora
            expect(b.y + b.h, `${pose} ${dir} ${frame}`).toBe(PET_AY + 1);
          }
  });

  it('a esquerda é o espelho da direita', () => {
    const r = renderDog({ coat: 'caramel', dir: 'right', pose: 'walk', frame: 1 });
    const l = renderDog({ coat: 'caramel', dir: 'left', pose: 'walk', frame: 1 });
    for (let y = 0; y < PET_H; y++)
      for (let x = 0; x < PET_W; x++) expect(l.buf.alpha(x, y)).toBe(r.buf.alpha(PET_W - 1 - x, y));
    expect(l.ax).toBe(PET_W - 1 - r.ax);
  });

  it('cada pelo tem a sua cor', () => {
    const px = (coat: (typeof PET_COATS)[number]) => {
      const s = renderDog({ coat, dir: 'down', pose: 'stand', frame: 0 });
      const i = (5 * PET_W + 8) * 4;
      return Array.from(s.buf.data.slice(i, i + 3)).join(',');
    };
    expect(new Set(PET_COATS.map(px)).size).toBe(PET_COATS.length);
  });
});
