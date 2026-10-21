// Painel do CEO (botão da maleta na barra do topo, tecla B): o dia da empresa num lugar só. Do servidor
// (GET /api/company/dashboard, server/company/dashboard.ts): o que cada setor registrou hoje no diário, as entregas do
// dia, o turno, os pedidos que esperam você (com Aprovar/Recusar aqui mesmo) e os parados há mais de um dia. Do
// escritório (snapshot): quem está aberto em cada setor, os tokens das sessões abertas e o uso das contas.
// Sem a pasta da empresa (HABBLAUD_COMPANY_DIR), o botão não aparece.
import { tr } from '../../../shared/i18n';
import type { AgentInfo, OfficeSnapshot } from '../../../shared/types';
import { access } from '../net/access';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { formatResetAt, formatTokens, relativeTime } from './format';
import { ICONS } from './icons';
import type { CompanyRequest } from './requests';
import { sectorName } from './requests';

export const DASHBOARD_URL = '/api/company/dashboard';

export interface SectorDay {
  slug: string;
  name: string;
  diary: { time?: string; text: string }[];
  deliveries: { name: string; at: number }[];
  turn: { active: boolean; time: string; ranToday: boolean } | null;
}

export interface CompanyDashboard {
  day: string;
  sectors: SectorDay[];
  waiting: CompanyRequest[];
  stale: CompanyRequest[];
  open: number;
}

/** Maleta em pixels (o mesmo traço dos outros ícones da barra). */
const BRIEFCASE_ICON =
  '<svg class="ui-px-icon" width="20" height="20" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M3 1h4v1H3zM3 2h1v1H3zM6 2h1v1H6zM0 3h10v6H0zM1 4v1h8V4zM4 5h2v1H4z"/></svg>';

// ---------------------------------------------------------------- modelo (puro)

export function parseDashboard(body: unknown): CompanyDashboard | null {
  const b = body as Partial<CompanyDashboard> | null;
  if (!b || typeof b.day !== 'string' || !Array.isArray(b.sectors) || !Array.isArray(b.waiting) || !Array.isArray(b.stale)) return null;
  return { day: b.day, sectors: b.sectors, waiting: b.waiting, stale: b.stale, open: typeof b.open === 'number' ? b.open : 0 };
}

export interface SectorLive {
  /** Agentes principais abertos na sala do setor. */
  agents: { name: string; status: AgentInfo['status'] }[];
  /** Tokens (entrada + saída) das sessões abertas no setor. */
  tokens: number;
}

/** O que o escritório sabe agora de cada setor (pela sala fixa com `sector`). */
export function sectorLive(snap: Pick<OfficeSnapshot, 'rooms' | 'agents'> | null): Map<string, SectorLive> {
  const out = new Map<string, SectorLive>();
  if (!snap) return out;
  const sectorOf = new Map(snap.rooms.filter((r) => r.sector).map((r) => [r.id, r.sector!]));
  for (const a of snap.agents) {
    const s = sectorOf.get(a.roomId);
    if (!s) continue;
    const cur = out.get(s) ?? { agents: [], tokens: 0 };
    if (a.kind === 'main' && a.status !== 'offline' && a.status !== 'done') cur.agents.push({ name: a.name, status: a.status });
    cur.tokens += (a.stats?.tokensIn ?? 0) + (a.stats?.tokensOut ?? 0);
    out.set(s, cur);
  }
  return out;
}

/** "Trabalhando" vence "parado": o resumo de uma linha do setor. */
export function sectorState(live: SectorLive | undefined): 'working' | 'waiting' | 'idle' | 'closed' {
  if (!live || !live.agents.length) return 'closed';
  if (live.agents.some((a) => a.status === 'waiting')) return 'waiting';
  if (live.agents.some((a) => a.status === 'working' || a.status === 'shell')) return 'working';
  return 'idle';
}

function stateLabel(s: ReturnType<typeof sectorState>): string {
  switch (s) {
    case 'working':
      return tr('Trabalhando');
    case 'waiting':
      return tr('Precisa de você');
    case 'idle':
      return tr('Parado');
    default:
      return tr('Fechado');
  }
}

// ---------------------------------------------------------------- componente

export class CeoDashboard implements UiComponent {
  readonly button: HTMLButtonElement;
  readonly el: HTMLDialogElement;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private data: CompanyDashboard | null = null;
  private sectors: Record<string, string> = {};
  private probed = false;
  private available = false;
  private loading = false;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ctx: UiContext) {
    this.button = iconButton(BRIEFCASE_ICON, tr('Painel do CEO (B)'), () => this.toggle());
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.hidden = true;
    this.status = h('p', { class: 'ui-ceo-dash__status', role: 'status' });
    this.body = h('div', { class: 'ui-dialog__body ui-ceo-dash__body' });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.el.close(), 'ui-icon-btn--sm');
    const reload = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Atualizar'), on: { click: () => void this.refresh() } });
    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-ceo-dash', attrs: { 'aria-labelledby': 'ui-ceo-dash-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Painel do CEO'), attrs: { id: 'ui-ceo-dash-title' } }), this.status, reload, close),
      this.body,
    ) as HTMLDialogElement;
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
    this.el.addEventListener('close', () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    });
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  render(): void {
    const store = this.ctx.store;
    if (this.el.open && this.data) this.paint();
    if (this.probed || store.mock || store.replaying || !store.snapshot) return;
    this.probed = true;
    void this.refresh();
  }

  toggle(): void {
    if (!this.available) return;
    if (this.el.open) return this.el.close();
    this.el.showModal();
    this.paint();
    void this.refresh();
    this.timer ??= setInterval(() => void this.refresh(), 30_000);
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const [res, reqs] = await Promise.all([fetch(DASHBOARD_URL, { credentials: 'same-origin', cache: 'no-store' }), fetch('/api/company/requests', { credentials: 'same-origin', cache: 'no-store' })]);
      if (res.status === 404 && !this.data) {
        this.available = false;
        setHidden(this.button, true);
        return;
      }
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? tr('erro {0}', [res.status]));
      this.data = parseDashboard(body);
      const r = (await reqs.json().catch(() => ({}))) as { sectors?: Record<string, string> };
      if (r.sectors) this.sectors = r.sectors;
      if (!this.available) {
        this.available = true;
        setHidden(this.button, false);
        this.ctx.invalidate();
      }
      setText(this.status, '');
    } catch (err) {
      setText(this.status, tr('Não deu para atualizar: {0}', [(err as Error).message]));
    } finally {
      this.loading = false;
      if (this.el.open) this.paint();
    }
  }

  private async decide(r: CompanyRequest, status: 'done' | 'declined'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res = await fetch(`/api/company/requests/${encodeURIComponent(r.id)}/reply`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: status === 'done' ? tr('Aprovado.') : tr('Recusado.'), status }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string; notified?: string };
      if (!res.ok) throw new Error(out.error ?? tr('erro {0}', [res.status]));
      this.ctx.announce(out.notified ? tr('Resposta enviada: {0}.', [out.notified]) : tr('Resposta enviada.'));
    } catch (err) {
      setText(this.status, tr('Não deu para enviar: {0}', [(err as Error).message]));
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }

  private paint(): void {
    const d = this.data;
    if (!d) {
      this.body.replaceChildren(h('p', { class: 'ui-muted', text: tr('Carregando o painel…') }));
      return;
    }
    const snap = this.ctx.store.snapshot;
    const live = sectorLive(snap);
    const now = Date.now();
    const name = (s: string) => sectorName(this.sectors, s);
    const deliveriesToday = d.sectors.reduce((n, s) => n + s.deliveries.length, 0);

    const stat = (value: number, label: string, tone = '') => h('div', { class: `ui-ceo-dash__stat${tone ? ` is-${tone}` : ''}` }, h('b', { text: String(value) }), h('span', { text: label }));
    const top = h(
      'div',
      { class: 'ui-ceo-dash__stats' },
      stat(d.waiting.length, tr('esperando você'), d.waiting.length ? 'warn' : ''),
      stat(d.open, tr('pedidos abertos')),
      stat(d.stale.length, tr('parados há mais de 1 dia'), d.stale.length ? 'bad' : ''),
      stat(deliveriesToday, tr('entregas nas últimas 24 h')),
    );

    const canWrite = access().messages && !this.ctx.store.replaying;
    const reqLine = (r: CompanyRequest, actions: boolean) =>
      h(
        'li',
        { class: 'ui-ceo-dash__req' },
        h('span', { class: 'ui-ceo-dash__req-title', text: r.title }),
        h('span', { class: 'ui-muted', text: `${name(r.from)} → ${name(r.to)} · ${relativeTime(Math.max(r.createdAt, r.updatedAt), now)}` }),
        actions && canWrite
          ? h(
              'span',
              { class: 'ui-ceo-dash__req-actions' },
              h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('Aprovar'), on: { click: () => void this.decide(r, 'done') } }),
              h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Recusar'), on: { click: () => void this.decide(r, 'declined') } }),
            )
          : null,
      );

    const section = (title: string, ...children: (Node | null)[]) => h('section', { class: 'ui-ceo-dash__sec' }, h('h3', { text: title }), ...children);

    const waiting = section(
      tr('Esperando você'),
      d.waiting.length ? h('ul', { class: 'ui-ceo-dash__reqs' }, ...d.waiting.map((r) => reqLine(r, true))) : h('p', { class: 'ui-muted', text: tr('Nada esperando você.') }),
    );

    const cards = d.sectors.map((s) => {
      const l = live.get(s.slug);
      const st = sectorState(l);
      const turn = s.turn ? (s.turn.active ? (s.turn.ranToday ? tr('Turno de hoje: feito ({0})', [s.turn.time]) : tr('Turno de hoje: às {0}', [s.turn.time])) : tr('Turno desligado')) : '';
      return h(
        'article',
        { class: 'ui-ceo-dash__card' },
        h(
          'header',
          {},
          h('b', { text: s.name }),
          h('span', { class: `ui-ceo-dash__state is-${st}`, text: stateLabel(st) }),
        ),
        h('p', { class: 'ui-muted ui-small', text: [l?.agents.map((a) => a.name).join(', '), turn, l?.tokens ? tr('{0} tokens nas sessões abertas', [formatTokens(l.tokens)]) : ''].filter(Boolean).join(' · ') || tr('Ninguém aberto') }),
        s.diary.length
          ? h('ul', { class: 'ui-ceo-dash__diary' }, ...s.diary.map((x) => h('li', {}, x.time ? h('span', { class: 'ui-ceo-dash__time', text: x.time }) : null, document.createTextNode(x.text))))
          : h('p', { class: 'ui-muted ui-small', text: tr('Nada no diário hoje.') }),
        s.deliveries.length ? h('p', { class: 'ui-small' }, h('b', { text: tr('Entregas: ') }), document.createTextNode(s.deliveries.map((x) => x.name).join(', '))) : null,
      );
    });
    const today = section(tr('Hoje em cada setor'), h('div', { class: 'ui-ceo-dash__cards' }, ...cards));

    const stale = section(
      tr('Pedidos parados'),
      d.stale.length ? h('ul', { class: 'ui-ceo-dash__reqs' }, ...d.stale.map((r) => reqLine(r, false))) : h('p', { class: 'ui-muted', text: tr('Nenhum pedido parado há mais de um dia.') }),
    );

    const accounts = (snap?.accounts ?? []).filter((a) => a.usage);
    const bar = (label: string, pct: number | undefined, resetsAt: number | undefined) =>
      pct === undefined
        ? null
        : h(
            'div',
            { class: 'ui-ceo-dash__usage' },
            h('span', { text: label }),
            h('span', { class: 'ui-ceo-dash__bar' }, h('span', { class: `ui-ceo-dash__fill${pct >= 80 ? ' is-bad' : pct >= 60 ? ' is-warn' : ''}`, attrs: { style: `width:${Math.min(100, Math.max(0, pct))}%` } })),
            h('span', { text: `${Math.round(pct)}%${resetsAt ? ` · ${formatResetAt(resetsAt, now)}` : ''}` }),
          );
    const usage = section(
      tr('Uso da conta'),
      accounts.length
        ? h(
            'div',
            {},
            ...accounts.map((a) =>
              h('div', { class: 'ui-ceo-dash__acc' }, h('b', { text: a.name }), bar(tr('5 h'), a.usage?.fiveHour?.utilization, a.usage?.fiveHour?.resetsAt), bar(tr('Semana'), a.usage?.sevenDay?.utilization, a.usage?.sevenDay?.resetsAt)),
            ),
          )
        : h('p', { class: 'ui-muted', text: tr('Sem números de uso (instale o mod do Habblaud: npm run mod:install).') }),
      h('p', { class: 'ui-muted ui-small', text: tr('Os turnos dos setores entram neste limite: se a semana passar de 80%, desligue algum turno em C:\\empresa\\turnos.json.') }),
    );

    this.body.replaceChildren(top, waiting, today, stale, usage);
  }
}
