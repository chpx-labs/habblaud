// O CEO: o seu personagem na sala do CEO (world/layout/ceo.ts). Fica sempre na sala, sentado à mesa; com o controle
// ligado (botão da gravata na barra do topo ou a tecla G), as setas/WASD e o clique no chão o movem, e a câmera o segue
// (Shift corre). Desligado, setas/WASD voltam a mover a câmera. Com o controle ligado, uma barrinha acompanha o CEO:
// "Falar com Fulano (E)" perto de um agente (abre a ligação), "Sentar"/"Levantar" perto de um assento da sala dele e o
// lápis que abre o editor (ui/ceo-editor.ts). A aparência fica no navegador (localStorage): um sorteio na primeira vez.
// Ele só existe aqui: não é agente, não vai ao servidor nem ao Habblaud World.
import { tr } from '../../../shared/i18n';
import type { CeoMe } from '../world/api';
import { intentFrom, moveKeyOf } from '../world/city/input';
import { CeoEditor, DEFAULT_PET } from './ceo-editor';
import { isPetCoat } from '../art/pet/dog';
import type { CeoPet } from '../world/api';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';

const CEO_KEY = 'habblaud.ceo';

export function loadCeo(): CeoMe {
  try {
    const raw = JSON.parse(localStorage.getItem(CEO_KEY) ?? 'null') as Partial<CeoMe> | null;
    if (raw && typeof raw.seed === 'number' && (raw.look === 'f' || raw.look === 'm')) {
      return {
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 24) : tr('Você'),
        look: raw.look,
        seed: raw.seed >>> 0,
        ...(raw.parts ? { parts: raw.parts } : {}),
        pet: petOf(raw.pet),
      };
    }
  } catch {
    // sem armazenamento ou dado estragado: sorteia
  }
  const me: CeoMe = { name: tr('Você'), look: Math.random() < 0.5 ? 'f' : 'm', seed: Math.floor(Math.random() * 2 ** 31), pet: { ...DEFAULT_PET } };
  saveCeo(me);
  return me;
}

/** O mascote gravado: ausente (gravado antes do mascote existir) = o padrão; null = sem mascote. */
function petOf(raw: unknown): CeoPet | null {
  if (raw === null) return null;
  const p = raw as Partial<CeoPet> | undefined;
  if (!p || typeof p !== 'object') return { ...DEFAULT_PET };
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 16) : DEFAULT_PET.name;
  return { name, coat: isPetCoat(p.coat) ? p.coat : DEFAULT_PET.coat };
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
  /** Barrinha sobre o CEO (Falar, Sentar/Levantar, editar). */
  readonly hint: HTMLElement;
  /** Editor do CEO: criado na primeira abertura. */
  private editor: CeoEditor | null = null;
  private me: CeoMe | null = null;
  private keys = new Set<string>();
  private shift = false;
  private shown = false;
  private raf = 0;
  private readonly talkBtn: HTMLButtonElement;
  private readonly talkText: HTMLElement;
  private readonly sitBtn: HTMLButtonElement;
  private readonly sitKey: HTMLElement;
  private readonly sitText: HTMLElement;
  /** Agente ao alcance agora (para o E e o botão Falar). */
  private near: string | null = null;
  private lastSig = '';

  constructor(private ctx: UiContext) {
    this.button = iconButton(ICONS.ceo, tr('Controlar o CEO (G)'), () => this.toggle());
    this.button.setAttribute('aria-pressed', 'false');
    this.talkText = h('span');
    this.talkBtn = h('button', { class: 'ui-ceo-hint__btn', type: 'button', hidden: true, on: { click: () => this.talk() } }, h('kbd', { text: 'E' }), this.talkText);
    this.sitKey = h('kbd', { text: 'E' });
    this.sitText = h('span');
    this.sitBtn = h('button', { class: 'ui-ceo-hint__btn', type: 'button', hidden: true, on: { click: () => this.sit() } }, this.sitKey, this.sitText);
    const edit = iconButton(ICONS.pencil, tr('Editar o CEO (nome e aparência)'), () => this.edit(), 'ui-icon-btn--sm ui-ceo-hint__edit');
    this.hint = h('div', { class: 'ui-ceo-hint', hidden: true }, this.talkBtn, this.sitBtn, edit);
    const ceo = ctx.world.ceo;
    if (ceo) {
      this.me = loadCeo();
      ceo.set(this.me);
      // Clicar no CEO liga o controle.
      ceo.onClick(() => {
        if (!this.control) this.toggle(true);
      });
    } else this.button.hidden = true;
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
      this.control
        ? tr('Controlando o CEO: setas/WASD ou clique no chão (Shift corre). Perto de um agente, E fala com ele; perto de uma cadeira, E senta. G solta.')
        : tr('CEO solto: setas/WASD voltam a mover a câmera.'),
    );
    if (this.control) this.loop();
    else this.stopLoop();
    this.ctx.invalidate();
  }

  /** Abre o editor do CEO. */
  edit(): void {
    if (!this.me) return;
    if (!this.editor) {
      this.editor = new CeoEditor((me) => this.apply(me));
      this.ctx.root.append(this.editor.el);
    }
    this.editor.open(this.me);
  }

  render(): void {
    const on = this.control;
    if (on === this.shown) return;
    this.shown = on;
    this.button.classList.toggle('is-on', on);
    this.button.setAttribute('aria-pressed', String(on));
    this.button.title = on ? tr('Soltar o CEO (G)') : tr('Controlar o CEO (G)');
    if (on) this.loop();
    else this.stopLoop();
  }

  private apply(me: CeoMe): void {
    this.me = me;
    saveCeo(me);
    const ceo = this.ctx.world.ceo;
    const control = this.control;
    ceo?.set(me);
    if (control) ceo?.setControl(true);
    this.ctx.announce(me.pet ? tr('CEO salvo: {0}, com {1}.', [me.name, me.pet.name]) : tr('CEO salvo: {0}.', [me.name]));
  }

  /** Fala com o agente ao alcance: liga para ele (ou o põe na ligação); sem mensagens, abre os detalhes dele. */
  private talk(): void {
    const id = this.near;
    if (!id) return;
    const a = this.ctx.agent(id);
    if (!a) return;
    if (this.ctx.call?.canCall(id)) this.ctx.call.call(id);
    else {
      this.ctx.world.select({ type: 'agent', id });
      this.ctx.announce(tr('{0} não recebe mensagens daqui: abri os detalhes.', [a.name]));
    }
  }

  private sit(): void {
    this.ctx.world.ceo?.toggleSit();
  }

  /** A barrinha acompanha o CEO enquanto o controle está ligado. */
  private loop(): void {
    if (this.raf) return;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.place();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.near = null;
    this.lastSig = '';
    setHidden(this.hint, true);
  }

  private place(): void {
    const ceo = this.ctx.world.ceo;
    if (!ceo || !ceo.control) return this.stopLoop();
    const n = ceo.nearby();
    const a = n.agentId ? this.ctx.agent(n.agentId) : undefined;
    this.near = a ? a.id : null;
    const call = this.ctx.call;
    const talk = a ? (call?.inCall(a.id) ? tr('Na ligação: {0}', [a.name]) : call?.canCall(a.id) ? tr('Falar com {0}', [a.name]) : tr('Ver {0}', [a.name])) : '';
    const sig = `${talk}|${n.seat}|${n.seated}`;
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      setHidden(this.talkBtn, !a);
      setText(this.talkText, talk);
      setHidden(this.sitBtn, !n.seat);
      setText(this.sitText, n.seated ? tr('Levantar') : tr('Sentar'));
      // O E fala quando há alguém perto; senão, senta/levanta.
      setHidden(this.sitKey, !!a);
    }
    const at = ceo.screen();
    setHidden(this.hint, !at);
    if (!at) return;
    const w = this.hint.offsetWidth || 160;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, at.x - w / 2));
    this.hint.style.transform = `translate(${Math.round(x)}px, ${Math.round(at.y - 38)}px)`;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.control) return;
    if (e.key === 'Shift') this.shift = down;
    else if (typeof e.getModifierState === 'function') this.shift = e.getModifierState('Shift');
    const blocked = e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || !!(e.target as HTMLElement | null)?.closest?.('dialog[open]') || !!this.editor?.isOpen;
    if (down && !blocked && !e.repeat && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      if (this.near) this.talk();
      else this.sit();
      return;
    }
    const k = moveKeyOf(e);
    if (!down) {
      if (k) this.keys.delete(k);
      this.push();
      return;
    }
    if (!k || blocked) return;
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
