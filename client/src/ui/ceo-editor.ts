// Editor do CEO (o personagem que você controla, ui/ceo.ts): nome, dica visual, "Sortear" e as peças, com a prévia de
// corpo inteiro (appearance-fields.ts, o mesmo dos agentes e do Habblaud World). Fica só no navegador: "Salvar" chama
// `onSave` e quem usa grava no localStorage; nada vai ao servidor.
import { NAME_MAX } from '../../../shared/appearance';
import { tr } from '../../../shared/i18n';
import { appearanceFromSeed } from '../art';
import type { Appearance } from '../art/api';
import type { CeoMe } from '../world/api';
import { AppearanceFields } from './appearance-fields';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { segmented } from './settings';
import { fullParts } from './world/world-model';

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
        this.error,
        h('div', { class: 'ui-char__actions' }, save, cancel),
      ),
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.save();
      }
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
    this.showError(null);
    if (!this.el.open) this.el.showModal();
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
    this.onSave({ name: name.slice(0, 24), look: this.look, seed: this.seed, parts: fullParts(a) });
    this.el.close();
  }

  private showError(message: string | null): void {
    setText(this.error, message ?? '');
    setHidden(this.error, !message);
    if (message) this.nameInput.focus();
  }
}
