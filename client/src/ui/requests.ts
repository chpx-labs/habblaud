// Pedidos entre setores (botão do envelope na barra do topo): o que um setor da empresa pediu a outro, lido de
// GET /api/company/requests (server/company/requests.ts, pasta HABBLAUD_COMPANY_DIR). Abertos primeiro; um toque num
// pedido mostra o texto e as respostas. O selo conta os abertos. Sem a pasta configurada (404), o botão não aparece.
// Quem cria e responde são os agentes dos setores (bin/request.mjs da pasta da empresa); o CEO, com as mensagens
// liberadas, também pede (botão "Novo pedido", com o modelo "App novo") e responde (Aprovar, Recusar, Responder) por aqui:
// POST /api/company/requests e /api/company/requests/:id/reply, e o setor é avisado pelo escritório.
import { tr } from '../../../shared/i18n';
import { access } from '../net/access';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { relativeTime } from './format';
import { ICONS } from './icons';

export const REQUESTS_URL = '/api/company/requests';
const POLL_MS = 20_000;

export type RequestStatus = 'open' | 'in_progress' | 'done' | 'declined';

export interface CompanyRequest {
  id: string;
  from: string;
  to: string;
  title: string;
  text: string;
  status: RequestStatus;
  createdAt: number;
  updatedAt: number;
  history: { at: number; sector: string; text: string; status?: RequestStatus }[];
}

// ---------------------------------------------------------------- modelo (puro)

const STATUS = new Set<RequestStatus>(['open', 'in_progress', 'done', 'declined']);

/** Valida a resposta da API (o que não tiver o formato fica de fora). */
export function parseRequests(body: unknown): { sectors: Record<string, string>; requests: CompanyRequest[] } {
  const b = body as { sectors?: unknown; requests?: unknown } | null;
  const sectors: Record<string, string> = {};
  if (b?.sectors && typeof b.sectors === 'object') for (const [k, v] of Object.entries(b.sectors)) if (typeof v === 'string') sectors[k] = v;
  const requests = (Array.isArray(b?.requests) ? b.requests : []).filter((r): r is CompanyRequest => {
    const x = r as Partial<CompanyRequest> | null;
    return !!x && typeof x.id === 'string' && typeof x.from === 'string' && typeof x.to === 'string' && typeof x.title === 'string' && STATUS.has(x.status as RequestStatus) && Array.isArray(x.history);
  });
  return { sectors, requests };
}

export function isOpen(r: Pick<CompanyRequest, 'status'>): boolean {
  return r.status === 'open' || r.status === 'in_progress';
}

/** Nome do setor (setores.json da empresa), ou o slug mais legível. */
export function sectorName(sectors: Readonly<Record<string, string>>, slug: string): string {
  if (sectors[slug]) return sectors[slug];
  const s = slug.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Texto do pedido "App novo" (o fluxo de setor em setor está no manual geral da empresa). */
export function appNovoText(ideia: string): string {
  return [
    ideia.trim(),
    '',
    tr('Fluxo App novo (veja o manual geral): Produto e Design faz o estudo, o PRD, o nome, o preço e o design em apps/<slug>/ e pede a aprovação do CEO; depois passa ao Desenvolvimento, que constrói e pede o teste do CEO; depois ao Marketing, que prepara as lojas e pede o OK do envio; e ao Comercial e Suporte, que prepara o FAQ.'),
  ].join('\n');
}

/** Sala do CEO no prédio (world/layout/ceo.ts): recebe o envelope dos pedidos feitos a ele. */
export const CEO_ROOM = 'core:ceo';

/**
 * Pedidos abertos por sala: cada pedido conta na sala do setor de destino (a sala fixa com `sector`), e os feitos ao
 * CEO, na sala do CEO.
 */
export function roomBadges(requests: readonly CompanyRequest[], rooms: readonly { id: string; sector?: string }[]): Map<string, number> {
  const bySector = new Map<string, number>();
  for (const r of requests) if (isOpen(r)) bySector.set(r.to, (bySector.get(r.to) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const room of rooms) if (room.sector && bySector.get(room.sector)) out.set(room.id, bySector.get(room.sector)!);
  if (bySector.get('ceo')) out.set(CEO_ROOM, bySector.get('ceo')!);
  return out;
}

export function statusLabel(s: RequestStatus): string {
  switch (s) {
    case 'open':
      return tr('Aberto');
    case 'in_progress':
      return tr('Em andamento');
    case 'done':
      return tr('Feito');
    default:
      return tr('Recusado');
  }
}

// ---------------------------------------------------------------- componente

export class CompanyRequests implements UiComponent {
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly tabOpen: HTMLButtonElement;
  private readonly tabClosed: HTMLButtonElement;
  private sectors: Record<string, string> = {};
  private list: CompanyRequest[] = [];
  private showClosed = false;
  private expanded = new Set<string>();
  private probed = false;
  private available = false;
  private loading = false;
  private loaded = false;
  private error = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly newBtn: HTMLButtonElement;
  private readonly form: HTMLElement;
  private readonly formTo: HTMLSelectElement;
  private readonly formKind: HTMLSelectElement;
  private readonly formTitle: HTMLInputElement;
  private readonly formText: HTMLTextAreaElement;
  private readonly formMsg: HTMLElement;
  private sending = false;
  /** Rascunhos das respostas por pedido (sobrevivem ao redesenho da lista). */
  private drafts = new Map<string, string>();

  constructor(private readonly ctx: UiContext) {
    this.badge = h('span', { class: 'ui-deliv-badge', hidden: true, attrs: { 'aria-hidden': 'true' } });
    this.button = iconButton(ICONS.mail, tr('Pedidos entre setores'), () => this.toggle(), 'ui-btn-deliv');
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.append(this.badge);
    this.button.hidden = true;

    this.tabOpen = h('button', { class: 'ui-req-tab', type: 'button', on: { click: () => this.setTab(false) } });
    this.tabClosed = h('button', { class: 'ui-req-tab', type: 'button', text: tr('Fechados'), on: { click: () => this.setTab(true) } });
    this.listEl = h('ul', { class: 'ui-req-list', attrs: { 'aria-label': tr('Pedidos') } });
    this.empty = h('p', { class: 'ui-deliv-empty' });
    this.newBtn = h('button', { class: 'ui-btn ui-btn--sm ui-req-new', type: 'button', text: tr('+ Novo pedido'), on: { click: () => this.toggleForm() } });
    this.formTo = h('select', { class: 'ui-req-input', attrs: { 'aria-label': tr('Para qual setor') } });
    this.formKind = h(
      'select',
      { class: 'ui-req-input', attrs: { 'aria-label': tr('Tipo de pedido') } },
      h('option', { text: tr('Pedido'), attrs: { value: 'pedido' } }),
      h('option', { text: tr('App novo (ideia)'), attrs: { value: 'app' } }),
    );
    this.formTitle = h('input', { class: 'ui-req-input', type: 'text', attrs: { maxlength: 200, placeholder: tr('Título curto'), 'aria-label': tr('Título') } });
    this.formText = h('textarea', { class: 'ui-req-input ui-req-area', attrs: { rows: 4, maxlength: 8000, placeholder: tr('O que precisa, por quê e para quando'), 'aria-label': tr('Texto do pedido') } });
    this.formKind.addEventListener('change', () => {
      const app = this.formKind.value === 'app';
      if (app) this.formTo.value = 'produto-design';
      this.formTitle.placeholder = app ? tr('Nome provisório do app') : tr('Título curto');
      this.formText.placeholder = app ? tr('A ideia: para quem é, o problema que resolve, o que ele faz') : tr('O que precisa, por quê e para quando');
    });
    this.formMsg = h('p', { class: 'ui-req-msg', role: 'status' });
    this.form = h(
      'div',
      { class: 'ui-req-form', hidden: true },
      h('div', { class: 'ui-req-row' }, this.formKind, this.formTo),
      this.formTitle,
      this.formText,
      h(
        'div',
        { class: 'ui-req-row' },
        h('button', { class: 'ui-btn ui-btn--primary ui-btn--sm', type: 'button', text: tr('Enviar pedido'), on: { click: () => void this.createRequest() } }),
        h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Cancelar'), on: { click: () => this.toggleForm(false) } }),
      ),
      this.formMsg,
    );
    for (const el of [this.formTitle, this.formText]) el.addEventListener('keydown', (e) => e.stopPropagation());
    this.el = h(
      'div',
      { class: 'ui-popover ui-deliv ui-req', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Pedidos entre setores'), popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Pedidos entre setores') }), iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm')),
      h('p', { class: 'ui-deliv-lead', text: tr('O que um setor pediu a outro. Toque num pedido para ver o texto e as respostas.') }),
      h('div', { class: 'ui-req-tabs', role: 'tablist' }, this.tabOpen, this.tabClosed, this.newBtn),
      this.form,
      this.empty,
      this.listEl,
    );
    this.el.addEventListener('toggle', () => {
      this.button.setAttribute('aria-expanded', String(this.isShown));
      this.button.classList.toggle('is-on', this.isShown);
    });
  }

  private get isShown(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  render(): void {
    const store = this.ctx.store;
    // salas mudaram (uma sala de setor apareceu): refaz os envelopes do prédio
    const key = (store.snapshot?.rooms ?? []).map((r) => `${r.id}:${r.sector ?? ''}`).join('|');
    if (key !== this.roomsKey) {
      this.roomsKey = key;
      this.pushRoomBadges();
    }
    if (this.probed || store.mock || store.replaying || !store.snapshot) return;
    this.probed = true;
    void this.refresh();
  }

  private roomsKey = '';

  private pushRoomBadges(): void {
    const rooms = this.ctx.store.replaying ? [] : (this.ctx.store.snapshot?.rooms ?? []);
    this.ctx.world.setRoomBadges?.(roomBadges(this.available ? this.list : [], rooms));
  }

  private toggle(): void {
    if (this.isShown) return this.hide();
    this.paint();
    const r = this.button.getBoundingClientRect();
    this.el.style.top = `${Math.round(r.bottom + 8)}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    void this.refresh();
  }

  private hide(): void {
    if (typeof this.el.hidePopover === 'function' && this.isShown) this.el.hidePopover();
    this.el.classList.remove('is-open');
  }

  /** O CEO pode pedir e responder daqui (mensagens liberadas para esta página). */
  private get canWrite(): boolean {
    return access().messages && !this.ctx.store.replaying;
  }

  private toggleForm(on = this.form.hidden): void {
    if (on) {
      const opts = Object.keys(this.sectors).filter((k) => k !== 'ceo');
      this.formTo.replaceChildren(...opts.map((k) => h('option', { text: sectorName(this.sectors, k), attrs: { value: k } })));
      if (this.formKind.value === 'app') this.formTo.value = 'produto-design';
      setText(this.formMsg, '');
    }
    setHidden(this.form, !on);
    if (on) this.formTitle.focus();
  }

  private async post(url: string, body: unknown): Promise<{ notified?: string }> {
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { error?: string; notified?: string };
    if (!res.ok) throw new Error(out.error ?? tr('erro {0}', [res.status]));
    return out;
  }

  private async createRequest(): Promise<void> {
    if (this.sending) return;
    const app = this.formKind.value === 'app';
    const title = this.formTitle.value.trim();
    const ideia = this.formText.value.trim();
    if (!title) return void setText(this.formMsg, tr('Dê um título ao pedido.'));
    this.sending = true;
    setText(this.formMsg, tr('Enviando…'));
    try {
      const out = await this.post(REQUESTS_URL, { to: this.formTo.value, title: app ? tr('App novo: {0}', [title]) : title, text: app ? appNovoText(ideia || title) : ideia });
      this.formTitle.value = '';
      this.formText.value = '';
      this.toggleForm(false);
      this.ctx.announce(out.notified ? tr('Pedido enviado: {0}.', [out.notified]) : tr('Pedido enviado.'));
      this.showClosed = false;
      await this.refresh();
    } catch (err) {
      setText(this.formMsg, tr('Não deu para enviar: {0}', [(err as Error).message]));
    } finally {
      this.sending = false;
    }
  }

  private async reply(r: CompanyRequest, status: RequestStatus | undefined, input: HTMLTextAreaElement, msg: HTMLElement): Promise<void> {
    if (this.sending) return;
    const text = input.value.trim() || (status === 'done' ? tr('Aprovado.') : status === 'declined' ? tr('Recusado.') : '');
    if (!text) return void setText(msg, tr('Escreva a resposta.'));
    this.sending = true;
    setText(msg, tr('Enviando…'));
    try {
      const out = await this.post(`${REQUESTS_URL}/${encodeURIComponent(r.id)}/reply`, { text, ...(status ? { status } : {}) });
      this.drafts.delete(r.id);
      this.ctx.announce(out.notified ? tr('Resposta enviada: {0}.', [out.notified]) : tr('Resposta enviada.'));
      await this.refresh();
    } catch (err) {
      setText(msg, tr('Não deu para enviar: {0}', [(err as Error).message]));
    } finally {
      this.sending = false;
    }
  }

  private setTab(closed: boolean): void {
    this.showClosed = closed;
    this.paint();
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const res = await fetch(REQUESTS_URL, { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 404 && !this.loaded) {
        // sem pasta da empresa: sem botão
        this.setAvailable(false);
        return;
      }
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? tr('erro {0}', [res.status]));
      const r = parseRequests(body);
      this.sectors = r.sectors;
      this.list = r.requests;
      this.loaded = true;
      this.error = '';
      this.setAvailable(true);
    } catch (err) {
      this.error = (err as Error).message || tr('não deu para carregar');
    } finally {
      this.loading = false;
      this.updateBadge();
      if (this.isShown) this.paint();
    }
  }

  private setAvailable(on: boolean): void {
    if (on === this.available) return;
    this.available = on;
    setHidden(this.button, !on);
    if (on && !this.timer)
      this.timer = setInterval(() => {
        if (!document.hidden) void this.refresh();
      }, POLL_MS);
    this.ctx.invalidate();
  }

  private updateBadge(): void {
    const n = this.list.filter(isOpen).length;
    setText(this.badge, String(n));
    setHidden(this.badge, !n);
    this.button.title = n ? tr('Pedidos entre setores: {0} abertos', [n]) : tr('Pedidos entre setores');
    this.pushRoomBadges();
  }

  private paint(): void {
    const open = this.list.filter(isOpen);
    const closed = this.list.filter((r) => !isOpen(r));
    setText(this.tabOpen, tr('Abertos ({0})', [open.length]));
    setHidden(this.newBtn, !this.canWrite);
    this.tabOpen.setAttribute('aria-selected', String(!this.showClosed));
    this.tabClosed.setAttribute('aria-selected', String(this.showClosed));
    const shown = this.showClosed ? closed : open;
    const now = Date.now();
    setHidden(this.empty, shown.length > 0);
    setText(
      this.empty,
      this.error
        ? tr('Não deu para carregar: {0}', [this.error])
        : !this.loaded
          ? tr('Carregando os pedidos…')
          : this.showClosed
            ? tr('Nenhum pedido fechado ainda.')
            : tr('Nenhum pedido aberto entre os setores.'),
    );
    this.listEl.replaceChildren(...shown.map((r) => h('li', {}, this.card(r, now))));
  }

  /** Responder um pedido aberto: Aprovar/Recusar nos que foram feitos ao CEO; comentar nos outros. */
  private replyBox(r: CompanyRequest): HTMLElement {
    const input = h('textarea', { class: 'ui-req-input ui-req-area', attrs: { rows: 2, maxlength: 4000, placeholder: r.to === 'ceo' ? tr('Sua resposta (opcional ao aprovar)') : tr('Comentário para o setor'), 'aria-label': tr('Resposta') } });
    input.value = this.drafts.get(r.id) ?? '';
    input.addEventListener('input', () => this.drafts.set(r.id, input.value));
    input.addEventListener('keydown', (e) => e.stopPropagation());
    const msg = h('p', { class: 'ui-req-msg', role: 'status' });
    const btn = (label: string, status: RequestStatus | undefined, primary = false) =>
      h('button', { class: `ui-btn ui-btn--sm${primary ? ' ui-btn--primary' : ''}`, type: 'button', text: label, on: { click: () => void this.reply(r, status, input, msg) } });
    const buttons = r.to === 'ceo' ? [btn(tr('Aprovar'), 'done', true), btn(tr('Recusar'), 'declined'), btn(tr('Responder'), undefined)] : [btn(tr('Comentar'), undefined)];
    return h('div', { class: 'ui-req-replybox' }, input, h('div', { class: 'ui-req-row' }, ...buttons), msg);
  }

  private card(r: CompanyRequest, now: number): HTMLElement {
    const open = this.expanded.has(r.id);
    const name = (s: string) => sectorName(this.sectors, s);
    const head = h(
      'button',
      {
        class: 'ui-req-card__head',
        type: 'button',
        attrs: { 'aria-expanded': String(open) },
        on: {
          click: () => {
            if (this.expanded.has(r.id)) this.expanded.delete(r.id);
            else this.expanded.add(r.id);
            this.paint();
          },
        },
      },
      h('span', { class: `ui-req-status is-${r.status}`, text: statusLabel(r.status) }),
      h('span', { class: 'ui-req-route', text: `${name(r.from)} → ${name(r.to)}` }),
      h('span', { class: 'ui-req-when', text: relativeTime(isOpen(r) ? r.createdAt : r.updatedAt, now) }),
      h('span', { class: 'ui-req-title', text: r.title }),
    );
    const card = h('div', { class: `ui-req-card${open ? ' is-open' : ''}` }, head);
    if (open) {
      const body = h('div', { class: 'ui-req-card__body' }, h('p', { class: 'ui-req-text', text: r.text }));
      for (const e of r.history) {
        body.append(
          h(
            'div',
            { class: 'ui-req-reply' },
            h('b', { text: name(e.sector) }),
            h('span', { class: 'ui-req-when', text: `${relativeTime(e.at, now)}${e.status ? ` · ${statusLabel(e.status)}` : ''}` }),
            e.text ? h('p', { class: 'ui-req-text', text: e.text }) : null,
          ),
        );
      }
      if (!r.history.length) body.append(h('p', { class: 'ui-req-none', text: tr('Ainda sem resposta.') }));
      if (this.canWrite && isOpen(r)) body.append(this.replyBox(r));
      body.append(h('p', { class: 'ui-req-id', text: r.id }));
      card.append(body);
    }
    return card;
  }
}
