// Ligação: conversa por voz com um ou mais agentes principais, como numa conferência.
// - Ouvir: cada participante tem o próprio stream do terminal (GET /api/agents/:id/terminal); cada resposta nova do
//   agente é lida em voz alta pelo navegador (speechSynthesis), sem código nem links (call-model.ts), cada agente com
//   uma voz ou um tom. A conversa que já existia ao ligar não é lida. Quem passa a precisar de você é anunciado.
// - Falar: o botão Falar grava (ui/dictation.ts, Whisper local no computador) e o texto vai como mensagem
//   (POST /api/messages, plugin habblaud-mensagens). Com vários na ligação, "Marina, ..." fala com a Marina; sem
//   nome, vai para quem está marcado. Também dá para escrever. Gravar corta a voz que estiver falando.
// - Precisa das mensagens liberadas (local ou HABBLAUD_REMOTE_ALLOW=messages) e, para ouvir, do terminal
//   (terminal). Só agentes principais ao vivo; quem sai do escritório sai da ligação.
import { MESSAGE_MAX } from '../../../shared/messages';
import type { AgentInfo, AgentStatus, TerminalEntry } from '../../../shared/types';
import { tr } from '../../../shared/i18n';
import { access } from '../net/access';
import { addressedTo, chunks, pickVoice, seedOf, speakableText, voicesFor, voiceStyle, waitingAnnouncement, withSpeaker, type VoiceLike } from './call-model';
import { composerMode, messageText } from './composer-model';
import type { CallControl, UiComponent, UiContext } from './context';
import { DictationButton, dictationAvailable } from './dictation';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { Movable } from './movable';
import { parseAppend, parseInit, terminalUrl } from './terminal';

/** Participantes ao mesmo tempo (cada um abre um stream; o servidor aceita 8 no total). */
export const MAX_PARTIES = 4;
/** Linhas guardadas no registro da ligação. */
const LOG_MAX = 40;
const VOICE_KEY = 'habblaud.call.voice';
/** EventSource.CLOSED. */
const ES_CLOSED = 2;

interface Party {
  id: string;
  name: string;
  /** Posição na ligação (escolhe a voz). */
  index: number;
  seed: number;
  source: EventSource | null;
  /** Ids das entradas do terminal já vistas (a conversa de antes de ligar não é lida). */
  seen: Set<string>;
  status: AgentStatus | undefined;
  listening: 'connecting' | 'open' | 'failed';
}

type LogKind = 'me' | 'agent' | 'info' | 'error';

interface LogLine {
  kind: LogKind;
  who?: string;
  text: string;
}

function readVoicePref(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeVoicePref(on: boolean): void {
  try {
    localStorage.setItem(VOICE_KEY, on ? 'on' : 'off');
  } catch {
    // sem armazenamento: vale só nesta página
  }
}

function speechLang(): string {
  const l = (typeof navigator !== 'undefined' && navigator.language) || 'pt-BR';
  return /^pt/i.test(l) ? 'pt-BR' : l;
}

export class CallPanel implements UiComponent, CallControl {
  readonly el: HTMLElement;
  private parties = new Map<string, Party>();
  private nextIndex = 0;
  /** Quem recebe a fala sem nome. */
  private target: string | null = null;
  private voiceOn = readVoicePref();
  private voices: VoiceLike[] = [];
  private lastSpoken: { text: string; party: Party } | null = null;
  private log: LogLine[] = [];
  private canDictate = false;

  private title: HTMLElement;
  private chips: HTMLElement;
  private addSel: HTMLSelectElement;
  private logEl: HTMLElement;
  private status: HTMLElement;
  private talk: DictationButton;
  private voiceBtn: HTMLButtonElement;
  private repeatBtn: HTMLButtonElement;
  private noMic: HTMLElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;

  constructor(private ctx: UiContext) {
    this.title = h('h2', { class: 'ui-call__title', text: tr('Ligação') });
    const close = h('button', { class: 'ui-btn ui-call__end', type: 'button', text: tr('Encerrar'), on: { click: () => this.hangUp() } });
    const head = h('div', { class: 'ui-call__head' }, h('span', { class: 'ui-call__icon', text: '📞', attrs: { 'aria-hidden': 'true' } }), this.title, close);

    this.chips = h('div', { class: 'ui-call__people', role: 'radiogroup', attrs: { 'aria-label': tr('Com quem você fala') } });
    this.addSel = h('select', { class: 'ui-call__add', attrs: { 'aria-label': tr('Pôr outro agente na ligação') } });
    this.addSel.addEventListener('change', () => {
      const id = this.addSel.value;
      this.addSel.value = '';
      if (id) this.call(id);
    });

    this.logEl = h('ol', { class: 'ui-call__log', attrs: { 'aria-label': tr('O que foi dito na ligação') } });
    this.status = h('p', { class: 'ui-call__status', role: 'status', attrs: { 'aria-live': 'polite' } });

    this.talk = new DictationButton(
      (t) => void this.heard(t.text),
      (text, error) => this.say(text, error),
      {
        idleLabel: tr('Falar'),
        recordingHint: tr('Ouvindo… toque em Parar para mandar.'),
        doneHint: () => '',
        onStart: () => this.stopVoice(),
      },
    );
    this.talk.el.classList.add('ui-call__talk');
    this.voiceBtn = h('button', { class: 'ui-btn ui-call__voice', type: 'button', on: { click: () => this.toggleVoice() } });
    this.repeatBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Repetir'), title: tr('Falar de novo a última resposta'), on: { click: () => this.repeat() } });
    this.noMic = h('p', { class: 'ui-call__hint', hidden: true, text: tr('Para falar, o computador precisa do Whisper (veja o README). Dá para escrever aqui embaixo.') });

    this.input = h('input', { class: 'ui-call__input', attrs: { type: 'text', maxlength: MESSAGE_MAX, autocomplete: 'off', enterkeyhint: 'send' } });
    this.input.addEventListener('keydown', (e) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this.typed();
      } else if (e.key === 'Escape') this.input.blur();
    });
    this.sendBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Enviar'), on: { click: () => void this.typed() } });

    this.el = h(
      'section',
      { class: 'ui-call', hidden: true, attrs: { 'aria-label': tr('Ligação com os agentes') } },
      head,
      h('div', { class: 'ui-call__bar' }, this.chips, this.addSel),
      this.logEl,
      this.status,
      h('div', { class: 'ui-call__controls' }, this.talk.el, this.voiceBtn, this.repeatBtn),
      this.noMic,
      h('div', { class: 'ui-call__type' }, this.input, this.sendBtn),
    );
    this.syncVoiceBtn();
    // Arrastar pela barra do título, redimensionar pelas bordas (vale também no celular); duplo clique devolve ao canto.
    new Movable(this.el, head, { key: 'habblaud.move.call', onMove: () => (this.logEl.scrollTop = this.logEl.scrollHeight) });

    if (typeof speechSynthesis !== 'undefined') {
      const load = () => (this.voices = speechSynthesis.getVoices());
      load();
      speechSynthesis.addEventListener?.('voiceschanged', load);
    }
  }

  get isOpen(): boolean {
    return this.parties.size > 0;
  }

  // ---------------------------------------------------------------- CallControl

  canCall(agentId: string): boolean {
    const a = this.ctx.agent(agentId);
    return this.callable(a);
  }

  inCall(agentId: string): boolean {
    return this.parties.has(agentId);
  }

  call(agentId: string): void {
    const a = this.ctx.agent(agentId);
    if (!a || !this.callable(a)) return;
    if (this.parties.has(agentId)) {
      this.setTarget(agentId);
      return;
    }
    if (this.parties.size >= MAX_PARTIES) {
      this.say(tr('A ligação já tem {0} agentes: tire alguém antes.', [MAX_PARTIES]), true);
      return;
    }
    const party: Party = { id: a.id, name: a.name, index: this.nextIndex++, seed: seedOf(a.id), source: null, seen: new Set(), status: a.status, listening: 'connecting' };
    this.parties.set(a.id, party);
    this.target = a.id;
    this.listen(party);
    const many = this.parties.size > 1;
    this.addLog({ kind: 'info', text: many ? tr('{0} entrou na ligação.', [a.name]) : tr('Ligação com {0}.', [a.name]) });
    // Dentro do clique: libera a voz no celular (o iPhone só fala se a primeira fala nasce de um toque).
    this.speak(many ? tr('{0} na linha.', [a.name]) : tr('Ligação com {0}.', [a.name]), party);
    setHidden(this.el, false);
    this.ctx.invalidate();
  }

  // ---------------------------------------------------------------- render

  render(): void {
    if (!this.parties.size) {
      setHidden(this.el, true);
      return;
    }
    // Quem saiu do escritório (ou deixou de aceitar mensagens) sai da ligação; quem passou a precisar de você é avisado.
    for (const p of [...this.parties.values()]) {
      const a = this.ctx.agent(p.id);
      if (!a || !this.callable(a)) {
        this.addLog({ kind: 'info', text: tr('{0} saiu da ligação.', [p.name]) });
        this.speak(tr('{0} saiu da ligação.', [p.name]), p);
        this.drop(p.id);
        continue;
      }
      const note = waitingAnnouncement(p.status, a.status, a.name, a.waitingFor);
      if (note) {
        this.addLog({ kind: 'info', text: note });
        this.speak(note, p);
      }
      p.status = a.status;
      p.name = a.name;
    }
    if (!this.parties.size) {
      this.stopVoice();
      setHidden(this.el, true);
      return;
    }
    if (!this.target || !this.parties.has(this.target)) this.target = this.parties.keys().next().value ?? null;

    const many = this.parties.size > 1;
    setText(this.title, many ? tr('Conferência ({0})', [this.parties.size]) : tr('Ligação com {0}', [this.parties.get(this.target!)!.name]));
    this.renderChips();
    this.renderAddList();

    void dictationAvailable().then((ok) => {
      if (ok === this.canDictate) return;
      this.canDictate = ok;
      this.ctx.invalidate();
    });
    setHidden(this.talk.el, !this.canDictate);
    setHidden(this.noMic, this.canDictate);
    const name = this.target ? this.parties.get(this.target)?.name ?? '' : '';
    this.input.placeholder = tr('Escrever para {0}…', [name]);
    this.repeatBtn.disabled = !this.lastSpoken;
    setHidden(this.el, false);
  }

  // ---------------------------------------------------------------- participantes

  private callable(a: AgentInfo | undefined): boolean {
    const store = this.ctx.store;
    return (
      !!a &&
      a.kind === 'main' &&
      composerMode(a, { enabled: store.mock || !!store.snapshot?.meta.messages, local: store.mock || access().messages, replaying: store.replaying }).kind === 'ready'
    );
  }

  private renderChips(): void {
    const ids = [...this.parties.keys()];
    const many = ids.length > 1;
    const existing = new Map([...this.chips.children].map((c) => [(c as HTMLElement).dataset.id ?? '', c as HTMLElement]));
    for (const [id, el] of existing) if (!this.parties.has(id)) el.remove();
    for (const id of ids) {
      const p = this.parties.get(id)!;
      let chip = existing.get(id);
      if (!chip) {
        const pick = h('button', { class: 'ui-call__chip-name', type: 'button', attrs: { role: 'radio' }, on: { click: () => this.setTarget(id) } });
        const out = iconButton(ICONS.close, tr('Tirar da ligação'), () => this.remove(id), 'ui-call__chip-x');
        chip = h('span', { class: 'ui-call__chip' }, h('span', { class: 'ui-call__dot', attrs: { 'aria-hidden': 'true' } }), pick, out);
        chip.dataset.id = id;
        this.chips.append(chip);
      }
      const pick = chip.querySelector('.ui-call__chip-name') as HTMLElement;
      setText(pick, p.name);
      pick.setAttribute('aria-checked', String(id === this.target));
      chip.classList.toggle('is-target', many && id === this.target);
      chip.dataset.status = p.status ?? '';
      chip.classList.toggle('is-deaf', p.listening === 'failed');
      pick.title =
        p.listening === 'failed'
          ? tr('Não dá para ouvir {0} daqui (terminal não liberado): as mensagens ainda chegam.', [p.name])
          : many
            ? tr('Falar com {0} (ou comece a frase com o nome)', [p.name])
            : p.name;
    }
  }

  private renderAddList(): void {
    const agents = (this.ctx.store.snapshot?.agents ?? []).filter((a) => !this.parties.has(a.id) && this.callable(a));
    const full = this.parties.size >= MAX_PARTIES;
    setHidden(this.addSel, !agents.length || full);
    const key = agents.map((a) => `${a.id}:${a.name}`).join('|');
    if (this.addSel.dataset.key === key) return;
    this.addSel.dataset.key = key;
    this.addSel.replaceChildren(h('option', { text: tr('+ Chamar…'), attrs: { value: '' } }), ...agents.map((a) => h('option', { text: a.name, attrs: { value: a.id } })));
  }

  private setTarget(id: string): void {
    if (!this.parties.has(id) || this.target === id) return;
    this.target = id;
    const name = this.parties.get(id)!.name;
    this.say(tr('Falando com {0}.', [name]));
    this.ctx.invalidate();
  }

  private remove(id: string): void {
    const p = this.parties.get(id);
    if (!p) return;
    this.addLog({ kind: 'info', text: tr('{0} saiu da ligação.', [p.name]) });
    this.drop(id);
    if (!this.parties.size) this.hangUp();
    this.ctx.invalidate();
  }

  private drop(id: string): void {
    const p = this.parties.get(id);
    p?.source?.close();
    this.parties.delete(id);
    if (this.target === id) this.target = this.parties.keys().next().value ?? null;
  }

  private hangUp(): void {
    for (const id of [...this.parties.keys()]) this.drop(id);
    this.talk.cancel();
    this.stopVoice();
    this.log = [];
    this.logEl.replaceChildren();
    this.lastSpoken = null;
    this.nextIndex = 0;
    this.say('');
    setHidden(this.el, true);
    this.ctx.invalidate();
  }

  // ---------------------------------------------------------------- ouvir

  private listen(p: Party): void {
    if (this.ctx.store.mock || !this.ctx.store.snapshot?.meta.terminal || !access().terminal) {
      p.listening = 'failed';
      const why = this.ctx.store.mock
        ? tr('Na simulação (?mock=1) as respostas não são lidas: as mensagens funcionam de mentira.')
        : access().remote
          ? tr('Não dá para ouvir {0} daqui: o terminal não está liberado (HABBLAUD_REMOTE_ALLOW=terminal).', [p.name])
          : tr('Não dá para ouvir {0}: o terminal está desligado neste Habblaud (HABBLAUD_TERMINAL=0).', [p.name]);
      this.addLog({ kind: 'error', text: why });
      return;
    }
    let es: EventSource;
    try {
      es = new EventSource(terminalUrl(p.id));
    } catch {
      p.listening = 'failed';
      return;
    }
    p.source = es;
    es.addEventListener('init', (ev) => {
      if (p.source !== es) return;
      const data = parseInit((ev as MessageEvent).data);
      // A conversa de antes (ou repetida numa reconexão) só é marcada como vista.
      for (const e of data?.entries ?? []) p.seen.add(e.id);
      p.listening = 'open';
      this.ctx.invalidate();
    });
    es.addEventListener('append', (ev) => {
      if (p.source !== es) return;
      this.onEntries(p, parseAppend((ev as MessageEvent).data));
    });
    es.addEventListener('error', () => {
      if (p.source !== es || es.readyState !== ES_CLOSED) return;
      es.close();
      p.source = null;
      p.listening = 'failed';
      this.addLog({ kind: 'error', text: tr('Perdi o áudio de {0}: feche e ligue de novo.', [p.name]) });
      this.ctx.invalidate();
    });
  }

  private onEntries(p: Party, entries: TerminalEntry[]): void {
    const many = this.parties.size > 1;
    for (const e of entries) {
      if (p.seen.has(e.id)) continue;
      p.seen.add(e.id);
      if (e.kind !== 'assistant') continue;
      const text = speakableText(e.text);
      if (!text) continue;
      this.addLog({ kind: 'agent', who: p.name, text });
      this.speak(withSpeaker(text, p.name, many), p);
      this.lastSpoken = { text: withSpeaker(text, p.name, many), party: p };
    }
    this.ctx.invalidate();
  }

  // ---------------------------------------------------------------- voz

  private speak(text: string, p?: Party): void {
    if (!this.voiceOn || !text || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return;
    const lang = speechLang();
    if (!this.voices.length) this.voices = speechSynthesis.getVoices();
    const voice = p ? pickVoice(this.voices, lang, p.index) : voicesFor(this.voices, lang)[0];
    const style = p ? voiceStyle(p.seed, p.index, voicesFor(this.voices, lang).length) : { pitch: 1, rate: 1.05 };
    for (const piece of chunks(text)) {
      const u = new SpeechSynthesisUtterance(piece);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice as SpeechSynthesisVoice;
      u.pitch = style.pitch;
      u.rate = style.rate;
      speechSynthesis.speak(u);
    }
  }

  private stopVoice(): void {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  private toggleVoice(): void {
    this.voiceOn = !this.voiceOn;
    writeVoicePref(this.voiceOn);
    if (!this.voiceOn) this.stopVoice();
    this.syncVoiceBtn();
  }

  private syncVoiceBtn(): void {
    setText(this.voiceBtn, this.voiceOn ? tr('🔊 Voz') : tr('🔇 Mudo'));
    this.voiceBtn.title = this.voiceOn ? tr('Parar de ler as respostas em voz alta') : tr('Ler as respostas em voz alta');
    this.voiceBtn.setAttribute('aria-pressed', String(this.voiceOn));
    this.voiceBtn.classList.toggle('is-on', this.voiceOn);
  }

  private repeat(): void {
    if (!this.lastSpoken) return;
    this.stopVoice();
    const was = this.voiceOn;
    this.voiceOn = true;
    this.speak(this.lastSpoken.text, this.lastSpoken.party);
    this.voiceOn = was;
  }

  // ---------------------------------------------------------------- falar

  private async heard(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    const people = [...this.parties.values()].map((p) => ({ id: p.id, name: p.name }));
    const named = this.parties.size > 1 ? addressedTo(text, people) : null;
    if (named && !named.text) {
      // Só o nome: passa a falar com essa pessoa.
      this.setTarget(named.id);
      return;
    }
    // Chamar alguém pelo nome também o marca: as próximas falas sem nome vão para ele.
    if (named && named.id !== this.target) {
      this.target = named.id;
      this.ctx.invalidate();
    }
    const to = named?.id ?? this.target;
    await this.send(to, named?.text ?? text);
  }

  private async typed(): Promise<void> {
    const raw = this.input.value;
    if (!raw.trim()) return;
    this.input.value = '';
    await this.heard(raw);
  }

  private async send(to: string | null, raw: string): Promise<void> {
    const p = to ? this.parties.get(to) : undefined;
    if (!p) return this.say(tr('Ninguém na ligação para receber.'), true);
    const text = messageText(raw).slice(0, MESSAGE_MAX);
    this.addLog({ kind: 'me', who: this.parties.size > 1 ? p.name : undefined, text });
    this.say(tr('Mandando para {0}…', [p.name]));
    let r: Awaited<ReturnType<UiContext['store']['sendMessage']>>;
    try {
      r = await this.ctx.store.sendMessage(p.id, text);
    } catch {
      r = { error: tr('Sem conexão com o Habblaud.') };
    }
    if ('error' in r) {
      this.addLog({ kind: 'error', text: tr('Não chegou para {0}: {1}', [p.name, r.error]) });
      this.say(tr('Não chegou para {0}.', [p.name]), true);
      return;
    }
    const busy = p.status === 'working' || p.status === 'shell';
    this.say(busy ? tr('{0} está ocupado: a mensagem entra quando terminar o que está fazendo.', [p.name]) : tr('{0} recebeu.', [p.name]));
  }

  // ---------------------------------------------------------------- registro e situação

  private addLog(line: LogLine): void {
    this.log.push(line);
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    const li = h('li', { class: `ui-call__line is-${line.kind}` });
    if (line.kind === 'me') li.append(h('b', { text: line.who ? tr('Você → {0}: ', [line.who]) : tr('Você: ') }));
    else if (line.who) li.append(h('b', { text: `${line.who}: ` }));
    li.append(document.createTextNode(line.text));
    this.logEl.append(li);
    while (this.logEl.children.length > LOG_MAX) this.logEl.firstElementChild?.remove();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private say(text: string, error = false): void {
    setText(this.status, text);
    this.status.classList.toggle('is-error', error);
  }
}
