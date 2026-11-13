// Ядро клиента: состояние, i18n, безопасный шаблонизатор, API, роутер, окна, карты, фото, realtime.
export const state = {
  user: null, config: null, overrides: {},
  lang: safeGet('mba.lang') || '', installPrompt: null
};
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } }

/* ---------- i18n ---------- */
// t(ключ, ru, en): ключи перечислены прямо в коде, администратор может переопределить любой текст в разделе «Переводы».
export function t(key, ru, en) {
  const o = state.overrides[key];
  if (o) return o;
  return state.lang === 'en' ? (en ?? ru) : ru;
}
export const tr = (ru, en) => (state.lang === 'en' ? en : ru);
export const dict = (type) => (state.config?.dicts?.[type] || []).map((d) => (state.lang === 'en' ? d.en : d.ru));

/* ---------- безопасный шаблонизатор ---------- */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function fmtVal(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmtVal).join('');
  return esc(v);
}
export function h(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += fmtVal(vals[i]); });
  return new Raw(out);
}
export function mount(el, tpl) { el.innerHTML = tpl instanceof Raw ? tpl.s : Array.isArray(tpl) ? fmtVal(tpl) : esc(tpl); return el; }
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- иконки: Phosphor (regular / fill / duotone), viewBox 256 ---------- */
import { R as IR, F as IF, D as ID } from './icons.js';
// icon('map') — контурная; icon('map', '', 'fill') — залитая; icon('paw', '', 'duo') — двухтоновая.
// неизвестное имя иконки — предупреждение в консоли (иначе вместо неё молча рисуются три точки)
export const icon = (name, cls = '', v = '') => (IR[name] || console.warn('[icon] нет иконки: ' + name), raw(`<svg class="ic ${cls}" viewBox="0 0 256 256" aria-hidden="true">${(v === 'fill' ? IF[name] : v === 'duo' ? ID[name] : 0) || IR[name] || IR.more}</svg>`));
export const iconSvg = (name, v = 'fill') => `<svg viewBox="0 0 256 256">${(v === 'fill' ? IF[name] : 0) || IR[name] || ''}</svg>`;

export const CAT = {
  people: { icon: 'user', ru: 'Люди', en: 'People', one_ru: 'Человек', one_en: 'Person' },
  animals: { icon: 'paw', ru: 'Животные', en: 'Animals', one_ru: 'Животное', one_en: 'Animal' },
  things: { icon: 'key', ru: 'Вещи', en: 'Things', one_ru: 'Вещь', one_en: 'Item' }
};
// Заглушка «без фото»: фирменные кольца-радар + двухтоновая иконка категории.
export const mediaPh = (cat, cls = '', ic = '', label = '') => h`<div class="media-ph c-${cat} ${cls}"><span class="ph-ic">${icon(ic || CAT[cat]?.icon || 'pin', '', 'duo')}</span><span class="ph-t">${label || tr('Без фото', 'No photo')}</span></div>`;
export const catName = (c) => tr(CAT[c]?.ru, CAT[c]?.en);
export const kindName = (k) => (k === 'lost' ? t('kind.lost', 'Потеряно', 'Lost') : t('kind.found', 'Найдено', 'Found'));
export const statusName = (s) => ({
  pending: t('status.pending', 'На проверке', 'Under review'), published: t('status.published', 'Опубликована', 'Published'),
  found: t('status.found', 'Найдено', 'Found'), closed: t('status.closed', 'Закрыта', 'Closed'), rejected: t('status.rejected', 'Отклонена', 'Rejected')
}[s] || s);
export const statusChip = (s) => ({ pending: 'chip-warn', published: 'chip-ok', found: 'chip-found', closed: '', rejected: 'chip-lost' }[s] || '');

/* ---------- форматирование ---------- */
const locale = () => (state.lang === 'en' ? 'en-GB' : 'ru-RU');
function parseDate(s) { if (!s) return null; return new Date(/^\d{4}-\d\d-\d\d \d/.test(s) ? s.replace(' ', 'T') + 'Z' : s); }
export function fmtDate(s, withTime) {
  const d = parseDate(s); if (!d || isNaN(d)) return '';
  return d.toLocaleDateString(locale(), withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'long', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
export function ago(s) {
  const d = parseDate(s); if (!d || isNaN(d)) return '';
  const sec = Math.max(1, (Date.now() - d) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (sec < 60) return tr('только что', 'just now');
  if (sec < 3600) return rtf.format(-Math.round(sec / 60), 'minute');
  if (sec < 86400) return rtf.format(-Math.round(sec / 3600), 'hour');
  if (sec < 86400 * 7) return rtf.format(-Math.round(sec / 86400), 'day');
  return fmtDate(s);
}
export const timeOf = (s) => { const d = parseDate(s); return d ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : ''; };
export const km = (d) => (d == null ? '' : d < 1 ? Math.round(d * 1000) + ' ' + tr('м', 'm') : d.toFixed(d < 10 ? 1 : 0) + ' ' + tr('км', 'km'));
export const money = (n) => new Intl.NumberFormat(locale()).format(n) + ' ₽';
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };

/* ---------- API ---------- */
export async function api(method, url, body) {
  const opt = { method, headers: { 'X-Requested-With': 'mba', 'X-Lang': state.lang === 'en' ? 'en' : 'ru' }, credentials: 'same-origin' }; // X-Lang — язык системных уведомлений
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + url, opt); } catch (e) { const er = new Error(tr('Нет соединения с сервером', 'No connection to the server')); er.code = 'offline'; throw er; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const er = new Error(data.message || tr('Ошибка запроса', 'Request failed')); er.code = data.error; er.status = res.status;
    if (res.status === 401 && state.user) { state.user = null; renderChrome(); }
    throw er;
  }
  return data;
}
export const GET = (u) => api('GET', u);
export const POST = (u, b = {}) => api('POST', u, b);
export const PATCH = (u, b = {}) => api('PATCH', u, b);
export const DEL = (u) => api('DELETE', u);

export async function refreshMe() {
  const r = await GET('/me'); state.user = r.user; renderChrome(); appBadge(r.user ? r.user.unread : 0); return r.user;
}

/* ---------- роутер ---------- */
const routes = [];
let leaveFns = [];
export function route(pattern, handler, opts = {}) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, opts }); }
export function onLeave(fn) { leaveFns.push(fn); }
// Рамка раздела (например, личного кабинета): fn(view, path) рисует меню и возвращает контейнер для содержимого страницы или null
let shellFn = null;
export function setShell(fn) { shellFn = fn; }
export function go(hash) { if (location.hash === hash) handleRoute(); else location.hash = hash; }
export const currentPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0].split('#')[0].replace(/(.)\/+$/, '$1');
export const query = () => new URLSearchParams(location.hash.split('?')[1] || '');
let rendering = 0;
export async function handleRoute() {
  const path = currentPath();
  leaveFns.forEach((f) => { try { f(); } catch (e) { /* noop */ } }); leaveFns = [];
  document.body.classList.remove('map-open');
  closeAllSheets();
  const r = routes.find((x) => x.re.test(path)) || routes.find((x) => x.opts.notFound);
  const params = (r.re.exec(path) || {}).groups || {};
  if (r.opts.auth && !state.user) { go('#/login?next=' + encodeURIComponent('#' + path)); return; }
  const view = $('#view');
  const denied = (r.opts.mod && !(state.user && ['moderator', 'admin'].includes(state.user.role))) || (r.opts.admin && !(state.user && state.user.role === 'admin'));
  if (denied) {
    ++rendering; document.body.dataset.route = 'denied'; renderChrome(); view.className = 'view';
    mount(view, h`<div class="wrap"><div class="empty" style="margin-top:40px">${icon('lock')}<b>${tr('Нет доступа к этому разделу', 'No access to this section')}</b>${r.opts.admin ? tr('Раздел доступен только администратору.', 'This section is for administrators only.') : tr('Раздел доступен модераторам и администраторам.', 'This section is for moderators and administrators.')}<div class="row" style="justify-content:center;gap:10px;margin-top:16px;flex-wrap:wrap">${r.opts.admin && state.user && state.user.role === 'moderator' ? h`<a class="btn btn-sm" href="#/admin">${tr('В админ-панель', 'Admin panel')}</a>` : ''}<a class="btn btn-ghost btn-sm" href="#/">${tr('На главную', 'Home')}</a></div></div></div>`);
    window.scrollTo({ top: 0, behavior: 'instant' }); return;
  }
  const id = ++rendering;
  document.body.dataset.route = path.split('/')[1] || 'home';
  renderChrome();
  const run = async () => {
    view.className = 'view' + (r.opts.full ? ' full' : '');
    view.innerHTML = '';
    const target = (!r.opts.full && !r.opts.notFound && shellFn && shellFn(view, path)) || view;
    try { await r.handler(target, params); } catch (e) {
      if (id !== rendering) return;
      if (e.status === 404) document.title = `${tr('Не найдено', 'Not found')} — ${tr('Мой лучший агент', 'My Best Agent')}`;
      mount(target, h`<div class="wrap"><div class="empty" style="margin-top:40px">${icon('alert')}<b>${e.status === 404 ? tr('Не найдено', 'Not found') : tr('Что-то пошло не так', 'Something went wrong')}</b>${e.message}<div style="margin-top:16px"><a class="btn btn-ghost btn-sm" href="#/">${tr('На главную', 'Home')}</a></div></div></div>`);
    }
    if (!r.opts.keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
    observeReveal(view);
    // после перехода фокус теряется вместе со старым экраном — переносим его в начало нового (клавиатура, экранный диктор)
    const ae = document.activeElement;
    if (id > 1 && id === rendering && (!ae || ae === document.body || !ae.isConnected)) { view.tabIndex = -1; view.focus({ preventScroll: true }); }
  };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches && view.childElementCount) {
    // При быстрых переходах браузер прерывает предыдущую анимацию (ready/finished отклоняются) — это не ошибка.
    // Ошибки самой отрисовки страницы по-прежнему видны: их сообщает updateCallbackDone.
    const vt = document.startViewTransition(run);
    vt.ready.catch(() => {}); vt.finished.catch(() => {});
  }
  else await run();
}

/* ---------- появление при прокрутке ---------- */
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' }) : null;
export function observeReveal(root) { $$('.reveal', root).forEach((el) => (io ? io.observe(el) : el.classList.add('in'))); }

/* ---------- оболочка: навигация, счётчики ---------- */
let chromeHook = () => {};
export function setChrome(fn) { chromeHook = fn; }
export function renderChrome() { chromeHook(); }

/* ---------- уведомления на экране ---------- */
export function toast(msg, type = 'ok', sub = '', onClick) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  mount(el, h`${icon(type === 'err' ? 'alert' : type === 'info' ? 'bell' : 'check')}<div class="grow">${msg}${sub ? h`<small>${sub}</small>` : ''}</div>`);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.onclick = () => { if (onClick) onClick(); close(); };
  box.appendChild(el);
  setTimeout(close, type === 'err' ? 5200 : 3800);
}
export const toastErr = (e) => toast(e.message || String(e), 'err');

/* ---------- нижние листы / модальные окна ---------- */
const sheets = new Set();
export function sheet(tpl, { wide = false, onClose } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="grab"></div></div>`;
  const sh = ov.firstChild;
  sh.insertAdjacentHTML('beforeend', tpl instanceof Raw ? tpl.s : esc(tpl));
  // доступность: заголовок окна — его имя; фокус уходит в окно, Tab не выходит за его пределы, после закрытия фокус возвращается
  const head = sh.querySelector('h1, h2, h3');
  if (head) { head.id = head.id || 'sh' + Math.random().toString(36).slice(2, 8); sh.setAttribute('aria-labelledby', head.id); }
  sh.tabIndex = -1;
  const opener = document.activeElement;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const api = {
    el: sh,
    close() {
      if (!sheets.has(api)) return; sheets.delete(api);
      ov.classList.add('closing'); setTimeout(() => ov.remove(), 240);
      if (!sheets.size) document.body.style.overflow = '';
      if (opener && opener.isConnected && typeof opener.focus === 'function' && (!document.activeElement || document.activeElement === document.body || sh.contains(document.activeElement))) opener.focus({ preventScroll: true });
      onClose && onClose();
    }
  };
  const focusables = () => $$('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', sh).filter((e) => e.getClientRects().length || e.type === 'file');
  sh.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = focusables(); if (!f.length) { e.preventDefault(); sh.focus(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sh)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  sheets.add(api);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) api.close(); });
  $$('[data-close]', sh).forEach((b) => b.addEventListener('click', api.close));
  // свайп вниз для закрытия на телефоне
  let y0 = null;
  sh.addEventListener('touchstart', (e) => { if (sh.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  sh.addEventListener('touchmove', (e) => { if (y0 != null) { const d = e.touches[0].clientY - y0; if (d > 0) sh.style.transform = `translateY(${d}px)`; } }, { passive: true });
  sh.addEventListener('touchend', (e) => { if (y0 == null) return; const d = e.changedTouches[0].clientY - y0; sh.style.transform = ''; y0 = null; if (d > 110) api.close(); });
  const f = sh.querySelector('input:not([type=hidden]),textarea');
  // на компьютере — сразу в первое поле; иначе фокус на само окно (без всплытия клавиатуры на телефоне)
  setTimeout(() => { if (!sheets.has(api) || sh.contains(document.activeElement)) return; if (f && matchMedia('(min-width: 640px)').matches) f.focus(); else sh.focus({ preventScroll: true }); }, 120);
  return api;
}
export function closeAllSheets() { [...sheets].forEach((s) => s.close()); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const last = [...sheets].pop(); if (last) last.close(); } });
/* ---------- выпадающие списки: свой список выбора вместо системного ---------- */
// Сам <select> остаётся на месте (значение, формы, обработчики change) — меняется только окно выбора:
// телефон — лист снизу с крупными строками и галочкой, компьютер — аккуратное меню под полем
// (стрелки, Enter, Esc, Tab; клик мимо или прокрутка закрывают). <select data-native> — системный список.
let selPop = null;
const selOk = (s) => s instanceof HTMLSelectElement && !s.multiple && !(s.size > 1) && !s.disabled && !s.hasAttribute('data-native');
const selFor = (t) => (selOk(t) ? t : t instanceof Element && t.closest('.sort-sel') ? t.closest('.sort-sel').querySelector('select') : null);
const selLabel = (s) => (s.getAttribute('aria-label') || s.closest('label')?.querySelector(':scope > span')?.textContent || (s.id && document.querySelector(`label[for="${CSS.escape(s.id)}"]`)?.textContent) || s.title || tr('Выберите', 'Choose')).trim();
const selRow = (o) => (o.hidden ? '' : h`<button type="button" class="opt ${o.selected ? 'on' : ''}" role="option" tabindex="-1" data-i="${o.index}" aria-selected="${o.selected ? 'true' : 'false'}" ${o.disabled ? raw('disabled') : ''}><span>${o.textContent.trim()}</span>${icon('check', 'ic-sm opt-ck')}</button>`);
const selRows = (s) => [...s.children].map((c) => (c.tagName === 'OPTGROUP' ? h`<div class="opt-head" role="presentation">${c.label}</div>${[...c.children].map(selRow)}` : c.tagName === 'OPTION' ? selRow(c) : ''));
function selChoose(s, o) {
  if (!o || o.disabled || s.selectedIndex === o.index) return;
  s.selectedIndex = o.index;
  s.dispatchEvent(new Event('input', { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
}
function closeSel(refocus = true) {
  if (!selPop) return;
  const { el, s, off } = selPop; selPop = null; off();
  el.classList.add('out'); setTimeout(() => el.remove(), 130);
  s.removeAttribute('aria-expanded');
  if (refocus && s.isConnected) s.focus({ preventScroll: true });
}
function openSel(s) {
  closeSel(false);
  const label = selLabel(s), rows = selRows(s);
  if (matchMedia('(max-width: 640px), (pointer: coarse)').matches) {
    const sh = sheet(h`${sheetHead(label)}<div class="opt-list" role="listbox" aria-label="${label}">${rows}</div>`);
    sh.el.classList.add('sheet-opts');
    $$('.opt', sh.el).forEach((b) => { b.onclick = () => { selChoose(s, s.options[+b.dataset.i]); sh.close(); }; });
    const on = $('.opt.on', sh.el); if (on) on.scrollIntoView({ block: 'center' });
    return;
  }
  const el = document.createElement('div');
  el.className = 'sel-pop'; el.setAttribute('role', 'listbox'); el.setAttribute('aria-label', label);
  el.innerHTML = h`${rows}`.s;
  document.body.appendChild(el);
  const anchor = s.closest('.sort-sel') || s;
  const r = anchor.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = innerHeight;
  const w = Math.min(Math.max(r.width, 220), vw - 16);
  el.style.minWidth = w + 'px'; el.style.maxWidth = Math.max(w, Math.min(380, vw - 16)) + 'px';
  const below = vh - r.bottom - 14, above = r.top - 14, up = below < Math.min(260, el.scrollHeight) && above > below;
  el.style.maxHeight = Math.max(150, Math.min(360, up ? above : below)) + 'px';
  el.style.left = Math.max(8, Math.min(r.left, vw - el.offsetWidth - 8)) + 'px';
  el.style.top = (up ? r.top - 6 - el.offsetHeight : r.bottom + 6) + 'px';
  el.classList.toggle('up', up);
  const opts = $$('.opt:not([disabled])', el);
  let act = Math.max(0, opts.findIndex((b) => b.classList.contains('on')));
  const mark = (i) => { if (!opts.length) return; act = Math.max(0, Math.min(opts.length - 1, i)); opts.forEach((b, j) => b.classList.toggle('act', j === act)); opts[act].scrollIntoView({ block: 'nearest' }); };
  mark(act);
  el.addEventListener('mousedown', (e) => e.preventDefault()); // фокус остаётся на поле
  el.addEventListener('click', (e) => { const b = e.target.closest('.opt'); if (!b || b.disabled) return; selChoose(s, s.options[+b.dataset.i]); closeSel(); });
  el.addEventListener('mousemove', (e) => { const b = e.target.closest('.opt:not([disabled])'); if (b && !b.classList.contains('act')) mark(opts.indexOf(b)); });
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeSel(false); };
  const away = (e) => { if (!el.contains(e.target)) closeSel(false); };
  const blur = () => setTimeout(() => { if (selPop?.el === el && document.activeElement !== s) closeSel(false); }, 0);
  document.addEventListener('mousedown', outside, true);
  window.addEventListener('scroll', away, true); window.addEventListener('resize', away);
  s.addEventListener('blur', blur);
  s.setAttribute('aria-expanded', 'true');
  const key = (e) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') mark(act + (k === 'ArrowDown' ? 1 : -1));
    else if (k === 'Home' || k === 'PageUp') mark(0);
    else if (k === 'End' || k === 'PageDown') mark(opts.length - 1);
    else if (k === 'Enter' || k === ' ') { if (opts[act]) selChoose(s, s.options[+opts[act].dataset.i]); closeSel(); }
    else if (k === 'Escape') closeSel();
    else { if (k === 'Tab') closeSel(false); return; }
    e.preventDefault(); e.stopImmediatePropagation();
  };
  selPop = { el, s, key, off: () => { document.removeEventListener('mousedown', outside, true); window.removeEventListener('scroll', away, true); window.removeEventListener('resize', away); s.removeEventListener('blur', blur); } };
}
let selTouch = null;
document.addEventListener('mousedown', (e) => {
  const s = e.button === 0 && selFor(e.target); if (!s) return;
  e.preventDefault();
  if (selPop?.s === s) return closeSel();
  s.focus({ preventScroll: true }); openSel(s);
}, true);
// касание: системный список не открываем (preventDefault на touchend), открываем свой; прокрутка пальцем — не нажатие
document.addEventListener('touchstart', (e) => { const s = selFor(e.target); selTouch = s ? { s, x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { capture: true, passive: true });
document.addEventListener('touchend', (e) => {
  const t = selTouch; selTouch = null;
  if (!t || selFor(e.target) !== t.s) return;
  const p = e.changedTouches[0]; if (Math.hypot(p.clientX - t.x, p.clientY - t.y) > 10) return;
  e.preventDefault(); openSel(t.s);
}, true);
document.addEventListener('keydown', (e) => {
  const s = e.target; if (!selOk(s)) return;
  if (selPop?.s === s) return selPop.key(e);
  if (e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) { e.preventDefault(); openSel(s); }
}, true);
export const sheetHead = (title, sub) => h`<div class="sheet-head"><div><h3>${title}</h3>${sub ? h`<p class="muted small" style="margin-top:6px">${sub}</p>` : ''}</div><button class="icon-btn" data-close aria-label="${tr('Закрыть', 'Close')}">${icon('x')}</button></div>`;

export function confirmBox(title, text, { ok = tr('Подтвердить', 'Confirm'), danger = false, input = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(h`${sheetHead(title)}<p class="muted">${text}</p>
      ${input ? h`<label class="field" style="margin-top:14px"><span>${input}</span><textarea name="v" rows="3"></textarea></label>` : ''}
      <div class="row" style="margin-top:20px"><button class="btn btn-ghost grow" data-close>${tr('Отмена', 'Cancel')}</button><button class="btn ${danger ? 'btn-red' : ''} grow" data-ok>${ok}</button></div>`,
    { onClose: () => { if (!done) resolve(null); } });
    $('[data-ok]', s.el).onclick = () => { done = true; const v = input ? $('textarea', s.el).value.trim() : true; s.close(); resolve(v || (input ? '' : true)); };
  });
}

export function lightbox(src) {
  const el = document.createElement('div'); el.className = 'lightbox';
  el.innerHTML = `<img src="${esc(src)}" alt="">`;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', tr('Фото — нажмите, чтобы закрыть', 'Photo — click to close')); el.tabIndex = -1;
  const opener = document.activeElement;
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); if (opener && opener.isConnected) opener.focus({ preventScroll: true }); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } else if (e.key === 'Tab') e.preventDefault(); };
  el.onclick = close; document.addEventListener('keydown', onKey); document.body.appendChild(el); el.focus();
}

/* ---------- фото: сжатие и загрузка ---------- */
export async function compress(file, max = 1600) {
  if (!/^image\//.test(file.type)) throw new Error(tr('Это не изображение', 'Not an image'));
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
export async function upload(file) { const data = await compress(file); return (await POST('/upload', { data })).url; }

// Поле для фото (до max штук): возвращает функцию получения списка
export function photoField(el, initial = [], max = 5) {
  let list = [...initial];
  const draw = () => {
    mount(el, h`<div class="photos">${list.map((u, i) => h`<div class="ph-item"><img src="${u}" alt=""><button type="button" data-rm="${i}" aria-label="${tr('Удалить фото', 'Remove photo')}">${icon('x', 'ic-sm')}</button></div>`)}
      ${list.length < max ? h`<label class="ph-add">${icon('camera')}<div>${tr('Добавить', 'Add')}<br><span class="muted">${list.length}/${max}</span></div><input type="file" accept="image/*" multiple></label>` : ''}</div>`);
    $$('[data-rm]', el).forEach((b) => b.onclick = () => { list.splice(+b.dataset.rm, 1); draw(); });
    const inp = $('input[type=file]', el);
    if (inp) inp.onchange = async () => {
      const files = Array.from(inp.files).slice(0, max - list.length);
      const grid = $('.photos', el);
      for (const f of files) {
        const ph = document.createElement('div'); ph.className = 'ph-item up'; grid.insertBefore(ph, grid.lastElementChild);
        try { list.push(await upload(f)); } catch (e) { toastErr(e); }
      }
      draw();
    };
  };
  draw();
  return () => list;
}

/* ---------- карты: OpenStreetMap (Leaflet лежит на нашем сервере, /vendor) ---------- */
export function tiles() {
  return window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
}
// Leaflet 1.9.4 завершает анимацию зума по таймеру — если карту уже убрали (ушли со страницы), он падал с ошибкой
function guardLeaflet(L) {
  const P = L.Map.prototype;
  if (P._mbaGuarded) return;
  P._mbaGuarded = true;
  // внутренние таймеры анимации и смена вида после удаления карты — ничего не делаем
  for (const fn of ['_onZoomTransitionEnd', '_onPanTransitionEnd', '_catchTransitionEnd', 'setView', 'fitBounds', 'flyTo', 'panTo', 'panBy', 'setZoom', 'invalidateSize']) {
    const orig = P[fn];
    if (typeof orig === 'function') P[fn] = function (...args) { return this._mapPane ? orig.apply(this, args) : this; };
  }
}
// Карта: m.lib — её библиотека (метки, круги, группы)
export function makeMap(el, { center, zoom = 12, interactive = true } = {}) {
  guardLeaflet(window.L);
  const c = center || state.config?.map?.center || [55.7558, 37.6173];
  const m = window.L.map(el, { zoomControl: interactive, attributionControl: false, dragging: interactive, scrollWheelZoom: interactive, doubleClickZoom: interactive, touchZoom: interactive, keyboard: interactive, tap: interactive }).setView(c, zoom);
  m.lib = window.L;
  tiles().addTo(m);
  // источник данных карты — по правилам OpenStreetMap; на карте только маленький значок «©», подпись открывается по нажатию
  const attr = window.L.control({ position: 'bottomright' });
  attr.onAdd = () => {
    const d = window.L.DomUtil.create('div', 'osm-attr');
    d.innerHTML = `<button type="button" class="osm-i" aria-expanded="false" aria-label="${esc(tr('Источник данных карты', 'Map data source'))}" title="${esc(tr('Источник данных карты', 'Map data source'))}">©</button><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${esc(tr('© участники OpenStreetMap', '© OpenStreetMap contributors'))}</a>`;
    window.L.DomEvent.disableClickPropagation(d);
    const b = d.firstChild; b.onclick = () => { const on = d.classList.toggle('open'); b.setAttribute('aria-expanded', String(on)); };
    return d;
  };
  attr.addTo(m);
  setTimeout(() => { if (m._mapPane) m.invalidateSize(); }, 60);
  return m;
}
export function pinIcon(a, extra = '') {
  const cls = a.status === 'found' || a.status === 'closed' ? 'done' : a.kind;
  return window.L.divIcon({ className: '', html: `<div class="pin ${cls} ${a.emergency ? 'em' : ''} ${extra}">${iconSvg(CAT[a.category]?.icon || 'pin')}</div>`, iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -30] });
}
export function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error(tr('Геолокация недоступна', 'Geolocation unavailable')));
    navigator.geolocation.getCurrentPosition((p) => res([p.coords.latitude, p.coords.longitude]),
      () => rej(new Error(tr('Не удалось определить местоположение. Разрешите доступ к геолокации.', 'Could not get your location. Allow location access.'))), { enableHighAccuracy: true, timeout: 10000 });
  });
}
// Карта на весь экран: кнопка «Развернуть», внизу «Готово», Esc закрывает
const EXPAND_SVG = '<svg class="ic" viewBox="0 0 256 256" aria-hidden="true"><path d="M216,48V96a8,8,0,0,1-16,0V67.31l-42.34,42.35a8,8,0,0,1-11.32-11.32L188.69,56H160a8,8,0,0,1,0-16h48A8,8,0,0,1,216,48ZM98.34,146.34,56,188.69V160a8,8,0,0,0-16,0v48a8,8,0,0,0,8,8H96a8,8,0,0,0,0-16H67.31l42.35-42.34a8,8,0,0,0-11.32-11.32Z"/></svg>';
const COLLAPSE_SVG = '<svg class="ic" viewBox="0 0 256 256" aria-hidden="true"><path d="M152,104V56a8,8,0,0,1,16,0V84.69l42.34-42.35a8,8,0,0,1,11.32,11.32L179.31,96H208a8,8,0,0,1,0,16H160A8,8,0,0,1,152,104ZM96,144H48a8,8,0,0,0,0,16H76.69L34.34,202.34a8,8,0,0,0,11.32,11.32L88,171.31V200a8,8,0,0,0,16,0V152A8,8,0,0,0,96,144Z"/></svg>';
export function mapFull(m, host, slot) {
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'map-full-btn';
  const done = document.createElement('button'); done.type = 'button'; done.className = 'btn btn-blue btn-lg map-done';
  done.innerHTML = `<svg class="ic" viewBox="0 0 256 256" aria-hidden="true">${IR.check || ''}</svg><span>${tr('Готово', 'Done')}</span>`;
  const sync = () => { const on = host.classList.contains('map-full'); const l = on ? tr('Свернуть карту', 'Collapse map') : tr('Развернуть карту', 'Expand map'); btn.innerHTML = on ? COLLAPSE_SVG : EXPAND_SVG; btn.setAttribute('aria-label', l); btn.title = l; };
  const toggle = (on) => { host.classList.toggle('map-full', on); document.body.classList.toggle('map-open', on); sync(); setTimeout(() => m.invalidateSize(), 60); (on ? done : btn).focus({ preventScroll: true }); };
  btn.onclick = () => toggle(!host.classList.contains('map-full'));
  done.onclick = () => toggle(false);
  sync(); (slot || host).appendChild(btn); host.appendChild(done);
  if (m.lib) { m.lib.DomEvent.disableClickPropagation(btn); m.lib.DomEvent.disableClickPropagation(done); }
  return { toggle };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const f = document.querySelector('.map-full .map-done'); if (f) { e.stopPropagation(); f.click(); } } });

// Выбор точки на карте: клик/перетаскивание маркера + кнопка «моё местоположение»
export function mapPicker(el, value, onChange, { radius, kind = 'lost', category = '', full = true } = {}) {
  mount(el, h`<div class="map-host"></div><div class="map-fab"><button type="button" data-loc title="${tr('Моё местоположение', 'My location')}" aria-label="${tr('Моё местоположение', 'My location')}">${icon('locate')}</button></div><div class="crosshint">${icon('pin', 'ic-sm')}<span>${tr('Нажмите на карту — там появится метка', 'Tap the map to drop a pin')}</span></div>`);
  const m = makeMap($('.map-host', el), { center: value?.lat ? [value.lat, value.lng] : null, zoom: value?.lat ? 15 : 11 });
  let mk = null, circle = null;
  const set = (lat, lng, fly) => {
    if (!mk) { mk = m.lib.marker([lat, lng], { draggable: true, title: tr('Отмеченное место', 'Selected place'), icon: pinIcon({ kind, category }, 'pick-pin') }).addTo(m); mk.on('dragend', () => { const p = mk.getLatLng(); set(p.lat, p.lng); }); } else mk.setLatLng([lat, lng]);
    if (radius) { if (!circle) circle = m.lib.circle([lat, lng], { radius: radius() * 1000, color: '#e0192d', weight: 1.5, fillOpacity: .08 }).addTo(m); else { circle.setLatLng([lat, lng]); circle.setRadius(radius() * 1000); } }
    if (fly) m.flyTo([lat, lng], Math.max(m.getZoom(), 15), { duration: .8 });
    el.classList.add('picked'); $('.crosshint span', el).textContent = tr('Место отмечено. Метку можно перетащить', 'Place set. You can drag the pin');
    onChange({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
  };
  if (value?.lat) set(value.lat, value.lng);
  m.on('click', (e) => set(e.latlng.lat, e.latlng.lng));
  $('[data-loc]', el).onclick = async () => { try { const [a, b] = await getPosition(); set(a, b, true); } catch (e) { toastErr(e); } };
  if (full) mapFull(m, el, $('.map-fab', el));
  return { map: m, set, updateRadius: () => { if (circle) circle.setRadius(radius() * 1000); else if (mk && radius) { const p = mk.getLatLng(); set(p.lat, p.lng); } } };
}

/* ---------- realtime (SSE) ---------- */
let es = null; const listeners = new Set();
export function onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function connectStream() {
  if (es) { es.close(); es = null; }
  if (!state.user || !('EventSource' in window)) return;
  es = new EventSource('/api/stream');
  ['notification', 'message', 'chat_read', 'ticket'].forEach((type) => es.addEventListener(type, (e) => { const d = JSON.parse(e.data); listeners.forEach((f) => f(type, d)); }));
}

/* ---------- push-уведомления ---------- */
function b64ToUint8(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const r = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); }
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);
const swReg = async () => { try { return (await navigator.serviceWorker.getRegistration()) || null; } catch (e) { return null; } };
const currentSub = async () => { const reg = await swReg(); try { return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; } };
// Включить push на этом устройстве: разрешение спрашиваем только по нажатию кнопки
export async function enablePush() {
  if (!pushSupported()) throw new Error(isIOS() && !isStandalone() ? tr('На iPhone уведомления работают в установленном приложении: «Поделиться» → «На экран „Домой“» (iOS 16.4+)', 'On iPhone, notifications work in the installed app: Share → Add to Home Screen (iOS 16.4+)') : tr('Этот браузер не поддерживает уведомления', 'This browser does not support notifications'));
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') { const e = new Error(tr('Уведомления запрещены в настройках браузера', 'Notifications are blocked in browser settings')); e.code = perm; throw e; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(state.config.vapidPublic) });
  return POST('/push/subscribe', { subscription: sub.toJSON() });
}
// Выключить на этом устройстве (и при выходе из аккаунта): сервер забывает адрес, браузер отписывается
export async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  if (state.user) await POST('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
// 'on' | 'off' | 'denied' | 'unsupported'
export async function pushStatus() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return (Notification.permission === 'granted' && await currentSub()) ? 'on' : 'off';
}
// При входе: подписка этого браузера снова привязывается к аккаунту (сервер мог её удалить или сменился пользователь)
export async function syncPush() {
  if (!state.user || !pushSupported() || Notification.permission !== 'granted') return;
  const sub = await currentSub();
  if (sub) POST('/push/subscribe', { subscription: sub.toJSON() }).catch(() => {});
}
// Счётчик непрочитанных на иконке установленного приложения
export function appBadge(n) {
  try { if (n > 0) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch (e) { /* не поддерживается */ }
}

/* ---------- поделиться ---------- */
export function shareSheet(url, title) {
  const text = title;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { navigator.share({ title, text, url }).catch(() => {}); return; }
  const u = encodeURIComponent(url), tx = encodeURIComponent(text);
  const s = sheet(h`${sheetHead(t('share.title', 'Поделиться заявкой', 'Share report'), title)}
    <div class="list">
      <a href="https://t.me/share/url?url=${u}&text=${tx}" target="_blank" rel="noopener">${icon('send')}<span class="grow">Telegram</span>${icon('chevR')}</a>
      <a href="https://wa.me/?text=${tx}%20${u}" target="_blank" rel="noopener">${icon('chat')}<span class="grow">WhatsApp</span>${icon('chevR')}</a>
      <a href="https://vk.com/share.php?url=${u}&title=${tx}" target="_blank" rel="noopener">${icon('globe')}<span class="grow">ВКонтакте</span>${icon('chevR')}</a>
      <a href="viber://forward?text=${tx}%20${u}">${icon('phone')}<span class="grow">Viber</span>${icon('chevR')}</a>
      <a href="#" data-copy>${icon('copy')}<span class="grow">${t('share.copy', 'Скопировать ссылку', 'Copy link')}</span>${icon('chevR')}</a>
    </div>`);
  $('[data-copy]', s.el).onclick = async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(url); } catch (er) { const i = document.createElement('input'); i.value = url; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); }
    toast(t('share.copied', 'Ссылка скопирована', 'Link copied')); s.close();
  };
}

/* ---------- анимированные счётчики ---------- */
export function countUp(root = document) {
  $$('[data-count]', root).forEach((el) => {
    const to = +el.dataset.count; const t0 = performance.now(); const dur = 1100;
    const step = (t1) => { const p = Math.min(1, (t1 - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString(locale()); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

/* ---------- формы ---------- */
export function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
  $$('input[type=checkbox]', form).forEach((i) => { if (i.name) o[i.name] = i.checked; });
  return o;
}
export async function busy(btn, fn) {
  if (!btn) return fn();
  btn.classList.add('loading'); btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove('loading'); btn.disabled = false; }
}

/* ---------- телефоны экстренных служб: компактная строка, номера нажимаются (tel:) ---------- */
export const EMERGENCY_PHONES = [
  ['112', '112', 'Единый номер', 'Emergency'],
  ['102', '102', 'Полиция', 'Police'],
  ['103', '103', 'Скорая', 'Ambulance'],
  ['101', '101', 'МЧС', 'Fire & rescue'],
  ['88007005452', '8 800 700-54-52', '«ЛизаАлерт»', 'LizaAlert']
];
// variant: '' — строка с подписями (главная, окно «Новая заявка»); 'mini' — только номера (подвал)
export function emergencyPhones(variant = '') {
  const label = tr('Экстренные службы', 'Emergency services');
  return h`<div class="sos-phones ${variant}" role="group" aria-label="${label}">
    <span class="sos-lbl">${icon('phone', 'ic-sm')}${label}</span>
    ${EMERGENCY_PHONES.map(([tel, num, ru, en]) => h`<a class="sos-ph" href="tel:${tel}" aria-label="${tr(ru, en)}: ${num}"><b>${num}</b>${variant === 'mini' && tel !== '88007005452' ? '' : h`<span>${tr(ru, en)}</span>`}</a>`)}
  </div>`;
}

/* ---------- кнопка SOS в шапке: окно «Куда обратиться прямо сейчас», звонок в одно касание ---------- */
const sosServices = () => [
  { num: '112', tel: '112', ic: 'siren', main: true, title: tr('Единый номер экстренных служб', 'Emergency number'), sub: tr('Полиция, скорая, спасатели. Бесплатно, с любого телефона', 'Police, ambulance, rescue. Free, from any phone') },
  { num: '102', tel: '102', ic: 'police', title: tr('Полиция', 'Police'), sub: tr('Пропал человек, кража, угроза. Заявление о пропаже человека принимают сразу', 'Missing person, theft, threat. Missing-person reports are taken at once') },
  { num: '103', tel: '103', ic: 'heart', title: tr('Скорая помощь', 'Ambulance'), sub: tr('Угроза жизни и здоровью', 'Threat to life or health') },
  { num: '101', tel: '101', ic: 'alert', title: tr('МЧС: пожарные и спасатели', 'Fire & rescue'), sub: tr('Пожар, авария, человек в опасности', 'Fire, accident, person in danger') },
  { num: '8 800 700-54-52', tel: '88007005452', ic: 'users', title: tr('Поисково-спасательный отряд «ЛизаАлерт»', 'LizaAlert search & rescue'), sub: tr('Поиск пропавших людей. Бесплатно, круглосуточно', 'Searching for missing people. Free, 24/7') },
  { num: tr('Разместить заявку', 'Post a report'), href: '#/new/lost', ic: 'handshake', title: tr('Волонтёры рядом', 'Volunteers nearby'), sub: tr('Подайте заявку о пропаже — волонтёры и партнёры поблизости получат оповещение', 'Post a missing report — volunteers and partners nearby get an alert') }
];
export function sosSheet() {
  const item = (s) => h`<a class="svc ${s.main ? 'svc-main' : ''}" href="${s.href || 'tel:' + s.tel}" ${s.href ? '' : raw(`aria-label="${esc(s.title)}: ${esc(tr('позвонить', 'call'))} ${esc(s.num)}"`)}>
    <span class="svc-ic">${icon(s.ic)}</span><span class="svc-tx"><b>${s.title}</b><span>${s.sub}</span></span><span class="svc-num">${s.href ? '' : icon('phone', 'ic-sm')}${s.num}</span></a>`;
  const s = sheet(h`${sheetHead(tr('Куда обратиться прямо сейчас', 'Get help right now'), tr('Нажмите на службу — телефон сразу наберёт номер', 'Tap a service and your phone dials it'))}
    <div class="svc-list">${sosServices().map(item)}</div>
    <p class="svc-foot">${icon('alert', 'ic-sm')}${tr('Номера действуют в России. Платформа не заменяет полицию и экстренные службы.', 'Numbers are for Russia. The platform does not replace the police or emergency services.')}</p>`);
  s.el.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', () => s.close()));
  return s;
}
