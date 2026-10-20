// Pedidos entre setores (botão do envelope na barra do topo): o que um setor da empresa pediu a outro, lido de
// GET /api/company/requests (server/company/requests.ts, pasta HABBLAUD_COMPANY_DIR). Abertos primeiro; um toque num
// pedido mostra o texto e as respostas. O selo conta os abertos. Sem a pasta configurada (404), o botão não aparece.
// Só leitura: quem cria e responde são os agentes dos setores (bin/pedido.mjs da pasta da empresa).
import { tr } from '../../../shared/i18n';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { relativeTime } from './format';
import { ICONS } from './icons';

export const REQUESTS_URL = '/api/company/requests';
const POLL_MS = 20_000;

export type RequestStatus = 'aberto' | 'andamento' | 'feito' | 'recusado';

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

const STATUS = new Set<RequestStatus>(['aberto', 'andamento', 'feito', 'recusado']);

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
  return r.status === 'aberto' || r.status === 'andamento';
}

/** Nome do setor (setores.json da empresa), ou o slug mais legível. */
export function sectorName(sectors: Readonly<Record<string, string>>, slug: string): string {
  if (sectors[slug]) return sectors[slug];
  const s = slug.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function statusLabel(s: RequestStatus): string {
  switch (s) {
    case 'aberto':
      return tr('Aberto');
    case 'andamento':
      return tr('Em andamento');
    case 'feito':
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
    this.el = h(
      'div',
      { class: 'ui-popover ui-deliv ui-req', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Pedidos entre setores'), popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Pedidos entre setores') }), iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm')),
      h('p', { class: 'ui-deliv-lead', text: tr('O que um setor pediu a outro. Toque num pedido para ver o texto e as respostas.') }),
      h('div', { class: 'ui-req-tabs', role: 'tablist' }, this.tabOpen, this.tabClosed),
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
    if (this.probed || store.mock || store.replaying || !store.snapshot) return;
    this.probed = true;
    void this.refresh();
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
  }

  private paint(): void {
    const open = this.list.filter(isOpen);
    const closed = this.list.filter((r) => !isOpen(r));
    setText(this.tabOpen, tr('Abertos ({0})', [open.length]));
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
      body.append(h('p', { class: 'ui-req-id', text: r.id }));
      card.append(body);
    }
    return card;
  }
}
