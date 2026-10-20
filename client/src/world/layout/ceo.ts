// Sala do CEO: sala fixa no lado norte da primeira coluna depois do núcleo (geometry.ts, ceoRect), sempre montada e
// nunca desmontada. É do personagem que você controla (sim/visitor.ts, modo CEO): os assentos são do tipo 'ceo_seat',
// que nenhum agente procura, então os agentes não a usam nos passeios (não há 'desk', 'sofa', 'shelf'... para eles).
import type { WallStyle } from '../../art/api';
import { DOOR_W, DOOR_X, TILE } from '../constants';
import { AreaBuilder } from './builder';
import { ceoRect } from './geometry';
import type { AreaLayout } from './types';

export const CEO_ROOM_ID = 'core:ceo';

const CEO_WALL: WallStyle = { base: '#38445a', trim: '#c9a227', pattern: 'wood_panel' };

export function layoutCeoRoom(): AreaLayout {
  const rect = ceoRect();
  const b = new AreaBuilder(CEO_ROOM_ID, 'ceo', rect);
  b.area.side = 'north';

  // ---- piso de madeira, tapete vinho sob a mesa e azul no canto do sofá
  b.floor('wood', 0, 0, 16, 12, 701);
  b.rug(3.5, 3.4, 8, 4.8, '#6b1f2b', 702);
  b.rug(9.8, 3.2, 5, 4.6, '#2d4059', 703);
  b.rug(DOOR_X - 0.25, 9.5, DOOR_W + 0.5, 1.25, '#4a1520', 704);

  // ---- paredes: lambri escuro com friso dourado; porta para o corredor (sul)
  b.face(0.5, 15, CEO_WALL);
  b.south(0.5, 15, 11, CEO_WALL, [{ lx: DOOR_X, w: DOOR_W }]);
  b.cap(0, 0, 0.5, 12, CEO_WALL);
  b.cap(15.5, 0, 0.5, 12, CEO_WALL);

  b.walk(1, 2, 14, 9);
  b.area.door = { x: rect.x + DOOR_X, y: rect.y + 11, w: DOOR_W, h: 1 };
  b.walk(DOOR_X, 11, DOOR_W, 1);

  // ---- parede norte: janela, quadro, relógio e TV do canto do sofá
  b.wall('window', 4, undefined, { order: 0.4 });
  b.wall('painting', 6.5, undefined, { order: 0.5 });
  b.wall('clock', 9, undefined, { order: 0.7 });
  b.wall('tv', 12.5, undefined, { order: 0.45 });

  // ---- mesa de diretor (dupla, madeira escura), cadeira atrás e duas cadeiras de visita
  b.furn('desk_back', 5, 5, 'dark', { order: 0.35 });
  b.furn('desk_back', 7, 5, 'dark', { order: 0.36 });
  b.seat('ceo_seat', 'office_chair_front', 6, 4, 'down', 'black', { dx: TILE / 2, order: 0.55 });
  b.seat('ceo_seat', 'office_chair', 5, 6, 'up', 'red', { order: 0.6 });
  b.seat('ceo_seat', 'office_chair', 8, 6, 'up', 'red', { order: 0.61 });

  // ---- canto do sofá, de frente para a TV
  b.furn('coffee_table', 11, 4, undefined, { dx: TILE / 2, order: 0.45 });
  const sofa = b.furn('sofa', 11, 6, 'up', { order: 0.5 });
  for (let i = 0; i < 3; i++) b.seat('ceo_seat', 'sofa', 11 + i, 6, 'up', 'up', { noFurniture: true, furnitureId: sofa });
  b.seat('ceo_seat', 'armchair', 10, 4, 'right', 'right', { order: 0.55 });
  b.block(13, 4, 1, 1);
  b.seat('ceo_seat', 'armchair', 14, 4, 'left', 'left', { order: 0.56 });

  // ---- estantes, plantas e luminária
  b.furn('bookshelf', 1, 2, undefined, { order: 0.25 });
  b.furn('plant_tall', 14, 2, 'ficus', { order: 0.2 });
  b.furn('plant_tall', 1, 9, 'monstera', { order: 0.2 });
  b.furn('floor_lamp', 14, 9, undefined, { order: 0.3 });
  b.furn('plant_small', 9, 2, 'succulent', { order: 0.22 });

  return b.build();
}
