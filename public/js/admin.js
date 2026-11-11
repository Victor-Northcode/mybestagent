// Панель администратора и модератора.
import {
  state, tr, h, raw, mount, $, $$, icon, CAT, catName, kindName, statusName, statusChip, fmtDate, ago, money,
  GET, POST, PATCH, DEL, mediaPh, route, go, toast, toastErr, sheet, sheetHead, confirmBox, makeMap, pinIcon, onLeave, formData, busy, esc
} from './core.js';
import { ticketView } from './views.js';

const isAdmin = () => state.user && state.user.role === 'admin';
const SECTIONS = () => [
  ['', 'chart', tr('Статистика', 'Dashboard'), null],
  ['moderation', 'shield', tr('Модерация', 'Moderation'), 'pending'],
  ['emergency', 'siren', tr('Экстренные', 'Emergencies'), 'emergencies_pending'],
  ['complaints', 'flag', tr('Жалобы', 'Complaints'), 'complaints'],
  ['applications', 'file', tr('Все заявки', 'All reports'), null],
  ['users', 'users', tr('Пользователи', 'Users'), null],
  ['roles', 'handshake', tr('Волонтёры и партнёры', 'Volunteers & partners'), 'roles'],
  ['support', 'help', tr('Поддержка', 'Support'), 'tickets'],
  ['deletion', 'trash', tr('Запросы на удаление', 'Removal requests'), 'deletion'],
  ['leads', 'inbox', tr('Партнёры и инвесторы', 'Leads'), 'leads'],
  ['payments', 'card', tr('Платежи', 'Payments'), null],
  ...(isAdmin() ? [
    ['tariffs', 'tag', tr('Тарифы', 'Plans'), null],
    ['dicts', 'list', tr('Справочники', 'Dictionaries'), null],
    ['translations', 'globe', tr('Переводы', 'Translations'), null],
    ['stories', 'book', tr('Истории', 'Stories'), null],
    ['system', 'db', tr('Система', 'System'), null],
    ['outbox', 'mail', tr('Исходящие', 'Outbox'), null]
  ] : []),
  ['audit', 'history', tr('Журнал действий', 'Audit log'), null]
];

async function shell(view, sec, title, fn) {
  let totals = {};
  try { totals = (await GET('/admin/stats')).totals; } catch (e) { /* noop */ }
  // Навигация как в личном кабинете: на компьютере — колонка слева, на телефоне — одна кнопка текущего раздела
  // (с суммой счётчиков), по нажатию — лист со всеми разделами в две колонки.
  const secs = SECTIONS(), cur = secs.find(([k]) => k === sec) || secs[0];
  const n = (c) => (c && +totals[c]) || 0;
  const sum = secs.reduce((s, x) => s + n(x[3]), 0);
  const link = ([k, ic, l, c]) => h`<a href="#/admin${k ? '/' + k : ''}" class="${sec === k ? 'on' : ''}" ${sec === k ? raw('aria-current="page"') : ''}>${icon(ic)}<span class="grow">${l}</span>${n(c) ? h`<span class="cnt">${n(c)}</span>` : ''}</a>`;
  const panel = tr('Админ-панель', 'Admin panel');
  mount(view, h`<div class="wrap"><div class="admin">
    <aside class="me-nav admin-nav"><nav aria-label="${panel}">${secs.map(link)}</nav></aside>
    <div style="min-width:0">
      <button type="button" class="me-pick" id="admPick" aria-haspopup="dialog" aria-label="${panel}: ${cur[2]}. ${tr('Все разделы', 'All sections')}${sum ? ` (${tr('ждут внимания', 'need attention')}: ${sum})` : ''}">
        <span class="me-pick-ic">${icon(cur[1])}</span><span class="grow"><small>${panel}</small><b>${cur[2]}</b></span>
        <span class="me-pick-all">${tr('Разделы', 'Sections')}${sum ? h`<span class="cnt">${sum}</span>` : icon('chevR', 'ic-sm')}</span></button>
      <div class="row between" style="margin-bottom:18px;flex-wrap:wrap"><h1 style="font-size:clamp(24px,3.5vw,34px)">${title}</h1><div id="hact" class="row"></div></div><div id="body"></div></div>
  </div></div>`);
  $('#admPick', view).onclick = () => {
    const s = sheet(h`${sheetHead(panel)}<nav class="me-sheet admin-sheet" aria-label="${panel}">${secs.map(link)}</nav>`);
    $$('a', s.el).forEach((a) => a.addEventListener('click', () => s.close()));
  };
  await fn($('#body', view), $('#hact', view), totals);
}
const sec = (path, title, fn, opts = {}) => route('/admin' + (path ? '/' + path : ''), (view) => shell(view, path, title(), fn), Object.assign({ auth: true, mod: true }, opts));
// Широкие таблицы (5+ колонок) на телефоне показываются карточками «подпись: значение» — подписи берутся из заголовков
const stackTables = () => document.querySelectorAll('#view table.t:not(.t-cards):not([data-lb])').forEach((tb) => {
  const hs = [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim());
  tb.dataset.lb = '1';
  if (hs.length < 5) return;
  tb.classList.add('t-stack');
  tb.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (hs[i]) td.dataset.label = hs[i]; }));
});
new MutationObserver(stackTables).observe(document.getElementById('view'), { childList: true, subtree: true });
const emptyBox = (text) => h`<div class="empty">${icon('check')}<b>${text}</b></div>`;
const thumb = (a) => a.photos && a.photos.length ? h`<img src="${a.photos[0]}" alt="">` : mediaPh(a.category);

/* ---------- графики (одна серия, одна ось, всплывающие значения) ---------- */
function barChart(days, color, label) {
  const map = Object.fromEntries(days.map((d) => [d.d, d.c]));
  const pts = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10); return { d, c: map[d] || 0 }; });
  const max = Math.max(1, ...pts.map((p) => p.c)); const W = 600, H = 160, bw = W / 30;
  const ticks = [0, Math.ceil(max / 2), max];
  const yOf = (v) => H - (v / max) * (H - 10);
  return h`<div class="chart-box"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    ${[...new Set(ticks)].map((v) => h`<line x1="0" x2="${W}" y1="${yOf(v)}" y2="${yOf(v)}" stroke="var(--line)" stroke-width="1"/>`)}
    ${pts.map((p, i) => { const bh = Math.max(p.c ? 3 : 0, (p.c / max) * (H - 10)); const x = i * bw + 1, w = bw - 2; return h`<g><rect x="${i * bw}" y="0" width="${bw}" height="${H}" fill="transparent"><title>${fmtDate(p.d)}: ${p.c}</title></rect>${bh ? h`<path class="bar" d="M${x},${H} V${H - bh + 4} q0,-4 4,-4 h${w - 8} q4,0 4,4 V${H} Z" fill="${color}"><title>${fmtDate(p.d)}: ${p.c}</title></path>` : ''}</g>`; })}
  </svg>${[...new Set(ticks)].filter((v) => v > 0).map((v) => h`<span class="chart-y" style="top:${(yOf(v) / H) * 100}%">${v}</span>`)}
  <div class="chart-x"><span>${fmtDate(pts[0].d)}</span><span>${tr('сегодня', 'today')}</span></div></div>`;
}

/* ---------- статистика ---------- */
sec('', () => tr('Статистика', 'Dashboard'), async (el, act) => {
  const s = await GET('/admin/stats'); const T = s.totals;
  mount(act, h`<a class="btn btn-sm" href="/api/admin/export.xlsx" download>${icon('download')}${tr('Выгрузить в Excel', 'Export to Excel')}</a>`);
  const cat = {}; s.byCat.forEach((r) => { cat[r.category] = cat[r.category] || { lost: 0, found: 0, done: 0 }; cat[r.category][r.kind] += r.c; if (r.status === 'found') cat[r.category].done += r.c; });
  const cmax = Math.max(1, ...Object.values(cat).map((c) => c.lost + c.found));
  mount(el, h`<div class="stack-lg">
    <div class="kpis">${[[tr('Всего заявок', 'Reports'), T.applications, ''], [tr('На проверке', 'Pending'), T.pending, 'red'], [tr('Найдено', 'Found'), T.found, 'green'], [tr('Совпадений', 'Matches'), T.matches, 'blue'],
      [tr('Пользователей', 'Users'), T.users, ''], [tr('Волонтёров / партнёров', 'Volunteers / partners'), `${T.volunteers} / ${T.partners}`, ''], [tr('Экстренных активно', 'Active emergencies'), T.emergencies_active, 'red'], [tr('Выручка', 'Revenue'), money(T.revenue), '']]
      .map(([l, v, c], i) => h`<div class="kpi ${c} rise" style="--i:${i}"><span>${l}</span><b>${v}</b></div>`)}</div>
    <div class="grid-2" style="gap:14px">
      <div class="card pad"><h3 style="font-size:15px">${tr('Новые заявки за 30 дней', 'New reports, 30 days')}</h3><div style="margin-top:12px">${barChart(s.days, 'var(--ink)', tr('Новые заявки', 'New reports'))}</div></div>
      <div class="card pad"><h3 style="font-size:15px">${tr('Найдено за 30 дней', 'Found, 30 days')}</h3><div style="margin-top:12px">${barChart(s.foundDays, 'var(--blue)', tr('Найдено', 'Found'))}</div></div>
    </div>
    <div class="grid-2" style="gap:14px;align-items:start">
      <div class="card pad"><h3 style="font-size:15px;margin-bottom:12px">${tr('По категориям', 'By category')}</h3>
        ${['people', 'animals', 'things'].map((c) => { const v = cat[c] || { lost: 0, found: 0, done: 0 }; return h`<div class="hbar"><span>${catName(c)}</span><i style="width:${((v.lost + v.found) / cmax) * 100}%"></i><span class="num">${v.lost + v.found}</span></div><div class="xs muted" style="margin:-2px 0 8px 120px">${kindName('lost')}: ${v.lost} · ${kindName('found')}: ${v.found} · ${tr('закрыто как найдено', 'resolved')}: ${v.done}</div>`; })}
      </div>
      <div class="card pad"><h3 style="font-size:15px;margin-bottom:12px">${tr('По регионам', 'By region')}</h3>
        <div class="table-wrap" tabindex="0" style="border:0"><table class="t"><thead><tr><th>${tr('Город', 'City')}</th><th class="num">${tr('Всего', 'Total')}</th><th class="num">${tr('Активно', 'Active')}</th><th class="num">${tr('Найдено', 'Found')}</th></tr></thead>
        <tbody>${s.regions.map((r) => h`<tr><td>${r.city}</td><td class="num">${r.total}</td><td class="num">${r.active}</td><td class="num">${r.found}</td></tr>`)}</tbody></table></div></div>
    </div>
    <div class="tiles">${[['moderation', 'shield', tr('Заявки на проверке', 'Pending reports'), T.pending], ['emergency', 'siren', tr('Запросы оповещений', 'Alert requests'), T.emergencies_pending], ['complaints', 'flag', tr('Открытые жалобы', 'Open complaints'), T.complaints], ['support', 'help', tr('Обращения', 'Tickets'), T.tickets]]
      .map(([k, ic, l, n]) => h`<a class="tile" href="#/admin/${k}"><div class="t-ic">${icon(ic)}</div><b>${l}</b><small>${n}</small>${n ? h`<span class="dotbadge">${n}</span>` : ''}</a>`)}</div>
  </div>`);
});

/* ---------- модерация ---------- */
function modCard(a, actions) {
  return h`<div class="mod-card rise">
    <div class="thumb">${thumb(a)}</div>
    <div class="stack" style="min-width:0">
      <div class="row-wrap"><span class="chip chip-${a.kind}">${kindName(a.kind)}</span><span class="chip">${catName(a.category)}</span><span class="chip ${statusChip(a.status)}">${statusName(a.status)}</span>${a.is_minor ? h`<span class="chip chip-lost">${tr('Несовершеннолетний', 'Minor')}</span>` : ''}${a.complaints ? h`<span class="chip chip-warn">${icon('flag')}${a.complaints}</span>` : ''}${a.emergency_status && a.emergency_status !== 'none' ? h`<span class="chip chip-em">SOS ${a.emergency_radius} ${tr('км', 'km')}</span>` : ''}</div>
      <a href="#/a/${a.id}" style="font-weight:800;font-size:16px">№${a.id} · ${a.title}</a>
      ${a.person_name ? h`<div class="small"><b>${tr('ФИО', 'Name')}:</b> ${a.person_name}${a.person_age != null ? `, ${a.person_age}` : ''} · <b>${tr('Заявитель', 'Filed by')}:</b> ${a.relation === 'legal_rep' ? tr('законный представитель', 'legal representative') : a.relation === 'relative' ? tr('родственник', 'relative') : '—'}</div>` : ''}
      ${a.last_seen ? h`<div class="small"><b>${tr('Последнее местонахождение', 'Last seen')}:</b> ${a.last_seen}</div>` : ''}
      ${a.features ? h`<div class="small muted">${a.features}</div>` : ''}
      <div class="xs muted">${a.address || a.city} · ${fmtDate(a.event_date)} · ${tr('автор', 'author')}: ${a.author_name} (${a.author_contact}) · ${tr('контакт', 'contact')}: ${a.contact}</div>
    </div>
    <div class="acts">${actions}</div></div>`;
}
async function moderate(id, action, reload) {
  let reason = '';
  if (action === 'reject') { reason = await confirmBox(tr('Отклонить заявку', 'Reject report'), tr('Причина увидит автор.', 'The author will see the reason.'), { input: tr('Причина', 'Reason'), danger: true, ok: tr('Отклонить', 'Reject') }); if (reason === null) return; }
  if (action === 'delete' && !(await confirmBox(tr('Удалить заявку?', 'Delete report?'), tr('Действие необратимо.', 'This cannot be undone.'), { danger: true }))) return;
  try { await POST(`/admin/applications/${id}/moderate`, { action, reason }); toast(tr('Готово', 'Done')); reload(); } catch (e) { toastErr(e); }
}
sec('moderation', () => tr('Модерация заявок', 'Report moderation'), async (el) => {
  const load = async () => {
    const { items } = await GET('/admin/applications?status=pending');
    mount(el, h`<div class="note note-blue" style="margin-bottom:16px">${icon('shield')}<div>${tr('Заявки категории «Люди» публикуются только после проверки. Убедитесь, что заявитель — родственник или законный представитель (о несовершеннолетнем — только законный представитель), а в тексте нет диагнозов, документов и полного адреса без основания.', 'People reports are published only after review. Check the filer is a relative or legal representative (for minors — legal guardian only) and the text contains no diagnoses, documents or full address without grounds.')}</div></div>
      ${items.length ? h`<div class="stack">${items.map((a) => modCard(a, h`<button class="btn btn-sm" data-a="approve" data-id="${a.id}">${icon('check')}${tr('Опубликовать', 'Publish')}</button><button class="btn btn-danger btn-sm" data-a="reject" data-id="${a.id}">${icon('x')}${tr('Отклонить', 'Reject')}</button>`))}</div>` : emptyBox(tr('Очередь пуста', 'Queue is empty'))}`);
    $$('[data-a]', el).forEach((b) => b.onclick = () => moderate(b.dataset.id, b.dataset.a, load));
  };
  await load();
});
sec('applications', () => tr('Все заявки', 'All reports'), async (el) => {
  let q = '', status = '', category = '';
  const load = async () => {
    const p = new URLSearchParams({ q, status, category });
    const { items } = await GET('/admin/applications?' + p);
    mount($('#res', el), items.length ? h`<div class="stack">${items.map((a) => modCard(a, h`
      ${a.status === 'pending' || a.status === 'rejected' ? h`<button class="btn btn-sm" data-a="approve" data-id="${a.id}">${tr('Опубликовать', 'Publish')}</button>` : ''}
      ${a.status === 'published' ? h`<button class="btn btn-ghost btn-sm" data-a="hide" data-id="${a.id}">${icon('eye')}${tr('Скрыть', 'Hide')}</button>` : ''}
      <button class="btn btn-danger btn-sm" data-a="delete" data-id="${a.id}">${icon('trash')}${tr('Удалить', 'Delete')}</button>`))}</div>` : emptyBox(tr('Ничего не найдено', 'Nothing found')));
    $$('[data-a]', el).forEach((b) => b.onclick = () => moderate(b.dataset.id, b.dataset.a, load));
  };
  mount(el, h`<form class="row-wrap" id="ff" style="margin-bottom:16px"><input class="input" name="q" placeholder="${tr('№, заголовок, ФИО', 'No., title, name')}" style="flex:1;min-width:180px">
    <select class="input" name="status" aria-label="${tr('Статус', 'Status')}" style="width:auto"><option value="">${tr('Все статусы', 'All statuses')}</option>${['pending', 'published', 'found', 'closed', 'rejected'].map((s) => h`<option value="${s}">${statusName(s)}</option>`)}</select>
    <select class="input" name="category" aria-label="${tr('Категория', 'Category')}" style="width:auto"><option value="">${tr('Все категории', 'All categories')}</option>${['people', 'animals', 'things'].map((c) => h`<option value="${c}">${catName(c)}</option>`)}</select><button class="btn" aria-label="${tr('Найти', 'Search')}">${icon('search')}</button></form><div id="res"></div>`);
  $('#ff', el).onsubmit = (e) => { e.preventDefault(); ({ q, status, category } = formData(e.target)); load(); };
  await load();
});

/* ---------- экстренные оповещения ---------- */
sec('emergency', () => tr('Экстренные оповещения', 'Emergency alerts'), async (el) => {
  const load = async () => {
    const { items } = await GET('/admin/emergencies');
    mount(el, h`<div class="note note-red" style="margin-bottom:16px">${icon('siren')}<div>${tr('Push получают пользователи и волонтёры, чья зона оповещений пересекается с кругом поиска. В уведомлении нет персональных данных. Перед запуском убедитесь, что заявка опубликована.', 'Users and volunteers whose alert zone overlaps the search circle get a push. It contains no personal data. Make sure the report is published first.')}</div></div>
      ${items.length ? h`<div class="stack">${items.map((a) => h`<div class="card pad"><div class="grid-2" style="gap:16px">
        <div class="stack"><div class="row-wrap"><span class="chip ${a.emergency_status === 'active' ? 'chip-em' : 'chip-warn'}">${a.emergency_status === 'active' ? tr('Активно', 'Active') : tr('Ждёт запуска', 'Awaiting launch')}</span><span class="chip">${catName(a.category)}</span><span class="chip ${statusChip(a.status)}">${statusName(a.status)}</span></div>
          <a href="#/a/${a.id}" style="font-weight:800;font-size:17px">${a.title}</a><div class="small muted">${a.address} · ${ago(a.created_at)}</div>
          <div class="kpi" style="padding:12px"><span>${tr('Получателей в зоне', 'Recipients in zone')}</span><b>${a.reach}</b></div>
          <div class="row small"><span>${tr('Радиус', 'Radius')}</span><select class="input" data-r="${a.id}" aria-label="${tr('Радиус, км', 'Radius, km')}" style="width:auto;min-height:38px;padding:6px 34px 6px 12px">${[1, 2, 3, 4, 5].map((r) => h`<option ${r === a.emergency_radius ? 'selected' : ''}>${r}</option>`)}</select><span>${tr('км', 'km')}</span></div>
          <div class="row-wrap">${a.emergency_status === 'pending' ? h`<button class="btn btn-red btn-urgent btn-sm" data-e="approve" data-id="${a.id}" ${a.status !== 'published' ? 'disabled' : ''}>${icon('siren')}${tr('Запустить', 'Launch')}</button><button class="btn btn-ghost btn-sm" data-e="reject" data-id="${a.id}">${tr('Отклонить', 'Reject')}</button>`
            : h`<button class="btn btn-sm" data-e="resend" data-id="${a.id}">${icon('refresh')}${tr('Повторить рассылку', 'Resend')}</button><button class="btn btn-ghost btn-sm" data-e="stop" data-id="${a.id}">${tr('Остановить', 'Stop')}</button>`}</div>
          ${a.status !== 'published' ? h`<p class="xs" style="color:var(--red)">${tr('Сначала опубликуйте заявку в разделе «Модерация»', 'Publish the report in Moderation first')}</p>` : ''}
        </div><div class="mini-map" id="em${a.id}" style="height:260px"></div></div></div>`)}</div>` : emptyBox(tr('Активных и ожидающих оповещений нет', 'No active or pending alerts'))}`);
    items.forEach((a) => { const m = makeMap($('#em' + a.id, el), { center: [a.lat, a.lng], zoom: 12 }); m.lib.marker([a.lat, a.lng], { icon: pinIcon(Object.assign({}, a, { emergency: 1 })), interactive: false, keyboard: false }).addTo(m); m.lib.circle([a.lat, a.lng], { radius: a.emergency_radius * 1000, color: '#e0192d', weight: 1.5, fillOpacity: .1 }).addTo(m); onLeave(() => m.remove()); });
    $$('[data-e]', el).forEach((b) => b.onclick = () => busy(b, async () => {
      try { const r = await POST(`/admin/emergencies/${b.dataset.id}`, { action: b.dataset.e, radius: +$(`[data-r="${b.dataset.id}"]`, el).value }); toast(['approve', 'resend'].includes(b.dataset.e) ? `${tr('Отправлено получателям', 'Sent to recipients')}: ${r.sent}` : tr('Готово', 'Done')); load(); } catch (e) { toastErr(e); }
    }));
  };
  await load();
});

/* ---------- жалобы ---------- */
sec('complaints', () => tr('Жалобы', 'Complaints'), async (el) => {
  const load = async () => {
    const { items } = await GET('/admin/complaints');
    mount(el, items.length ? h`<div class="stack">${items.map((c) => h`<div class="card pad stack" style="${c.status !== 'open' ? 'opacity:.6' : ''}">
      <div class="row between"><div class="row-wrap"><span class="chip ${c.status === 'open' ? 'chip-warn' : ''}">${c.status === 'open' ? tr('Открыта', 'Open') : c.status === 'resolved' ? tr('Решена', 'Resolved') : tr('Отклонена', 'Dismissed')}</span><span class="chip">${{ application: tr('Заявка', 'Report'), chat: tr('Чат', 'Chat'), user: tr('Пользователь', 'User'), message: tr('Сообщение', 'Message') }[c.target_type]}</span></div><span class="xs muted">${ago(c.created_at)}</span></div>
      <b>${c.target ? (c.target.link ? h`<a class="link" href="${c.target.link}">${c.target.title}</a>` : c.target.title) : tr('Объект удалён', 'Object deleted')}</b>
      <div class="small">${c.reason}</div><div class="xs muted">${tr('Пожаловался', 'Reported by')}: ${c.author}</div>
      ${c.status === 'open' && c.target ? h`<div class="row-wrap">
        ${c.target.chat_id ? h`<button class="btn btn-ghost btn-sm" data-view="${c.target.chat_id}">${icon('eye')}${tr('Просмотреть чат', 'View chat')}</button>` : ''}
        ${c.target_type === 'application' ? h`<button class="btn btn-sm" data-act="hide" data-id="${c.id}">${tr('Скрыть заявку', 'Hide report')}</button>` : ''}
        ${c.target_type === 'chat' ? h`<button class="btn btn-sm" data-act="block_chat" data-id="${c.id}">${tr('Заблокировать чат', 'Block chat')}</button>` : ''}
        ${(c.target.user_id || (c.target.user_ids || [])[0]) ? h`<button class="btn btn-danger btn-sm" data-act="block_user" data-uid="${c.target.user_id || c.target.user_ids[0]}" data-id="${c.id}">${icon('ban')}${tr('Заблокировать пользователя', 'Block user')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-act="dismiss" data-id="${c.id}">${tr('Отклонить жалобу', 'Dismiss')}</button></div>` : ''}
    </div>`)}</div>` : emptyBox(tr('Жалоб нет', 'No complaints')));
    $$('[data-view]', el).forEach((b) => b.onclick = async () => {
      const { chat, messages } = await GET('/admin/chats/' + b.dataset.view);
      sheet(h`${sheetHead(tr('Чат', 'Chat') + ': ' + chat.title, tr('Просмотр фиксируется в журнале действий', 'Viewing is logged in the audit log'))}<div class="msgs" style="padding:0;max-height:60vh">${messages.map((m) => h`<div class="msg ${m.from === 'owner' ? 'mine' : ''}">${m.photo ? h`<img src="${m.photo}" alt="">` : ''}${m.lat != null ? `📍 ${m.lat}, ${m.lng}\n` : ''}${m.text}<time>${m.from === 'owner' ? tr('автор', 'author') : tr('собеседник', 'responder')} · ${fmtDate(m.created_at, true)}</time></div>`)}</div>`, { wide: true });
    });
    $$('[data-act]', el).forEach((b) => b.onclick = async () => {
      const a = b.dataset.act; const body = { action: a === 'dismiss' ? 'dismiss' : 'resolve' };
      if (a === 'hide') body.hide = true; if (a === 'block_chat') body.block_chat = true;
      if (a === 'block_user') { if (!(await confirmBox(tr('Заблокировать пользователя?', 'Block user?'), tr('Он не сможет входить на платформу.', 'They will not be able to sign in.'), { danger: true }))) return; body.block_user = +b.dataset.uid; }
      try { await POST('/admin/complaints/' + b.dataset.id, body); toast(tr('Готово', 'Done')); load(); } catch (e) { toastErr(e); }
    });
  };
  await load();
});

/* ---------- пользователи ---------- */
const ROLES = () => ({ user: tr('Пользователь', 'User'), volunteer: tr('Волонтёр', 'Volunteer'), partner: tr('Партнёр', 'Partner'), moderator: tr('Модератор', 'Moderator'), admin: tr('Администратор', 'Admin') });
sec('users', () => tr('Пользователи', 'Users'), async (el) => {
  let q = '', role = '';
  const load = async () => {
    const { items } = await GET('/admin/users?' + new URLSearchParams({ q, role }));
    mount($('#res', el), h`<div class="table-wrap" tabindex="0"><table class="t"><thead><tr><th>№</th><th>${tr('Имя', 'Name')}</th><th>${tr('Контакты', 'Contacts')}</th><th>${tr('Роль', 'Role')}</th><th class="num">${tr('Баллы', 'Points')}</th><th class="num">${tr('Заявки', 'Reports')}</th><th></th></tr></thead><tbody>
      ${items.map((u) => h`<tr style="${u.blocked ? 'opacity:.55' : ''}"><td>${u.id}</td><td><b>${u.name}</b>${u.org_name ? h`<div class="xs muted">${u.org_name}</div>` : ''}<div class="xs muted">${u.city ? u.city + ' · ' : ''}${fmtDate(u.created_at)}</div></td><td class="small">${u.email ? h`<div>${u.email}</div>` : ''}${u.phone ? h`<div>${u.phone}</div>` : ''}</td>
      <td>${isAdmin() && u.id !== state.user.id ? h`<select class="input" data-role="${u.id}" aria-label="${tr('Роль', 'Role')}" style="min-height:36px;padding:4px 30px 4px 10px;font-size:13px">${Object.entries(ROLES()).map(([k, v]) => h`<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`)}</select>` : ROLES()[u.role]}</td>
      <td class="num">${u.points}</td><td class="num">${u.apps}</td>
      <td><div class="row" style="gap:6px"><button class="btn btn-ghost btn-xs" data-pts="${u.id}" title="${tr('Начислить баллы', 'Award points')}" aria-label="${tr('Начислить баллы', 'Award points')}">${icon('award', 'ic-sm')}</button>${u.role !== 'admin' && u.id !== state.user.id ? h`<button class="btn ${u.blocked ? 'btn-ghost' : 'btn-danger'} btn-xs" data-blk="${u.id}" data-v="${u.blocked ? 0 : 1}">${u.blocked ? tr('Разблок.', 'Unblock') : tr('Блок', 'Block')}</button>` : ''}</div></td></tr>`)}</tbody></table></div>`);
    $$('[data-role]', el).forEach((s) => s.onchange = async () => { try { await PATCH('/admin/users/' + s.dataset.role, { role: s.value }); toast(tr('Роль изменена', 'Role changed')); } catch (e) { toastErr(e); load(); } });
    $$('[data-blk]', el).forEach((b) => b.onclick = async () => { try { await PATCH('/admin/users/' + b.dataset.blk, { blocked: b.dataset.v === '1' }); load(); } catch (e) { toastErr(e); } });
    $$('[data-pts]', el).forEach((b) => b.onclick = () => {
      const s = sheet(h`${sheetHead(tr('Начислить баллы', 'Award points'), tr('За подтверждённые находки и полезную информацию', 'For confirmed finds and useful information'))}<form class="stack"><label class="field"><span>${tr('Баллы (можно отрицательные)', 'Points (can be negative)')}</span><input name="points" type="number" value="20" required></label><label class="field"><span>${tr('Причина', 'Reason')}</span><input name="reason" required></label><button class="btn btn-block">${tr('Начислить', 'Award')}</button></form>`);
      $('form', s.el).onsubmit = async (e) => { e.preventDefault(); try { await PATCH('/admin/users/' + b.dataset.pts, formData(e.target)); s.close(); load(); } catch (er) { toastErr(er); } };
    });
  };
  mount(el, h`<form class="row-wrap" id="uf" style="margin-bottom:16px"><input class="input" name="q" placeholder="${tr('Имя, e-mail, телефон, организация', 'Name, e-mail, phone, org')}" style="flex:1;min-width:200px"><select class="input" name="role" aria-label="${tr('Роль', 'Role')}" style="width:auto"><option value="">${tr('Все роли', 'All roles')}</option>${Object.entries(ROLES()).map(([k, v]) => h`<option value="${k}">${v}</option>`)}</select><button class="btn" aria-label="${tr('Найти', 'Search')}">${icon('search')}</button></form><div id="res"></div>`);
  $('#uf', el).onsubmit = (e) => { e.preventDefault(); ({ q, role } = formData(e.target)); load(); };
  await load();
});
sec('roles', () => tr('Заявки волонтёров и партнёров', 'Volunteer & partner requests'), async (el) => {
  const load = async () => {
    const { items } = await GET('/admin/role-requests');
    mount(el, items.length ? h`<div class="stack">${items.map((r) => h`<div class="card pad stack" style="${r.status !== 'pending' ? 'opacity:.6' : ''}">
      <div class="row between"><div class="row-wrap"><span class="chip ${r.role === 'partner' ? 'chip-found' : 'chip-ok'}">${ROLES()[r.role]}</span><span class="chip">${r.status === 'pending' ? tr('Ожидает', 'Pending') : r.status === 'approved' ? tr('Одобрена', 'Approved') : tr('Отклонена', 'Rejected')}</span></div><span class="xs muted">${ago(r.created_at)}</span></div>
      <b>${r.name}${r.org_name ? ` — ${r.org_name}` : ''}</b>${r.org_type ? h`<div class="small muted">${r.org_type}</div>` : ''}
      <div class="small">${r.details}</div><div class="xs muted">${r.email || ''} ${r.phone || ''} · ${r.city || ''} · ${tr('зона', 'zone')}: ${r.zone_radius} ${tr('км', 'km')}</div>
      ${r.status === 'pending' ? h`<div class="row"><button class="btn btn-sm" data-ok="${r.id}">${icon('check')}${tr('Одобрить', 'Approve')}</button><button class="btn btn-ghost btn-sm" data-no="${r.id}">${tr('Отклонить', 'Reject')}</button></div>` : ''}</div>`)}</div>` : emptyBox(tr('Заявок нет', 'No requests')));
    $$('[data-ok]', el).forEach((b) => b.onclick = async () => { await POST('/admin/role-requests/' + b.dataset.ok, { action: 'approve' }); load(); });
    $$('[data-no]', el).forEach((b) => b.onclick = async () => { const reason = await confirmBox(tr('Отклонить заявку', 'Reject'), '', { input: tr('Причина', 'Reason') }); if (reason === null) return; await POST('/admin/role-requests/' + b.dataset.no, { action: 'reject', reason }); load(); });
  };
  await load();
});
sec('deletion', () => tr('Запросы на удаление', 'Removal requests'), async (el) => {
  const load = async () => {
    const { items } = await GET('/admin/deletion');
    mount(el, h`<div class="note" style="margin-bottom:16px">${icon('trash')}<div>${tr('Заявка удаляется по требованию автора или человека, о котором она подана. Проверьте личность заявителя перед удалением.', 'A report is removed at the request of its author or the person it concerns. Verify the requester\'s identity.')}</div></div>
      ${items.length ? h`<div class="stack">${items.map((d) => h`<div class="card pad stack" style="${d.status !== 'open' ? 'opacity:.6' : ''}"><b>${d.title ? h`<a class="link" href="#/a/${d.application_id}">№${d.application_id} · ${d.title}</a>` : tr('Заявка уже удалена', 'Already deleted')}</b><div class="small">${d.name} · ${d.contact}</div><div class="small muted">${d.reason}</div>
      ${d.status === 'open' && d.title ? h`<div class="row"><button class="btn btn-danger btn-sm" data-d="${d.id}" data-a="delete">${tr('Удалить заявку', 'Delete report')}</button><button class="btn btn-ghost btn-sm" data-d="${d.id}" data-a="reject">${tr('Отклонить', 'Reject')}</button></div>` : ''}</div>`)}</div>` : emptyBox(tr('Запросов нет', 'No requests'))}`);
    $$('[data-d]', el).forEach((b) => b.onclick = async () => { await POST('/admin/deletion/' + b.dataset.d, { action: b.dataset.a }); load(); });
  };
  await load();
});

/* ---------- поддержка ---------- */
sec('support', () => tr('Обращения в поддержку', 'Support tickets'), async (el) => {
  const { items } = await GET('/admin/tickets');
  mount(el, items.length ? h`<div class="list">${items.map((x) => h`<a href="#/admin/support/${x.id}">${icon('help')}<div class="grow" style="min-width:0"><b>${x.subject}</b><div class="xs muted">${x.name} · ${ago(x.updated_at)}</div>${x.last ? h`<div class="xs muted ellipsis">${x.last}</div>` : ''}</div><span class="chip ${x.status === 'open' ? 'chip-warn' : x.status === 'answered' ? 'chip-ok' : ''}">${x.status === 'open' ? tr('Ждёт ответа', 'Needs reply') : x.status === 'answered' ? tr('Отвечено', 'Answered') : tr('Закрыто', 'Closed')}</span></a>`)}</div>` : emptyBox(tr('Обращений нет', 'No tickets')));
});
route('/admin/support/:id', (view, p) => ticketView(view, p.id, true), { auth: true, mod: true });
sec('leads', () => tr('Партнёры и инвесторы', 'Partner & investor leads'), async (el) => {
  const load = async () => {
    const { items } = await GET('/admin/leads');
    mount(el, items.length ? h`<div class="table-wrap" tabindex="0"><table class="t"><thead><tr><th>${tr('Дата', 'Date')}</th><th>${tr('Тип', 'Type')}</th><th>${tr('Имя', 'Name')}</th><th>${tr('Контакт', 'Contact')}</th><th>${tr('Организация / сообщение', 'Org / message')}</th><th></th></tr></thead><tbody>
      ${items.map((l) => h`<tr style="${l.status !== 'new' ? 'opacity:.6' : ''}"><td>${fmtDate(l.created_at, true)}</td><td><span class="chip ${l.kind === 'investor' ? 'chip-found' : 'chip-ok'}">${l.kind === 'investor' ? tr('Инвестор', 'Investor') : tr('Партнёр', 'Partner')}</span></td><td><b>${l.name}</b></td><td>${l.contact}</td><td class="small">${l.org}<div class="muted">${l.message}</div></td><td>${l.status === 'new' ? h`<button class="btn btn-ghost btn-xs" data-l="${l.id}">${tr('Обработано', 'Done')}</button>` : ''}</td></tr>`)}</tbody></table></div>` : emptyBox(tr('Заявок нет', 'No leads')));
    $$('[data-l]', el).forEach((b) => b.onclick = async () => { await POST('/admin/leads/' + b.dataset.l, { status: 'done' }); load(); });
  };
  await load();
});
sec('payments', () => tr('Платежи', 'Payments'), async (el) => {
  const { items } = await GET('/admin/payments');
  mount(el, items.length ? h`<div class="table-wrap" tabindex="0"><table class="t"><thead><tr><th>№</th><th>${tr('Дата', 'Date')}</th><th>${tr('Пользователь', 'User')}</th><th>${tr('Тариф', 'Plan')}</th><th>${tr('Способ', 'Method')}</th><th class="num">${tr('Сумма', 'Amount')}</th><th>${tr('Статус', 'Status')}</th></tr></thead><tbody>
    ${items.map((p) => h`<tr><td>${p.id}</td><td>${fmtDate(p.created_at, true)}</td><td>${p.name}</td><td>${p.name_ru}${p.auto ? ' (авто)' : ''}</td><td>${{ card: tr('Карта', 'Card'), sbp: tr('СБП', 'SBP'), saved_card: tr('Сохр. карта', 'Saved card') }[p.method]}</td><td class="num"><b>${money(p.amount)}</b>${p.discount ? h`<div class="xs muted">−${p.discount}%</div>` : ''}</td><td><span class="chip ${p.status === 'succeeded' ? 'chip-ok' : p.status === 'pending' ? 'chip-warn' : ''}">${p.status}</span></td></tr>`)}</tbody></table></div>` : emptyBox(tr('Платежей нет', 'No payments')));
});

/* ---------- только администратор ---------- */
sec('tariffs', () => tr('Тарифы', 'Plans'), async (el, act) => {
  const load = async () => {
    const { items } = await GET('/admin/tariffs');
    mount(el, h`<div class="table-wrap" tabindex="0"><table class="t"><thead><tr><th>${tr('Название', 'Name')}</th><th>${tr('Для кого', 'Audience')}</th><th>${tr('Функция', 'Feature')}</th><th class="num">${tr('Цена', 'Price')}</th><th class="num">${tr('Период', 'Period')}</th><th>${tr('Активен', 'Active')}</th><th></th></tr></thead><tbody>
      ${items.map((x) => h`<tr><td><b>${x.name_ru}</b><div class="xs muted">${x.name_en}</div></td><td>${x.audience === 'partner' ? tr('Партнёры', 'Partners') : tr('Пользователи', 'Users')}</td><td><code>${x.feature}</code></td><td class="num">${money(x.price)}</td><td class="num">${x.period_days} ${tr('дн.', 'd')}</td><td>${x.active ? '✓' : '—'}</td><td><button class="btn btn-ghost btn-xs" data-ed="${x.id}" aria-label="${tr('Изменить', 'Edit')}">${icon('edit', 'ic-sm')}</button></td></tr>`)}</tbody></table></div>`);
    $$('[data-ed]', el).forEach((b) => b.onclick = () => form(items.find((x) => x.id === +b.dataset.ed)));
  };
  const form = (x = { audience: 'user', feature: 'registry', period_days: 30, active: 1 }) => {
    const s = sheet(h`${sheetHead(x.id ? tr('Изменить тариф', 'Edit plan') : tr('Новый тариф', 'New plan'))}<form class="stack">
      <div class="grid-2"><label class="field"><span>${tr('Название (RU)', 'Name (RU)')}</span><input name="name_ru" value="${x.name_ru || ''}" required></label><label class="field"><span>${tr('Название (EN)', 'Name (EN)')}</span><input name="name_en" value="${x.name_en || ''}"></label></div>
      <div class="grid-2"><label class="field"><span>${tr('Описание (RU)', 'Description (RU)')}</span><textarea name="desc_ru" rows="2">${x.desc_ru || ''}</textarea></label><label class="field"><span>${tr('Описание (EN)', 'Description (EN)')}</span><textarea name="desc_en" rows="2">${x.desc_en || ''}</textarea></label></div>
      <div class="grid-3"><label class="field"><span>${tr('Цена, ₽', 'Price, ₽')}</span><input name="price" type="number" min="0" value="${x.price ?? ''}" required></label><label class="field"><span>${tr('Период, дней', 'Period, days')}</span><input name="period_days" type="number" min="1" value="${x.period_days}"></label><label class="field"><span>${tr('Порядок', 'Order')}</span><input name="sort" type="number" value="${x.sort || 0}"></label></div>
      <div class="grid-2"><label class="field"><span>${tr('Для кого', 'Audience')}</span><select name="audience"><option value="user" ${x.audience === 'user' ? 'selected' : ''}>${tr('Пользователи', 'Users')}</option><option value="partner" ${x.audience === 'partner' ? 'selected' : ''}>${tr('Партнёры', 'Partners')}</option></select></label>
      <label class="field"><span>${tr('Функция', 'Feature')}</span><select name="feature">${[['registry', tr('Расширенный реестр', 'Extended registry')], ['promote', tr('Продвижение заявки', 'Boost report')], ['partner', tr('Тариф партнёра', 'Partner plan')]].map(([k, v]) => h`<option value="${k}" ${x.feature === k ? 'selected' : ''}>${v}</option>`)}</select></label></div>
      <label class="check"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> ${tr('Активен', 'Active')}</label><button class="btn btn-block">${tr('Сохранить', 'Save')}</button></form>`);
    $('form', s.el).onsubmit = async (e) => { e.preventDefault(); try { await POST('/admin/tariffs', Object.assign(formData(e.target), { id: x.id })); s.close(); load(); } catch (er) { toastErr(er); } };
  };
  mount(act, h`<button class="btn btn-sm" id="nt">${icon('plus')}${tr('Тариф', 'Plan')}</button>`); $('#nt', act).onclick = () => form();
  await load();
}, { admin: true });
const DICT_T = () => ({ species: tr('Виды животных', 'Animal species'), thing_type: tr('Типы вещей', 'Item types'), complaint_reason: tr('Причины жалоб', 'Complaint reasons'), partner_type: tr('Типы партнёров', 'Partner types') });
sec('dicts', () => tr('Справочники', 'Dictionaries'), async (el) => {
  const load = async () => {
    const { items } = await GET('/admin/dicts');
    mount(el, h`<div class="grid-2" style="gap:14px;align-items:start">${Object.entries(DICT_T()).map(([type, name]) => h`<div class="card pad stack"><h3 style="font-size:16px">${name}</h3>
      <div class="list">${items.filter((d) => d.type === type).map((d) => h`<div><div class="grow"><b>${d.value_ru}</b> <span class="muted small">/ ${d.value_en}</span></div><button class="btn btn-ghost btn-xs" data-ed="${d.id}" aria-label="${tr('Изменить', 'Edit')}">${icon('edit', 'ic-sm')}</button><button class="btn btn-ghost btn-xs" data-rm="${d.id}" aria-label="${tr('Удалить', 'Delete')}">${icon('trash', 'ic-sm')}</button></div>`)}</div>
      <form class="row" data-add="${type}"><input class="input" name="value_ru" placeholder="RU" required style="min-height:40px"><input class="input" name="value_en" placeholder="EN" style="min-height:40px"><button class="btn btn-sm" aria-label="${tr('Добавить', 'Add')}">${icon('plus')}</button></form></div>`)}</div>`);
    $$('[data-add]', el).forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); await POST('/admin/dicts', Object.assign(formData(f), { type: f.dataset.add })); load(); });
    $$('[data-rm]', el).forEach((b) => b.onclick = async () => { if (await confirmBox(tr('Удалить значение?', 'Delete value?'), '', { danger: true })) { await DEL('/admin/dicts/' + b.dataset.rm); load(); } });
    $$('[data-ed]', el).forEach((b) => b.onclick = () => {
      const d = items.find((x) => x.id === +b.dataset.ed);
      const s = sheet(h`${sheetHead(tr('Изменить значение', 'Edit value'))}<form class="stack"><label class="field"><span>RU</span><input name="value_ru" value="${d.value_ru}" required></label><label class="field"><span>EN</span><input name="value_en" value="${d.value_en}"></label><label class="field"><span>${tr('Порядок', 'Order')}</span><input name="sort" type="number" value="${d.sort}"></label><button class="btn btn-block">${tr('Сохранить', 'Save')}</button></form>`);
      $('form', s.el).onsubmit = async (e) => { e.preventDefault(); await POST('/admin/dicts', Object.assign(formData(e.target), { id: d.id, type: d.type })); s.close(); load(); };
    });
  };
  await load();
}, { admin: true });

// Переводы: ключи собираются прямо из исходников интерфейса — список всегда полный
async function collectKeys() {
  const files = ['/js/views.js', '/js/core.js'];
  const re = /\bt\('([\w.]+)',\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'\)/g;
  const keys = new Map();
  for (const f of files) {
    const src = await (await fetch(f, { cache: 'no-store' })).text();
    for (const m of src.matchAll(re)) if (!keys.has(m[1])) keys.set(m[1], { ru: m[2].replace(/\\'/g, "'"), en: m[3].replace(/\\'/g, "'") });
  }
  // Документы встроены в сервер (server/legal.js). Здесь можно заменить реквизиты оператора или текст документа целиком.
  [['name', '(название оператора, например ООО «…» или ИП … — не указано)', '(operator name — not set)'], ['inn', '(ИНН оператора — не указан)', '(TIN — not set)'], ['ogrn', '(ОГРН/ОГРНИП — не указан)', '(OGRN — not set)'], ['address', '(юридический адрес — не указан)', '(legal address — not set)'], ['email', 'support@mybestagent.ru', 'support@mybestagent.ru']]
    .forEach(([k, ru, en]) => keys.set('legal.op.' + k, { ru, en }));
  ['terms', 'privacy', 'consent', 'publication'].forEach((d) => keys.set('legal.text.' + d, { ru: tr('(встроенный текст; вставьте свой, чтобы заменить документ целиком: абзацы через пустую строку, разделы — «1. Заголовок»)', '(built-in text; paste your own to replace the whole document: blank line between paragraphs, sections as "1. Heading")'), en: '' }));
  return keys;
}
sec('translations', () => tr('Переводы и тексты', 'Translations & texts'), async (el) => {
  const keys = await collectKeys();
  const { items } = await GET('/admin/translations');
  const ov = {}; items.forEach((x) => { ov[x.key + ':' + x.lang] = x.value; });
  let filter = '', page = 0;
  const PER = 50;
  const draw = () => {
    const list = [...keys.entries()].filter(([k, v]) => !filter || (k + ' ' + v.ru + ' ' + v.en + ' ' + (ov[k + ':ru'] || '') + ' ' + (ov[k + ':en'] || '')).toLowerCase().includes(filter));
    const pages = Math.max(1, Math.ceil(list.length / PER)); page = Math.min(page, pages - 1);
    const pager = pages > 1 ? h`<div class="row" style="justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" data-pg="${page - 1}" ${page ? '' : 'disabled'} aria-label="${tr('Предыдущая страница', 'Previous page')}">${icon('chevL', 'ic-sm')}</button><span class="small muted">${tr('Страница', 'Page')} ${page + 1} ${tr('из', 'of')} ${pages}</span><button class="btn btn-ghost btn-sm" data-pg="${page + 1}" ${page < pages - 1 ? '' : 'disabled'} aria-label="${tr('Следующая страница', 'Next page')}">${icon('chevR', 'ic-sm')}</button></div>` : '';
    mount($('#res', el), h`<p class="small muted" style="margin-bottom:10px">${tr('Ключей', 'Keys')}: ${list.length} · ${tr('изменено', 'overridden')}: ${items.length}</p><div class="table-wrap" tabindex="0"><table class="t"><thead><tr><th>${tr('Ключ', 'Key')}</th><th>Русский</th><th>English</th><th></th></tr></thead><tbody>
      ${list.slice(page * PER, page * PER + PER).map(([k, v]) => h`<tr><td><code class="xs">${k}</code></td><td class="small" style="${ov[k + ':ru'] ? 'color:var(--blue);font-weight:700' : ''}">${ov[k + ':ru'] || v.ru}</td><td class="small" style="${ov[k + ':en'] ? 'color:var(--blue);font-weight:700' : ''}">${ov[k + ':en'] || v.en}</td><td><button class="btn btn-ghost btn-xs" data-k="${k}" aria-label="${tr('Изменить', 'Edit')}">${icon('edit', 'ic-sm')}</button></td></tr>`)}</tbody></table></div>${pager}`);
    $$('[data-pg]', el).forEach((b) => b.onclick = () => { page = +b.dataset.pg; draw(); $('#tf', el).scrollIntoView({ block: 'start' }); });
    $$('[data-k]', el).forEach((b) => b.onclick = () => {
      const k = b.dataset.k, v = keys.get(k);
      const s = sheet(h`${sheetHead(tr('Изменить текст', 'Edit text'), k)}<form class="stack">
        <label class="field"><span>Русский</span><textarea name="ru" rows="${k.startsWith('legal.text') ? 12 : 3}" placeholder="${v.ru}">${ov[k + ':ru'] || ''}</textarea></label>
        <label class="field"><span>English</span><textarea name="en" rows="${k.startsWith('legal.text') ? 12 : 3}" placeholder="${v.en}">${ov[k + ':en'] || ''}</textarea></label>
        <p class="xs muted">${tr('Пустое поле — используется текст по умолчанию (показан серым).', 'Leave empty to use the default (shown in grey).')}</p><button class="btn btn-block">${tr('Сохранить', 'Save')}</button></form>`, { wide: k.startsWith('legal.text') });
      $('form', s.el).onsubmit = async (e) => {
        e.preventDefault(); const f = formData(e.target);
        await POST('/admin/translations', { key: k, lang: 'ru', value: f.ru }); await POST('/admin/translations', { key: k, lang: 'en', value: f.en });
        ov[k + ':ru'] = f.ru; ov[k + ':en'] = f.en; s.close(); toast(tr('Сохранено. Обновите страницу, чтобы увидеть изменения.', 'Saved. Reload to see changes.')); draw();
      };
    });
  };
  mount(el, h`<div class="note note-blue" style="margin-bottom:14px">${icon('globe')}<div>${tr('Интерфейс на русском и английском. Здесь можно заменить любой текст. Документы (соглашение, политика, согласия) уже написаны и выгружаются в PDF; ключи legal.op.* — реквизиты оператора (название, ИНН, ОГРН, адрес, e-mail), они подставляются во все документы.', 'The interface is in Russian and English. Override any text here. Legal documents are built in and exported to PDF; legal.op.* keys hold the operator details used in all documents.')}</div></div>
    <div class="search-box" style="margin-bottom:14px">${icon('search')}<input id="tf" placeholder="${tr('Поиск по ключу или тексту', 'Search key or text')}"></div><div id="res"></div>`);
  $('#tf', el).oninput = (e) => { filter = e.target.value.toLowerCase(); page = 0; draw(); };
  draw();
}, { admin: true });
sec('stories', () => tr('Истории успешных находок', 'Success stories'), async (el, act) => {
  const load = async () => {
    const { items } = await GET('/admin/stories');
    mount(el, h`<div class="stack">${items.map((s) => h`<div class="card pad row" style="align-items:flex-start"><div class="grow"><div class="row-wrap"><span class="chip">${catName(s.category)}</span>${s.published ? '' : h`<span class="chip chip-warn">${tr('Скрыта', 'Hidden')}</span>`}</div><b style="display:block;margin-top:8px">${s.title_ru}</b><div class="small muted">${s.text_ru}</div></div><button class="btn btn-ghost btn-xs" data-ed="${s.id}" aria-label="${tr('Изменить', 'Edit')}">${icon('edit', 'ic-sm')}</button><button class="btn btn-ghost btn-xs" data-rm="${s.id}" aria-label="${tr('Удалить', 'Delete')}">${icon('trash', 'ic-sm')}</button></div>`)}</div>`);
    $$('[data-ed]', el).forEach((b) => b.onclick = () => form(items.find((x) => x.id === +b.dataset.ed)));
    $$('[data-rm]', el).forEach((b) => b.onclick = async () => { if (await confirmBox(tr('Удалить историю?', 'Delete story?'), '', { danger: true })) { await DEL('/admin/stories/' + b.dataset.rm); load(); } });
  };
  const form = (x = { category: 'people', published: 1 }) => {
    const s = sheet(h`${sheetHead(x.id ? tr('Изменить историю', 'Edit story') : tr('Новая история', 'New story'))}<form class="stack">
      <div class="grid-2"><label class="field"><span>${tr('Категория', 'Category')}</span><select name="category">${['people', 'animals', 'things'].map((c) => h`<option value="${c}" ${x.category === c ? 'selected' : ''}>${catName(c)}</option>`)}</select></label><label class="field"><span>${tr('Город', 'City')}</span><input name="city" value="${x.city || ''}"></label></div>
      <div class="grid-2"><label class="field"><span>${tr('Заголовок (RU)', 'Title (RU)')}</span><input name="title_ru" value="${x.title_ru || ''}" required></label><label class="field"><span>${tr('Заголовок (EN)', 'Title (EN)')}</span><input name="title_en" value="${x.title_en || ''}"></label></div>
      <label class="field"><span>${tr('Текст (RU)', 'Text (RU)')}</span><textarea name="text_ru" rows="3" required>${x.text_ru || ''}</textarea></label><label class="field"><span>${tr('Текст (EN)', 'Text (EN)')}</span><textarea name="text_en" rows="3">${x.text_en || ''}</textarea></label>
      <label class="check"><input type="checkbox" name="published" ${x.published ? 'checked' : ''}> ${tr('Опубликована', 'Published')}</label><button class="btn btn-block">${tr('Сохранить', 'Save')}</button></form>`, { wide: true });
    $('form', s.el).onsubmit = async (e) => { e.preventDefault(); try { await POST('/admin/stories', Object.assign(formData(e.target), { id: x.id })); s.close(); load(); } catch (er) { toastErr(er); } };
  };
  mount(act, h`<button class="btn btn-sm" id="ns">${icon('plus')}${tr('История', 'Story')}</button>`); $('#ns', act).onclick = () => form();
  await load();
}, { admin: true });
sec('system', () => tr('Система', 'System'), async (el) => {
  mount(el, h`<div class="grid-2" style="gap:14px">
    <div class="card pad stack"><h3>${tr('Резервное копирование', 'Backups')}</h3><p class="small muted">${tr('Копия базы создаётся автоматически раз в сутки, хранятся 14 последних. Фото хранятся в папке data/uploads.', 'A database copy is made daily; the last 14 are kept. Photos are stored in data/uploads.')}</p><button class="btn" id="bk">${icon('db')}${tr('Создать копию сейчас', 'Back up now')}</button></div>
    <div class="card pad stack"><h3>${tr('Готовность к работе', 'Launch readiness')}</h3><div class="list small" id="ready"><div class="sk" style="height:120px"></div></div>
      <p class="xs muted">${tr('Ключи и адреса задаются в переменных окружения сервера (файл .env, см. README → «Запуск в работу»). Реквизиты оператора можно также указать в разделе «Переводы».', 'Keys and addresses are set in server environment variables (.env, see README → “Going live”). Operator details can also be set under Translations.')}</p></div>
  </div>`);
  const RL = {
    mode: [tr('Режим работы', 'Mode'), (v) => (v === 'production' ? tr('рабочий', 'production') : tr('тестовый (NODE_ENV не production)', 'test (NODE_ENV is not production)'))],
    base_url: [tr('Адрес сайта (https)', 'Site address (https)'), (v) => v || tr('не задан', 'not set')],
    admin: [tr('Администратор', 'Administrator'), () => tr('есть', 'present')],
    email: [tr('Отправка e-mail', 'E-mail delivery'), (v) => v || tr('не подключена — письма только в журнале', 'not connected — log only')],
    sms: [tr('Отправка SMS', 'SMS delivery'), (v) => v || tr('не подключена — вход по телефону недоступен', 'not connected — phone sign-in unavailable')],
    payments: [tr('Приём оплаты (карты РФ, СБП, чеки)', 'Payments (RU cards, SBP, receipts)'), (v) => (v === 'ЮKassa' ? v : v === 'test' ? tr('тестовая страница (только тестовый режим)', 'test page (test mode only)') : tr('не подключён — оплата недоступна', 'not connected — payments unavailable'))],
    legal: [tr('Реквизиты оператора в документах', 'Operator details in documents'), (v) => v || tr('не заполнены', 'not filled in')],
    push: [tr('Push-уведомления', 'Push notifications'), (v) => v],
    demo: [tr('Демо-данные', 'Demo data'), () => tr('нет', 'none')]
  };
  const loadReady = () => GET('/admin/status').then(({ items }) => {
    const box = $('#ready', el); if (!box) return;
    mount(box, h`${items.map((c) => h`<div><span class="ready-ic ${c.ok ? 'ok' : 'no'}">${icon(c.ok ? 'check' : 'alert', 'ic-sm')}</span><span class="grow">${RL[c.key] ? RL[c.key][0] : c.key}</span><b class="${c.ok ? '' : 'warn-t'}">${c.ok || c.key !== 'demo' ? (RL[c.key] ? RL[c.key][1](c.value) : c.value) : tr('есть демо-пользователи — для работы нужна чистая база', 'demo users present — use a clean database')}</b></div>`)}`);
  }).catch((e) => {
    const box = $('#ready', el); if (!box) return;
    mount(box, h`<div class="row" style="gap:10px;flex-wrap:wrap"><span class="ready-ic no">${icon('alert', 'ic-sm')}</span><span class="grow">${tr('Не удалось получить состояние сервера', 'Could not load server status')}${e && e.message ? h`<span class="xs muted" style="display:block">${e.message}</span>` : ''}</span><button class="btn btn-sm btn-ghost" id="readyRetry">${tr('Повторить', 'Retry')}</button></div>`);
    $('#readyRetry', box).onclick = () => { mount(box, h`<div class="sk" style="height:120px"></div>`); loadReady(); };
  });
  loadReady();
  $('#bk', el).onclick = (e) => busy(e.currentTarget, async () => { const r = await POST('/admin/backup'); toast(tr('Копия создана', 'Backup created'), 'ok', r.file); });
}, { admin: true });
sec('outbox', () => tr('Исходящие e-mail и SMS', 'Outgoing e-mail & SMS'), async (el) => {
  const { items } = await GET('/admin/outbox');
  const ST = { sent: [tr('отправлено', 'sent'), 'chip-ok'], failed: [tr('ошибка', 'failed'), 'chip-lost'], queued: [tr('отправляется', 'sending'), 'chip-warn'], logged: [tr('только журнал', 'log only'), ''] };
  mount(el, h`<p class="muted small" style="margin-bottom:14px">${tr('Журнал писем и SMS за последний год. Одноразовые коды в журнале скрыты.', 'Log of e-mails and SMS for the last year. One-time codes are hidden.')}</p>
    ${items.length ? h`<div class="table-wrap" tabindex="0"><table class="t"><thead><tr><th>${tr('Время', 'Time')}</th><th>${tr('Канал', 'Channel')}</th><th>${tr('Кому', 'To')}</th><th>${tr('Текст', 'Text')}</th><th>${tr('Статус', 'Status')}</th></tr></thead><tbody>${items.map((o) => h`<tr><td class="xs">${fmtDate(o.created_at, true)}</td><td><span class="chip">${o.channel === 'sms' ? 'SMS' : 'E-mail'}</span></td><td class="small">${o.target}</td><td class="small"><b>${o.subject}</b><div class="muted" style="white-space:pre-wrap">${o.body}</div></td><td><span class="chip ${(ST[o.status] || ST.logged)[1]}">${(ST[o.status] || ST.logged)[0]}</span>${o.error ? h`<div class="xs muted" style="max-width:220px">${o.error}</div>` : ''}</td></tr>`)}</tbody></table></div>` : emptyBox(tr('Пусто', 'Empty'))}`);
}, { admin: true });
sec('audit', () => tr('Журнал действий', 'Audit log'), async (el) => {
  const { items } = await GET('/admin/audit');
  mount(el, h`<div class="table-wrap" tabindex="0"><table class="t"><thead><tr><th>${tr('Время', 'Time')}</th><th>${tr('Кто', 'Who')}</th><th>${tr('Действие', 'Action')}</th><th>${tr('Объект', 'Target')}</th><th>IP</th></tr></thead><tbody>
    ${items.map((a) => h`<tr><td class="xs">${fmtDate(a.created_at, true)}</td><td class="small">${a.name || '—'}</td><td><code class="xs">${a.action}</code>${a.meta ? h`<div class="xs muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.meta}</div>` : ''}</td><td class="xs">${a.target}</td><td class="xs muted">${a.ip}</td></tr>`)}</tbody></table></div>`);
});
export {};
