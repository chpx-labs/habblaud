// Editor do CEO (o personagem que você controla, ui/ceo.ts): nome, dica visual, "Sortear" e as peças, com a prévia de
// corpo inteiro (appearance-fields.ts, o mesmo dos agentes e do Habblaud World). Fica só no navegador: "Salvar" chama
// `onSave` e quem usa grava no localStorage; nada vai ao servidor. Embaixo, o mascote (o cachorro que anda com o CEO):
// com ou sem, nome e cor do pelo, com a prévia abanando o rabo.
import { NAME_MAX } from '../../../shared/appearance';
import { tr } from '../../../shared/i18n';
import { appearanceFromSeed, petSprite } from '../art';
import type { Appearance } from '../art/api';
import { PET_COATS, type PetCoat } from '../art/pet/dog';
import type { CeoMe, CeoPet } from '../world/api';
import { AppearanceFields } from './appearance-fields';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { segmented } from './settings';
import { fullParts } from './world/world-model';

/** O mascote de quem ainda não escolheu: o Billy, caramelo. */
export const DEFAULT_PET: CeoPet = { name: 'Billy', coat: 'caramel' };

function coatName(c: PetCoat): string {
  return { caramel: tr('Caramelo'), chocolate: tr('Chocolate'), black: tr('Preto'), white: tr('Branco') }[c];
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
}

export class CeoEditor {
  readonly el: HTMLDialogElement;
  private readonly fields = new AppearanceFields();
  private readonly nameInput: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly lookSeg: { row: HTMLElement; set(v: 'f' | 'm'): void };
  private look: 'f' | 'm' = 'f';
  private seed = 0;
  private petOn = true;
  private coat: PetCoat = DEFAULT_PET.coat;
  private readonly petName: HTMLInputElement;
  private readonly petPreview: HTMLCanvasElement;
  private readonly petFields: HTMLElement;
  private readonly petSeg: { row: HTMLElement; set(v: 'on' | 'off'): void };
  private readonly coatSeg: { row: HTMLElement; set(v: PetCoat): void };
  private petTimer = 0;
  private petFrame = 0;

  constructor(private readonly onSave: (me: CeoMe) => void) {
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    this.nameInput = h('input', { class: 'ui-char__name', type: 'text', attrs: { maxlength: Math.min(NAME_MAX, 24), autocomplete: 'off', spellcheck: 'false' } });
    const roll = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Sortear'), title: tr('Sortear outra aparência (desfaz as peças escolhidas)'), on: { click: () => this.roll() } });
    this.lookSeg = segmented<'f' | 'm'>(
      tr('Dica visual'),
      [
        ['f', tr('Feminina')],
        ['m', tr('Masculina')],
      ],
      (v) => {
        this.look = v;
        this.lookSeg.set(v);
        const a = this.fields.value;
        if (a) this.fields.set({ ...a, look: v } satisfies Appearance);
      },
    );
    this.petName = h('input', { class: 'ui-char__name', type: 'text', attrs: { maxlength: 16, autocomplete: 'off', spellcheck: 'false' } });
    this.petPreview = h('canvas', { class: 'ui-char__preview ui-ceo-pet__preview', attrs: { width: 69, height: 54, 'aria-hidden': 'true' } });
    this.petSeg = segmented<'on' | 'off'>(
      tr('Mascote'),
      [
        ['on', tr('Com mascote')],
        ['off', tr('Sem mascote')],
      ],
      (v) => {
        this.petOn = v === 'on';
        this.syncPet();
      },
    );
    this.coatSeg = segmented<PetCoat>(
      tr('Pelo'),
      PET_COATS.map((c) => [c, coatName(c)] as [PetCoat, string]),
      (v) => {
        this.coat = v;
        this.syncPet();
      },
    );
    this.petFields = h(
      'div',
      { class: 'ui-ceo-pet__fields' },
      h('div', { class: 'ui-char__top' }, this.petPreview, h('label', { class: 'ui-char__label' }, h('span', { text: tr('Nome do mascote') }), this.petName)),
      this.coatSeg.row,
    );
    const petBox = h('div', { class: 'ui-ceo-pet' }, this.petSeg.row, this.petFields);
    this.error = h('p', { class: 'ui-char__error', role: 'alert', hidden: true });
    const save = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Salvar'), on: { click: () => this.save() } });
    const cancel = h('button', { class: 'ui-btn', type: 'button', text: tr('Cancelar'), on: { click: () => this.el.close() } });
    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-ceo-editor', attrs: { 'aria-labelledby': 'ui-ceo-editor-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Editar o CEO'), attrs: { id: 'ui-ceo-editor-title' } }), close),
      h(
        'div',
        { class: 'ui-dialog__body ui-char' },
        h(
          'div',
          { class: 'ui-char__top' },
          this.fields.preview,
          h('div', { class: 'ui-char__head' }, h('label', { class: 'ui-char__label' }, h('span', { text: tr('Nome') }), this.nameInput), roll),
        ),
        this.lookSeg.row,
        h('p', { class: 'ui-muted ui-small', text: tr('Fica só neste navegador: o CEO não vai ao servidor nem ao Habblaud World.') }),
        this.fields.groups,
        petBox,
        this.error,
        h('div', { class: 'ui-char__actions' }, save, cancel),
      ),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    for (const input of [this.nameInput, this.petName]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.save();
        }
      });
    }
    this.el.addEventListener('close', () => {
      clearInterval(this.petTimer);
      this.petTimer = 0;
    });
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  open(me: CeoMe): void {
    this.look = me.look;
    this.seed = me.seed;
    this.nameInput.value = me.name;
    this.lookSeg.set(me.look);
    this.fields.set(appearanceFromSeed(me.seed, { look: me.look, parts: me.parts }));
    const pet = me.pet === undefined ? DEFAULT_PET : me.pet;
    this.petOn = !!pet;
    this.coat = pet?.coat ?? DEFAULT_PET.coat;
    this.petName.value = pet?.name ?? DEFAULT_PET.name;
    this.syncPet();
    this.showError(null);
    if (!this.el.open) this.el.showModal();
    if (!this.petTimer) this.petTimer = window.setInterval(() => this.drawPet(), 240);
    this.nameInput.focus();
    this.nameInput.select();
  }

  private roll(): void {
    this.seed = randomSeed();
    this.fields.set(appearanceFromSeed(this.seed, { look: this.look }));
  }

  private save(): void {
    const a = this.fields.value;
    if (!a) return;
    const name = this.nameInput.value.trim();
    if (!name) return this.showError(tr('Dê um nome ao personagem.'));
    const petName = this.petName.value.trim() || DEFAULT_PET.name;
    const pet: CeoPet | null = this.petOn ? { name: petName.slice(0, 16), coat: this.coat } : null;
    this.onSave({ name: name.slice(0, 24), look: this.look, seed: this.seed, parts: fullParts(a), pet });
    this.el.close();
  }

  private syncPet(): void {
    this.petSeg.set(this.petOn ? 'on' : 'off');
    this.coatSeg.set(this.coat);
    setHidden(this.petFields, !this.petOn);
    this.drawPet();
  }

  /** A prévia do mascote, de frente, abanando o rabo (3x). */
  private drawPet(): void {
    const ctx = this.petPreview.getContext('2d');
    if (!ctx) return;
    this.petFrame = (this.petFrame + 1) % 2;
    const s = petSprite({ coat: this.coat, dir: 'down', pose: 'wag', frame: this.petFrame });
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.petPreview.width, this.petPreview.height);
    ctx.drawImage(s.canvas, 0, 0, s.canvas.width * 3, s.canvas.height * 3);
  }

  private showError(message: string | null): void {
    setText(this.error, message ?? '');
    setHidden(this.error, !message);
    if (message) this.nameInput.focus();
  }
}
