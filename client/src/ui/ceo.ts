// O CEO: o seu personagem na sala do CEO (world/layout/ceo.ts). Fica sempre na sala; com o controle ligado (botão
// da gravata na barra do topo ou a tecla G), as setas/WASD e o clique no chão o movem, e a câmera o segue (Shift
// corre). Desligado, setas/WASD voltam a mover a câmera. A aparência fica no navegador (localStorage): um sorteio na
// primeira vez. Ele só existe aqui: não é agente, não vai ao servidor nem ao Habblaud World.
import { tr } from '../../../shared/i18n';
import type { CeoMe } from '../world/api';
import { intentFrom, moveKeyOf } from '../world/city/input';
import type { UiComponent, UiContext } from './context';
import { iconButton } from './dom';
import { ICONS } from './icons';

const CEO_KEY = 'habblaud.ceo';

export function loadCeo(): CeoMe {
  try {
    const raw = JSON.parse(localStorage.getItem(CEO_KEY) ?? 'null') as Partial<CeoMe> | null;
    if (raw && typeof raw.seed === 'number' && (raw.look === 'f' || raw.look === 'm')) {
      return { name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 24) : tr('Você'), look: raw.look, seed: raw.seed >>> 0, ...(raw.parts ? { parts: raw.parts } : {}) };
    }
  } catch {
    // sem armazenamento ou dado estragado: sorteia
  }
  const me: CeoMe = { name: tr('Você'), look: Math.random() < 0.5 ? 'f' : 'm', seed: Math.floor(Math.random() * 2 ** 31) };
  saveCeo(me);
  return me;
}

export function saveCeo(me: CeoMe): void {
  try {
    localStorage.setItem(CEO_KEY, JSON.stringify(me));
  } catch {
    // vale só nesta página
  }
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
}

export class CeoControl implements UiComponent {
  readonly button: HTMLButtonElement;
  private keys = new Set<string>();
  private shift = false;
  private shown = false;

  constructor(private ctx: UiContext) {
    this.button = iconButton(ICONS.ceo, tr('Controlar o CEO (G)'), () => this.toggle());
    this.button.setAttribute('aria-pressed', 'false');
    const ceo = ctx.world.ceo;
    if (ceo) ceo.set(loadCeo());
    else this.button.hidden = true;
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => this.clearKeys());
  }

  get control(): boolean {
    return !!this.ctx.world.ceo?.control;
  }

  toggle(on = !this.control): void {
    const ceo = this.ctx.world.ceo;
    if (!ceo) return;
    ceo.setControl(on);
    this.clearKeys();
    this.ctx.announce(
      this.control ? tr('Controlando o CEO: setas/WASD ou clique no chão (Shift corre). G solta.') : tr('CEO solto: setas/WASD voltam a mover a câmera.'),
    );
    this.ctx.invalidate();
  }

  render(): void {
    const on = this.control;
    if (on === this.shown) return;
    this.shown = on;
    this.button.classList.toggle('is-on', on);
    this.button.setAttribute('aria-pressed', String(on));
    this.button.title = on ? tr('Soltar o CEO (G)') : tr('Controlar o CEO (G)');
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.control) return;
    if (e.key === 'Shift') this.shift = down;
    else if (typeof e.getModifierState === 'function') this.shift = e.getModifierState('Shift');
    const k = moveKeyOf(e);
    if (!down) {
      if (k) this.keys.delete(k);
      this.push();
      return;
    }
    if (!k || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || (e.target as HTMLElement | null)?.closest?.('dialog[open]')) return;
    e.preventDefault();
    this.keys.add(k);
    this.push();
  }

  private push(): void {
    this.ctx.world.ceo?.setIntent(intentFrom(this.keys, this.shift));
  }

  private clearKeys(): void {
    this.keys.clear();
    this.shift = false;
    this.push();
  }
}
