// Пользовательские экраны платформы.
import {
  state, t, tr, dict, h, raw, mount, $, $$, icon, CAT, catName, kindName, statusName, statusChip,
  fmtDate, ago, timeOf, km, money, plural, GET, POST, PATCH, DEL, refreshMe, route, onLeave, go, query, currentPath,
  toast, toastErr, sheet, sheetHead, confirmBox, lightbox, photoField, upload, makeMap, pinIcon, mapPicker, mapFull, getPosition,
  onEvent, connectStream, mediaPh, enablePush, disablePush, pushStatus, isIOS, isStandalone, shareSheet, countUp, formData, busy, observeReveal, safeSet, esc, setShell,
  emergencyPhones
} from './core.js';
import { BREEDS, COLORS, parksOf } from './places.js';
import { pushCard, installCard, meNudge } from './push.js';

/* =================== общие компоненты =================== */
// Псевдоним собеседника в анонимном чате (сервер отдаёт по-русски, здесь — перевод).
const aliasOf = (c) => { if (state.lang !== 'en') return c.alias; const k = c.application ? c.application.kind : c.kind; return c.side === 'owner' ? (k === 'lost' ? 'Responder' : 'Owner') : (k === 'lost' ? 'Report author (searching)' : 'Finder'); };
const media = (a, cls = '') => a.photos && a.photos.length
  ? h`<img src="${a.photos[0]}" alt="" loading="lazy">`
  : mediaPh(a.category, cls);

export function appCard(a, i = 0, extra = {}) {
  return h`<a class="app-card rise ${a.emergency ? 'em' : ''}" style="--i:${i}" href="#/a/${a.id}">
    <div class="media">${media(a)}
      <div class="tags">
        ${a.emergency ? h`<span class="chip chip-em">${icon('siren')}${t('card.sos', 'Экстренно', 'Urgent')}</span>` : ''}
        ${a.status === 'found' ? h`<span class="chip chip-ok">${icon('check')}${statusName('found')}</span>` : h`<span class="chip chip-${a.kind}">${kindName(a.kind)}</span>`}
        <span class="chip">${icon(CAT[a.category].icon)}${catName(a.category)}</span>
        ${a.promoted ? h`<span class="chip">${icon('zap')}${t('card.top', 'Топ', 'Top')}</span>` : ''}
      </div>
      ${extra.score ? h`<span class="score">${extra.score}%</span>` : ''}
    </div>
    <div class="body">
      <h3>${a.title}</h3>
      ${a.reward ? h`<span class="chip chip-warn" style="align-self:flex-start">${icon('gift')}${money(a.reward)}</span>` : ''}
      <div class="meta">
        <span>${icon('pin')}${a.address || a.city || '—'}</span>
        ${a.distance != null ? h`<span>${icon('locate')}${km(a.distance)}</span>` : ''}
        <span>${icon('clock')}${ago(a.created_at)}</span>
      </div>
    </div></a>`;
}
export function appRow(a, right = '') {
  return h`<a class="app-row" href="#/a/${a.id}">
    <div class="thumb">${a.photos && a.photos.length ? h`<img src="${a.photos[0]}" alt="" loading="lazy">` : mediaPh(a.category)}</div>
    <div class="grow"><div class="row-wrap" style="gap:6px;margin-bottom:4px">
      <span class="chip chip-${a.kind}" style="height:22px;font-size:11px">${kindName(a.kind)}</span>
      ${a.status !== 'published' ? h`<span class="chip ${statusChip(a.status)}" style="height:22px;font-size:11px">${statusName(a.status)}</span>` : ''}
      ${a.emergency ? h`<span class="chip chip-em" style="height:22px;font-size:11px">SOS</span>` : ''}
    </div><h4>${a.title}</h4>
    <div class="meta"><span>${catName(a.category)}</span><span>${a.address || a.city || ''}</span>${a.distance != null ? h`<span>${km(a.distance)}</span>` : ''}<span>${ago(a.created_at)}</span></div></div>
    ${right || icon('chevR')}</a>`;
}
const skeletons = (n = 4) => h`<div class="apps">${Array.from({ length: n }, () => h`<div class="sk sk-card"></div>`)}</div>`;
const empty = (ic, title, text = '', action = '') => h`<div class="empty">${icon(ic)}<b>${title}</b>${text}${action ? h`<div style="margin-top:16px">${action}</div>` : ''}</div>`;
const needLogin = (next) => go('#/login?next=' + encodeURIComponent(next || location.hash));
const back = (href, label) => href === 'back'
  ? h`<button type="button" class="back" data-back>${icon('arrowL', 'ic-sm')}${label || tr('Назад', 'Back')}</button>`
  : h`<a class="back" href="${href}">${icon('arrowL', 'ic-sm')}${label || tr('Назад', 'Back')}</a>`;
const levelName = (l) => (state.lang === 'en' ? l.en : l.ru);
const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
const avatar = (u, cls = '') => h`<div class="ava ${cls}" style="${u.avatar ? `background-image:url('${esc(u.avatar)}')` : ''}">${u.avatar ? '' : initials(u.name)}</div>`;

/* =================== РЕКЛАМНАЯ СТРОКА =================== */
// Бегущая строка на всю ширину сразу под шапкой, над «Поиск пропавших…»: объявления непрерывно и плавно едут справа налево по кругу.
// Пауза при наведении мыши и при фокусе с клавиатуры, вне экрана — тоже стоит; при «уменьшить движение» строка не едет, её можно пролистать пальцем.
// Метка «Реклама», рекламодатель и токен erid — по закону о рекламе. Объявления задаёт администратор: админка → «Реклама».
const AD_SPEED = 42; // px/с — спокойно, текст легко читается на ходу
function adLine() {
  const ads = state.config?.ads || [];
  if (!ads.length) return '';
  const who = (a) => [a.advertiser ? tr('Рекламодатель: ', 'Advertiser: ') + a.advertiser : '', a.erid ? 'erid: ' + a.erid : ''].filter(Boolean).join('. ');
  // название рекламодателя: по-русски — как задано в админке («Кадры здесь»), по-английски — адрес сайта
  const brand = (a) => (state.lang === 'en' ? a.host : a.advertiser || a.host);
  // у всех объявлений один рекламодатель — его название стоит слева один раз, в строке едут только сами предложения
  const one = new Set(ads.map(brand)).size === 1;
  return h`<aside class="adline${one ? ' one' : ''}" id="adLine" aria-label="${tr('Реклама', 'Advertising')}"><div class="wrap adline-in">
    <span class="ad-tag" title="${[...new Set(ads.map(who).filter(Boolean))].join('; ')}">${tr('Реклама', 'Ad')}</span>
    ${one ? h`<span class="ad-who">${brand(ads[0])}</span>` : ''}
    <div class="ad-vp"><div class="ad-track"><div class="ad-run">${ads.map((a) => h`<a class="ad-item" href="${a.url}" target="_blank" rel="noopener sponsored" title="${who(a)}"><b class="ad-brand">${brand(a)}</b><span class="ad-tx">${state.lang === 'en' ? a.en : a.ru}</span>${icon('arrowUR', 'ic-sm ad-go')}</a><i class="ad-sep" aria-hidden="true"></i>`)}</div></div></div>
  </div></aside>`;
}
function startAdLine(view) {
  const box = $('#adLine', view); if (!box) return;
  const vp = $('.ad-vp', box), track = $('.ad-track', box), run = $('.ad-run', box);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { box.classList.add('still'); return; }
  const base = run.innerHTML, count = run.querySelectorAll('.ad-item').length;
  // повторы объявлений — только для глаз: вне Tab и скрыты от экранных дикторов
  const quiet = (root, from = 0) => $$('.ad-item', root).forEach((a, i) => { if (i >= from) { a.tabIndex = -1; a.setAttribute('aria-hidden', 'true'); } });
  const build = () => {
    box.classList.remove('go');
    $$('.ad-run.copy', track).forEach((e) => e.remove());
    run.innerHTML = base;
    // группа объявлений не короче видимой полосы — иначе в бегущей строке появятся пустоты
    for (let n = 1; run.scrollWidth < vp.clientWidth + 40 && n < 12; n++) run.insertAdjacentHTML('beforeend', base);
    quiet(run, count);
    const copy = run.cloneNode(true); copy.classList.add('copy'); copy.setAttribute('aria-hidden', 'true'); quiet(copy); track.appendChild(copy);
    track.style.setProperty('--ad-dur', (run.getBoundingClientRect().width / AD_SPEED).toFixed(1) + 's');
    requestAnimationFrame(() => box.classList.add('go'));
  };
  build();
  let w = vp.clientWidth;
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { if (Math.abs(vp.clientWidth - w) > 24) { w = vp.clientWidth; build(); } }) : null;
  ro?.observe(vp);
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([en]) => box.classList.toggle('off', !en.isIntersecting)) : null;
  io?.observe(box);
  onLeave(() => { ro?.disconnect(); io?.disconnect(); });
}

/* =================== ГЛАВНАЯ =================== */
route('/', async (view) => {
  mount(view, h`
  ${adLine()}
  <div class="wrap home">
    <section class="blk hero-blk">
      <div class="hb-top">
        <div class="hb-text">
          <h1 class="rise">${t('home.h1', 'Поиск пропавших людей, животных и вещей', 'Find missing people, pets and belongings')}</h1>
          <p class="lead rise" style="--i:1">${t('home.lead3', 'Разместите заявку — мы подберём похожие и оповестим людей рядом. Контакты скрыты, связь через анонимный чат.', 'Post a report — we match similar ones and alert people nearby. Contacts stay hidden, you talk in an anonymous chat.')}</p>
        </div>
        <div class="hb-cta rise" style="--i:2">
          <a class="btn btn-lost btn-lg" href="#/new/lost">${icon('plus')}${t('home.lost2', 'Сообщить о пропаже', 'Report a loss')}</a>
          <a class="btn btn-found btn-lg" href="#/new/found">${icon('check')}${t('home.found2', 'Я нашёл', 'I found something')}</a>
        </div>
      </div>
      <form class="big-search rise" style="--i:2" id="homeSearch" role="search">
        <label class="bs-cat"><span class="sr">${tr('Категория', 'Category')}</span><select name="category">
          <option value="">${tr('Все категории', 'All categories')}</option>
          <option value="people">${catName('people')}</option><option value="animals">${catName('animals')}</option><option value="things">${catName('things')}</option>
        </select></label>
        <label class="bs-in">${icon('search')}<span class="sr">${tr('Поиск по заявкам', 'Search reports')}</span><input name="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="${t('home.search_ph', 'Кличка, приметы, улица или район', 'Name, features, street or area')}"></label>
        <button class="btn btn-search">${icon('search', 'ic-sm')}${t('home.search_btn', 'Найти', 'Search')}</button>
      </form>
      <div class="hero-stats rise" style="--i:3" id="heroStats">
        <div><b data-count="0">0</b><span>${t('home.st_active', 'активных заявок', 'active reports')}</span></div>
        <div><b data-count="0">0</b><span>${t('home.st_found', 'уже найдено', 'already found')}</span></div>
        <div><b data-count="0">0</b><span>${t('home.st_vol', 'волонтёров и партнёров', 'volunteers & partners')}</span></div>
      </div>
      <nav class="ctiles" aria-label="${t('home.svc', 'Что случилось?', 'What happened?')}">
      ${[['people', 'volunteer.jpg', '#/new/lost?category=people', t('home.svc_p', 'Пропал человек', 'A person is missing'), t('home.svc_pt', 'Проверим и опубликуем', 'We check and publish')],
        ['animals', 'dog-happy.jpg', '#/new/lost?category=animals', t('home.svc_a', 'Потерялся питомец', 'A pet is lost'), t('home.svc_at', 'Собака, кошка, птица', 'Dog, cat, bird')],
        ['things', 'backpack.jpg', '#/new/lost?category=things', t('home.svc_t', 'Потерял вещь', 'Lost an item'), t('home.svc_tt', 'Ключи, телефон, документы', 'Keys, phone, documents')],
        ['found', 'labrador.jpg', '#/new/found', t('home.svc_f', 'Я что-то нашёл', 'I found something'), t('home.svc_ft', 'Поможем вернуть владельцу', 'We help return it')]]
        .map(([c, img, href, ti, tx], i) => h`<a class="ctile ctile-${c} reveal" style="--i:${i}" href="${href}"><span class="ctile-tx"><b>${ti}</b><span>${tx}</span>${c !== 'found' ? h`<span class="svc-n" data-cat="${c}"></span>` : ''}</span><img src="/assets/img/${img}" alt="" loading="lazy"></a>`)}
      </nav>
      ${emergencyPhones()}
    </section>

    <section class="blk">
      <div class="blk-head"><h2>${t('home.latest', 'Свежие заявки', 'Latest reports')}</h2>
        <a class="blk-more" href="#/map">${t('home.all2', 'Все на карте', 'All on the map')}${icon('chevR', 'ic-sm')}</a></div>
      <div id="latest">${skeletons(4)}</div>
    </section>

    <div class="promos">
      <a class="promo promo-wine reveal" href="#/community">
        <span class="promo-tx"><b>${t('home.comm', 'Станьте волонтёром или партнёром', 'Become a volunteer or partner')}</b>
          <span>${t('home.comm_t2', 'Получайте оповещения по своему району и помогайте искать', 'Get alerts for your area and help search')}</span>
          <span class="btn btn-sm promo-btn">${t('home.comm_btn', 'Присоединиться', 'Join')}</span></span>
        <img src="/assets/img/volunteers.jpg" alt="" loading="lazy">
      </a>
      <div class="promo promo-light reveal" style="--i:1">
        <span class="promo-tx"><b>${t('home.reg', 'Реестр ценностей и антиквариата', 'Valuables & antiques registry')}</b>
          <span>${t('home.reg_t', 'Добавьте ценные вещи заранее. Перед покупкой проверьте — не краденое ли.', 'Add valuables in advance. Before buying, check it isn’t stolen.')}</span>
          <form class="search-box" id="regForm">${icon('search')}<input name="q" aria-label="${t('home.reg_ph', 'Серийный номер или название', 'Serial number or name')}" placeholder="${t('home.reg_ph', 'Серийный номер или название', 'Serial number or name')}" minlength="3" required><button class="fbtn fbtn-search" aria-label="${tr('Проверить', 'Check')}">${icon('chevR')}</button></form></span>
      </div>
    </div>

    <section class="blk">
      <div class="blk-head"><h2>${t('home.how', 'Как это работает', 'How it works')}</h2></div>
      <div class="steps">
        ${[[t('home.s1', 'Заявка за 2 минуты', 'Report in 2 minutes'), t('home.s1t', 'До 5 фото, приметы, место на карте или текущая геолокация.', 'Up to 5 photos, features, a place on the map or your location.')],
          [t('home.s2', 'Автоподбор совпадений', 'Automatic matching'), t('home.s2t', 'Сравниваем «потерял» и «нашёл» по месту, дате и приметам.', 'We compare lost and found by place, date and features.')],
          [t('home.s3', 'Оповещение рядом', 'Alerts nearby'), t('home.s3t', 'При экстренном поиске push получают люди и волонтёры в радиусе 1–5 км.', 'In an emergency, people and volunteers within 1–5 km get a push.')],
          [t('home.s4', 'Безопасная встреча', 'Safe reunion'), t('home.s4t', 'Анонимный чат, контакты скрыты. Не платите заранее.', 'Anonymous chat, contacts hidden. Never pay in advance.')]]
          .map(([a, b], i) => h`<div class="step reveal" style="--i:${i}"><h4>${a}</h4><p>${b}</p></div>`)}
      </div>
    </section>

    <section class="blk">
      <div class="blk-head"><h2>${t('home.stories', 'Успешные находки', 'Successful reunions')}</h2></div>
      <div class="stories" id="stories" tabindex="0" role="region" aria-label="${t('home.stories', 'Успешные находки', 'Successful reunions')}"></div>
    </section>

    <section class="blk" id="partner">
      <div class="grid-2 partner-grid">
        <div>
          <h2>${t('home.inv', 'Стать партнёром или инвестором', 'Become a partner or investor')}</h2>
          <p class="muted" style="margin-top:10px">${t('home.inv_t', 'Расскажите о себе — ответим в течение двух рабочих дней.', 'Tell us about yourself — we’ll reply within two business days.')}</p>
          <ul class="perks">
            ${[['zone', tr('Оповещения по вашей зоне', 'Alerts for your area'), tr('Водители, курьеры и отряды получают экстренные поиски рядом', 'Drivers, couriers and teams get nearby emergency searches')],
              ['seal', tr('Значок проверенного партнёра', 'Verified partner badge'), tr('Профиль организации и доверие пользователей', 'Organisation profile and user trust')],
              ['trend', tr('Статистика и отчёты', 'Stats and reports'), tr('Сколько находок вернули ваши сотрудники', 'How many finds your team returned')]]
              .map(([ic, ti, tx]) => h`<li><span class="perk-ic">${icon(ic, '', 'duo')}</span><div><b>${ti}</b><span>${tx}</span></div></li>`)}
          </ul>
        </div>
        <form id="leadForm" class="stack">
          <div class="seg" data-seg="kind"><button type="button" class="on" data-v="partner">${t('home.inv_p', 'Партнёр', 'Partner')}</button><button type="button" data-v="investor">${t('home.inv_i', 'Инвестор', 'Investor')}</button></div>
          <div class="grid-2"><label class="field"><span>${t('f.name', 'Имя', 'Name')}</span><input name="name" required maxlength="120"></label>
          <label class="field"><span>${t('f.contact', 'Телефон или e-mail', 'Phone or e-mail')}</span><input name="contact" required maxlength="120"></label></div>
          <label class="field"><span>${t('f.org', 'Организация', 'Organisation')}</span><input name="org" maxlength="160"></label>
          <label class="field"><span>${t('f.message', 'Сообщение', 'Message')}</span><textarea name="message" rows="3" maxlength="2000"></textarea></label>
          <label class="check"><input type="checkbox" name="consent"> <span><a class="doc-link" href="#/legal/consent" data-doc="consent" data-for="consent">${t('f.consent_pd', 'Даю согласие на обработку персональных данных', 'I consent to personal data processing')}</a></span></label>
          <button class="btn btn-blue btn-block">${t('home.inv_send', 'Отправить заявку', 'Send request')}</button>
        </form>
      </div>
    </section>
  </div>`);

  let leadKind = 'partner';
  $$('[data-seg=kind] button', view).forEach((b) => b.onclick = () => { $$('[data-seg=kind] button', view).forEach((x) => x.classList.toggle('on', x === b)); leadKind = b.dataset.v; });
  $('#leadForm', view).onsubmit = (e) => {
    e.preventDefault(); const f = formData(e.target);
    busy(e.submitter, async () => {
      try { await POST('/leads', Object.assign(f, { kind: leadKind })); e.target.reset(); toast(t('home.inv_ok', 'Спасибо! Заявка отправлена', 'Thank you! Request sent')); } catch (er) { toastErr(er); }
    });
  };
  startAdLine(view);
  $('#homeSearch', view).onsubmit = (e) => { e.preventDefault(); const q = e.target.q.value.trim(), c = e.target.category.value; const ps = new URLSearchParams(); if (q) ps.set('q', q); if (c) ps.set('category', c); go('#/map' + (ps.toString() ? '?' + ps : '')); };
  $('#regForm', view).onsubmit = (e) => { e.preventDefault(); go('#/registry?q=' + encodeURIComponent(e.target.q.value.trim())); };

  const [stats, latest, stories] = await Promise.all([GET('/stats/public'), GET('/applications?sort=new&limit=8'), GET('/stories')]).catch((e) => { toastErr(e); return [{}, { items: [] }, { items: [] }]; });
  const hs = $$('#heroStats b', view);
  [stats.active, stats.found, stats.volunteers].forEach((v, i) => { if (hs[i]) hs[i].dataset.count = v || 0; });
  countUp($('#heroStats', view));
  for (const c of ['people', 'animals', 'things']) {
    const s = (stats.byCategory || {})[c] || { lost: 0, found: 0 };
    const box = $(`.ctile [data-cat=${c}]`, view); // счётчики в плитках категорий
    if (box) mount(box, h`<span><b>${s.lost}</b> ${tr('ищут', 'missing')}</span><span><b>${s.found}</b> ${tr('найдено', 'found')}</span>`);
  }
  // Последние заявки: строго по времени публикации, компактная сетка (2 колонки на телефоне, 4 — на компьютере)
  mount($('#latest', view), latest.items.length ? h`<div class="apps apps-latest">${latest.items.map((a, i) => appCard(a, i))}</div>` : empty('inbox', tr('Пока нет заявок', 'No reports yet'),
    h`<p class="muted small" style="margin-top:6px">${tr('Потеряли или нашли человека, питомца или вещь — разместите первую заявку.', 'Lost or found a person, a pet or an item? Post the first report.')}</p>`,
    h`<div class="row-wrap" style="justify-content:center;gap:10px"><a class="btn btn-lost" href="#/new/lost">${icon('plus', 'ic-sm')}${tr('Сообщить о пропаже', 'Report a loss')}</a><a class="btn btn-found" href="#/new/found">${icon('check', 'ic-sm')}${tr('Я нашёл', 'I found')}</a></div>`));
  // Истории: первая — крупная, остальные — аккуратные карточки; без горизонтальной прокрутки
  const CITY_EN = { 'Москва': 'Moscow', 'Санкт-Петербург': 'Saint Petersburg', 'Казань': 'Kazan', 'Новосибирск': 'Novosibirsk', 'Екатеринбург': 'Yekaterinburg' };
  const storyEl = $('#stories', view);
  if (!stories.items.length) storyEl.closest('section').hidden = true;
  else mount(storyEl, stories.items.slice(0, 4).map((s, i) => h`<article class="story ${s.category} ${s.photo ? 'has-photo' : ''} reveal" style="--i:${i}">
    ${s.photo ? h`<img class="story-bg" src="${s.photo}" alt="" loading="lazy">` : h`<span class="story-ic" aria-hidden="true">${icon(CAT[s.category].icon, '', 'duo')}</span>`}
    <div class="story-top"><span class="story-chip">${icon(CAT[s.category].icon, 'ic-sm')}${catName(s.category)}</span><span class="story-ok">${icon('check', 'ic-sm')}${statusName('found')}</span></div>
    <div class="story-body"><h3>${state.lang === 'en' ? s.title_en : s.title_ru}</h3><p>${state.lang === 'en' ? s.text_en : s.text_ru}</p>
    ${s.city ? h`<span class="city">${icon('pin', 'ic-sm')}${state.lang === 'en' ? CITY_EN[s.city] || s.city : s.city}</span>` : ''}</div></article>`));
});

/* =================== КАРТА И ПОИСК =================== */
// Кластеризация меток: библиотека лежит локально и подгружается только на этой странице.
let clusterLib = null;
const loadCluster = () => clusterLib || (clusterLib = new Promise((res) => {
  if (window.L && window.L.markerClusterGroup) return res(true);
  const s = document.createElement('script');
  s.src = '/vendor/leaflet.markercluster.js';
  s.onload = () => res(!!window.L.markerClusterGroup);
  s.onerror = () => { clusterLib = null; res(false); };
  document.head.appendChild(s);
}));
const MINUS = raw('<svg class="ic" viewBox="0 0 256 256" aria-hidden="true"><path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128Z"/></svg>');
const SORT_IC = raw('<svg class="ic ic-sm" viewBox="0 0 256 256" aria-hidden="true"><path d="M117.66,170.34a8,8,0,0,1,0,11.32l-32,32a8,8,0,0,1-11.32,0l-32-32a8,8,0,0,1,11.32-11.32L72,188.69V48a8,8,0,0,1,16,0V188.69l18.34-18.35A8,8,0,0,1,117.66,170.34Zm96-96-32-32a8,8,0,0,0-11.32,0l-32,32a8,8,0,0,0,11.32,11.32L168,67.31V208a8,8,0,0,0,16,0V67.31l18.34,18.35a8,8,0,0,0,11.32-11.32Z"/></svg>');
const cssVar = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;

route('/map', async (view) => {
  const q = query();
  const DEF = { q: '', category: '', kind: '', status: 'active', emergency: '', from: '', to: '', radius: '', sort: '' };
  const SORTS = [['', tr('Рекомендуемые', 'Recommended')], ['new', tr('Сначала новые', 'Newest first')], ['old', tr('Сначала старые', 'Oldest first')], ['near', tr('Ближе ко мне', 'Nearest to me')], ['reward', tr('С вознаграждением', 'Highest reward')]];
  const f = { ...DEF, q: q.get('q') || '', category: q.get('category') || q.get('cat') || '', kind: q.get('kind') || '', status: q.get('status') || 'active', emergency: q.get('emergency') ? '1' : '', sort: q.get('sort') || '', center: null };
  if (!SORTS.some(([v]) => v === f.sort) || f.sort === 'near') f.sort = '';
  if (!CAT[f.category]) f.category = '';
  if (!['lost', 'found'].includes(f.kind)) f.kind = '';
  if (!['active', 'found', 'all'].includes(f.status)) f.status = 'active';
  const desk = matchMedia('(min-width: 980px)');
  const CATS = ['people', 'animals', 'things'];

  mount(view, h`<div class="map-page" data-view="map"><h1 class="sr-only">${tr('Карта поиска: пропавшие и найденные рядом', 'Search map: missing and found nearby')}</h1>
    <div class="map-side">
      <div class="map-filters">
        <form class="search-box map-search" id="sform" role="search">${icon('search')}
          <input name="q" type="search" value="${f.q}" autocomplete="off" placeholder="${t('map.ph', 'Описание, приметы, адрес', 'Description, features, address')}" enterkeyhint="search" aria-label="${tr('Поиск по заявкам', 'Search reports')}">
          <button type="button" class="sclear" id="sclear" aria-label="${tr('Очистить', 'Clear')}" ${f.q ? '' : 'hidden'}>${icon('x')}</button>
          <button type="button" class="fbtn" id="fbtn" aria-label="${tr('Фильтры', 'Filters')}">${icon('filter')}<i class="fcount" id="fcount"></i></button>
        </form>
        <div class="map-quick" id="quick">
          <div class="mq-row">
            <div class="kind-seg" role="group" aria-label="${tr('Тип заявки', 'Report type')}">${[['', tr('Все', 'All')], ['lost', kindName('lost')], ['found', kindName('found')]].map(([v, l]) => h`<button type="button" data-k="${v}" class="${v ? 'k-' + v : ''}">${l}</button>`)}</div>
            <button type="button" class="chip filter-chip sos" data-em title="${tr('Только экстренные поиски', 'Emergency searches only')}">${icon('siren')}SOS</button>
          </div>
          <div class="cat-seg" role="group" aria-label="${tr('Категория', 'Category')}">${CATS.map((c) => h`<button type="button" class="chip filter-chip" data-c="${c}">${icon(CAT[c].icon)}<span>${catName(c)}</span></button>`)}</div>
        </div>
      </div>
      <div class="map-list" id="list" aria-live="polite"></div>
    </div>
    <div class="map-box">
      <div id="bigmap"></div>
      <div class="map-bar" aria-hidden="true"></div>
      <button type="button" class="map-area map-area-search" id="areaBtn" hidden>${icon('search')}<span>${tr('Искать в этой области', 'Search this area')}</span></button>
      <div class="map-fab">
        <div class="fab-group"><button type="button" id="zin" aria-label="${tr('Приблизить', 'Zoom in')}">${icon('plus')}</button><button type="button" id="zout" aria-label="${tr('Отдалить', 'Zoom out')}">${MINUS}</button></div>
        <button type="button" class="fab-one" id="locBtn" aria-label="${tr('Рядом со мной', 'Near me')}" title="${tr('Рядом со мной', 'Near me')}">${icon('locate')}</button>
      </div>
      <div class="map-empty" id="mempty" hidden></div>
      <div class="peek" id="peek" hidden></div>
    </div>
    <div class="map-seg" role="tablist">
      <button type="button" role="tab" data-v="map" class="on">${icon('map')}<span>${t('map.on_map', 'Карта', 'Map')}</span></button>
      <button type="button" role="tab" data-v="list">${icon('list')}<span>${t('map.list', 'Список', 'List')}</span><b id="tcount">·</b></button>
    </div>
  </div>`);

  const page = $('.map-page', view), listEl = $('#list', view), peekEl = $('#peek', view), areaBtn = $('#areaBtn', view), input = $('#sform input', view);
  const m = makeMap($('#bigmap', view), { zoom: 11 });
  const L = () => m.lib;
  if (m.zoomControl) m.zoomControl.remove();
  const zones = L().layerGroup().addTo(m); // круги SOS-зон и радиуса поиска — не кластеризуются
  let group = L().layerGroup().addTo(m), clustered = false;
  let items = [], markers = new Map(), sel = null, area = null, meMarker = null, reqId = 0, deb = 0, auto = false, autoT = 0, hover = null;

  // Программные сдвиги карты не должны показывать кнопку «Искать в этой области»
  const programmatic = (fn) => { auto = true; clearTimeout(autoT); autoT = setTimeout(() => { auto = false; }, 900); fn(); };
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => programmatic(() => m.invalidateSize({ pan: false }))) : null;
  if (ro) ro.observe($('#bigmap', view));
  const onKey = (e) => { if (e.key === 'Escape' && sel != null) select(null); };
  document.addEventListener('keydown', onKey);
  onLeave(() => { if (ro) ro.disconnect(); clearTimeout(deb); clearTimeout(autoT); document.removeEventListener('keydown', onKey); m.remove(); });

  const hasFilters = () => !!(f.q || f.category || f.kind || f.emergency || f.from || f.to || f.radius || f.status !== 'active');
  // Если известна геопозиция и сортировка не выбрана явно — показываем ближайшие первыми
  const curSort = () => f.sort || (f.center ? 'near' : '');
  const extraCount = () => [f.from, f.to, f.radius, f.status !== 'active'].filter(Boolean).length;

  // Кластер: число в центре, кольцо — доля «потеряно» (красный) / «найдено» (синий) / закрытые (серый)
  const clusterIcon = (c) => {
    const ch = c.getAllChildMarkers().map((mk) => mk.options.app), n = ch.length;
    const lost = ch.filter((a) => a.status === 'published' && a.kind === 'lost').length;
    const found = ch.filter((a) => a.status === 'published' && a.kind === 'found').length;
    const s = n < 10 ? 42 : n < 50 ? 48 : 56;
    const pa = Math.round(lost / n * 100), pb = Math.round((lost + found) / n * 100);
    return L().divIcon({ className: '', html: `<div class="mcl ${ch.some((a) => a.emergency && a.status === 'published') ? 'em' : ''}" style="--s:${s}px;--a:${pa}%;--b:${pb}%"><b>${n}</b></div>`, iconSize: [s, s] });
  };
  loadCluster().then((ok) => {
    if (!ok || !page.isConnected || !m._mapPane) return;
    const g = L().markerClusterGroup({ maxClusterRadius: 46, showCoverageOnHover: false, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 16, spiderLegPolylineOptions: { weight: 1.5, color: '#8a8f98', opacity: .6 }, iconCreateFunction: clusterIcon });
    g.on('clusterclick', () => { if (sel != null) select(null); });
    m.removeLayer(group); group = g.addTo(m); clustered = true; drawMarkers();
  });

  function drawMarkers() {
    group.clearLayers(); zones.clearLayers(); markers.clear();
    const list = [];
    for (const a of items) {
      if (a.lat == null) continue;
      const mk = L().marker([a.lat, a.lng], { icon: pinIcon(a, sel === a.id ? 'sel' : ''), app: a, title: a.title, alt: a.title, zIndexOffset: sel === a.id ? 1000 : 0 });
      mk.on('click', () => select(a.id, { pan: true }));
      markers.set(a.id, mk); list.push(mk);
      if (a.emergency && a.status === 'published') L().circle([a.lat, a.lng], { radius: a.emergency * 1000, color: cssVar('--red', '#e0192d'), weight: 1, fillOpacity: .05, dashArray: '4 6', interactive: false }).addTo(zones);
    }
    if (f.center && f.radius) L().circle(f.center, { radius: f.radius * 1000, color: cssVar('--blue', '#2563eb'), weight: 1.5, fillOpacity: .05, interactive: false }).addTo(zones);
    if (clustered) group.addLayers(list); else list.forEach((mk) => mk.addTo(group));
  }

  function fitAll() {
    const pts = items.filter((a) => a.lat != null).map((a) => [a.lat, a.lng]);
    const pad = { paddingTopLeft: [40, 72], paddingBottomRight: [desk.matches ? 72 : 64, desk.matches ? 40 : 84], maxZoom: 15 };
    programmatic(() => {
      if (f.center && f.radius) m.fitBounds(L().latLng(f.center).toBounds(f.radius * 2000), pad);
      else if (pts.length === 1) m.setView(pts[0], 15);
      else if (pts.length) m.fitBounds(pts, pad);
    });
  }

  // Поднимаем выбранную метку, если её закрывает карточка или край карты
  function panIntoView(ll) {
    const p = m.latLngToContainerPoint(ll), s = m.getSize();
    const top = 76, bottom = s.y - (peekEl.hidden ? 40 : peekEl.offsetHeight + 36), left = desk.matches && !peekEl.hidden && p.y > s.y - peekEl.offsetHeight - 36 ? 420 : 40, right = s.x - 70;
    let dx = 0, dy = 0;
    if (p.y < top) dy = p.y - top; else if (p.y > bottom) dy = p.y - bottom;
    if (p.x < left) dx = p.x - left; else if (p.x > right) dx = p.x - right;
    if (dx || dy) programmatic(() => m.panBy([dx, dy], { animate: true, duration: .35 }));
  }

  function markEl(id) {
    const mk = markers.get(id); if (!mk) return null;
    const vis = clustered && group.getVisibleParent ? group.getVisibleParent(mk) : mk;
    return vis && vis.getElement ? { mk: vis, el: vis.getElement() && vis.getElement().firstElementChild } : null;
  }
  function highlight(id, on) {
    const r = markEl(id); if (!r || !r.el) return;
    r.el.classList.toggle('hl', on);
    if (r.mk.setZIndexOffset && id !== sel) r.mk.setZIndexOffset(on ? 900 : 0);
  }

  function select(id, { pan = false } = {}) {
    const prev = markers.get(sel);
    if (prev && sel !== id) prev.setIcon(pinIcon(prev.options.app)).setZIndexOffset(0);
    sel = id;
    $$('.mrow.sel', listEl).forEach((r) => r.classList.remove('sel'));
    const mk = markers.get(id);
    if (!mk) { sel = null; closePeek(); return; }
    mk.setIcon(pinIcon(mk.options.app, 'sel')).setZIndexOffset(1000);
    const row = $(`.mrow[data-id="${id}"]`, listEl);
    if (row) { row.classList.add('sel'); if (desk.matches) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    showPeek(mk.options.app);
    if (pan) requestAnimationFrame(() => panIntoView(mk.getLatLng()));
  }

  function showPeek(a) {
    mount(peekEl, h`<a class="peek-card" href="#/a/${a.id}">
        <span class="peek-media">${media(a)}</span>
        <span class="peek-body">
          <span class="peek-tags">
            ${a.status !== 'published' ? h`<span class="chip ${statusChip(a.status)}">${statusName(a.status)}</span>` : h`<span class="chip chip-${a.kind}">${kindName(a.kind)}</span>`}
            ${a.emergency && a.status === 'published' ? h`<span class="chip chip-em">SOS</span>` : ''}
            <span class="peek-cat">${icon(CAT[a.category].icon, 'ic-sm')}${catName(a.category)}</span>
          </span>
          <b class="peek-title">${a.title}</b>
          <span class="peek-meta">${icon('pin', 'ic-sm')}<span class="ellipsis">${a.address || a.city || '—'}</span></span>
          <span class="peek-meta"><span class="ellipsis">${[a.distance != null ? km(a.distance) : '', ago(a.created_at), a.reward ? money(a.reward) : ''].filter(Boolean).join(' · ')}</span></span>
        </span>
        <span class="peek-go" aria-hidden="true">${icon('arrowUR')}</span>
      </a>
      <button type="button" class="peek-x" aria-label="${tr('Закрыть', 'Close')}">${icon('x')}</button>`);
    $('.peek-x', peekEl).onclick = () => select(null);
    peekEl.hidden = false; peekEl.style.transform = '';
    peekEl.classList.remove('show', 'out'); void peekEl.offsetWidth; peekEl.classList.add('show');
    page.classList.add('peeking');
  }
  function closePeek() {
    page.classList.remove('peeking');
    if (peekEl.hidden) return;
    peekEl.classList.remove('show'); peekEl.classList.add('out');
    setTimeout(() => { if (sel == null) { peekEl.hidden = true; peekEl.classList.remove('out'); peekEl.style.transform = ''; } }, 200);
  }
  // Свайп карточки вниз закрывает её (мобильные)
  let ty = null;
  peekEl.addEventListener('touchstart', (e) => { ty = e.touches[0].clientY; }, { passive: true });
  peekEl.addEventListener('touchmove', (e) => { if (ty == null) return; const d = Math.max(0, e.touches[0].clientY - ty); peekEl.style.transform = `translateY(${d}px)`; peekEl.style.opacity = String(Math.max(.4, 1 - d / 240)); }, { passive: true });
  peekEl.addEventListener('touchend', (e) => {
    if (ty == null) return; const d = e.changedTouches[0].clientY - ty; ty = null;
    peekEl.style.opacity = '';
    if (d > 60) { e.preventDefault(); select(null); } else peekEl.style.transform = '';
  });
  m.on('click', () => { if (sel != null) select(null); });

  function renderList() {
    const shown = area ? items.filter((a) => a.lat != null && area.contains([a.lat, a.lng])) : items;
    $('#tcount', view).textContent = shown.length;
    const cnt = `${shown.length} ${tr(plural(shown.length, 'заявка', 'заявки', 'заявок'), shown.length === 1 ? 'report' : 'reports')}`;
    const head = h`<div class="list-head"><b>${area ? `${tr('В этой области', 'In this area')}: ${cnt}` : cnt}</b>
      ${area ? h`<button type="button" class="link xs" data-area-reset>${tr('Показать все', 'Show all')}</button>` : ''}
      <label class="sort-sel">${SORT_IC}<select data-sort aria-label="${tr('Сортировка', 'Sort')}">${SORTS.map(([v, l]) => h`<option value="${v}" ${curSort() === v ? 'selected' : ''}>${l}</option>`)}</select>${icon('chevR', 'ic-sm chev')}</label></div>`;
    mount(listEl, shown.length
      ? h`${head}${shown.map((a, i) => h`<div class="mrow rise ${a.id === sel ? 'sel' : ''}" data-id="${a.id}" style="--i:${Math.min(i, 8)}">${appRow(a)}</div>`)}`
      : h`${head}${empty('search', t('map.empty', 'Ничего не найдено', 'Nothing found'), area ? tr('В этой области заявок нет — сдвиньте карту или покажите все.', 'No reports here — move the map or show all.') : t('map.empty_t', 'Измените фильтры или расширьте радиус.', 'Change filters or widen the radius.'), hasFilters() ? h`<button type="button" class="btn btn-ghost btn-sm" data-reset-all>${tr('Сбросить фильтры', 'Reset filters')}</button>` : '')}`);
  }
  function renderEmpty() {
    const box = $('#mempty', view);
    if (items.length) { box.hidden = true; return; }
    mount(box, h`${icon('search')}<b>${t('map.empty', 'Ничего не найдено', 'Nothing found')}</b><p>${hasFilters() ? tr('По этим условиям заявок нет. Попробуйте ослабить фильтры.', 'No reports match. Try loosening the filters.') : tr('Пока здесь нет заявок.', 'No reports here yet.')}</p>
      ${hasFilters() ? h`<button type="button" class="btn btn-sm" data-reset-all>${tr('Сбросить фильтры', 'Reset filters')}</button>` : ''}`);
    box.hidden = false;
  }
  function syncControls() {
    $$('[data-k]', view).forEach((b) => { const on = f.kind === b.dataset.k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    $$('[data-c]', view).forEach((b) => { const on = f.category === b.dataset.c; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    const em = $('[data-em]', view); em.classList.toggle('on', !!f.emergency); em.setAttribute('aria-pressed', !!f.emergency);
    const n = extraCount(); $('#fcount', view).textContent = n || ''; $('#fbtn', view).classList.toggle('has', n > 0);
    $('#sclear', view).hidden = !input.value;
  }
  function syncUrl() {
    const p = new URLSearchParams();
    ['q', 'category', 'kind', 'emergency'].forEach((k) => f[k] && p.set(k, f[k]));
    if (f.status !== 'active') p.set('status', f.status);
    if (f.sort && f.sort !== 'near') p.set('sort', f.sort);
    const hash = '#/map' + (p.toString() ? '?' + p : '');
    if (location.hash !== hash) history.replaceState(history.state, '', hash);
  }

  async function load({ fit = true } = {}) {
    const id = ++reqId;
    syncControls(); syncUrl();
    area = null; areaBtn.hidden = true;
    page.classList.add('loading');
    if (!listEl.querySelector('.mrow')) mount(listEl, h`<div class="list-head"><span class="sk" style="width:110px;height:16px;border-radius:6px"></span></div>${Array.from({ length: 5 }, () => h`<div class="sk sk-row"></div>`)}`);
    else listEl.classList.add('dim');
    const p = new URLSearchParams({ limit: '200' });
    ['q', 'category', 'kind', 'from', 'to', 'emergency'].forEach((k) => f[k] && p.set(k, f[k]));
    if (f.status !== 'all') p.set('status', f.status);
    if (f.center) { p.set('lat', f.center[0]); p.set('lng', f.center[1]); if (f.radius) p.set('radius', f.radius); }
    if (curSort()) p.set('sort', curSort());
    let res = [];
    try { res = (await GET('/applications?' + p)).items || []; } catch (e) { if (id === reqId) toastErr(e); }
    if (id !== reqId || !page.isConnected || !m._mapPane) return; // ушли со страницы, карта уже убрана
    items = res;
    page.classList.remove('loading'); listEl.classList.remove('dim');
    if (sel != null && !items.some((a) => a.id === sel)) { sel = null; closePeek(); }
    drawMarkers(); renderList(); renderEmpty();
    if (fit) fitAll();
  }
  function resetAll() {
    Object.assign(f, DEF); input.value = '';
    load();
  }

  // Делегирование: быстрые фильтры, список, сброс
  $('#quick', view).onclick = (e) => {
    const k = e.target.closest('[data-k]'), c = e.target.closest('[data-c]'), em = e.target.closest('[data-em]');
    if (k) { if (f.kind === k.dataset.k) return; f.kind = k.dataset.k; }
    else if (c) f.category = f.category === c.dataset.c ? '' : c.dataset.c;
    else if (em) f.emergency = f.emergency ? '' : '1';
    else return;
    load();
  };
  view.addEventListener('click', (e) => {
    if (e.target.closest('[data-reset-all]')) resetAll();
    else if (e.target.closest('[data-area-reset]')) { area = null; renderList(); }
  });
  listEl.addEventListener('mouseover', (e) => {
    const r = e.target.closest('.mrow'); const id = r ? +r.dataset.id : null;
    if (id === hover) return;
    if (hover != null) highlight(hover, false);
    hover = id; if (id != null) highlight(id, true);
  });
  listEl.addEventListener('mouseleave', () => { if (hover != null) highlight(hover, false); hover = null; });
  // Сортировка списка: «ближе ко мне» сначала спрашивает геопозицию (без ограничения радиуса)
  listEl.addEventListener('change', (e) => {
    const s = e.target.closest('[data-sort]'); if (!s) return;
    f.sort = s.value;
    if (f.sort === 'near' && !f.center) locate(false); else load({ fit: false });
  });

  // Поиск: живой с паузой, Enter — сразу
  input.addEventListener('input', () => {
    $('#sclear', view).hidden = !input.value;
    clearTimeout(deb);
    deb = setTimeout(() => { const v = input.value.trim(); if (v !== f.q) { f.q = v; load(); } }, 380);
  });
  $('#sform', view).onsubmit = (e) => { e.preventDefault(); clearTimeout(deb); const v = input.value.trim(); input.blur(); if (v !== f.q) { f.q = v; load(); } };
  $('#sclear', view).onclick = () => { input.value = ''; clearTimeout(deb); input.focus(); if (f.q) { f.q = ''; load(); } else syncControls(); };

  // Карта / список (мобильные)
  const setView = (v) => {
    page.dataset.view = v;
    $$('.map-seg [data-v]', view).forEach((b) => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-selected', b.dataset.v === v); });
    if (v === 'map') requestAnimationFrame(() => programmatic(() => m.invalidateSize({ pan: false })));
  };
  $$('.map-seg [data-v]', view).forEach((b) => { b.onclick = () => setView(b.dataset.v); });

  // Кнопка «Искать в этой области» появляется только после ручного сдвига карты
  m.on('moveend', () => {
    if (auto) return;
    if (items.length) areaBtn.hidden = false;
  });
  areaBtn.onclick = () => {
    area = m.getBounds().pad(-0.04); areaBtn.hidden = true; renderList();
    const c = $('.map-seg b', view); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
  };
  $('#zin', view).onclick = () => m.zoomIn();
  $('#zout', view).onclick = () => m.zoomOut();

  const locBtn = $('#locBtn', view);
  async function locate(withRadius = true) {
    if (f.center) { fitAll(); return; }
    locBtn.classList.add('busy');
    try {
      f.center = await getPosition();
      if (meMarker) meMarker.remove();
      meMarker = L().marker(f.center, { icon: L().divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false, keyboard: false, zIndexOffset: 2000 }).addTo(m);
      if (withRadius && !f.radius) f.radius = '5';
      locBtn.classList.add('on');
      await load();
    } catch (e) { f.radius = ''; if (f.sort === 'near') f.sort = ''; syncControls(); renderList(); toastErr(e); } finally { locBtn.classList.remove('busy'); }
  }
  locBtn.onclick = locate;

  $('#fbtn', view).onclick = () => {
    const s = sheet(h`${sheetHead(t('map.filters', 'Фильтры', 'Filters'))}
      <div class="stack">
        <label class="field"><span>${t('map.f_status', 'Статус', 'Status')}</span><select name="status">
          <option value="active" ${f.status === 'active' ? 'selected' : ''}>${t('map.f_active', 'Активные', 'Active')}</option>
          <option value="found" ${f.status === 'found' ? 'selected' : ''}>${statusName('found')}</option>
          <option value="all" ${f.status === 'all' ? 'selected' : ''}>${tr('Все', 'All')}</option></select></label>
        <div class="grid-2"><label class="field"><span>${t('map.f_from', 'Дата с', 'Date from')}</span><input type="date" name="from" value="${f.from}"></label>
        <label class="field"><span>${t('map.f_to', 'Дата по', 'Date to')}</span><input type="date" name="to" value="${f.to}"></label></div>
        <label class="field"><span>${t('map.f_radius', 'Радиус от меня', 'Radius from me')}</span><select name="radius">
          <option value="">${tr('Без ограничения', 'Any distance')}</option>${[1, 3, 5, 10, 25, 50].map((r) => h`<option value="${r}" ${+f.radius === r ? 'selected' : ''}>${r} ${tr('км', 'km')}</option>`)}</select>
          <p class="hint">${f.center ? tr('Центр — ваше местоположение', 'Centre is your location') : tr('Потребуется доступ к геолокации', 'Location access will be requested')}</p></label>
        <div class="row"><button type="button" class="btn btn-ghost grow" data-reset>${tr('Сбросить', 'Reset')}</button><button type="button" class="btn grow" data-apply>${tr('Показать', 'Show')}</button></div>
      </div>`);
    $('[data-reset]', s.el).onclick = () => { Object.assign(f, { from: '', to: '', radius: '', status: 'active' }); s.close(); load(); };
    $('[data-apply]', s.el).onclick = () => {
      f.status = $('[name=status]', s.el).value; f.from = $('[name=from]', s.el).value; f.to = $('[name=to]', s.el).value; f.radius = $('[name=radius]', s.el).value;
      if (f.from && f.to && f.from > f.to) [f.from, f.to] = [f.to, f.from];
      s.close();
      if (f.radius && !f.center) locate(); else load();
    };
  };

  load();
}, { full: true });

/* =================== МАСТЕР ЗАЯВКИ =================== */
// Единые параметры заявки: приметы человека и место события. Значения совпадают со списками на сервере (server/index.js).
const OPT = {
  sex: { male: ['Мужской', 'Male'], female: ['Женский', 'Female'] },
  build: { thin: ['Худощавое', 'Slim'], normal: ['Среднее', 'Medium'], full: ['Полное', 'Heavy'] },
  hair_color: { blond: ['Светлые', 'Blond'], light_brown: ['Русые', 'Light brown'], brown: ['Каштановые', 'Brown'], black: ['Тёмные, чёрные', 'Dark, black'], red: ['Рыжие', 'Red'], gray: ['Седые', 'Grey'], other: ['Другой цвет', 'Other colour'] },
  hair_length: { none: ['Нет волос, бритая голова', 'Bald, shaved'], short: ['Короткие', 'Short'], medium: ['Средние', 'Medium'], long: ['Длинные', 'Long'] },
  eye_color: { blue: ['Голубые, синие', 'Blue'], gray: ['Серые', 'Grey'], green: ['Зелёные', 'Green'], brown: ['Карие', 'Brown'], other: ['Другой', 'Other'] },
  skin: { light: ['Светлая', 'Light'], olive: ['Смуглая', 'Olive'], dark: ['Тёмная', 'Dark'] },
  disability: { none: ['Нет', 'None'], g1: ['I группа', 'Group I'], g2: ['II группа', 'Group II'], g3: ['III группа', 'Group III'], child: ['Ребёнок-инвалид', 'Disabled child'] },
  health: { deaf: ['Не слышит или плохо слышит', 'Deaf or hard of hearing'], blind: ['Не видит или плохо видит', 'Blind or low vision'], dementia: ['Деменция: может не помнить имя и адрес', 'Dementia: may not remember name or address'], concussion: ['Контузия', 'Concussion'], other: ['Другое', 'Other'] },
  transport: { bus: ['Автобус', 'Bus'], trolleybus: ['Троллейбус', 'Trolleybus'], tram: ['Трамвай', 'Tram'], minibus: ['Маршрутка', 'Minibus'], metro: ['Метро', 'Metro'], suburban: ['Электричка', 'Commuter train'],
    train: ['Поезд', 'Train'], plane: ['Самолёт', 'Plane'], taxi: ['Такси', 'Taxi'], other: ['Другой транспорт', 'Other transport'] }
};
const ROUTE = {
  bus: [['Номер маршрута', 'Route number'], ['№ 15, остановка «Парк»', 'No. 15, “Park” stop']],
  trolleybus: [['Номер маршрута', 'Route number'], ['№ 7, остановка «Рынок»', 'No. 7, “Market” stop']],
  tram: [['Номер маршрута', 'Route number'], ['№ 3, остановка «Вокзал»', 'No. 3, “Station” stop']],
  minibus: [['Номер маршрута', 'Route number'], ['№ 45, у ТЦ', 'No. 45, near the mall']],
  metro: [['Станция, линия', 'Station, line'], ['Станция «Пушкинская»', 'Pushkinskaya station']],
  suburban: [['Направление, станция', 'Line, station'], ['Ярославское направление, ст. Мытищи', 'Yaroslavl line, Mytishchi']],
  train: [['Номер поезда, вагон', 'Train number, car'], ['№ 102, вагон 5', 'No. 102, car 5']],
  plane: [['Рейс', 'Flight'], ['SU 1234', 'SU 1234']],
  taxi: [['Машина, служба такси', 'Car, taxi service'], ['Белый седан, номер А123ВС', 'White sedan, plate A123BC']],
  other: [['Какой транспорт', 'What transport'], ['Речной трамвай, канатная дорога', 'River boat, cable car']]
};
const DETAIL_KEYS = ['sex', 'height', 'weight', 'build', 'skin', 'hair_color', 'hair_length', 'eye_color', 'nationality', 'clothes_top', 'clothes_bottom', 'headwear', 'shoes',
  'language', 'health_note', 'disability', 'breed', 'color', 'clothes', 'park', 'landmark', 'transport', 'transport_route', 'place_photo'];
// Вид животного хранится словом из справочника (на языке интерфейса); подсказки пород привязаны к русскому названию
const speciesRu = (v) => { const e = (state.config?.dicts?.species || []).find((x) => x.ru === v || x.en === v); return e ? e.ru : v; };
const PARK_OTHER = '__other';
export const optName = (k, v) => { const o = OPT[k] && OPT[k][v]; return o ? tr(o[0], o[1]) : v; };
const optSelect = (name, cur) => h`<select name="${name}"><option value="">${tr('Выберите', 'Choose')}</option>${Object.keys(OPT[name]).map((v) => h`<option value="${v}" ${cur === v ? 'selected' : ''}>${optName(name, v)}</option>`)}</select>`;
const fld = (label, control) => h`<label class="field"><span>${label}</span>${control}</label>`;
const txt = (d, name, max, ph = '') => h`<input name="${name}" value="${d[name] ?? ''}" maxlength="${max}" placeholder="${ph}" autocomplete="off">`;
// Вещи: тип и уточнения к нему (тот же список — в server/things.js). В форме уточнения называются th_<поле>.
const THING_TYPES = ['clothes', 'accessories', 'jewelry', 'auto', 'other'];
const THING_FIELDS = { clothes: ['size', 'color', 'brand'], accessories: ['brand', 'color', 'material'], jewelry: ['metal', 'stones', 'engraving'], auto: ['brand', 'model', 'color', 'plate'], other: [] };
const THING_MAX = { size: 20, color: 40, brand: 60, model: 60, material: 60, metal: 40, stones: 80, engraving: 80, plate: 12 };
const thingName = (k) => ({ clothes: tr('Одежда', 'Clothing'), accessories: tr('Аксессуары', 'Accessories'), jewelry: tr('Украшения', 'Jewellery'), auto: tr('Авто', 'Car'), other: tr('Другое', 'Other') })[k] || k;
const thingLabel = (k, type) => ({
  size: tr('Размер', 'Size'), color: tr('Цвет', 'Colour'), brand: type === 'auto' ? tr('Марка', 'Make') : tr('Бренд', 'Brand'), model: tr('Модель', 'Model'),
  material: tr('Материал', 'Material'), metal: tr('Металл, проба', 'Metal, hallmark'), stones: tr('Камни, вставки', 'Stones, inlays'), engraving: tr('Гравировка, надпись', 'Engraving'), plate: tr('Госномер', 'Licence plate')
})[k] || k;
const thingHint = (k, type) => ({
  size: '48, M, 42', color: type === 'auto' ? tr('Серебристый', 'Silver') : tr('Чёрный', 'Black'), brand: type === 'auto' ? 'Kia' : 'Zara', model: 'Rio',
  material: tr('Кожа, ткань', 'Leather, fabric'), metal: tr('Золото 585', 'Gold 585'), stones: tr('Фианит, жемчуг', 'Zirconia, pearl'), engraving: tr('«Навсегда» внутри кольца', '“Forever” inside the ring'), plate: tr('А123ВС 77', 'A123BC 77')
})[k] || '';
const thingTitleHint = (type) => ({
  clothes: tr('Чёрная пуховая куртка', 'Black down jacket'), accessories: tr('Кожаный кошелёк с картами', 'Leather wallet with cards'),
  jewelry: tr('Золотое обручальное кольцо', 'Gold wedding ring'), auto: tr('Серебристый седан', 'Silver sedan'), other: tr('Связка ключей с брелоком', 'Keys with a key ring')
})[type] || tr('Чёрный рюкзак с ноутбуком', 'Black backpack with laptop');
// все уточнения передаются явно: поля другого типа уходят пустыми и не смешиваются с общими параметрами (окрас животного и т. п.)
const thingDetails = (d) => {
  const own = THING_FIELDS[d.thing_type] || [];
  const o = { thing_type: d.thing_type };
  for (const k of Object.keys(THING_MAX)) o[k] = own.includes(k) ? d['th_' + k] || '' : '';
  return o;
};
const localDate = (dt = new Date()) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
async function wizard(view, kind, existing) {
  const edit = !!existing;
  const d = existing ? Object.assign({}, existing) : { kind, category: query().get('category') || '', photos: [], event_date: localDate(), contact: state.user.phone || state.user.email || '', emergency_radius: 3, emergency_on: false };
  kind = d.kind;
  if (existing && existing.details) { Object.assign(d, existing.details); for (const x of existing.details.health || []) d['h_' + x] = true; }
  // уточнения вещи — в поля формы th_<поле>
  if (existing && existing.category === 'things' && existing.details && THING_FIELDS[existing.details.thing_type]) {
    d.thing_type = existing.details.thing_type;
    for (const k of THING_FIELDS[d.thing_type]) if (existing.details[k]) d['th_' + k] = existing.details[k];
  }
  // у заявки о человеке отдельный шаг «Приметы»
  const stepsFor = () => d.category === 'people' ? ['cat', 'details', 'looks', 'photos', 'place', 'final'] : ['cat', 'details', 'photos', 'place', 'final'];
  let steps = stepsFor();
  let step = edit ? 1 : (d.category ? 1 : 0);
  let getPhotos = () => d.photos;
  let getPlacePhoto = () => (d.place_photo ? [d.place_photo] : []);
  const isLost = kind === 'lost';
  const title = edit ? t('wiz.edit', 'Редактирование заявки', 'Edit report') : isLost ? t('wiz.lost', 'Сообщить о пропаже', 'Report a loss') : t('wiz.found', 'Сообщить о находке', 'Report a find');

  function saveStep() {
    if (steps[step] === 'photos') d.photos = getPhotos();
    if (steps[step] === 'place') d.place_photo = getPlacePhoto()[0] || '';
    const form = $('#wform', view);
    if (form) Object.assign(d, formData(form));
    return true;
  }
  function clearErrors() {
    $$('.has-err', view).forEach((b) => { b.classList.remove('has-err'); $$('.ferr', b).forEach((x) => x.remove()); });
    $$('[aria-invalid]', view).forEach((f) => { f.removeAttribute('aria-invalid'); f.removeAttribute('aria-describedby'); });
  }
  function validate() {
    clearErrors();
    const s = steps[step];
    // name — поле формы, '#picker' — карта; если поля нет на экране, сообщение показывается всплывающим
    const err = (m, name) => {
      const f = name && (name[0] === '#' ? $(name, view) : $(`#wform [name="${name}"]`, view));
      if (!f) { toast(m, 'err'); return false; }
      const box = f.closest('.field, .check') || f;
      box.classList.add('has-err');
      const p = document.createElement('p'); p.className = 'ferr'; p.id = 'ferr-' + (name[0] === '#' ? name.slice(1) : name); p.setAttribute('role', 'alert'); p.textContent = m;
      if (box === f) f.after(p); else box.appendChild(p);
      if (f.matches('input, select, textarea')) { f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', p.id); f.focus({ preventScroll: true }); }
      box.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return false;
    };
    if (s === 'cat' && !d.category) return err(tr('Выберите категорию', 'Choose a category'));
    if (s === 'details') {
      if (d.category === 'people' && isLost) {
        if (!d.person_name) return err(t('wiz.e_fio', 'Укажите ФИО', 'Enter full name'), 'person_name');
        if (d.person_age === '' || d.person_age == null) return err(t('wiz.e_age', 'Укажите возраст', 'Enter age'), 'person_age');
        if (!d.sex) return err(t('wiz.e_sex', 'Укажите пол', 'Select sex'), 'sex');
        if (!d.relation) return err(t('wiz.e_rel', 'Укажите, кем вы приходитесь человеку', 'Specify your relation'), 'relation');
        if (+d.person_age < 18 && d.relation !== 'legal_rep') return err(t('wiz.e_minor', 'Заявку о несовершеннолетнем подаёт только законный представитель', 'Only a legal guardian can report a minor'), 'relation');
        if (!d.title) d.title = `${tr('Пропал человек', 'Missing person')}: ${d.person_name}, ${d.person_age} ${tr(plural(+d.person_age, 'год', 'года', 'лет'), 'y.o.')}`;
      }
      if (d.category === 'animals') { if (!d.title && !d.species && !d.breed && !d.color) return err(t('wiz.e_pet', 'Укажите вид животного, породу или кличку', 'Enter the species, breed or name'), 'species'); }
      else {
        if (d.category === 'things' && !THING_FIELDS[d.thing_type]) return err(t('wiz.e_ttype', 'Выберите тип вещи', 'Choose the item type'), 'thing_type');
        if (!d.title) return err(d.category === 'things' ? t('wiz.e_thing', 'Напишите, что за вещь', 'Say what the item is') : t('wiz.e_title', 'Заполните заголовок', 'Fill in the title'), 'title');
      }
    }
    if (s === 'place' && (d.lat == null || d.lat === '')) return err(t('wiz.e_place', 'Отметьте место на карте', 'Mark the place on the map'), '#picker');
    if (s === 'place' && !d.event_date) return err(tr('Укажите дату', 'Enter the date'), 'event_date');
    if (s === 'place' && d.category === 'people' && isLost && !d.address && !d.landmark && !d.transport) return err(t('wiz.e_where', 'Укажите адрес, место или транспорт', 'Enter an address, place or transport'), 'address');
    if (s === 'looks' && d.height !== '' && d.height != null && (+d.height < 40 || +d.height > 250)) return err(tr('Рост — от 40 до 250 см', 'Height: 40–250 cm'), 'height');
    if (s === 'looks' && d.weight !== '' && d.weight != null && (+d.weight < 2 || +d.weight > 300)) return err(tr('Вес — от 2 до 300 кг', 'Weight: 2–300 kg'), 'weight');
    if (s === 'final') {
      if (!d.contact) return err(t('wiz.e_contact', 'Укажите контакт для связи', 'Enter a contact'), 'contact');
      if (d.category === 'people' && isLost && !d.confirm_rights) return err(t('wiz.e_rights', 'Подтвердите право подачи заявки', 'Confirm your right to file'), 'confirm_rights');
    }
    return true;
  }
  const catPick = (c) => h`<button type="button" class="pick ${d.category === c ? 'on' : ''}" data-cat="${c}">
    <div class="cat-ic" style="background:${c === 'people' ? 'linear-gradient(145deg,var(--red),var(--red-2))' : c === 'animals' ? 'linear-gradient(145deg,var(--blue),var(--blue-2))' : 'linear-gradient(145deg,#2a2c33,#0e0f13)'}">${icon(CAT[c].icon)}</div>
    <div><b>${catName(c)}</b><span>${c === 'people' ? tr('Проверка модератором', 'Moderator review') : tr('Публикуется сразу', 'Published instantly')}</span></div></button>`;

  // Парк: выпадающий список парков выбранного города; «Другой парк» или город без списка — своё название
  function drawParks() {
    const row = $('#parkRow', view); if (!row) return;
    const city = ($('[name=city]', view) || {}).value || '';
    const inp0 = $('[name=park]', view);
    const cur = inp0 ? inp0.value : (d.park || '');
    const list = parksOf(city);
    const sel = !cur ? '' : list.includes(cur) ? cur : PARK_OTHER;
    mount(row, list.length ? h`
      ${fld(t('wiz.park', 'Парк, сквер, лес', 'Park, square, forest'), h`<select name="park_pick"><option value="">${tr('Не в парке', 'Not in a park')}</option>${list.map((v) => h`<option ${sel === v ? 'selected' : ''}>${v}</option>`)}<option value="${PARK_OTHER}" ${sel === PARK_OTHER ? 'selected' : ''}>${tr('Другой парк…', 'Another park…')}</option></select>`)}
      <label class="field ${sel === PARK_OTHER ? '' : 'hide'}" id="parkOther"><span>${t('wiz.park_name', 'Название парка', 'Park name')}</span><input name="park" value="${cur}" maxlength="120" autocomplete="off"></label>`
      : fld(t('wiz.park', 'Парк, сквер, лес', 'Park, square, forest'), h`<input name="park" value="${cur}" maxlength="120" autocomplete="off" placeholder="${tr('Если это было в парке — его название', 'If it was in a park — its name')}">`));
    const pick = $('[name=park_pick]', row);
    if (pick) pick.onchange = () => {
      const other = pick.value === PARK_OTHER, inp = $('[name=park]', row);
      $('#parkOther', row).classList.toggle('hide', !other);
      inp.value = other ? (list.includes(inp.value) ? '' : inp.value) : pick.value;
      if (other) inp.focus();
    };
  }
  // По точке на карте подставляем город и адрес (и парк для животных), не затирая то, что человек вписал сам
  const autoFilled = {};
  let geoSeq = 0, geoTimer = 0;
  function suggestPlace(p) {
    if (!state.config?.map?.geocoder) return;
    clearTimeout(geoTimer);
    geoTimer = setTimeout(async () => {
      const seq = ++geoSeq;
      let r; try { r = await GET(`/geo/reverse?lat=${(+p.lat).toFixed(6)}&lng=${(+p.lng).toFixed(6)}&lang=${state.lang === 'en' ? 'en' : 'ru'}`); } catch (e) { return; }
      if (seq !== geoSeq || steps[step] !== 'place' || !view.isConnected) return;
      for (const k of ['city', 'address']) {
        const el = $(`#wform [name=${k}]`, view);
        if (el && r[k] && (!el.value.trim() || el.value === autoFilled[k])) { el.value = r[k]; autoFilled[k] = r[k]; d[k] = r[k]; }
      }
      if (d.category === 'animals') {
        const park = $('[name=park]', view);
        if (r.park && park && (!park.value || park.value === autoFilled.park)) { park.value = r.park; autoFilled.park = r.park; }
        drawParks();
      }
    }, 350);
  }

  function draw() {
    const s = steps[step];
    const pct = Math.round(((step + 1) / steps.length) * 100);
    let body;
    if (s === 'cat') body = h`<h2>${isLost ? t('wiz.q_lost', 'Кого или что вы потеряли?', 'What did you lose?') : t('wiz.q_found', 'Кого или что вы нашли?', 'What did you find?')}</h2><div class="pick-grid" style="margin-top:18px">${['people', 'animals', 'things'].map(catPick)}</div>`;
    if (s === 'details') {
      const c = d.category;
      body = h`<h2>${t('wiz.details', 'Описание', 'Description')}</h2><form id="wform" class="stack" style="margin-top:18px">
        ${c === 'people' && isLost ? h`
          <div class="note note-red">${icon('shield')}<div><b>${t('wiz.p_note', 'Заявка о человеке проходит проверку', 'Reports about people are reviewed')}</b>${t('wiz.p_note_t', 'Подаёт родственник или законный представитель (о ребёнке — только представитель). Обязательно позвоните в полицию: 102 или 112.', 'Filed by a relative or legal guardian (for a minor — guardian only). Be sure to call the police: 102 or 112.')}</div></div>
          <label class="field"><span>${t('wiz.fio', 'ФИО', 'Full name')} <em>*</em></span><input name="person_name" value="${d.person_name || ''}" maxlength="120" autocomplete="off"></label>
          <div class="grid-pair"><label class="field"><span>${t('wiz.age', 'Возраст', 'Age')} <em>*</em></span><input name="person_age" type="number" min="0" max="120" inputmode="numeric" value="${d.person_age ?? ''}"></label>
          <label class="field"><span>${t('wiz.sex', 'Пол', 'Sex')} <em>*</em></span>${optSelect('sex', d.sex)}</label></div>
          <label class="field"><span>${t('wiz.relation', 'Кем вы приходитесь', 'Your relation')} <em>*</em></span><select name="relation"><option value="">${tr('Выберите', 'Choose')}</option><option value="relative" ${d.relation === 'relative' ? 'selected' : ''}>${t('wiz.rel_rel', 'Родственник', 'Relative')}</option><option value="legal_rep" ${d.relation === 'legal_rep' ? 'selected' : ''}>${t('wiz.rel_legal', 'Законный представитель', 'Legal representative')}</option></select></label>
          <div id="minorNote"></div>
          <label class="field"><span>${t('wiz.title_opt', 'Заголовок (необязательно)', 'Title (optional)')}</span><input name="title" value="${d.title || ''}" maxlength="140"><p class="hint">${tr('Если не заполнить — сформируется автоматически', 'Generated automatically if empty')}</p></label>`
        : c === 'things' ? h`
          <div class="field" role="radiogroup" aria-labelledby="ttype-l"><span id="ttype-l">${t('wiz.thing_type', 'Тип вещи', 'Item type')} <em>*</em></span>
            <div class="tpick">${THING_TYPES.map((k) => h`<label><input type="radio" name="thing_type" value="${k}" ${d.thing_type === k ? 'checked' : ''}><span>${thingName(k)}</span></label>`)}</div></div>
          <label class="field"><span>${t('wiz.t_thing', 'Вещь — что именно', 'Item — what exactly')} <em>*</em></span><input name="title" value="${d.title || ''}" maxlength="140" placeholder="${thingTitleHint(d.thing_type)}"></label>
          ${(THING_FIELDS[d.thing_type] || []).length ? h`<div class="grid-2">${THING_FIELDS[d.thing_type].map((k) => h`<label class="field"><span>${thingLabel(k, d.thing_type)}</span><input name="th_${k}" value="${d['th_' + k] || ''}" maxlength="${THING_MAX[k]}" placeholder="${thingHint(k, d.thing_type)}" ${k === 'plate' ? 'autocapitalize=characters' : ''}></label>`)}</div>` : ''}
          <label class="field"><span>${t('wiz.thing_desc', 'Описание', 'Description')}</span><textarea name="features" rows="3" maxlength="1000" placeholder="${tr('Цвет, материал, приметы, серийный номер, что было внутри', 'Colour, material, marks, serial number, what was inside')}">${d.features || ''}</textarea></label>`
        : h`
          ${c === 'people' ? h`<div class="note note-blue">${icon('shield')}<div>${t('wiz.pf_note', 'Без документов и домашнего адреса. Укажите, где человек сейчас: полиция, больница, остановка. Заявку проверит модератор.', 'No documents or home address. Say where the person is now: police, hospital, bus stop. A moderator will review it.')}</div></div>
            <div class="grid-pair"><label class="field"><span>${t('wiz.approx_age', 'Примерный возраст', 'Approximate age')}</span><input name="person_age" type="number" min="0" max="120" inputmode="numeric" value="${d.person_age ?? ''}"></label>
            <label class="field"><span>${t('wiz.sex', 'Пол', 'Sex')}</span>${optSelect('sex', d.sex)}</label></div>` : ''}
          ${c === 'animals' ? h`
          <label class="field"><span>${t('wiz.species', 'Вид животного', 'Species')}</span><select name="species"><option value="">${tr('Выберите', 'Choose')}</option>${dict('species').map((v) => h`<option ${d.species === v ? 'selected' : ''}>${v}</option>`)}</select></label>
          <div class="grid-2">
            ${fld(t('wiz.breed', 'Порода', 'Breed'), h`<input name="breed" value="${d.breed || ''}" maxlength="80" list="breedList" autocomplete="off" placeholder="${tr('Начните вводить или выберите', 'Start typing or pick')}"><datalist id="breedList">${(BREEDS[speciesRu(d.species)] || []).map((v) => h`<option value="${v}">`)}</datalist>`)}
            ${fld(t('wiz.color', 'Окрас', 'Colour'), h`<input name="color" value="${d.color || ''}" maxlength="80" list="colorList" autocomplete="off" placeholder="${tr('Рыжий, чёрно-белый…', 'Ginger, black and white…')}"><datalist id="colorList">${COLORS.map((v) => h`<option value="${v}">`)}</datalist>`)}
          </div>
          <label class="field"><span>${t('wiz.marks', 'Особые приметы', 'Distinguishing marks')}</span><textarea name="features" rows="3" maxlength="1000" placeholder="${tr('Чип, клеймо, шрамы, разные глаза, купированный хвост, хромает', 'Chip, tattoo, scars, odd eyes, docked tail, limps')}">${d.features || ''}</textarea></label>
          ${fld(t('wiz.pet_clothes', 'Одежда, если есть', 'Clothing, if any'), txt(d, 'clothes', 150, tr('Красный ошейник с адресником, шлейка, комбинезон', 'Red collar with a tag, harness, coat')))}
          <label class="field"><span>${isLost ? t('wiz.pet_name', 'Кличка и коротко (необязательно)', 'Name and short description (optional)') : t('wiz.pet_name_f', 'Коротко: кого нашли (необязательно)', 'Short: what you found (optional)')}</span><input name="title" value="${d.title || ''}" maxlength="140" placeholder="${isLost ? tr('Такса Буся', 'Dachshund Busya') : tr('Рыжая собака без ошейника', 'Ginger dog without a collar')}"><p class="hint">${tr('Если не заполнить — заголовок соберётся из вида, породы и окраса', 'If empty, the title is built from species, breed and colour')}</p></label>`
          : h`
          <label class="field"><span>${c === 'animals' ? (isLost ? t('wiz.t_pet', 'Кличка и коротко', 'Name and short description') : t('wiz.t_pet_f', 'Коротко: кого нашли', 'Short: what you found')) : c === 'things' ? t('wiz.t_thing', 'Что за вещь', 'What item') : t('wiz.t_person_f', 'Коротко: кого нашли', 'Short: who you found')} <em>*</em></span><input name="title" value="${d.title || ''}" maxlength="140" placeholder="${c === 'animals' ? tr('Рыжий кот Барсик', 'Ginger cat Barsik') : c === 'things' ? tr('Чёрный рюкзак с ноутбуком', 'Black backpack with laptop') : tr('Пожилой мужчина без документов', 'Elderly man without documents')}"></label>
          ${c !== 'people' ? h`<label class="field"><span>${t('wiz.features', 'Приметы', 'Distinctive features')}</span><textarea name="features" rows="3" maxlength="1000" placeholder="${c === 'animals' ? tr('Порода, окрас, ошейник, чип, клеймо', 'Breed, colour, collar, chip') : tr('Цвет, марка, серийный номер, брелоки', 'Colour, brand, serial number')}">${d.features || ''}</textarea></label>` : ''}`}`}
        <label class="field"><span>${c === 'animals' || c === 'things' ? t('wiz.comments', 'Комментарии', 'Comments') : t('wiz.desc', 'Подробное описание', 'Full description')}</span><textarea name="description" rows="4" maxlength="4000" placeholder="${c === 'animals' ? tr('Характер, на что откликается, как подойти, чем приманить', 'Temper, what it responds to, how to approach') : c === 'things' ? tr('Где и как это случилось, кому передали находку, как её забрать', 'How it happened, who has the item now, how to collect it') : ''}">${d.description || ''}</textarea></label>
      </form>`;
    }
    if (s === 'looks') body = h`<h2>${t('wiz.looks', 'Приметы', 'Appearance')}</h2><p class="muted" style="margin-top:8px">${t('wiz.looks_t', 'Заполните то, что знаете: по этим приметам человека узнают на улице и подберут похожие заявки.', 'Fill in what you know: people use these details to recognise the person, and we use them to match reports.')}</p>
      <form id="wform" class="stack" style="margin-top:18px">
        <h3 class="wiz-sub">${t('wiz.g_body', 'Внешность', 'Looks')}</h3>
        <div class="grid-pair">
          ${fld(t('wiz.height', 'Рост, см', 'Height, cm'), h`<input name="height" type="number" min="40" max="250" inputmode="numeric" value="${d.height ?? ''}">`)}
          ${fld(t('wiz.weight', 'Вес, кг', 'Weight, kg'), h`<input name="weight" type="number" min="2" max="300" inputmode="numeric" value="${d.weight ?? ''}">`)}
          ${fld(t('wiz.build', 'Телосложение', 'Build'), optSelect('build', d.build))}
          ${fld(t('wiz.skin', 'Цвет кожи', 'Skin tone'), optSelect('skin', d.skin))}
          ${fld(t('wiz.hair_color', 'Цвет волос', 'Hair colour'), optSelect('hair_color', d.hair_color))}
          ${fld(t('wiz.hair_length', 'Длина волос', 'Hair length'), optSelect('hair_length', d.hair_length))}
          ${fld(t('wiz.eye_color', 'Цвет глаз', 'Eye colour'), optSelect('eye_color', d.eye_color))}
          ${fld(t('wiz.nationality', 'Национальность', 'Nationality'), txt(d, 'nationality', 60))}
        </div>
        <h3 class="wiz-sub">${t('wiz.g_clothes', 'Одежда и обувь', 'Clothes and shoes')}</h3>
        <div class="grid-2">
          ${fld(t('wiz.clothes_top', 'Верх', 'Top'), txt(d, 'clothes_top', 150, tr('Синяя куртка, серый свитер', 'Blue jacket, grey sweater')))}
          ${fld(t('wiz.clothes_bottom', 'Низ', 'Bottom'), txt(d, 'clothes_bottom', 150, tr('Чёрные брюки', 'Black trousers')))}
          ${fld(t('wiz.headwear', 'Головной убор', 'Headwear'), txt(d, 'headwear', 100, tr('Вязаная шапка', 'Knitted hat')))}
          ${fld(t('wiz.shoes', 'Обувь', 'Shoes'), txt(d, 'shoes', 100, tr('Коричневые ботинки', 'Brown boots')))}
        </div>
        <label class="field"><span>${t('wiz.marks', 'Особые приметы', 'Distinguishing marks')}</span><textarea name="features" rows="3" maxlength="1000" placeholder="${tr('Шрамы, татуировки, родинки, очки, украшения, походка, что было с собой', 'Scars, tattoos, moles, glasses, jewellery, gait, what they carried')}">${d.features || ''}</textarea></label>
        <h3 class="wiz-sub">${t('wiz.g_health', 'Здоровье и общение', 'Health and communication')}</h3>
        <div class="note note-blue">${icon('shield')}<div>${t('wiz.health_note', 'Только то, что поможет узнать человека и правильно себя вести при встрече. Диагнозы и данные медицинских документов не указывайте. Когда человек найдётся, эти сведения скроем.', 'Only what helps recognise the person and act right when you meet. No diagnoses or medical records. Once found, this is hidden.')}</div></div>
        <fieldset class="chk-grid"><legend>${t('wiz.health', 'Состояние', 'Condition')}</legend>${Object.keys(OPT.health).map((x) => h`<label class="check"><input type="checkbox" name="h_${x}" ${d['h_' + x] ? 'checked' : ''}> <span>${optName('health', x)}</span></label>`)}</fieldset>
        ${fld(t('wiz.health_more', 'Что важно знать при встрече', 'What to know when you meet'), txt(d, 'health_note', 200, tr('Не откликается на имя, нужен приём лекарств', 'Doesn’t respond to name, needs medication')))}
        <div class="grid-pair">
          ${fld(t('wiz.disability', 'Инвалидность', 'Disability'), optSelect('disability', d.disability))}
          ${fld(t('wiz.language', 'Язык общения', 'Language'), txt(d, 'language', 80, tr('Русский', 'Russian')))}
        </div>
      </form>`;
    if (s === 'photos') body = h`<h2>${t('wiz.photos', 'Фотографии', 'Photos')}</h2><p class="muted" style="margin-top:8px">${t('wiz.photos_t', 'До 5 фото. Чёткие снимки повышают шанс совпадения.', 'Up to 5 photos. Clear shots improve matching.')}</p><div id="ph" style="margin-top:18px"></div>`;
    if (s === 'place') {
      const lastSeen = d.category === 'people' && isLost;
      const rl = ROUTE[d.transport] || ROUTE.other;
      body = h`<h2>${lastSeen ? t('wiz.where_seen', 'Где и когда видели последний раз?', 'Where and when were they last seen?') : isLost ? t('wiz.where_lost', 'Где и когда потеряли?', 'Where and when was it lost?') : t('wiz.where_found', 'Где и когда нашли?', 'Where and when was it found?')}</h2>
      <form id="wform" class="stack" style="margin-top:18px">
        <div class="picker" id="picker"></div>
        <p class="xs muted">${icon('lock', 'ic-sm')} ${t('wiz.geo_note', 'Геолокация определяется только по вашему нажатию и с вашего согласия.', 'Location is used only when you tap the button and allow it.')}</p>
        <div class="grid-pair">
          ${fld(t('wiz.date_req', 'Дата *', 'Date *'), h`<input type="date" name="event_date" value="${d.event_date || ''}" max="${localDate()}">`)}
          ${fld(t('wiz.time', 'Время', 'Time'), h`<input type="time" name="event_time" value="${d.event_time || ''}">`)}
        </div>
        <div class="grid-2">
          ${fld(t('wiz.city', 'Город', 'City'), h`<input name="city" value="${d.city || state.user.city || ''}" maxlength="80">`)}
          ${fld(t('wiz.address2', 'Адрес', 'Address'), h`<input name="address" value="${d.address || ''}" maxlength="200" placeholder="${tr('Тверская ул., 7', '7 Tverskaya St')}">`)}
        </div>
        ${d.category === 'animals' ? h`<div class="grid-2" id="parkRow"></div>
        ${fld(t('wiz.place_other', 'Другое место или ориентир', 'Other place or landmark'), txt(d, 'landmark', 150, tr('Подъезд дома, зоомагазин, дача, вокзал', 'Building entrance, pet shop, country house')))}`
        : fld(t('wiz.landmark', 'Место или ориентир', 'Place or landmark'), txt(d, 'landmark', 150, tr('Парк Горького, вокзал, ТЦ «Европейский»', 'Gorky Park, railway station, a mall')))}
        <div class="grid-2">
          ${fld(t('wiz.transport', 'Общественный транспорт', 'Public transport'), h`<select name="transport"><option value="">${tr('Не в транспорте', 'Not in transport')}</option>${Object.keys(OPT.transport).map((v) => h`<option value="${v}" ${d.transport === v ? 'selected' : ''}>${optName('transport', v)}</option>`)}</select>`)}
          <label class="field ${d.transport ? '' : 'hide'}" id="routeBox"><span id="routeL">${tr(...rl[0])}</span><input name="transport_route" value="${d.transport_route || ''}" maxlength="100" placeholder="${tr(...rl[1])}" autocomplete="off"></label>
        </div>
        <div class="field"><span>${t('wiz.place_photo', 'Фото места (необязательно)', 'Photo of the place (optional)')}</span><div id="pph"></div><p class="hint">${t('wiz.place_photo_t', 'Подъезд, остановка, вход в парк — так место быстрее узнают.', 'An entrance, a bus stop, a park gate — helps people recognise the place.')}</p></div>
      </form>`;
    }
    if (s === 'final') {
      const canEm = isLost && d.category !== 'things' && !edit;
      body = h`<h2>${t('wiz.final', 'Связь и публикация', 'Contact & publishing')}</h2><form id="wform" class="stack" style="margin-top:18px">
        <label class="field"><span>${t('wiz.contact', 'Контакт для связи', 'Contact')} <em>*</em></span><input name="contact" value="${d.contact || ''}" maxlength="120" autocomplete="tel" autocapitalize="off">
          <p class="hint">${icon('lock', 'ic-sm')} ${t('wiz.contact_t', 'Контакт видит только модератор. Вам напишут в анонимный чат.', 'Only moderators see it. People will reach you via anonymous chat.')}</p></label>
        ${isLost ? h`<label class="field"><span>${t('wiz.reward', 'Вознаграждение, ₽ (необязательно)', 'Reward, ₽ (optional)')}</span><input name="reward" type="number" min="0" step="100" inputmode="numeric" value="${d.reward || ''}"><p class="hint">${t('wiz.reward_t', 'Выплачивается вами напрямую, вне платформы.', 'Paid by you directly, outside the platform.')}</p></label>` : ''}
        ${canEm ? h`<div class="card pad" style="padding:16px">
          <label class="row between" style="cursor:pointer"><div class="row">${icon('siren')}<div><b>${t('wiz.em', 'Экстренное оповещение', 'Emergency alert')}</b><div class="xs muted">${t('wiz.em_t', 'Push людям и волонтёрам рядом. Запуск — после проверки модератором.', 'Push to people and volunteers nearby. Starts after moderator review.')}</div></div></div><span class="switch"><input type="checkbox" name="emergency_on" ${d.emergency_on ? 'checked' : ''}></span></label>
          <div id="emR" class="${d.emergency_on ? '' : 'hide'}" style="margin-top:14px"><div class="row between small"><span>${t('wiz.radius', 'Радиус', 'Radius')}</span><b id="emRv">${d.emergency_radius} ${tr('км', 'km')}</b></div><input class="range" type="range" name="emergency_radius" aria-label="${t('wiz.radius', 'Радиус', 'Radius')}" min="1" max="5" step="1" value="${d.emergency_radius}"></div>
        </div>` : ''}
        ${state.user.family_id && !edit ? h`<label class="check"><input type="checkbox" name="family" ${d.family ? 'checked' : ''}> <span>${t('wiz.family', 'Общая заявка семьи — её видят и могут редактировать члены семейного аккаунта', 'Shared family report — family members can view and edit it')}</span></label>` : ''}
        ${d.category === 'people' && isLost ? h`<label class="check"><input type="checkbox" name="confirm_rights" ${d.confirm_rights ? 'checked' : ''}> <span>${t('wiz.rights', 'Я родственник или законный представитель и вправе подать заявку. Понимаю, что платформа не заменяет полицию.', 'I am a relative or legal guardian and may file this report. I understand the platform does not replace the police.')}</span></label>` : ''}
        <div class="note">${icon('alert')}<div>${d.category === 'people' ? t('wiz.pub_people', 'Публикация — после проверки модератором. Когда человек найдётся, личные данные скроем.', 'Published after moderator review. Once found, personal data is hidden.') : t('wiz.pub_other', 'Заявка публикуется сразу. Модератор проверяет её по жалобам.', 'Published instantly. Moderators review it on complaints.')}</div></div>
        ${!edit ? h`<p class="xs muted">${t('wiz.pub_consent', 'Нажимая «Опубликовать», вы даёте', 'By tapping Publish you give the')} <a class="doc-link" href="#/legal/publication" data-doc="publication">${t('wiz.pub_consent_l', 'согласие на распространение персональных данных', 'consent to dissemination of personal data')}</a>.</p>` : ''}
      </form>`;
    }
    mount(view, h`<div class="wrap wizard">
      <div class="page-head" style="padding-bottom:0">${back(edit ? `#/a/${d.id}` : '#/', tr('Отмена', 'Cancel'))}<span class="eyebrow">${title}</span></div>
      <div class="row between xs muted" style="font-weight:700;margin-top:14px"><span>${tr('Шаг', 'Step')} ${step + 1} / ${steps.length}</span><span>${d.category ? catName(d.category) : ''}</span></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="view">${body}</div>
      <div class="wiz-foot">
        ${step > (edit ? 1 : 0) ? h`<button class="btn btn-ghost" id="prev" aria-label="${tr('Назад', 'Back')}">${icon('chevL')}</button>` : ''}
        <button class="btn ${s === 'final' ? 'btn-red' : ''}" id="next">${s === 'final' ? (edit ? t('wiz.save', 'Сохранить изменения', 'Save changes') : t('wiz.publish', 'Опубликовать', 'Publish')) : s === 'photos' && !getPhotos().length ? tr('Пропустить', 'Skip') : tr('Далее', 'Next')}${s === 'final' ? '' : icon('chevR')}</button>
      </div></div>`);
    if (s === 'cat') $$('[data-cat]', view).forEach((b) => b.onclick = () => { d.category = b.dataset.cat; steps = stepsFor(); step = 1; draw(); });
    if (s === 'photos') {
      getPhotos = photoField($('#ph', view), d.photos || [], 5);
      // обновлять подпись кнопки при изменении
      new MutationObserver(() => { const n = $('#next', view); if (n) n.firstChild.textContent = getPhotos().length ? tr('Далее', 'Next') : tr('Пропустить', 'Skip'); }).observe($('#ph', view), { childList: true, subtree: true });
    }
    if (s === 'place') {
      getPlacePhoto = photoField($('#pph', view), d.place_photo ? [d.place_photo] : [], 1);
      const tsel = $('[name=transport]', view);
      tsel.onchange = () => {
        const rl = ROUTE[tsel.value] || ROUTE.other;
        $('#routeBox', view).classList.toggle('hide', !tsel.value);
        $('#routeL', view).textContent = tr(...rl[0]);
        $('[name=transport_route]', view).placeholder = tr(...rl[1]);
      };
      if (d.category === 'animals') {
        $('[name=city]', view).addEventListener('input', () => drawParks());
        drawParks();
      }
    }
    if (s === 'place') { const pk = mapPicker($('#picker', view), d.lat != null && d.lat !== '' ? { lat: +d.lat, lng: +d.lng } : null, (p) => { d.lat = p.lat; d.lng = p.lng; suggestPlace(p); const pe = $('#picker', view); if (pe && pe.classList.contains('has-err')) { pe.classList.remove('has-err'); const fe = $('#ferr-picker', view); if (fe) fe.remove(); } }, { kind, category: d.category }); onLeave(() => pk.map.remove()); }
    if (s === 'details' && d.category === 'animals') {
      const sp = $('[name=species]', view);
      sp.onchange = () => mount($('#breedList', view), (BREEDS[speciesRu(sp.value)] || []).map((v) => h`<option value="${v}">`));
    }
    if (s === 'details' && d.category === 'things') {
      $$('[name=thing_type]', view).forEach((r) => r.onchange = () => { saveStep(); draw(); const on = $('[name=thing_type]:checked', view); if (on) on.focus({ preventScroll: true }); });
    }
    if (s === 'details' && d.category === 'people' && isLost) {
      const upd = () => { const a = $('[name=person_age]', view).value; mount($('#minorNote', view), a !== '' && +a < 18 ? h`<div class="note note-amber">${icon('alert')}<div>${t('wiz.minor', 'Человеку меньше 18 лет: заявку подаёт только законный представитель.', 'Under 18: only a legal guardian can file.')}</div></div>` : ''); };
      $('[name=person_age]', view).oninput = upd; upd();
    }
    if (s === 'final') {
      const em = $('[name=emergency_on]', view);
      if (em) { em.onchange = () => $('#emR', view).classList.toggle('hide', !em.checked); $('[name=emergency_radius]', view).oninput = (e) => { $('#emRv', view).textContent = e.target.value + ' ' + tr('км', 'km'); }; }
    }
    // новый шаг — старые ошибки не висят; исправили поле — подсветка снимается
    $$('#toasts .toast.err').forEach((x) => x.remove());
    const wf = $('#wform', view);
    if (wf) { const fix = (e) => { const b = e.target.closest('.has-err'); if (b) { b.classList.remove('has-err'); $$('.ferr', b).forEach((x) => x.remove()); e.target.removeAttribute('aria-invalid'); } }; wf.addEventListener('input', fix); wf.addEventListener('change', fix); }
    const prev = $('#prev', view); if (prev) prev.onclick = () => { saveStep(); step--; draw(); };
    $('#next', view).onclick = (e) => {
      saveStep(); if (!validate()) return;
      if (s !== 'final') { step++; draw(); return; }
      busy(e.currentTarget, submit);
    };
  }
  async function submit() {
    const body = {
      kind: d.kind, category: d.category, title: d.title, description: d.description, features: d.features, species: d.species,
      person_name: d.person_name, person_age: d.person_age, relation: d.relation, confirm_rights: !!d.confirm_rights,
      details: Object.assign(Object.fromEntries(DETAIL_KEYS.map((k) => [k, d[k] ?? ''])), { health: Object.keys(OPT.health).filter((x) => d['h_' + x]) }, d.category === 'things' ? thingDetails(d) : {}),
      event_date: d.event_date, event_time: d.event_time || '', lat: d.lat, lng: d.lng, address: d.address, city: d.city, contact: d.contact, reward: d.reward,
      photos: d.photos || [], family: !!d.family, emergency_radius: d.emergency_on ? +d.emergency_radius : null
    };
    try {
      if (edit) { const r = await PATCH('/applications/' + d.id, body); toast(r.item.status === 'pending' ? tr('Изменения отправлены на проверку', 'Changes sent for review') : tr('Изменения сохранены', 'Changes saved')); go('#/a/' + d.id); return; }
      const r = await POST('/applications', body);
      const pending = r.item.status === 'pending';
      mount(view, h`<div class="wrap wizard"><div class="success">
        <div class="big-ic ${pending ? 'wait' : ''}">${icon(pending ? 'clock' : 'check')}</div>
        <h2>${pending ? t('wiz.ok_pending', 'Заявка отправлена на проверку', 'Report sent for review') : t('wiz.ok', 'Заявка опубликована', 'Report published')}</h2>
        <p class="muted" style="margin:12px auto 0;max-width:460px">${pending ? t('wiz.ok_pending_t', 'Модератор скоро проверит — пришлём уведомление. Если пропал человек, позвоните в полицию: 102 или 112.', 'A moderator will review it soon — we’ll notify you. If a person is missing, call the police: 102 or 112.') : r.matches ? `${t('wiz.ok_matches', 'Найдено возможных совпадений', 'Possible matches found')}: ${r.matches}` : t('wiz.ok_t', 'Мы сообщим, как только появится похожая заявка.', 'We will notify you as soon as a similar report appears.')}</p>
        ${body.emergency_radius ? h`<p class="chip chip-warn" style="margin-top:14px">${icon('siren')}${t('wiz.ok_em', 'Экстренное оповещение ждёт подтверждения модератора', 'Emergency alert awaits moderator approval')} · ${body.emergency_radius} ${tr('км', 'km')}</p>` : ''}
        ${pending && d.category === 'people' ? h`<div class="row" style="justify-content:center;margin-top:18px"><a class="btn btn-red btn-urgent" href="tel:112">${icon('phone')}112</a><a class="btn" href="tel:102">${icon('phone')}102</a></div>` : ''}
        <div class="row" style="justify-content:center;margin-top:22px;flex-wrap:wrap"><a class="btn btn-ghost" href="#/a/${r.item.id}">${t('wiz.open', 'Открыть заявку', 'Open report')}</a><a class="btn btn-ghost" href="#/me/apps">${t('wiz.my', 'Мои заявки', 'My reports')}</a></div>
      </div></div>`);
    } catch (e) { toastErr(e); }
  }
  draw();
}
route('/new/:kind', (view, p) => wizard(view, p.kind === 'found' ? 'found' : 'lost'), { auth: true });
route('/edit/:id', async (view, p) => { const r = await GET('/applications/' + p.id); if (!r.item.is_owner) throw Object.assign(new Error(tr('Нет доступа', 'No access')), { status: 404 }); wizard(view, r.item.kind, r.item); }, { auth: true });

/* =================== СТРАНИЦА ЗАЯВКИ =================== */
route('/a/:id', async (view, p) => {
  mount(view, h`<div class="wrap" style="padding-top:20px"><div class="sk" style="height:360px"></div></div>`);
  const { item: a } = await GET('/applications/' + p.id);
  const owner = a.is_owner;
  // ссылка «Поделиться» — чистый адрес: мессенджеры и поисковики получают превью с фото и описанием заявки
  const url = location.origin + '/a/' + a.id;
  document.title = `${a.title} — ${kindName(a.kind)} — ${tr('Мой лучший агент', 'My Best Agent')}`;
  const kv = [], dt = a.details || {};
  const structuredPlace = dt.landmark || dt.transport;
  if (a.category === 'people' && !a.hidden_pd) {
    if (a.person_name) kv.push([t('wiz.fio', 'ФИО', 'Full name'), a.person_name]);
    if (dt.sex) kv.push([t('wiz.sex', 'Пол', 'Sex'), optName('sex', dt.sex)]);
    if (a.person_age != null) kv.push([t('wiz.age', 'Возраст', 'Age'), a.person_age]);
    if (a.last_seen && !structuredPlace && !a.address) kv.push([t('wiz.last_seen', 'Последнее местонахождение', 'Last known location'), a.last_seen]);
  }
  if (a.category === 'things' && THING_FIELDS[dt.thing_type]) {
    kv.push([t('wiz.thing_type', 'Тип вещи', 'Item type'), thingName(dt.thing_type)]);
    for (const k of THING_FIELDS[dt.thing_type]) if (dt[k]) kv.push([thingLabel(k, dt.thing_type), dt[k]]);
  } else if (a.species) kv.push([a.category === 'animals' ? t('wiz.species', 'Вид животного', 'Species') : t('wiz.thing_type', 'Тип вещи', 'Item type'), a.species]);
  if (a.category === 'animals') {
    if (dt.breed) kv.push([t('wiz.breed', 'Порода', 'Breed'), dt.breed]);
    if (dt.color) kv.push([t('wiz.color', 'Окрас', 'Colour'), dt.color]);
    if (dt.clothes) kv.push([t('wiz.pet_clothes_s', 'Одежда', 'Clothing'), dt.clothes]);
  }
  kv.push([t('wiz.date', 'Дата', 'Date'), fmtDate(a.event_date) + (a.event_time ? ', ' + a.event_time : '')]);
  if (a.address || a.city) kv.push([t('a.place', 'Место', 'Place'), [a.address, a.city].filter(Boolean).join(', ')]);
  if (dt.park) kv.push([t('wiz.park_s', 'Парк', 'Park'), dt.park]);
  if (dt.landmark) kv.push([t('wiz.landmark', 'Место или ориентир', 'Place or landmark'), dt.landmark]);
  if (dt.transport) kv.push([t('wiz.transport_s', 'Транспорт', 'Transport'), [optName('transport', dt.transport), dt.transport_route].filter(Boolean).join(', ')]);
  // приметы человека — единый набор параметров
  const looks = [];
  if (a.category === 'people') {
    const add = (k, label, v) => { if (v != null && v !== '') looks.push([label, v]); };
    add('height', t('wiz.height', 'Рост, см', 'Height, cm'), dt.height);
    add('weight', t('wiz.weight', 'Вес, кг', 'Weight, kg'), dt.weight);
    for (const [k, label] of [['build', t('wiz.build', 'Телосложение', 'Build')], ['skin', t('wiz.skin', 'Цвет кожи', 'Skin tone')], ['hair_color', t('wiz.hair_color', 'Цвет волос', 'Hair colour')],
      ['hair_length', t('wiz.hair_length', 'Длина волос', 'Hair length')], ['eye_color', t('wiz.eye_color', 'Цвет глаз', 'Eye colour')]]) if (dt[k]) add(k, label, optName(k, dt[k]));
    add('nationality', t('wiz.nationality', 'Национальность', 'Nationality'), dt.nationality);
    add('clothes_top', t('wiz.clothes_top', 'Верх', 'Top'), dt.clothes_top);
    add('clothes_bottom', t('wiz.clothes_bottom', 'Низ', 'Bottom'), dt.clothes_bottom);
    add('headwear', t('wiz.headwear', 'Головной убор', 'Headwear'), dt.headwear);
    add('shoes', t('wiz.shoes', 'Обувь', 'Shoes'), dt.shoes);
    add('language', t('wiz.language', 'Язык общения', 'Language'), dt.language);
    if (dt.health && dt.health.length) add('health', t('wiz.health', 'Состояние', 'Condition'), dt.health.map((x) => optName('health', x)).join(', '));
    add('health_note', t('wiz.health_more', 'Что важно знать при встрече', 'What to know when you meet'), dt.health_note);
    if (dt.disability) add('disability', t('wiz.disability', 'Инвалидность', 'Disability'), optName('disability', dt.disability));
  }
  kv.push([t('a.published', 'Опубликовано', 'Published'), ago(a.created_at)]);
  kv.push([t('a.views', 'Просмотры', 'Views'), a.views]);

  mount(view, h`<div class="wrap" style="padding-top:16px">
    ${back('back')}
    ${owner && a.status === 'pending' ? h`<div class="note note-amber" style="margin-bottom:14px">${icon('clock')}<div><b>${t('a.pending', 'Заявка на проверке', 'Under review')}</b>${t('a.pending_t', 'Видна только вам и модераторам. Сообщим, когда проверим.', 'Only you and moderators see it. We’ll notify you after review.')}</div></div>` : ''}
    ${owner && a.status === 'rejected' ? h`<div class="note note-red" style="margin-bottom:14px">${icon('alert')}<div><b>${t('a.rejected', 'Заявка отклонена', 'Report rejected')}</b>${a.reject_reason} · ${t('a.rejected_t', 'Исправьте и отправьте повторно.', 'Fix it and resubmit.')}</div></div>` : ''}
    <div class="detail">
      <div class="stack-lg d-top">
        <div class="gallery">${a.photos.length ? h`<div class="track">${a.photos.map((u, i) => h`<img src="${u}" alt="${a.title} — ${tr('фото', 'photo')} ${i + 1}" data-zoom="${u}" tabindex="0" role="button">`)}</div>${a.photos.length > 1 ? h`<div class="dots">${a.photos.map((_, i) => h`<i class="${i ? '' : 'on'}"></i>`)}</div>` : ''}` : media(a)}</div>
        <div>
          <div class="row-wrap">
            ${a.emergency ? h`<span class="chip chip-em">${icon('siren')}${t('a.em', 'Экстренный поиск', 'Emergency')} · ${a.emergency} ${tr('км', 'km')}</span>` : ''}
            <span class="chip chip-${a.kind}">${kindName(a.kind)}</span><span class="chip">${icon(CAT[a.category].icon)}${catName(a.category)}</span>
            <span class="chip ${statusChip(a.status)}">${statusName(a.status)}</span>
            ${a.promoted ? h`<span class="chip">${icon('zap')}${t('card.top', 'Топ', 'Top')}</span>` : ''}
          </div>
          <h1 style="font-size:clamp(24px,4vw,38px);margin-top:14px">${a.title}</h1>
        </div>
        ${a.hidden_pd ? h`<div class="note note-blue">${icon('shield')}<div><b>${t('a.hidden', 'Человек найден', 'Person found')}</b>${t('a.hidden_t', 'Личные данные скрыты. Спасибо всем, кто помогал!', 'Personal data is hidden. Thanks to everyone who helped!')}</div></div>` : ''}
        ${a.category === 'people' && a.status === 'published' ? h`<div class="police">${icon('siren', 'ic-lg')}<div class="grow"><b>${t('a.police', 'Сообщите в полицию', 'Call the police')}</b><div class="xs" style="opacity:.7">${t('a.police_t', 'Платформа не заменяет полицию', 'We don’t replace the police')}</div></div><a href="tel:102" aria-label="${tr('Позвонить 102', 'Call 102')}">102</a><a href="tel:112" aria-label="${tr('Позвонить 112', 'Call 112')}">112</a></div>` : ''}
        ${a.reward ? h`<div class="reward">${icon('gift', 'ic-lg')}<div class="grow"><div class="xs muted" style="font-weight:700">${t('a.reward', 'Вознаграждение', 'Reward')}</div><b>${money(a.reward)}</b></div><span class="xs muted" style="max-width:130px;text-align:right">${t('a.reward_t', 'Платит автор заявки', 'Paid by the author')}</span></div>` : ''}
      </div>
      <div class="stack-lg d-rest">
        ${a.features ? h`<div><h3 style="font-size:15px;margin-bottom:8px">${a.category !== 'things' ? t('wiz.marks', 'Особые приметы', 'Distinguishing marks') : t('wiz.thing_desc', 'Описание', 'Description')}</h3><p>${a.features}</p></div>` : ''}
        ${a.description ? h`<div><h3 style="font-size:15px;margin-bottom:8px">${a.category === 'animals' || a.category === 'things' ? t('wiz.comments', 'Комментарии', 'Comments') : t('a.desc', 'Описание', 'Description')}</h3><p style="white-space:pre-wrap">${a.description}</p></div>` : ''}
        <div class="card pad"><dl class="kv">${kv.map(([k, v]) => h`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></div>
        ${looks.length ? h`<div><h3 style="font-size:15px;margin-bottom:8px">${t('wiz.looks', 'Приметы', 'Appearance')}</h3><div class="card pad"><dl class="kv" id="looks">${looks.map(([k, v]) => h`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></div></div>` : ''}
        ${a.lat != null ? h`<div class="mini-map" id="mm"></div>` : ''}
        ${dt.place_photo ? h`<div><h3 style="font-size:15px;margin-bottom:8px">${t('a.place_photo', 'Фото места', 'Photo of the place')}</h3><img class="place-photo" src="${dt.place_photo}" alt="${t('a.place_photo', 'Фото места', 'Photo of the place')}" data-zoom="${dt.place_photo}" tabindex="0" role="button" loading="lazy"></div>` : ''}
        ${owner && a.matches ? h`<div><div class="sec-head" style="margin-bottom:12px"><h3>${t('a.matches', 'Возможные совпадения', 'Possible matches')}</h3><span class="chip">${a.matches.length}</span></div>
          ${a.matches.length ? h`<div class="apps">${a.matches.map((m, i) => appCard(m, i, { score: m.score }))}</div>` : empty('match', t('a.no_matches', 'Совпадений пока нет', 'No matches yet'), t('a.no_matches_t', 'Сообщим, как только появится похожая.', 'We’ll notify you when one appears.'))}</div>` : ''}
      </div>
      <aside class="stack d-side">
        ${owner ? ownerPanel(a) : visitorPanel(a)}
        ${!owner && a.category === 'people' && a.status !== 'pending' ? h`<button type="button" class="aside-link" id="delReq">${icon('shield')}<span class="grow"><b>${t('a.del_req_q', 'Эта заявка о вас?', 'Is this report about you?')}</b><small>${t('a.del_req_s', 'Попросить снять с публикации', 'Ask to take it down')}</small></span>${icon('chevR', 'ic-sm')}</button>` : ''}
        <div id="near"></div>
      </aside>
    </div></div>`);

  const track = $('.track', view);
  if (track) {
    track.onscroll = () => { const i = Math.round(track.scrollLeft / track.clientWidth); $$('.dots i', view).forEach((d, k) => d.classList.toggle('on', k === i)); };
    $$('[data-zoom]', view).forEach((im) => { im.onclick = () => lightbox(im.dataset.zoom); im.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lightbox(im.dataset.zoom); } }; });
  }
  if (a.lat != null) {
    const mm = makeMap($('#mm', view), { center: [a.lat, a.lng], zoom: 14 });
    { const slot = document.createElement('div'); slot.className = 'map-fab'; $('#mm', view).appendChild(slot); mapFull(mm, $('#mm', view), slot); }
    mm.lib.marker([a.lat, a.lng], { icon: pinIcon(a), interactive: false, keyboard: false }).addTo(mm);
    if (a.emergency) mm.lib.circle([a.lat, a.lng], { radius: a.emergency * 1000, color: '#e0192d', weight: 1.5, fillOpacity: .08 }).addTo(mm);
    // запрос SOS на проверке: автор видит будущую зону оповещения пунктиром
    else if (a.emergency_status === 'pending' && a.emergency_radius) {
      const c = mm.lib.circle([a.lat, a.lng], { radius: a.emergency_radius * 1000, color: '#e0192d', weight: 1.5, fillOpacity: .04, dashArray: '5 7', interactive: false }).addTo(mm);
      mm.fitBounds(c.getBounds(), { padding: [12, 12] });
    }
    onLeave(() => mm.remove());
  }
  // «Рядом»: заявки противоположного типа той же категории, ближайшие к месту — помогают заметить совпадение глазами
  if (a.lat != null && a.status !== 'pending') {
    const opp = a.kind === 'lost' ? 'found' : 'lost';
    GET(`/applications?category=${a.category}&kind=${opp}&status=active&lat=${a.lat}&lng=${a.lng}&sort=near&radius=25&limit=4`).then(({ items }) => {
      const list = items.filter((x) => x.id !== a.id).slice(0, 4); const box = $('#near', view); if (!box || !list.length) return;
      mount(box, h`<div class="card pad near-box"><div class="row between" style="margin-bottom:10px"><b>${opp === 'found' ? tr('Найдено поблизости', 'Found nearby') : tr('Ищут поблизости', 'Searched for nearby')}</b><a class="link xs" href="#/map?category=${a.category}&kind=${opp}">${tr('На карте', 'On map')}</a></div>
        <div class="near-list">${list.map((x) => h`<a href="#/a/${x.id}"><span class="near-th">${x.photos && x.photos.length ? h`<img src="${x.photos[0]}" alt="" loading="lazy">` : mediaPh(x.category)}</span><span class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${x.title}</b><span class="xs muted">${x.distance != null ? km(x.distance) + ' · ' : ''}${ago(x.created_at)}</span></span>${icon('chevR', 'ic-sm')}</a>`)}</div></div>`);
    }).catch(() => {});
  }
  // телефон: когда основная кнопка «Написать» вне экрана — показываем плавающую копию над нижним меню
  const wb = $('#write', view);
  if (wb && 'IntersectionObserver' in window) {
    const cta = document.createElement('div'); cta.className = 'm-cta';
    mount(cta, h`<button class="btn btn-red btn-lg btn-block">${icon('chat')}${wb.textContent.trim()}</button>`);
    document.body.appendChild(cta);
    cta.firstChild.onclick = () => wb.click();
    const io = new IntersectionObserver(([en]) => cta.classList.toggle('show', !en.isIntersecting), { rootMargin: '0px 0px -80px 0px' });
    io.observe(wb);
    onLeave(() => { io.disconnect(); cta.remove(); });
  }
  const on = (sel, fn) => { const el = $(sel, view); if (el) el.onclick = fn; };
  on('#share', () => shareSheet(url, a.title));
  on('#write', (e) => {
    if (!state.user) return needLogin();
    busy(e.currentTarget, async () => { try { const r = await POST(`/applications/${a.id}/chat`); go('#/chat/' + r.id); } catch (er) { toastErr(er); } });
  });
  on('#save', async (e) => {
    if (!state.user) return needLogin();
    const btn = e.currentTarget; // после await currentTarget уже null — запоминаем кнопку заранее
    btn.disabled = true;
    try { const r = await POST(`/applications/${a.id}/save`); btn.classList.toggle('btn-red', r.saved); btn.setAttribute('aria-pressed', String(!!r.saved)); btn.querySelector('span').textContent = r.saved ? tr('Сохранено', 'Saved') : tr('Сохранить', 'Save'); toast(r.saved ? tr('Добавлено в сохранённые', 'Saved') : tr('Убрано из сохранённых', 'Removed')); } catch (er) { toastErr(er); } finally { btn.disabled = false; }
  });
  on('#complain', () => { if (!state.user) return needLogin(); complain('application', a.id); });
  on('#delReq', () => {
    const s = sheet(h`${sheetHead(t('a.del_req_h', 'Снять заявку о себе', 'Remove a report about me'), t('a.del_req_t', 'Модератор проверит и удалит заявку.', 'A moderator will check and remove it.'))}
      <form class="stack"><label class="field"><span>${t('f.name', 'Имя', 'Name')}</span><input name="name" required></label><label class="field"><span>${t('f.contact', 'Телефон или e-mail', 'Phone or e-mail')}</span><input name="contact" required></label>
      <label class="field"><span>${t('f.reason', 'Комментарий', 'Comment')}</span><textarea name="reason" rows="3"></textarea></label><button class="btn btn-block">${tr('Отправить', 'Send')}</button></form>`);
    $('form', s.el).onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { try { await POST(`/applications/${a.id}/deletion-request`, formData(e.target)); s.close(); toast(tr('Запрос отправлен модератору', 'Request sent to moderators')); } catch (er) { toastErr(er); } }); };
  });
  // действия автора
  on('#edit', () => go('#/edit/' + a.id));
  on('#found', () => {
    const chats = a.chats || [];
    const s = sheet(h`${sheetHead(t('a.mark_found', 'Отметить «найдено»', 'Mark as found'), a.category === 'people' ? t('a.mark_found_p', 'Личные данные скроем из открытого доступа.', 'Personal data will be hidden.') : '')}
      ${chats.length ? h`<p class="small" style="font-weight:700;margin-bottom:10px">${t('a.who_helped', 'Кто помог? Ему +50 баллов', 'Who helped? They get +50 points')}</p>
        <div class="list" style="margin-bottom:16px"><label class="check"><input type="radio" name="helper" value="" checked style="border-radius:50%"> ${tr('Никто из чата', 'No one from chat')}</label>${chats.map((c) => h`<label class="check"><input type="radio" name="helper" value="${c.helper_id}" style="border-radius:50%"> ${aliasOf(c)} · ${c.msgs} ${tr('сообщ.', 'msgs')}</label>`)}</div>` : ''}
      <button class="btn btn-blue btn-block" data-ok>${icon('check')}${t('a.mark_found_ok', 'Да, найдено!', 'Yes, found!')}</button>`);
    $('[data-ok]', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      const helper = ($('input[name=helper]:checked', s.el) || {}).value;
      try { await POST(`/applications/${a.id}/status`, { status: 'found', helper_id: helper ? +helper : null }); s.close(); toast(tr('Ура! Отмечено «найдено»', 'Great! Marked as found')); go('#/a/' + a.id); } catch (er) { toastErr(er); }
    });
  });
  on('#close', async () => { if (await confirmBox(t('a.close_q', 'Закрыть заявку?', 'Close report?'), t('a.close_t', 'Пропадёт из поиска и с карты.', 'It will disappear from search and the map.'), { ok: tr('Закрыть', 'Close') })) { try { await POST(`/applications/${a.id}/status`, { status: 'closed' }); go('#/a/' + a.id); } catch (e) { toastErr(e); } } });
  on('#del', async () => { if (await confirmBox(t('a.del_q', 'Удалить заявку?', 'Delete report?'), t('a.del_t', 'Заявка и её чаты удалятся навсегда.', 'The report and its chats will be deleted for good.'), { ok: tr('Удалить', 'Delete'), danger: true })) { try { await DEL('/applications/' + a.id); toast(tr('Заявка удалена', 'Deleted')); go('#/me/apps'); } catch (e) { toastErr(e); } } });
  on('#promote', () => go('#/tariffs?promote=' + a.id));
  on('#emBtn', () => {
    const s = sheet(h`${sheetHead(t('wiz.em', 'Экстренное оповещение', 'Emergency alert'), t('a.em_t', 'Push получат волонтёры и жители рядом. Запуск — после проверки модератором.', 'Volunteers and people nearby get a push. Starts after moderator review.'))}
      <div class="row between small"><label for="rr">${t('wiz.radius', 'Радиус', 'Radius')}</label><b id="rv">3 ${tr('км', 'km')}</b></div><input class="range" type="range" min="1" max="5" step="1" value="3" id="rr">
      <div class="range-scale xs muted" aria-hidden="true"><span>1 ${tr('км', 'km')}</span><span>5 ${tr('км', 'km')}</span></div>
      <button class="btn btn-red btn-urgent btn-block" style="margin-top:18px" data-ok>${icon('siren')}${t('a.em_req', 'Запросить оповещение', 'Request alert')}</button>`);
    $('#rr', s.el).oninput = (e) => { $('#rv', s.el).textContent = e.target.value + ' ' + tr('км', 'km'); e.target.setAttribute('aria-valuetext', e.target.value + ' ' + tr('км', 'km')); };
    $('[data-ok]', s.el).onclick = (e) => busy(e.currentTarget, async () => { try { await POST(`/applications/${a.id}/emergency`, { radius: +$('#rr', s.el).value }); s.close(); toast(tr('Запрос отправлен модератору', 'Sent to moderators')); go('#/a/' + a.id); } catch (er) { toastErr(er); } });
  });
}, {});

// Главная кнопка зависит от того, кого или что ищут: о человеке не пишем «это моё»
function writeLabel(a) {
  const L = {
    lost: {
      people: ['a.w_lost_people', 'Я видел этого человека', 'I have seen this person'],
      animals: ['a.w_lost_animals', 'Я видел или нашёл питомца', 'I have seen or found this pet'],
      things: ['a.w_lost_things', 'Я нашёл эту вещь', 'I found this item']
    },
    found: {
      people: ['a.w_found_people', 'Я знаю этого человека', 'I know this person'],
      animals: ['a.w_found_animals', 'Это мой питомец', 'This is my pet'],
      things: ['a.w_found_things', 'Это моя вещь', 'This item is mine']
    }
  }[a.kind][a.category];
  return t(...L);
}
function visitorPanel(a) {
  const active = a.status === 'published';
  return h`<div class="card pad stack">
    ${active ? h`<button class="btn btn-red btn-lg btn-block" id="write">${icon('chat')}${a.chat_id ? t('a.open_chat', 'Открыть чат', 'Open chat') : writeLabel(a)}</button>
      <p class="xs muted center">${icon('lock', 'ic-sm')} ${t('a.anon', 'Чат анонимный — контакты скрыты', 'Anonymous chat — contacts stay hidden')}</p>` : h`<div class="status-line">${icon(a.status === 'found' ? 'check' : 'lock')}${statusName(a.status)}</div>`}
    <div class="actions-row">
      <button class="btn btn-soft" id="share">${icon('share')}<span>${tr('Поделиться', 'Share')}</span></button>
      <button class="btn btn-soft ${a.saved ? 'btn-red' : ''}" id="save">${icon('bookmark')}<span>${a.saved ? tr('Сохранено', 'Saved') : tr('Сохранить', 'Save')}</span></button>
      <button class="btn btn-soft" id="complain">${icon('flag')}<span>${tr('Жалоба', 'Report')}</span></button>
    </div>
    <div class="note note-amber small">${icon('alert')}<div>${t('a.fraud', 'Не платите заранее и встречайтесь в людных местах.', 'Don’t pay in advance; meet in public places.')}</div></div>
  </div>`;
}
// Радиус SOS: для активного оповещения он публичный, для запроса на проверке — виден только автору
const emRad = (a) => (['pending', 'active'].includes(a.emergency_status) ? a.emergency_radius || a.emergency : null);
function ownerPanel(a) {
  const active = a.status === 'published' || a.status === 'pending';
  const sos = a.kind === 'lost' && a.category !== 'things' && active && !['pending', 'active'].includes(a.emergency_status);
  const em = { pending: tr('SOS-оповещение на проверке', 'SOS alert under review'), active: tr('SOS-оповещение активно', 'SOS alert is active'), rejected: tr('SOS-оповещение отклонено', 'SOS alert rejected'), done: tr('SOS-оповещение завершено', 'SOS alert finished') }[a.emergency_status];
  const tiles = [
    a.status !== 'closed' && a.status !== 'found' ? h`<button class="btn btn-soft" id="edit">${icon('edit')}<span>${tr('Изменить', 'Edit')}</span></button>` : '',
    h`<button class="btn btn-soft" id="share">${icon('share')}<span>${tr('Поделиться', 'Share')}</span></button>`,
    a.status === 'published' ? h`<button class="btn btn-soft" id="promote">${icon('zap')}<span>${tr('Продвинуть', 'Boost')}</span></button>` : '',
    sos ? h`<button class="btn btn-soft" id="emBtn" style="color:var(--red)">${icon('siren')}<span>SOS</span></button>` : ''
  ].filter(Boolean);
  return h`<div class="card pad stack">
    <div class="status-line">${icon('user')}${t('a.yours', 'Ваша заявка', 'Your report')}${a.family_shared ? h`<span class="muted" style="font-weight:600">· ${tr('семейная', 'family')}</span>` : ''}<span class="chip ${statusChip(a.status)}" style="margin-left:auto">${statusName(a.status)}</span></div>
    ${em ? h`<div class="note ${a.emergency_status === 'active' ? 'note-red' : 'note-amber'} small" id="emNote">${icon('siren')}<div><b>${em}</b>${emRad(a) ? h`<span class="em-rad">${tr('Радиус', 'Radius')} ${emRad(a)} ${tr('км', 'km')}</span>` : ''}${a.emergency_status === 'pending' ? h`<span class="xs muted" style="display:block;margin-top:2px">${tr('После одобрения уведомим людей в этом радиусе', 'People within it are notified after approval')}</span>` : ''}</div></div>` : ''}
    ${a.status === 'published' ? h`<button class="btn btn-blue btn-lg btn-block" id="found">${icon('check')}${t('a.mark_found', 'Отметить «найдено»', 'Mark as found')}</button>` : ''}
    <div class="actions-row" style="--n:${tiles.length}">${tiles}</div>
    ${a.chats && a.chats.length ? h`<div><p class="small" style="font-weight:700;margin:6px 0 8px">${t('a.chats', 'Отклики', 'Responses')} · ${a.chats.length}</p><div class="list">${a.chats.map((c) => h`<a href="#/chat/${c.id}">${icon('chat')}<span class="grow">${aliasOf(c)}</span><span class="xs muted">${c.msgs}</span>${icon('chevR')}</a>`)}</div></div>` : ''}
    ${a.contact ? h`<p class="xs muted owner-contact">${icon('lock', 'ic-sm')}<span>${t('a.contact_hidden', 'Контакт виден только вам', 'Only you see your contact')}: <b>${a.contact}</b></span></p>` : ''}
    <div class="owner-danger">${active ? h`<button type="button" class="link" id="close">${icon('lock', 'ic-sm')}${tr('Закрыть заявку', 'Close report')}</button>` : ''}<button type="button" class="link" id="del">${icon('trash', 'ic-sm')}${tr('Удалить', 'Delete')}</button></div>
  </div>`;
}
export function complain(type, id) {
  const reasons = dict('complaint_reason');
  const s = sheet(h`${sheetHead(t('c.title', 'Пожаловаться', 'Report'), t('c.sub', 'Жалобу проверит модератор.', 'A moderator will review it.'))}
    <div class="stack"><div class="list">${reasons.map((r, i) => h`<label class="check"><input type="radio" name="r" value="${r}" style="border-radius:50%"> ${r}</label>`)}</div><p class="ferr hide" id="cErr" role="alert">${tr('Выберите причину жалобы', 'Choose a reason')}</p>
    <label class="field"><span>${t('f.reason', 'Комментарий', 'Comment')}</span><textarea name="c" rows="2" maxlength="900"></textarea></label>
    <button class="btn btn-red btn-block" data-ok>${t('c.send', 'Отправить', 'Send')}</button></div>`);
  $$('input[name=r]', s.el).forEach((x) => { x.onchange = () => $('#cErr', s.el).classList.add('hide'); });
  $('[data-ok]', s.el).onclick = (e) => busy(e.currentTarget, async () => {
    const picked = $('input[name=r]:checked', s.el);
    if (!picked) { $('#cErr', s.el).classList.remove('hide'); $('input[name=r]', s.el).focus(); return; }
    const r = picked.value + ($('[name=c]', s.el).value.trim() ? ': ' + $('[name=c]', s.el).value.trim() : '');
    try { await POST('/complaints', { target_type: type, target_id: id, reason: r }); s.close(); toast(tr('Жалоба отправлена', 'Report sent')); } catch (er) { toastErr(er); }
  });
}

/* =================== ЧАТЫ =================== */
// Как в мессенджере: на компьютере — диалоги слева, переписка справа; на телефоне — список, затем переписка на весь экран.
const pDate = (s) => new Date(/^\d{4}-\d\d-\d\d \d/.test(s || '') ? s.replace(' ', 'T') + 'Z' : s);
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const loc = () => (state.lang === 'en' ? 'en-GB' : 'ru-RU');
function dayLabel(s) {
  const d = pDate(s), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return tr('Сегодня', 'Today');
  if (sameDay(d, y)) return tr('Вчера', 'Yesterday');
  return fmtDate(s);
}
// время в списке: сегодня — часы, на этой неделе — день недели, раньше — дата
export function listTime(s) {
  if (!s) return '';
  const d = pDate(s), now = new Date();
  if (isNaN(d)) return '';
  if (sameDay(d, now)) return timeOf(s);
  if (now - d < 6 * 86400e3) return d.toLocaleDateString(loc(), { weekday: 'short' });
  return d.toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
const isDesk = () => matchMedia('(min-width: 980px)').matches;
const TICK1 = '<svg viewBox="0 0 18 12" aria-hidden="true"><path d="M2 6.6l3.4 3.4L12.6 2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const TICK2 = '<svg viewBox="0 0 18 12" aria-hidden="true"><path d="M1.2 6.6l3.4 3.4L11.8 2.6M8.6 9.4l.6.6L16.4 2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const chatAva = (c) => h`<span class="chat-ava ${c.application.kind === 'lost' ? 'lost' : 'found'}" aria-hidden="true">${icon(CAT[c.application.category]?.icon || 'chat')}</span>`;
const lastLine = (l) => !l ? h`<span class="muted">${tr('Нет сообщений', 'No messages')}</span>`
  : h`${l.mine ? h`<span class="you">${tr('Вы: ', 'You: ')}</span>` : ''}${l.text || (l.photo ? '📷 ' + tr('Фото', 'Photo') : '📍 ' + tr('Точка на карте', 'Location'))}`;
// Enter — отправить, Shift+Enter — новая строка (на сенсорных экранах Enter переносит строку, отправка — кнопкой)
function bindComposer(form, ta, btn) {
  const sync = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; btn.disabled = !ta.value.trim(); };
  ta.addEventListener('input', sync);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); if (ta.value.trim()) form.requestSubmit(); } });
  sync();
  return sync;
}

async function chatShell(view, activeId) {
  mount(view, h`<div class="chat-shell ${activeId ? 'has-chat' : ''}">
    <aside class="chat-side" aria-label="${tr('Диалоги', 'Conversations')}">
      <div class="chat-side-head"><h1>${t('chats.title', 'Сообщения', 'Messages')}</h1><p>${t('chats.sub', 'Анонимная переписка по заявкам. Контакты не раскрываются.', 'Anonymous conversations. Contacts stay private.')}</p></div>
      <div class="chat-list" id="cl"><div class="spinner"></div></div>
      <a class="chat-support" href="#/support">${icon('help')}<span><b>${tr('Поддержка', 'Support')}</b><small>${tr('Вопрос по работе сайта — ответим здесь', 'A question about the site — we reply here')}</small></span>${icon('chevR', 'ic-sm')}</a>
    </aside>
    <section class="chat-main" id="cm">${activeId ? h`<div class="spinner" style="margin:auto"></div>` : h`<div class="chat-pick">${icon('chat')}<b>${tr('Выберите диалог', 'Choose a conversation')}</b><span>${tr('Переписка откроется здесь', 'It will open here')}</span></div>`}</section>
  </div>`);
  const listEl = $('#cl', view);
  const loadList = async () => {
    const { items } = await GET('/chats');
    if (!listEl.isConnected) return;
    mount(listEl, items.length ? h`${items.map((c) => h`<a class="chat-item ${c.id === activeId ? 'on' : ''} ${c.unread ? 'unread' : ''}" href="#/chat/${c.id}" ${c.id === activeId ? raw('aria-current="page"') : ''}>
      ${chatAva(c)}
      <span class="ci-body"><span class="ci-top"><b>${aliasOf(c)}</b><time>${listTime(c.last ? c.last.created_at : c.created_at)}</time></span>
      <span class="ci-app">${c.application.title}</span>
      <span class="ci-last"><span class="ci-text">${lastLine(c.last)}</span>${c.blocked ? icon('ban', 'ic-sm') : c.unread ? h`<span class="unread-dot" aria-label="${tr('Непрочитанных', 'Unread')}: ${c.unread}">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}</span></span></a>`)}`
      : empty('chat', t('chats.empty', 'Пока нет переписок', 'No conversations yet'), t('chats.empty_t', 'Откройте заявку и нажмите «написать», чтобы связаться анонимно.', 'Open a report and tap “message” to contact anonymously.'), h`<a class="btn btn-sm" href="#/map">${t('home.all', 'Карта и поиск', 'Map & search')}</a>`));
  };
  // на телефоне открытая переписка занимает весь экран — список не нужен
  const listShown = () => !activeId || isDesk();
  if (listShown()) await loadList();
  onLeave(onEvent((type) => { if ((type === 'message' || type === 'chat_read') && listShown()) loadList().catch(() => {}); }));
  if (activeId) await chatPane($('#cm', view), activeId, () => { if (isDesk()) loadList().catch(() => {}); });
}
route('/chats', (view) => chatShell(view, null), { auth: true });
route('/chat/:id', (view, p) => chatShell(view, Number(p.id)), { auth: true, full: true });

async function chatPane(el, id, onChange) {
  const { chat, messages } = await GET('/chats/' + id);
  refreshMe().catch(() => {});
  const mod = chat.side === 'moderator';
  mount(el, h`<div class="chat-page">
    <div class="chat-head">
      <a class="icon-btn chat-back" href="#/chats" aria-label="${tr('К списку диалогов', 'Back to conversations')}">${icon('chevL')}</a>
      ${chatAva(chat)}
      <a class="chat-title" href="#/a/${chat.application.id}" title="${tr('Открыть заявку', 'Open report')}"><b>${aliasOf(chat)}</b><span>${chat.application.title}</span></a>
      ${mod ? '' : h`<button type="button" class="icon-btn" id="menu" aria-label="${tr('Действия с перепиской', 'Conversation actions')}" aria-haspopup="dialog">${icon('more')}</button>`}
    </div>
    <div class="msgs" id="msgs" tabindex="0" role="log" aria-live="polite" aria-label="${t('chat.msgs', 'Сообщения', 'Messages')}">
      <div class="chat-warn">${icon('shield', 'ic-sm')}<span>${t('chat.fraud', 'Не платите заранее и не называйте коды из SMS. Встречайтесь в людных местах. Модераторы не просят денег в чате.', 'Don’t pay in advance or share SMS codes. Meet in public places. Moderators never ask for money in chat.')}</span></div>
    </div>
    <button type="button" class="msgs-down hide" id="down" aria-label="${tr('К новым сообщениям', 'To new messages')}">${icon('chevR')}</button>
    ${mod ? h`<div class="composer composer-note">${icon('shield', 'ic-sm')}${tr('Вы видите переписку как модератор — писать в неё нельзя', 'You are viewing as a moderator — you cannot write here')}</div>`
    : chat.blocked ? h`<div class="composer composer-note">${icon('ban', 'ic-sm')}${chat.blocked_by_me ? t('chat.blocked_me', 'Вы заблокировали собеседника', 'You blocked this user') : t('chat.blocked', 'Переписка заблокирована', 'Conversation blocked')}</div>`
    : h`<form class="composer" id="cf">
      <div class="composer-box">
        <label class="icon-btn cb-btn" tabindex="0" role="button" title="${tr('Отправить фото', 'Send a photo')}" aria-label="${tr('Отправить фото', 'Send a photo')}">${icon('image')}<input type="file" accept="image/*" hidden id="cph"></label>
        <textarea id="ct" rows="1" placeholder="${t('chat.ph', 'Сообщение', 'Message')}" maxlength="2000" aria-label="${t('chat.ph', 'Сообщение', 'Message')}"></textarea>
        <button type="button" class="icon-btn cb-btn" id="cloc" title="${tr('Точка на карте', 'Location')}" aria-label="${tr('Отправить точку на карте', 'Send a location')}">${icon('pin')}</button>
      </div>
      <button class="send" id="csend" aria-label="${tr('Отправить', 'Send')}" disabled>${icon('send')}</button>
    </form>`}
  </div>`);
  const box = $('#msgs', el), down = $('#down', el);
  const nearBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const toBottom = (smooth) => { box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); down.classList.add('hide'); };
  box.addEventListener('scroll', () => { if (nearBottom()) down.classList.add('hide'); }, { passive: true });
  down.onclick = () => toBottom(true);
  // собеседник прочитал всё до этого номера (событие «прочитано» может обогнать ответ на нашу отправку)
  let readUpTo = 0;
  const tick = (m) => {
    if (!m.mine || mod) return '';
    const rd = !m.pending && (m.read || (m.id && m.id <= readUpTo));
    return h`<span class="tick ${rd ? 'read' : ''}" title="${m.pending ? tr('Отправляется', 'Sending') : rd ? tr('Прочитано', 'Read') : tr('Доставлено', 'Delivered')}">${m.pending ? icon('clock') : raw(rd ? TICK2 : TICK1)}</span>`;
  };
  const bubble = (m, cont) => h`<div class="msg ${m.mine ? 'mine' : ''} ${cont ? 'cont' : ''} ${m.pending ? 'pending' : ''} ${m.photo && !m.text ? 'photo-only' : ''}">${m.photo ? h`<img src="${m.photo}" alt="${tr('Фото', 'Photo')}" data-zoom="${m.photo}">` : ''}${m.lat != null ? h`<a class="loc" href="#" data-lat="${m.lat}" data-lng="${m.lng}">${icon('pin')}<span>${tr('Точка на карте', 'Location on map')}</span></a>` : ''}${m.text ? h`<span class="msg-text">${m.text}</span>` : ''}<span class="msg-meta"><time>${timeOf(m.created_at)}</time>${tick(m)}</span></div>`;
  let lastDay = '', lastMsg = null;
  const bindMsg = (x) => {
    $$('[data-zoom]', x).forEach((i) => { i.onclick = () => lightbox(i.dataset.zoom); i.addEventListener('load', () => { if (box.scrollHeight - box.scrollTop - box.clientHeight < 420) toBottom(); }); });
    $$('[data-lat]', x).forEach((a) => a.onclick = (e) => { e.preventDefault(); const s = sheet(h`${sheetHead(tr('Точка на карте', 'Location'))}<div class="mini-map" style="height:340px" id="lm"></div>`); const mm = makeMap($('#lm', s.el), { center: [+a.dataset.lat, +a.dataset.lng], zoom: 16 }); mm.lib.marker([+a.dataset.lat, +a.dataset.lng], { icon: pinIcon({ kind: 'found', category: 'things' }), interactive: false, keyboard: false }).addTo(mm); });
  };
  const append = (m, force) => {
    $('.chat-empty', box)?.remove();
    const near = nearBottom();
    const d = dayLabel(m.created_at); let out = '';
    if (d !== lastDay) { out += h`<div class="msg-day"><span>${d}</span></div>`.s; lastDay = d; lastMsg = null; }
    const cont = !!lastMsg && lastMsg.mine === m.mine && Math.abs(pDate(m.created_at) - pDate(lastMsg.created_at)) < 5 * 60e3;
    box.insertAdjacentHTML('beforeend', out + bubble(m, cont).s);
    lastMsg = m;
    const x = box.lastElementChild; bindMsg(x);
    if (force || near || m.mine) toBottom(!force); else down.classList.remove('hide');
    return x;
  };
  if (!messages.length) box.insertAdjacentHTML('beforeend', h`<div class="chat-empty">${icon('lock')}<b>${t('chat.start', 'Начните переписку', 'Start the conversation')}</b><span>${t('chat.start_t', 'Спросите о деталях, которые знает только владелец. Контакты скрыты.', 'Ask about details only the owner would know. Contacts stay hidden.')}</span></div>`.s);
  messages.forEach((m) => append(m, true));
  requestAnimationFrame(() => toBottom());
  const post = async (payload, tmp) => {
    try {
      const r = await POST(`/chats/${chat.id}/messages`, payload);
      if (tmp && tmp.isConnected) { const cont = tmp.classList.contains('cont'); tmp.insertAdjacentHTML('afterend', bubble(r.message, cont).s); const x = tmp.nextElementSibling; tmp.remove(); bindMsg(x); lastMsg = r.message; }
      else append(r.message);
      onChange();
      return true;
    } catch (e) { tmp?.remove(); toastErr(e); return false; }
  };
  const form = $('#cf', el);
  if (form) {
    const ta = $('#ct', el), btn = $('#csend', el);
    const sync = bindComposer(form, ta, btn);
    form.onsubmit = async (e) => {
      e.preventDefault(); const text = ta.value.trim(); if (!text) return;
      ta.value = ''; sync(); if (matchMedia('(pointer: fine)').matches) ta.focus();
      const tmp = append({ mine: true, pending: true, text, created_at: new Date().toISOString() });
      if (!(await post({ text }, tmp)) && !ta.value) { ta.value = text; sync(); }
    };
    const photoBtn = $('label.cb-btn', el);
    photoBtn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#cph', el).click(); } };
    $('#cph', el).onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const tmp = append({ mine: true, pending: true, text: tr('Загружаем фото…', 'Uploading photo…'), created_at: new Date().toISOString() });
      try { const url = await upload(f); await post({ photo: url }, tmp); } catch (er) { tmp.remove(); toastErr(er); }
    };
    $('#cloc', el).onclick = () => {
      let pt = null;
      const s = sheet(h`${sheetHead(t('chat.loc', 'Отправить точку на карте', 'Send a location'), t('chat.loc_t', 'Например, место встречи или где замечена находка.', 'E.g. a meeting point or where the item was seen.'))}<div class="picker" id="lp"></div><button class="btn btn-block" style="margin-top:14px" data-ok>${icon('send')}${tr('Отправить', 'Send')}</button>`);
      const pk = mapPicker($('#lp', s.el), null, (v) => { pt = v; }, { full: false });
      $('[data-ok]', s.el).onclick = () => { if (!pt) return toast(tr('Отметьте точку', 'Pick a point'), 'err'); s.close(); pk.map.remove(); post(pt); };
    };
  }
  const menu = $('#menu', el);
  if (menu) menu.onclick = () => {
    const s = sheet(h`${sheetHead(aliasOf(chat), chat.application.title)}<div class="list">
      <a href="#/a/${chat.application.id}">${icon('file')}<span class="grow">${tr('Открыть заявку', 'Open report')}</span>${icon('chevR')}</a>
      <a href="#" data-c>${icon('flag')}<span class="grow">${t('c.title', 'Пожаловаться', 'Report')}</span>${icon('chevR')}</a>
      ${!chat.blocked ? h`<a href="#" data-b style="color:var(--red)">${icon('ban')}<span class="grow">${t('chat.block', 'Заблокировать собеседника', 'Block user')}</span></a>` : chat.blocked_by_me ? h`<a href="#" data-u>${icon('refresh')}<span class="grow">${t('chat.unblock', 'Разблокировать', 'Unblock')}</span></a>` : ''}
    </div>`);
    $$('a[href^="#/"]', s.el).forEach((a) => a.addEventListener('click', () => s.close()));
    const on = (sel, fn) => { const x = $(sel, s.el); if (x) x.onclick = (e) => { e.preventDefault(); s.close(); fn(); }; };
    on('[data-c]', () => complain('chat', chat.id));
    on('[data-b]', async () => { if (await confirmBox(t('chat.block', 'Заблокировать собеседника', 'Block user'), t('chat.block_t', 'Он не сможет писать вам в этом чате.', 'They will not be able to message you here.'), { danger: true, ok: tr('Заблокировать', 'Block') })) { await POST(`/chats/${chat.id}/block`, { block: true }); go(location.hash); } });
    on('[data-u]', async () => { await POST(`/chats/${chat.id}/block`, { block: false }); go(location.hash); });
  };
  onLeave(onEvent((type, d) => {
    if (type === 'message' && d.chat_id === chat.id) {
      append(d);
      if (!d.mine) GET('/chats/' + chat.id).then(() => { refreshMe().catch(() => {}); onChange(); }).catch(() => {});
    }
    // собеседник прочитал — галочки становятся двойными
    if (type === 'chat_read' && d.chat_id === chat.id) {
      readUpTo = Math.max(readUpTo, Number(d.upto) || Number.MAX_SAFE_INTEGER);
      $$('.msg.mine:not(.pending) .tick:not(.read)', box).forEach((x) => { x.classList.add('read'); x.title = tr('Прочитано', 'Read'); x.innerHTML = TICK2; });
    }
  }));
}

/* =================== УВЕДОМЛЕНИЯ =================== */
const NIC = { match: 'match', emergency: 'siren', chat: 'chat', moderation: 'shield', status: 'check', points: 'award', payment: 'card', family: 'users', support: 'help', role: 'handshake', registry: 'gem' };
route('/notifications', async (view) => {
  const { items } = await GET('/notifications');
  mount(view, h`<div class="wrap" style="max-width:760px"><div class="page-head"><h1>${t('n.title', 'Уведомления', 'Notifications')}</h1></div>
    ${items.length ? h`<div class="list">${items.map((n) => h`<a href="${n.link || '#/'}" style="${n.read ? '' : 'background:var(--surface-2)'}"><div class="t-ic" style="width:40px;height:40px;border-radius:13px;display:grid;place-items:center;flex:none;background:${n.type === 'emergency' ? 'var(--red)' : n.type === 'match' ? 'var(--blue)' : 'var(--bg-2)'};color:${['emergency', 'match'].includes(n.type) ? '#fff' : 'inherit'}">${icon(NIC[n.type] || 'bell')}</div>
      <div class="grow" style="min-width:0"><b style="display:block">${n.title}</b><div class="small muted">${n.body}</div><div class="xs muted" style="margin-top:3px">${ago(n.created_at)}</div></div>${n.read ? '' : h`<span style="width:9px;height:9px;border-radius:50%;background:var(--red);flex:none"></span>`}</a>`)}</div>`
      : empty('bell', t('n.empty', 'Уведомлений пока нет', 'No notifications yet'))}</div>`);
  if (items.some((n) => !n.read)) { await POST('/notifications/read'); refreshMe(); }
}, { auth: true });

/* =================== ЛИЧНЫЙ КАБИНЕТ =================== */
// Разделы кабинета по группам. «Сообщения», «Уведомления» и «Поддержка» живут по своим адресам, но открываются в той же рамке:
// на компьютере слева всегда колонка разделов, на телефоне над разделом — «‹ Кабинет» и «Разделы», из любого экрана один шаг назад.
const ME_GROUPS = () => {
  const u = state.user || {};
  return [
    ['', [['/me', 'dash', t('me.overview', 'Обзор', 'Overview')], ['/me/apps', 'file', t('me.apps', 'Мои заявки', 'My reports')], ['/me/saved', 'bookmark', t('me.saved', 'Сохранённые', 'Saved')]]],
    [tr('Общение', 'Messages'), [['/chats', 'chat', t('chats.title', 'Сообщения', 'Messages'), u.unreadChats], ['/notifications', 'bell', t('n.title', 'Уведомления', 'Notifications'), u.unread], ['/support', 'help', t('sup.title', 'Поддержка', 'Support')]]],
    [tr('Безопасность', 'Safety'), [['/me/zone', 'zone', t('me.zone', 'Зона оповещений', 'Alert zone')], ['/me/family', 'users', t('me.family', 'Семья', 'Family')], ['/me/registry', 'gem', t('me.registry', 'Реестр ценностей', 'Valuables')]]],
    [tr('Аккаунт', 'Account'), [['/me/profile', 'idcard', t('me.profile', 'Профиль', 'Profile')], ['/me/rewards', 'award', t('me.rewards', 'Баллы и статус', 'Points & status')], ['/me/payments', 'card', t('me.payments', 'Платежи', 'Payments')], ['/me/settings', 'settings', t('me.settings', 'Настройки', 'Settings')]]]
  ];
};
const ME_PATHS = /^\/(me(\/[^/]+)?|chats|notifications|support(\/[^/]+)?)$/;
const meActive = (path, href) => path === href || (href !== '/me' && path.startsWith(href + '/'));
const cntBadge = (n) => (n ? h`<span class="cnt">${n > 99 ? '99+' : n}</span>` : '');
const meNavHtml = (path) => h`${ME_GROUPS().map(([title, items]) => h`<div class="acc-grp">${title ? h`<div class="acc-grp-t">${title}</div>` : ''}
  ${items.map(([href, ic, label, n]) => { const on = meActive(path, href); return h`<a href="#${href}" class="${on ? 'on' : ''}" ${on ? raw('aria-current="page"') : ''}>${icon(ic)}<span class="grow">${label}</span>${cntBadge(n)}</a>`; })}</div>`)}`;
setShell((view, path) => {
  if (!ME_PATHS.test(path) || !state.user) return null;
  const u = state.user;
  mount(view, h`<div class="wrap acc-wrap"><div class="me-layout">
    <aside class="me-nav">
      <a class="acc-me" href="#/me/profile">${avatar(u, 'ava-sm')}<span class="grow"><b>${u.name}</b><small>${levelName(u.level)} · ${u.points} ${tr(plural(u.points, 'балл', 'балла', 'баллов'), u.points === 1 ? 'point' : 'points')}</small></span></a>
      <nav aria-label="${tr('Разделы кабинета', 'Account sections')}">${meNavHtml(path)}</nav>
      ${['moderator', 'admin'].includes(u.role) ? h`<a class="acc-admin" href="#/admin">${icon('shield')}<span class="grow">${tr('Панель администратора', 'Admin panel')}</span>${icon('chevR', 'ic-sm')}</a>` : ''}
    </aside>
    <div class="me-main">
      ${path === '/me' ? '' : h`<div class="acc-bar">
        <a class="acc-back" href="#/me">${icon('chevL', 'ic-sm')}<span>${tr('Кабинет', 'Account')}</span></a>
        <button type="button" class="acc-all" id="accAll" aria-haspopup="dialog">${icon('list', 'ic-sm')}<span>${tr('Разделы', 'Sections')}</span>${cntBadge((u.unreadChats || 0) + (u.unread || 0))}</button></div>`}
      <div id="tab" class="acc-body"></div>
    </div></div></div>`);
  const all = $('#accAll', view);
  if (all) all.onclick = () => {
    const sh = sheet(h`${sheetHead(tr('Личный кабинет', 'My account'))}<nav class="acc-sheet" aria-label="${tr('Разделы кабинета', 'Account sections')}">${meNavHtml(path)}</nav>`);
    $$('a', sh.el).forEach((a) => a.addEventListener('click', () => sh.close()));
  };
  return $('#tab', view);
});
route('/me', (view) => meView(view, ''), { auth: true });
route('/me/:tab', (view, p) => meView(view, p.tab), { auth: true });
async function meView(el, tab) {
  await refreshMe();
  const fn = { '': meOverview, apps: meApps, saved: meSaved, profile: meProfile, zone: meZone, family: meFamily, registry: meRegistry, payments: mePayments, rewards: meRewards, settings: meSettings }[tab];
  if (!fn) throw Object.assign(new Error(tr('Раздел не найден', 'Section not found')), { status: 404 });
  await fn(el, state.user);
  observeReveal(el);
}
function levelProgress(u) {
  const lv = state.config.levels; const i = lv.findIndex((l) => l.code === u.level.code); const next = lv[i + 1];
  return { next, pct: next ? Math.round(((u.points - u.level.min) / (next.min - u.level.min)) * 100) : 100 };
}
const ROLE = (r) => ({ user: t('role.user', 'Пользователь', 'User'), volunteer: t('role.volunteer', 'Волонтёр', 'Volunteer'), partner: t('role.partner', 'Партнёр', 'Partner'), moderator: t('role.moderator', 'Модератор', 'Moderator'), admin: t('role.admin', 'Администратор', 'Administrator') }[r] || r);
async function meOverview(el, u) {
  const lp = levelProgress(u);
  const none = { items: [] };
  const [apps, chats, saved, vals, notes] = await Promise.all([GET('/my/applications'), GET('/chats'), GET('/my/saved').catch(() => none), GET('/valuables').catch(() => none), GET('/notifications').catch(() => none)]);
  const count = (n, one, few, many, en1, en) => `${n} ${tr(plural(n, one, few, many), n === 1 ? en1 : en)}`;
  const sub = {
    '/me/apps': apps.items.length ? count(apps.items.length, 'заявка', 'заявки', 'заявок', 'report', 'reports') : tr('пока нет', 'none yet'),
    '/me/saved': saved.items.length ? count(saved.items.length, 'заявка', 'заявки', 'заявок', 'report', 'reports') : tr('пока нет', 'none yet'),
    '/chats': u.unreadChats ? count(u.unreadChats, 'новое', 'новых', 'новых', 'new', 'new') : count(chats.items.length, 'диалог', 'диалога', 'диалогов', 'chat', 'chats'),
    '/notifications': u.unread ? count(u.unread, 'новое', 'новых', 'новых', 'new', 'new') : tr('всё прочитано', 'all read'),
    '/support': tr('ответим в чате', 'chat with us'),
    '/me/zone': u.zone.enabled ? `${tr('включена', 'on')} · ${u.zone.radius} ${tr('км', 'km')}` : tr('выключена', 'off'),
    '/me/family': u.family_id ? tr('подключена', 'on') : tr('не подключена', 'not set up'),
    '/me/registry': count(vals.items.length, 'предмет', 'предмета', 'предметов', 'item', 'items'),
    '/me/profile': u.email || u.phone || '',
    '/me/rewards': `${levelName(u.level)} · ${u.points}`,
    '/me/payments': tr('чеки и подписки', 'receipts and plans'),
    '/me/settings': tr('язык, уведомления, выход', 'language, notifications, sign out')
  };
  const rows = h`<div class="acc-rows">${ME_GROUPS().map(([title, items]) => { const list = items.filter(([href]) => href !== '/me'); return h`<section class="acc-rgrp">${title ? h`<h3>${title}</h3>` : ''}
    <div class="acc-rlist">${list.map(([href, ic, label, n]) => h`<a href="#${href}"><span class="acc-ric">${icon(ic)}</span><span class="grow"><b>${label}</b>${sub[href] ? h`<small>${sub[href]}</small>` : ''}</span>${cntBadge(n)}${icon('chevR', 'ic-sm acc-chev')}</a>`)}</div></section>`; })}</div>`;
  mount(el, h`<div class="profile-card rise">${avatar(u)}<div class="grow" style="min-width:0">
      <h2 style="font-size:22px">${u.name}</h2>
      <div class="row-wrap" style="margin-top:8px"><span class="lvl">${icon('award', 'ic-sm')}${levelName(u.level)} · ${u.points}</span><span class="lvl">${ROLE(u.role)}${u.org_name ? ' · ' + u.org_name : ''}</span></div>
      <div class="lvl-bar"><i style="width:${lp.pct}%"></i></div>
      <div class="xs" style="opacity:.6;margin-top:6px">${lp.next ? `${tr(`До статуса «${levelName(lp.next)}»`, `To “${levelName(lp.next)}”`)}: ${lp.next.min - u.points} ${tr(plural(lp.next.min - u.points, 'балл', 'балла', 'баллов'), lp.next.min - u.points === 1 ? 'point' : 'points')}` : tr('Максимальный статус', 'Top status')}</div></div></div>
    ${['moderator', 'admin'].includes(u.role) ? h`<a class="em-strip" style="margin-top:14px;background:linear-gradient(110deg,#0e0f13,#2a2c33)" href="#/admin">${icon('shield')}<div class="grow"><b>${tr('Панель администратора', 'Admin panel')}</b></div>${icon('chevR')}</a>` : ''}
    ${rows}
    <div class="tiles acc-tiles" style="margin-top:16px">
      ${[['#/me/apps', 'file', t('me.apps', 'Мои заявки', 'My reports'), apps.items.length, apps.items.filter((a) => a.match_count).length],
        ['#/chats', 'chat', t('chats.title', 'Сообщения', 'Messages'), chats.items.length, u.unreadChats],
        ['#/me/saved', 'bookmark', t('me.saved', 'Сохранённые', 'Saved'), saved.items.length, 0],
        ['#/me/zone', 'zone', t('me.zone', 'Зона оповещений', 'Alert zone'), u.zone.enabled ? `${u.zone.radius} ${tr('км', 'km')}` : tr('выкл.', 'off'), 0],
        ['#/me/family', 'users', t('me.family', 'Семья', 'Family'), u.family_id ? tr('подключена', 'on') : tr('не подключена', 'not set up'), 0],
        ['#/me/registry', 'gem', t('me.registry', 'Реестр ценностей', 'Valuables'), `${vals.items.length} ${tr(plural(vals.items.length, 'предмет', 'предмета', 'предметов'), vals.items.length === 1 ? 'item' : 'items')}`, 0],
        ['#/me/rewards', 'award', t('me.rewards', 'Баллы и статус', 'Points & status'), u.points, 0],
        ['#/support', 'help', t('sup.title', 'Поддержка', 'Support'), tr('ответим в чате', 'chat with us'), 0]]
        .map(([href, ic, l, sub, badge], i) => h`<a class="tile reveal" style="--i:${i}" href="${href}"><div class="t-ic">${icon(ic)}</div><b>${l}</b>${sub !== '' ? h`<small>${sub}</small>` : ''}${badge ? h`<span class="dotbadge">${badge}</span>` : ''}</a>`)}
    </div>
    ${u.role === 'user' ? h`<a class="card pad row reveal" style="margin-top:16px" href="#/community">${icon('handshake')}<div class="grow"><b>${t('me.become', 'Станьте волонтёром или партнёром', 'Become a volunteer or partner')}</b><div class="small muted">${t('me.become_t', 'Получайте экстренные оповещения и баллы за помощь', 'Get emergency alerts and points for helping')}</div></div>${icon('chevR')}</a>` : ''}
    ${notes.items.length ? h`<div class="sec-head" style="margin-top:26px"><h3>${tr('Последние события', 'Recent activity')}</h3><a class="link small" href="#/notifications">${tr('Все', 'All')}</a></div>
      <div class="list reveal">${notes.items.slice(0, 4).map((n) => h`<a href="${n.link || '#/notifications'}"><div class="t-ic feed-ic n-${n.type}">${icon(NIC[n.type] || 'bell', '', 'duo')}</div>
        <div class="grow" style="min-width:0"><b style="display:block">${n.title}</b><div class="small muted ellipsis">${n.body}</div></div><span class="xs muted" style="flex:none">${ago(n.created_at)}</span></a>`)}</div>` : ''}
    <div class="row" style="margin-top:16px"><a class="btn btn-lost grow" href="#/new/lost">${icon('plus')}${t('home.lost', 'Я потерял', 'I lost')}</a><a class="btn btn-found grow" href="#/new/found">${icon('plus')}${t('home.found', 'Я нашёл', 'I found')}</a></div>`);
  meNudge(el); // одна подсказка: установить приложение или включить уведомления
}
async function meApps(el) {
  const { items } = await GET('/my/applications');
  mount(el, h`<div class="sec-head"><h2>${t('me.apps', 'Мои заявки', 'My reports')}</h2><a class="btn btn-sm" href="#/new/lost">${icon('plus')}${tr('Новая', 'New')}</a></div>
    ${items.length ? h`<div class="apps-list">${items.map((a) => appRow(a, a.match_count ? h`<span class="chip chip-found">${icon('match')}${a.match_count}</span>` : icon('chevR')))}</div>`
      : empty('file', t('me.apps_empty', 'У вас пока нет заявок', 'You have no reports yet'), t('me.apps_empty_t', 'Добавьте заранее карточки близких — при беде останется одно нажатие.', 'Add your loved ones in advance — in trouble it will take one tap.'), h`<a class="btn btn-sm" href="#/new/lost">${t('home.lost', 'Я потерял', 'I lost')}</a>`)}`);
}
async function meSaved(el) {
  const { items } = await GET('/my/saved');
  mount(el, h`<div class="sec-head"><h2>${t('me.saved', 'Сохранённые', 'Saved')}</h2></div>${items.length ? h`<div class="apps">${items.map((a, i) => appCard(a, i))}</div>` : empty('bookmark', t('me.saved_empty', 'Здесь появятся сохранённые заявки', 'Saved reports will appear here'))}`);
}
/* ---------- Профиль ---------- */
const CITIES = ['Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань', 'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону', 'Уфа', 'Красноярск', 'Воронеж', 'Пермь', 'Волгоград', 'Краснодар', 'Тюмень', 'Сочи', 'Калининград', 'Владивосток'];
// Имя так, как его видят другие (рейтинг, чаты): «Анна С.»
const publicName = (name) => { const p = String(name || '').trim().split(/\s+/); return p[0] ? p[0] + (p[1] ? ' ' + p[1][0] + '.' : '') : ''; };
const fmtPhone = (p) => { const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(p || ''); return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : p || ''; };
const fmtBirth = (s) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; };

async function meProfile(el, u) {
  const st = u.stats || { apps: 0, found: 0, helped: 0 };
  const since = u.created_at ? fmtDate(u.created_at) : '';
  const contact = (type) => {
    const v = u[type], other = u[type === 'email' ? 'phone' : 'email'];
    return h`<div class="prof-ct" data-type="${type}">
      <span class="prof-ct-ic">${icon(type === 'email' ? 'mail' : 'phone')}</span>
      <div class="grow" style="min-width:0">
        <div class="xs muted">${type === 'email' ? 'E-mail' : t('f.phone', 'Телефон', 'Phone')}${v ? h` <span class="prof-ok">${icon('check', 'ic-sm')}${tr('подтверждён', 'verified')}</span>` : ''}</div>
        <b class="ellipsis prof-ct-v ${v ? '' : 'muted'}">${v ? (type === 'phone' ? fmtPhone(v) : v) : tr('Не указан', 'Not set')}</b>
      </div>
      <div class="prof-ct-act">
        ${v && other ? h`<button type="button" class="icon-btn" data-rm="${type}" aria-label="${tr('Отвязать', 'Remove')}" title="${tr('Отвязать', 'Remove')}">${icon('trash')}</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-ch="${type}">${v ? tr('Изменить', 'Change') : h`${icon('plus', 'ic-sm')}${tr('Добавить', 'Add')}`}</button>
      </div></div>`;
  };
  mount(el, h`<div class="prof">
    <section class="prof-hero rise">
      <div class="prof-hero-top">
        <div class="prof-ava" id="avaWrap">
          <div id="avaBox">${avatar(u, 'ava-xl')}</div>
          <label class="prof-ava-btn" title="${t('me.photo', 'Изменить фото', 'Change photo')}" aria-label="${t('me.photo', 'Изменить фото', 'Change photo')}">${icon('camera')}<input type="file" accept="image/*" hidden id="avaIn"></label>
        </div>
        <div class="prof-id">
          <h2 id="heroName">${u.name}</h2>
          <div class="row-wrap" style="margin-top:8px">
            <span class="chip prof-chip">${icon('award', 'ic-sm')}${levelName(u.level)}</span>
            ${u.role !== 'user' ? h`<span class="chip prof-chip">${icon(u.role === 'partner' ? 'handshake' : 'shield', 'ic-sm')}${ROLE(u.role)}${u.org_name ? ' · ' + u.org_name : ''}</span>` : ''}
          </div>
          <div class="small muted prof-since">${[u.city, since ? tr('на платформе с ', 'member since ') + since : ''].filter(Boolean).join(' · ')}</div>
          ${u.avatar ? h`<button type="button" class="link xs" id="avaRm" style="margin-top:6px">${tr('Удалить фото', 'Remove photo')}</button>` : h`<label class="link xs" style="margin-top:6px;cursor:pointer">${tr('Добавьте фото — так вам охотнее ответят', 'Add a photo — people reply more readily')}<input type="file" accept="image/*" hidden class="avaIn2"></label>`}
        </div>
      </div>
      <div class="prof-stats">
        <a href="#/me/apps"><b data-count="${st.apps}">0</b><span>${tr(plural(st.apps, 'заявка', 'заявки', 'заявок'), st.apps === 1 ? 'report' : 'reports')}</span></a>
        <a href="#/me/apps"><b data-count="${st.found}">0</b><span>${tr('найдено', 'found')}</span></a>
        <a href="#/me/rewards"><b data-count="${u.points}">0</b><span>${tr(plural(u.points, 'балл', 'балла', 'баллов'), 'points')}</span></a>
      </div>
    </section>

    <div class="prof-layout">
      <div class="stack-lg">
        <section class="card pad reveal">
          <div class="prof-h"><h3>${tr('Личные данные', 'Personal details')}</h3><p class="small muted">${tr('Имя и город видны в ваших заявках, чатах и рейтинге.', 'Your name and city appear in your reports, chats and rating.')}</p></div>
          <form id="pf" class="stack" novalidate>
            <label class="field"><span>${t('f.name', 'Имя', 'Name')} <em>*</em></span><input name="name" value="${u.name}" required maxlength="80" autocomplete="name" enterkeyhint="done">
              <div class="hint">${tr('Другие увидят: ', 'Others will see: ')}<b id="pubName">${publicName(u.name)}</b></div></label>
            <label class="field"><span>${t('wiz.city', 'Город', 'City')}</span><input name="city" value="${u.city || ''}" maxlength="80" list="cityList" autocomplete="address-level2" enterkeyhint="done" placeholder="${tr('Например, Москва', 'e.g. Moscow')}">
              <datalist id="cityList">${CITIES.map((c) => h`<option value="${c}">`)}</datalist>
              <div class="hint">${tr('По городу подбираем совпадения и заявки рядом.', 'Used to suggest matches and nearby reports.')}</div></label>
            ${u.birthdate ? h`<div class="field"><span>${t('login.birth', 'Дата рождения', 'Date of birth')}</span><div class="prof-ro">${icon('lock', 'ic-sm')}<span class="grow">${fmtBirth(u.birthdate)}</span></div><div class="hint">${tr('Указана при регистрации и подтверждает возраст 18+. Изменить — через поддержку.', 'Set at sign-up to confirm age 18+. To change it, contact support.')}</div></div>` : ''}
            <div class="prof-save" id="saveBar" aria-hidden="true">
              <span class="small grow">${tr('Есть несохранённые изменения', 'You have unsaved changes')}</span>
              <button type="button" class="btn btn-ghost btn-sm" id="pfReset">${tr('Отменить', 'Discard')}</button>
              <button class="btn btn-sm" id="pfSave">${icon('check', 'ic-sm')}${tr('Сохранить', 'Save')}</button>
            </div>
          </form>
        </section>

        <section class="card pad reveal">
          <div class="prof-h"><h3>${tr('Вход и контакты', 'Sign-in & contacts')}</h3><p class="small muted">${tr('Сюда приходят коды входа и уведомления. Другим не видны.', 'Login codes and notifications go here. Hidden from others.')}</p></div>
          <div class="prof-cts">${contact('email')}${contact('phone')}</div>
          <div class="note small" style="margin-top:14px">${icon('shield')}<div>${tr('Новый контакт подтверждается кодом — так вход в аккаунт не потеряется.', 'A new contact is confirmed with a code so you never lose access.')}</div></div>
        </section>
      </div>

      <aside class="stack-lg">
        <section class="card pad reveal prof-pub">
          <div class="xs muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">${tr('Так вас видят другие', 'How others see you')}</div>
          <div class="row" style="margin-top:12px">${avatar(u, 'ava-sm')}<div style="min-width:0"><b class="ellipsis" style="display:block" id="pubName2">${publicName(u.name)}</b><span class="xs muted">${levelName(u.level)} · ${u.points} ${tr(plural(u.points, 'балл', 'балла', 'баллов'), 'pts')}</span></div></div>
          <p class="xs muted" style="margin-top:10px">${tr('Фамилия — до инициала, контакты скрыты. Связь — через анонимный чат.', 'Surname shortened to an initial, contacts hidden. Contact via anonymous chat.')}</p>
        </section>
        <nav class="list reveal prof-links">
          <a href="#/me/zone">${icon('zone')}<span class="grow">${t('me.zone', 'Зона оповещений', 'Alert zone')}<small>${u.zone.enabled ? `${tr('включена', 'on')} · ${u.zone.radius} ${tr('км', 'km')}` : tr('выключена', 'off')}</small></span>${icon('chevR')}</a>
          <a href="#/me/settings">${icon('settings')}<span class="grow">${t('me.settings', 'Настройки', 'Settings')}<small>${tr('Уведомления и язык', 'Notifications and language')}</small></span>${icon('chevR')}</a>
          <a href="#/me/family">${icon('users')}<span class="grow">${t('me.family', 'Семья', 'Family')}<small>${u.family_id ? tr('подключена', 'connected') : tr('не подключена', 'not set up')}</small></span>${icon('chevR')}</a>
          <a href="#/legal/privacy">${icon('file')}<span class="grow">${tr('Как мы храним данные', 'How we store data')}<small>${tr('Политика конфиденциальности', 'Privacy policy')}</small></span>${icon('chevR')}</a>
          <a href="/api/me/export" download id="exp">${icon('download')}<span class="grow">${tr('Скачать мои данные', 'Download my data')}<small>${tr('Профиль, заявки, платежи · JSON', 'Profile, reports, payments · JSON')}</small></span></a>
        </nav>
      </aside>
    </div></div>`);
  countUp(el);

  const rerender = async () => { await refreshMe(); await meProfile(el, state.user); observeReveal(el); };

  /* фото сохраняется сразу — без лишней кнопки «Сохранить» */
  const setAva = async (file) => {
    if (!file) return;
    const wrap = $('#avaWrap', el); wrap.classList.add('loading');
    try { const url = await upload(file); await PATCH('/me', { avatar: url }); toast(tr('Фото обновлено', 'Photo updated')); await rerender(); }
    catch (er) { toastErr(er); wrap.classList.remove('loading'); }
  };
  $$('#avaIn, .avaIn2', el).forEach((i) => i.onchange = (e) => setAva(e.target.files[0]));
  const rm = $('#avaRm', el);
  if (rm) rm.onclick = () => busy(rm, async () => { try { await PATCH('/me', { avatar: '' }); toast(tr('Фото удалено', 'Photo removed')); await rerender(); } catch (er) { toastErr(er); } });

  /* личные данные: панель сохранения появляется только при изменениях */
  const f = $('#pf', el), bar = $('#saveBar', el);
  const init = { name: u.name || '', city: u.city || '' };
  const dirty = () => f.name.value.trim() !== init.name || f.city.value.trim() !== init.city;
  const sync = () => {
    const d = dirty(); bar.classList.toggle('on', d); bar.setAttribute('aria-hidden', String(!d));
    const pn = publicName(f.name.value) || '—'; $('#pubName', el).textContent = pn; $('#pubName2', el).textContent = pn;
    f.name.closest('.field').classList.toggle('bad', !f.name.value.trim());
  };
  f.oninput = sync;
  $('#pfReset', el).onclick = () => { f.name.value = init.name; f.city.value = init.city; sync(); };
  f.onsubmit = (e) => {
    e.preventDefault();
    if (!dirty()) return;
    if (!f.name.value.trim()) { f.name.focus(); return toast(tr('Укажите имя', 'Enter your name'), 'err'); }
    busy($('#pfSave', el), async () => {
      try { await PATCH('/me', { name: f.name.value.trim(), city: f.city.value.trim() }); toast(tr('Профиль сохранён', 'Profile saved')); await rerender(); }
      catch (er) { toastErr(er); }
    });
  };

  /* контакты: смена/добавление — через код, отвязка — если остаётся второй контакт */
  $$('[data-ch]', el).forEach((b) => b.onclick = () => contactSheet(b.dataset.ch, u, rerender));
  $$('[data-rm]', el).forEach((b) => b.onclick = async () => {
    const type = b.dataset.rm;
    const ok = await confirmBox(type === 'email' ? tr('Отвязать e-mail?', 'Remove e-mail?') : tr('Отвязать телефон?', 'Remove phone?'),
      tr(`Входить можно будет только по ${type === 'email' ? 'телефону' : 'e-mail'}.${type === 'email' ? ' Письма-уведомления перестанут приходить.' : ''}`, `You will sign in with your ${type === 'email' ? 'phone' : 'e-mail'} only.`),
      { ok: tr('Отвязать', 'Remove'), danger: true });
    if (!ok) return;
    try { await DEL('/me/contact/' + type); toast(tr('Контакт отвязан', 'Contact removed')); await rerender(); } catch (er) { toastErr(er); }
  });
}

// Двухшаговый лист: новый контакт → код подтверждения
function contactSheet(type, u, done) {
  const isMail = type === 'email', cur = u[type];
  const title = cur ? (isMail ? tr('Новый e-mail', 'New e-mail') : tr('Новый телефон', 'New phone')) : (isMail ? tr('Добавить e-mail', 'Add e-mail') : tr('Добавить телефон', 'Add phone'));
  const s = sheet(h`<div id="cs"></div>`);
  const box = $('#cs', s.el);
  let target = '', info = null, timer = null;
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  const step1 = () => {
    stop();
    mount(box, h`${sheetHead(title, cur ? tr(`Сейчас: ${isMail ? cur : fmtPhone(cur)}. После подтверждения старый ${isMail ? 'адрес' : 'номер'} перестанет работать для входа.`, `Current: ${isMail ? cur : fmtPhone(cur)}. Once confirmed, the old one stops working for sign-in.`) : tr('Пришлём код, чтобы убедиться, что контакт ваш.', 'We will send a code to make sure it is yours.'))}
      <form id="c1" class="stack" style="margin-top:6px">
        <label class="field"><span>${isMail ? 'E-mail' : t('f.phone', 'Телефон', 'Phone')}</span>
          <input name="target" required value="${target}" ${isMail ? raw('type="email" inputmode="email" autocomplete="email" placeholder="name@mail.ru"') : raw('type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00"')} autocapitalize="off" spellcheck="false" enterkeyhint="send"></label>
        <button class="btn btn-block btn-lg">${t('login.get_code', 'Получить код', 'Get code')}</button>
      </form>`);
    const inp = $('input', box); setTimeout(() => inp.focus(), 150);
    $('#c1', box).onsubmit = (e) => {
      e.preventDefault();
      const v = inp.value.trim(); if (!v) return inp.focus();
      busy(e.submitter, async () => { try { info = await POST('/me/contact/request', { target: v }); target = info.target; step2(); } catch (er) { toastErr(er); } });
    };
  };
  const step2 = () => {
    mount(box, h`${sheetHead(t('login.code', 'Введите код', 'Enter the code'), isMail ? tr(`Отправили 6-значный код на ${target}`, `We sent a 6-digit code to ${target}`) : tr(`Отправили SMS с кодом на ${fmtPhone(target)}`, `We sent an SMS code to ${fmtPhone(target)}`))}
      ${info.devCode ? h`<div class="note note-blue small">${icon('spark')}<div>${t('login.dev', 'Тестовый режим (SMS/почта не подключены): код', 'Test mode (SMS/e-mail not connected): code')} <b style="font-family:var(--display);letter-spacing:.1em">${info.devCode}</b></div></div>` : ''}
      <form id="c2" class="stack" style="margin-top:16px">
        <div class="otp" style="margin:0 auto">${[0, 1, 2, 3, 4, 5].map((i) => h`<input inputmode="numeric" pattern="[0-9]*" maxlength="6" aria-label="${tr('Цифра', 'Digit')} ${i + 1}" autocomplete="${i ? 'off' : 'one-time-code'}">`)}</div>
        <button class="btn btn-block btn-lg">${tr('Подтвердить', 'Confirm')}</button>
        <div class="row between"><button type="button" class="link small" id="cBack">${icon('arrowL', 'ic-sm')}${tr('Другой адрес', 'Different one')}</button><button type="button" class="link small" id="cRe" disabled></button></div>
      </form>`);
    const boxes = $$('.otp input', box), form = $('#c2', box);
    const submitIfFull = () => { if (boxes.every((x) => x.value)) form.requestSubmit(); };
    boxes.forEach((b, i) => {
      b.oninput = () => {
        const v = b.value.replace(/\D/g, '');
        if (v.length > 1) { const from = v.length >= 6 ? 0 : i; v.slice(0, 6 - from).split('').forEach((c, k) => { if (boxes[from + k]) boxes[from + k].value = c; }); boxes[Math.min(5, from + v.length)].focus(); submitIfFull(); return; }
        b.value = v; if (v && boxes[i + 1]) boxes[i + 1].focus(); submitIfFull();
      };
      b.onfocus = () => b.select();
      b.onkeydown = (e) => { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); };
    });
    setTimeout(() => boxes[0].focus(), 150);
    // повторная отправка — через 60 секунд (как на сервере)
    const re = $('#cRe', box); let left = 60;
    const tick = () => { if (!re.isConnected) return stop(); if (left > 0) { re.disabled = true; re.textContent = tr(`Повторно через ${left} с`, `Resend in ${left}s`); left--; } else { re.disabled = false; re.textContent = t('login.resend', 'Отправить код повторно', 'Resend code'); stop(); } };
    stop(); tick(); timer = setInterval(tick, 1000);
    re.onclick = () => busy(re, async () => { try { info = await POST('/me/contact/request', { target }); toast(tr('Код отправлен', 'Code sent')); step2(); } catch (er) { toastErr(er); } });
    $('#cBack', box).onclick = step1;
    form.onsubmit = (e) => {
      e.preventDefault();
      const code = boxes.map((b) => b.value).join('');
      if (code.length !== 6) return toast(tr('Введите 6 цифр кода', 'Enter the 6-digit code'), 'err');
      busy($('.btn', form), async () => {
        try { await POST('/me/contact/verify', { target, code }); stop(); s.close(); toast(isMail ? tr('E-mail подтверждён', 'E-mail verified') : tr('Телефон подтверждён', 'Phone verified')); await done(); }
        catch (er) { toastErr(er); boxes.forEach((x) => { x.value = ''; }); boxes[0].focus(); }
      });
    };
  };
  step1();
}
const ZONE_R = [1, 3, 5, 10, 20];
async function meZone(el, u) {
  const z = Object.assign({}, u.zone);
  // радиус — одна из кнопок; старое значение вне списка округляем до ближайшего
  z.radius = ZONE_R.reduce((a, b) => (Math.abs(b - (z.radius || 3)) < Math.abs(a - (z.radius || 3)) ? b : a));
  mount(el, h`<div class="zone stack">
    <div><h2>${t('me.zone', 'Зона оповещений', 'Alert zone')}</h2>
      <p class="muted" style="margin-top:8px">${t('me.zone_t', 'Район, где вы готовы помочь: дом, работа, маршрут. Если рядом начнётся экстренный поиск — придёт push.', 'Where you can help: home, work, your route. If an emergency search starts nearby, you get a push.')}</p></div>
    <label class="card pad row between zone-on"><div><b>${t('me.zone_on', 'Получать экстренные оповещения', 'Receive emergency alerts')}</b><div class="xs muted">${t('me.zone_on_t', 'Push без персональных данных', 'Push without personal data')}</div></div><span class="switch"><input type="checkbox" id="zon" ${z.enabled ? 'checked' : ''}></span></label>
    <div class="card pad zone-card">
      <div class="zone-r-head"><b>${t('wiz.radius', 'Радиус', 'Radius')}</b><span class="small muted">${tr('Отметьте центр на карте — дом, работу или место, где часто бываете', 'Mark the centre on the map — home, work or a place you often visit')}</span></div>
      <div class="rchips" role="radiogroup" aria-label="${t('wiz.radius', 'Радиус', 'Radius')}">${ZONE_R.map((r) => h`<button type="button" class="rchip ${r === z.radius ? 'on' : ''}" role="radio" aria-checked="${r === z.radius ? 'true' : 'false'}" data-r="${r}">${r} ${tr('км', 'km')}</button>`)}</div>
      <div class="picker zone-map" id="zp"></div>
    </div>
    <div id="pushHint"></div>
    <button class="btn btn-lg zone-save" id="zs">${icon('check')}${tr('Сохранить зону', 'Save zone')}</button>
  </div>`);
  const pk = mapPicker($('#zp', el), z.lat ? { lat: z.lat, lng: z.lng } : null, (v) => { z.lat = v.lat; z.lng = v.lng; }, { radius: () => z.radius });
  onLeave(() => pk.map.remove());
  $$('.rchip', el).forEach((b) => b.onclick = () => {
    z.radius = +b.dataset.r;
    $$('.rchip', el).forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); });
    pk.updateRadius();
  });
  const ps = await pushStatus();
  if (ps !== 'on') mount($('#pushHint', el), h`<div class="note note-amber small">${icon('bell')}<div>${t('me.push_off', 'Push-уведомления на этом устройстве выключены.', 'Push notifications are off on this device.')} <a class="link" href="#/me/settings">${tr('Включить', 'Enable')}</a></div></div>`);
  $('#zs', el).onclick = (e) => busy(e.currentTarget, async () => {
    try { await PATCH('/me', { zone: { enabled: $('#zon', el).checked, lat: z.lat, lng: z.lng, radius: z.radius } }); await refreshMe(); toast(tr('Зона сохранена', 'Zone saved')); } catch (er) { toastErr(er); }
  });
}
async function meFamily(el) {
  const { family, invites } = await GET('/family');
  const PROS = [['file', tr('Общие заявки', 'Shared reports'), tr('Заявку о пропаже видят и редактируют все члены семьи — не нужно пересылать данные.', 'Every family member can see and edit a lost report — no forwarding needed.')],
    ['chat', tr('Общая переписка', 'Shared chats'), tr('Ответы нашедших приходят всей семье, никто не пропустит важное сообщение.', 'Replies from finders reach the whole family, so nobody misses a message.')],
    ['shield', tr('Приватно', 'Private'), tr('Участники видят только семейные заявки. Личные данные остаются закрытыми.', 'Members see only family reports. Personal data stays private.')]];
  mount(el, h`<div class="fam stack-lg">
    <div><h2>${t('me.family', 'Семья', 'Family')}</h2><p class="muted" style="margin-top:8px">${t('me.family_t', 'Общие заявки и переписку по ним видят и ведут все члены семьи.', 'Shared reports and their chats are visible to and managed by the whole family.')}</p></div>
    ${invites.length ? h`<div class="stack">${invites.map((i) => h`<div class="card pad fam-inv">${icon('mail')}<div class="grow"><b>${i.name}</b><div class="small muted">${tr('Приглашение от', 'Invitation from')} ${i.owner}</div></div>
      <div class="fam-inv-act"><button class="btn btn-sm" data-acc="${i.id}">${tr('Принять', 'Accept')}</button><button class="btn btn-ghost btn-sm" data-dec="${i.id}">${tr('Отклонить', 'Decline')}</button></div></div>`)}</div>` : ''}
    ${family ? h`<section class="card pad fam-card">
        <div class="fam-top"><span class="fam-ic">${icon('users')}</span><div class="grow"><h3>${family.name}</h3><div class="small muted">${family.members.length} ${tr(plural(family.members.length, 'участник', 'участника', 'участников'), family.members.length === 1 ? 'member' : 'members')}</div></div>${family.is_owner ? h`<span class="chip">${tr('Вы владелец', 'Owner')}</span>` : ''}</div>
        <div class="fam-grid">${[...family.members].sort((a, b) => (b.owner ? 1 : 0) - (a.owner ? 1 : 0)).map((m) => h`<div class="fam-m">${avatar(m, 'ava-sm')}<div class="grow"><b class="ellipsis">${m.name}</b><div class="xs muted">${m.owner ? tr('владелец', 'owner') : tr('участник', 'member')}</div></div>${family.is_owner && !m.owner ? h`<button class="btn btn-ghost btn-xs" data-rm="${m.id}" aria-label="${tr('Исключить', 'Remove')}: ${m.name}">${tr('Исключить', 'Remove')}</button>` : ''}</div>`)}
          ${family.pending.map((p) => h`<div class="fam-m fam-pend"><span class="fam-pend-ic">${icon('mail')}</span><div class="grow"><b class="ellipsis">${p.target}</b><div class="xs muted">${tr('приглашение отправлено', 'invitation sent')}</div></div></div>`)}</div>
        ${family.is_owner ? h`<form class="fam-invite" id="inv"><label class="field"><span>${tr('Пригласить родственника', 'Invite a relative')}</span><input class="input" name="target" placeholder="${t('me.invite_ph', 'E-mail или телефон родственника', 'Relative\'s e-mail or phone')}" required autocomplete="off"></label><button class="btn">${icon('send')}${tr('Пригласить', 'Invite')}</button></form>` : ''}
        <div class="fam-foot"><button class="btn btn-danger btn-sm" id="leave">${family.is_owner ? t('me.family_del', 'Удалить семейный аккаунт', 'Delete family account') : t('me.family_leave', 'Выйти из семьи', 'Leave family')}</button></div>
      </section>`
    : h`<section class="card pad fam-card">
        <div class="fam-top"><span class="fam-ic">${icon('users')}</span><div class="grow"><h3>${tr('Семейный аккаунт', 'Family account')}</h3><div class="small muted">${tr('Создайте его и пригласите близких по e-mail или телефону', 'Create it and invite relatives by e-mail or phone')}</div></div></div>
        <ul class="fam-pros">${PROS.map(([ic, ti, tx]) => h`<li><span class="fam-pro-ic">${icon(ic)}</span><div><b>${ti}</b><span>${tx}</span></div></li>`)}</ul>
        <form class="fam-invite" id="mk"><label class="field"><span>${t('me.family_name', 'Название', 'Name')}</span><input class="input" name="name" placeholder="${tr('Семья Ивановых', 'The Smiths')}" maxlength="60"></label><button class="btn">${icon('plus')}${t('me.family_create', 'Создать семейный аккаунт', 'Create family account')}</button></form>
      </section>`}
  </div>`);
  const reload = () => meFamily(el).then(() => refreshMe());
  $$('[data-acc]', el).forEach((b) => b.onclick = async () => { try { await POST(`/family/invites/${b.dataset.acc}/accept`); toast(tr('Вы в семейном аккаунте', 'You joined the family')); reload(); } catch (e) { toastErr(e); } });
  $$('[data-dec]', el).forEach((b) => b.onclick = async () => { await POST(`/family/invites/${b.dataset.dec}/decline`); reload(); });
  $$('[data-rm]', el).forEach((b) => b.onclick = async () => { await DEL('/family/members/' + b.dataset.rm); reload(); });
  const mk = $('#mk', el); if (mk) mk.onsubmit = async (e) => { e.preventDefault(); try { await POST('/family', formData(e.target)); reload(); } catch (er) { toastErr(er); } };
  const inv = $('#inv', el); if (inv) inv.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { try { await POST('/family/invite', formData(e.target)); toast(tr('Приглашение отправлено', 'Invitation sent')); reload(); } catch (er) { toastErr(er); } }); };
  const lv = $('#leave', el); if (lv) lv.onclick = async () => { if (await confirmBox(lv.textContent, tr('Общие заявки останутся у их авторов.', 'Shared reports stay with their authors.'), { danger: true })) { await POST('/family/leave'); reload(); } };
}
async function meRegistry(el) {
  const { items, limit } = await GET('/valuables');
  const ST = { ok: [tr('В порядке', 'OK'), 'chip-ok'], stolen: [tr('Украдено', 'Stolen'), 'chip-lost'], lost: [tr('Утеряно', 'Lost'), 'chip-warn'] };
  mount(el, h`<div class="sec-head"><div><h2>${t('me.registry', 'Реестр ценностей', 'Valuables')}</h2><p>${t('me.reg_t', 'Фото, номера и приметы. При краже отметьте «украдено» — предмет появится в проверке.', 'Photos, serials and marks. If stolen, mark it — it will show up in the public check.')}</p></div>
    <button class="btn btn-sm" id="add">${icon('plus')}${tr('Добавить', 'Add')}</button></div>
    <div class="note small" style="margin-bottom:14px">${icon('gem')}<div><b>${tr('Использовано', 'Used')} ${items.length} / ${limit}</b>${limit < 100 ? h` · <a class="link" href="#/tariffs">${t('me.reg_up', 'Расширить до 100 предметов', 'Extend to 100 items')}</a>` : ''}<div class="xs muted" style="margin-top:4px">${t('me.reg_disclaimer', 'Реестр хранит сведения со слов владельца, экспертиза подлинности не проводится.', 'Data is as stated by the owner; authenticity is not verified.')}</div></div></div>
    ${items.length ? h`<div class="apps">${items.map((v, i) => h`<div class="app-card reg-card rise" style="--i:${i}"><div class="media ${v.photos[0] ? '' : 'no-photo'}">${v.photos[0] ? h`<img src="${v.photos[0]}" alt="">` : mediaPh('things', '', 'gem')}<div class="tags"><span class="chip ${ST[v.status][1]}">${ST[v.status][0]}</span></div></div>
      <div class="body"><h3>${v.title}</h3>${v.serials ? h`<div class="xs muted">№ ${v.serials}</div>` : ''}
      <div class="reg-acts"><div class="reg-st">${v.status === 'ok' ? h`<button class="btn btn-danger btn-xs" data-st="${v.id}" data-v="stolen">${tr('Украдено', 'Stolen')}</button><button class="btn btn-ghost btn-xs" data-st="${v.id}" data-v="lost">${tr('Утеряно', 'Lost')}</button>` : h`<button class="btn btn-ghost btn-xs" data-st="${v.id}" data-v="ok">${tr('Нашлось', 'Recovered')}</button>`}</div>
      <div class="reg-tools"><button class="btn btn-ghost btn-xs btn-ic" data-ed="${v.id}" aria-label="${tr('Изменить', 'Edit')}" title="${tr('Изменить', 'Edit')}">${icon('edit')}</button><button class="btn btn-ghost btn-xs btn-ic" data-del="${v.id}" aria-label="${tr('Удалить', 'Delete')}" title="${tr('Удалить', 'Delete')}">${icon('trash')}</button></div></div></div></div>`)}</div>`
      : empty('gem', t('me.reg_empty', 'Реестр пуст', 'Registry is empty'), t('me.reg_empty_t', 'Добавьте украшения, технику, антиквариат, документы.', 'Add jewellery, electronics, antiques, documents.'))}`);
  const form = (v = {}) => {
    const s = sheet(h`${sheetHead(v.id ? tr('Редактировать предмет', 'Edit item') : tr('Новый предмет', 'New item'))}<form class="stack">
      <label class="field"><span>${tr('Название', 'Name')} <em>*</em></span><input name="title" value="${v.title || ''}" required maxlength="140"></label>
      <label class="field"><span>${tr('Серийные номера, IMEI, клейма', 'Serial numbers, IMEI, hallmarks')}</span><input name="serials" value="${v.serials || ''}" maxlength="500"></label>
      <label class="field"><span>${tr('Отличительные признаки', 'Distinctive marks')}</span><textarea name="marks" rows="2" maxlength="1000">${v.marks || ''}</textarea></label>
      <label class="field"><span>${tr('Описание', 'Description')}</span><textarea name="description" rows="3" maxlength="3000">${v.description || ''}</textarea></label>
      <div id="vph"></div><button class="btn btn-block">${tr('Сохранить', 'Save')}</button></form>`);
    const ph = photoField($('#vph', s.el), v.photos || [], 5);
    $('form', s.el).onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { try { const b = Object.assign(formData(e.target), { photos: ph() }); if (v.id) await PATCH('/valuables/' + v.id, b); else await POST('/valuables', b); s.close(); meRegistry(el); } catch (er) { toastErr(er); if (er.code === 'limit') { s.close(); go('#/tariffs'); } } }); };
  };
  $('#add', el).onclick = () => form();
  $$('[data-ed]', el).forEach((b) => b.onclick = () => form(items.find((x) => x.id === +b.dataset.ed)));
  $$('[data-st]', el).forEach((b) => b.onclick = async () => { await PATCH('/valuables/' + b.dataset.st, { status: b.dataset.v }); toast(b.dataset.v === 'ok' ? tr('Отметка снята', 'Mark removed') : tr('Предмет отмечен — он виден в публичной проверке', 'Marked — now visible in public check')); meRegistry(el); });
  $$('[data-del]', el).forEach((b) => b.onclick = async () => { if (await confirmBox(tr('Удалить предмет?', 'Delete item?'), '', { danger: true })) { await DEL('/valuables/' + b.dataset.del); meRegistry(el); } });
}
async function mePayments(el, u) {
  const { items } = await GET('/my/payments');
  const PS = { pending: [tr('Ожидает', 'Pending'), 'chip-warn'], succeeded: [tr('Оплачен', 'Paid'), 'chip-ok'], canceled: [tr('Отменён', 'Canceled'), ''] };
  mount(el, h`<div class="stack-lg" style="max-width:820px">
    <div class="sec-head" style="margin:0"><h2>${t('me.payments', 'Платежи', 'Payments')}</h2><a class="btn btn-sm" href="#/tariffs">${t('tar.title', 'Тарифы', 'Plans')}</a></div>
    ${u.subscriptions.length ? h`<div class="stack">${u.subscriptions.map((s) => h`<div class="card pad row"><div class="t-ic" style="width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:var(--green-soft);color:var(--green)">${icon('check')}</div><div class="grow"><b>${state.lang === 'en' ? s.name_en : s.name_ru}</b><div class="small muted">${tr('до', 'until')} ${fmtDate(s.until)}</div></div>
      <label class="row small" style="cursor:pointer">${tr('Автопродление', 'Auto-renew')}<span class="switch"><input type="checkbox" data-auto="${s.id}" ${s.auto_renew ? 'checked' : ''} ${u.card ? '' : 'disabled'}></span></label></div>`)}</div>` : ''}
    <div class="card pad row">${icon('card')}<div class="grow"><b>${t('me.card', 'Привязанная карта', 'Saved card')}</b><div class="small muted">${u.card || tr('Нет. Карту можно сохранить при оплате — для автопродления.', 'None. Save a card during payment for auto-renewal.')}</div></div>${u.card ? h`<button class="btn btn-ghost btn-sm" id="unlink">${tr('Отвязать', 'Unlink')}</button>` : ''}</div>
    <div><h3 style="margin-bottom:12px">${t('me.history', 'История платежей', 'Payment history')}</h3>
    ${items.length ? h`<div class="table-wrap" tabindex="0"><table class="t t-cards"><thead><tr><th>${tr('Дата', 'Date')}</th><th>${tr('Услуга', 'Service')}</th><th class="num">${tr('Сумма', 'Amount')}</th><th>${tr('Статус', 'Status')}</th><th></th></tr></thead><tbody>
      ${items.map((p) => h`<tr><td>${fmtDate(p.created_at, true)}</td><td>${state.lang === 'en' ? p.name_en : p.name_ru}${p.auto ? h` <span class="chip" style="height:20px;font-size:10px">${tr('авто', 'auto')}</span>` : ''}${p.discount ? h`<div class="xs muted">${tr('скидка', 'discount')} ${p.discount}%</div>` : ''}</td><td class="num"><b>${money(p.amount)}</b></td><td><span class="chip ${PS[p.status][1]}">${PS[p.status][0]}</span></td>
      <td>${p.status === 'succeeded' ? h`<button class="btn btn-ghost btn-xs" data-rc="${p.id}">${tr('Чек', 'Receipt')}</button>` : p.status === 'pending' ? h`<a class="btn btn-ghost btn-xs" href="#/pay/${p.id}">${tr('Оплатить', 'Pay')}</a>` : ''}</td></tr>`)}</tbody></table></div>`
      : empty('card', t('me.pay_empty', 'Платежей пока нет', 'No payments yet'))}</div></div>`);
  $$('[data-auto]', el).forEach((c) => c.onchange = async () => { await POST(`/subscriptions/${c.dataset.auto}/auto`, { auto_renew: c.checked }); toast(c.checked ? tr('Автопродление включено', 'Auto-renew on') : tr('Автопродление выключено', 'Auto-renew off')); });
  const ul = $('#unlink', el); if (ul) ul.onclick = async () => { if (await confirmBox(tr('Отвязать карту?', 'Unlink card?'), tr('Автопродление будет отключено.', 'Auto-renewal will be turned off.'))) { await DEL('/me/card'); await refreshMe(); mePayments(el, state.user); } };
  $$('[data-rc]', el).forEach((b) => b.onclick = () => {
    const p = items.find((x) => x.id === +b.dataset.rc); const r = JSON.parse(p.receipt || '{}');
    sheet(h`${sheetHead(tr('Кассовый чек', 'Receipt'), tr('Данные переданы платёжному провайдеру для формирования чека (54-ФЗ)', 'Data sent to the payment provider for the fiscal receipt'))}
      <dl class="kv"><div><dt>${tr('Платёж', 'Payment')}</dt><dd>№ ${p.id}</dd></div><div><dt>${tr('Дата', 'Date')}</dt><dd>${fmtDate(p.paid_at, true)}</dd></div>${(r.items || []).map((i) => h`<div><dt>${i.name}</dt><dd>${money(i.price)}</dd></div>`)}<div><dt>${tr('НДС', 'VAT')}</dt><dd>${tr('без НДС', 'none')}</dd></div><div><dt>${tr('Покупатель', 'Customer')}</dt><dd>${r.customer || ''}</dd></div><div><dt>${tr('Итого', 'Total')}</dt><dd>${money(p.amount)}</dd></div></dl>`);
  });
}
async function meRewards(el, u) {
  const { items } = await GET('/my/points');
  const lp = levelProgress(u);
  mount(el, h`<div class="grid-2" style="gap:18px;align-items:start">
    <div class="stack">
      <div class="profile-card"><div class="ava" style="background:linear-gradient(145deg,#ffb020,#e0192d)">${icon('award', 'ic-lg')}</div><div class="grow"><div class="xs" style="opacity:.7">${t('rw.status', 'Ваш статус', 'Your status')}</div><h2 style="font-size:24px">${levelName(u.level)}</h2><div class="lvl-bar"><i style="width:${lp.pct}%"></i></div><div class="xs" style="opacity:.7;margin-top:6px">${u.points} ${tr('баллов', 'points')}${u.level.discount ? ` · ${tr('скидка', 'discount')} ${u.level.discount}%` : ''}</div></div></div>
      <div class="list">${state.config.levels.map((l) => h`<div style="${l.code === u.level.code ? 'background:var(--surface-2)' : ''}">${icon(l.code === u.level.code ? 'check' : 'award')}<div class="grow"><b>${levelName(l)}</b><div class="xs muted">${tr('от', 'from')} ${l.min} ${tr('баллов', 'points')}</div></div>${l.code === u.level.code ? h`<span class="chip chip-ok">${tr('Ваш статус', 'Your level')}</span>` : ''}${l.discount ? h`<span class="chip">−${l.discount}% ${tr('на тарифы', 'on plans')}</span>` : ''}</div>`)}</div>
      <p class="xs muted">${t('rw.note', 'Баллы — за подтверждённую помощь и полезную информацию. На деньги не обмениваются.', 'Points are for confirmed help and useful info. They can’t be exchanged for money.')}</p>
      <a class="btn btn-ghost" href="#/community">${icon('trend')}${t('rw.rating', 'Рейтинг волонтёров', 'Volunteer rating')}</a>
    </div>
    <div><h3 style="margin-bottom:12px">${t('rw.history', 'История начислений', 'Points history')}</h3>
      ${items.length ? h`<div class="list">${items.map((p) => h`<div><b style="color:${p.delta > 0 ? 'var(--green-t)' : 'var(--red-t)'};font-family:var(--display);min-width:48px">${p.delta > 0 ? '+' : ''}${p.delta}</b><div class="grow"><div class="small">${p.reason}</div><div class="xs muted">${ago(p.created_at)}</div></div></div>`)}</div>` : empty('award', t('rw.empty', 'Начислений пока нет', 'No points yet'), t('rw.empty_t', 'Помогайте в поиске — автор отметит вас, когда найдёт.', 'Help search — the author can credit you when it’s found.'))}
    </div></div>`);
}
async function meSettings(el, u) {
  mount(el, h`<div class="stack-lg" style="max-width:720px">
    <div class="card pad stack">
      <h3>${t('set.lang', 'Язык', 'Language')}</h3>
      <div class="seg" id="lang"><button class="${state.lang === 'ru' ? 'on' : ''}" data-v="ru">Русский</button><button class="${state.lang === 'en' ? 'on' : ''}" data-v="en">English</button></div>
    </div>
    <div class="card pad stack" id="pushCard"></div>
    <div class="card pad stack" id="installCard"></div>
    <div class="list">
      <a href="#/legal">${icon('file')}<span class="grow">${t('legal.all', 'Документы и согласия', 'Legal documents')}<span class="xs muted" style="display:block;font-weight:500">${tr('Соглашение, политика, согласия · PDF', 'Terms, policy, consents · PDF')}</span></span>${icon('chevR')}</a>
      <a href="#/support">${icon('help')}<span class="grow">${t('sup.title', 'Поддержка', 'Support')}</span>${icon('chevR')}</a>
    </div>
    <div class="row"><button class="btn btn-ghost grow" id="logout">${icon('logout')}${t('set.logout', 'Выйти', 'Sign out')}</button><button class="btn btn-danger" id="delAcc">${icon('trash')}${t('set.delete', 'Удалить аккаунт', 'Delete account')}</button></div>
  </div>`);
  $$('#lang button', el).forEach((b) => b.onclick = async () => { await setLang(b.dataset.v, true); meSettings(el, state.user); });
  pushCard($('#pushCard', el));
  installCard($('#installCard', el));
  $('#logout', el).onclick = async () => { await disablePush(); await POST('/auth/logout'); state.user = null; connectStream(); go('#/'); };
  $('#delAcc', el).onclick = async () => {
    if (await confirmBox(t('set.delete', 'Удалить аккаунт', 'Delete account'), t('set.delete_t', 'Профиль, заявки и реестр удалятся навсегда.', 'Your profile, reports and registry will be deleted for good.'), { danger: true, ok: tr('Удалить навсегда', 'Delete forever') })) {
      await DEL('/me'); state.user = null; connectStream(); toast(tr('Аккаунт удалён', 'Account deleted')); go('#/');
    }
  };
}
/* =================== РЕЕСТР: ПУБЛИЧНАЯ ПРОВЕРКА =================== */
route('/registry', async (view) => {
  const q0 = query().get('q') || '';
  mount(view, h`<div class="wrap" style="max-width:860px"><div class="page-head"><span class="eyebrow">${t('reg.eyebrow', 'Реестр ценностей и антиквариата', 'Valuables & antiques registry')}</span><h1 style="margin-top:12px">${t('reg.title', 'Проверка предмета перед покупкой', 'Check an item before buying')}</h1>
    <p>${t('reg.sub', 'Серийный номер, IMEI, гравировка или название — покажем, если предмет числится украденным или утерянным.', 'Serial number, IMEI, engraving or name — we’ll show if it’s marked stolen or lost.')}</p></div>
    <form class="search-box" id="rf">${icon('search')}<input name="q" value="${q0}" placeholder="${t('home.reg_ph', 'Серийный номер или название', 'Serial number or name')}" minlength="3" required><button class="fbtn fbtn-search" aria-label="${tr('Проверить', 'Check')}">${icon('arrowUR')}</button></form>
    <div class="row-wrap" style="margin-top:12px"><span class="xs muted">${tr('Например:', 'Try:')}</span><button type="button" class="chip chip-btn" data-try="NB-77120934">NB-77120934</button><button type="button" class="chip chip-btn" data-try="${tr('велосипед', 'bike')}">${tr('велосипед', 'bike')}</button></div>
    <div id="rr" style="margin-top:20px"></div>
    <div class="steps3">
      ${[['gem', tr('Зарегистрируйте', 'Register'), tr('Фото, серийный номер, гравировка и особые приметы — в личном кабинете.', 'Photos, serial number, engraving and marks — in your account.')],
        ['siren', tr('Отметьте кражу', 'Mark as stolen'), tr('Одна кнопка — и предмет помечен как украденный или утерянный.', 'One tap marks the item as stolen or lost.')],
        ['search', tr('Покупатель проверит', 'Buyers check'), tr('Перед покупкой любой может проверить номер и анонимно сообщить владельцу.', 'Anyone can check the number before buying and notify the owner anonymously.')]]
        .map(([ic, ti, tx], i) => h`<div class="step3"><span class="step3-n" data-n="0${i + 1}" aria-hidden="true"></span><span class="step3-ic">${icon(ic, '', 'duo')}</span><h4>${ti}</h4><p>${tx}</p></div>`)}
    </div>
    <div class="grid-2" style="margin-top:28px">
      <div class="card pad"><h3>${t('reg.owner', 'Для владельцев', 'For owners')}</h3><p class="muted small" style="margin-top:8px">${t('reg.owner_t', 'Добавьте ценности заранее: фото, номера, приметы. При краже — одна отметка, и предмет увидят покупатели и ломбарды.', 'Add valuables in advance: photos, serials, marks. If stolen, one tap makes it visible to buyers and pawnshops.')}</p><a class="btn btn-sm" style="margin-top:14px" href="#/me/registry">${t('reg.my', 'Мой реестр', 'My registry')}</a></div>
      <div class="card pad"><h3>${t('reg.disc', 'Важно', 'Important')}</h3><p class="muted small" style="margin-top:8px">${t('reg.disc_t', 'Данные — со слов владельцев, без экспертизы. Нет отметки — не гарантия чистого происхождения.', 'Data comes from owners, unverified. No mark is not a guarantee of lawful origin.')}</p></div>
    </div></div>`);
  const run = async (q) => {
    mount($('#rr', view), h`<div class="spinner"></div>`);
    try {
      const { items } = await GET('/registry/check?q=' + encodeURIComponent(q));
      mount($('#rr', view), items.length ? h`<div class="note note-red" style="margin-bottom:14px">${icon('alert')}<div><b>${t('reg.found', 'Найдены отметки о краже или утере', 'Theft or loss marks found')}</b>${t('reg.found_t', 'Не покупайте предмет. Сообщите владельцу — контакт не раскрывается.', 'Do not buy this item. Notify the owner — contacts stay private.')}</div></div>
        <div class="stack">${items.map((v) => h`<div class="card pad row" style="align-items:flex-start">${v.photo ? h`<img src="${v.photo}" alt="" style="width:72px;height:72px;border-radius:14px;object-fit:cover">` : h`<div class="chat-ava">${icon('gem')}</div>`}
          <div class="grow"><div class="row-wrap"><span class="chip ${v.status === 'stolen' ? 'chip-lost' : 'chip-warn'}">${v.status === 'stolen' ? tr('Украдено', 'Stolen') : tr('Утеряно', 'Lost')}</span>${v.serial_match ? h`<span class="chip chip-dark">${tr('Совпал номер', 'Serial match')}</span>` : ''}</div><b style="display:block;margin-top:6px">${v.title}</b>${v.marks ? h`<div class="small muted">${v.marks}</div>` : ''}<div class="xs muted">${tr('Отмечено', 'Marked')} ${fmtDate(v.status_at)}</div></div>
          <button class="btn btn-sm" data-rep="${v.id}">${tr('Сообщить владельцу', 'Notify owner')}</button></div>`)}</div>`
        : h`<div class="note note-blue">${icon('check')}<div><b>${t('reg.clean', 'Отметок о краже не найдено', 'No theft marks found')}</b>${t('reg.clean_t', 'Нет отметок «украдено» или «утеряно».', 'No “stolen” or “lost” marks.')}</div></div>`);
      $$('[data-rep]', view).forEach((b) => b.onclick = () => {
        const s = sheet(h`${sheetHead(tr('Сообщить владельцу', 'Notify owner'), tr('Владелец получит уведомление. Ваши данные — только если сами укажете.', 'The owner gets notified. Your details are shared only if you add them.'))}<form class="stack"><label class="field"><span>${tr('Где и когда замечен предмет', 'Where and when you saw it')}</span><textarea name="message" rows="3" required></textarea></label><button class="btn btn-block">${tr('Отправить', 'Send')}</button></form>`);
        $('form', s.el).onsubmit = async (e) => { e.preventDefault(); try { await POST(`/registry/${b.dataset.rep}/report`, formData(e.target)); s.close(); toast(tr('Владелец уведомлён', 'Owner notified')); } catch (er) { toastErr(er); } };
      });
    } catch (e) { mount($('#rr', view), ''); toastErr(e); }
  };
  $('#rf', view).onsubmit = (e) => { e.preventDefault(); run(e.target.q.value.trim()); };
  $$('[data-try]', view).forEach((b) => b.onclick = () => { $('#rf', view).q.value = b.dataset.try; run(b.dataset.try); });
  if (q0) run(q0);
});

/* =================== ТАРИФЫ И ОПЛАТА =================== */
route('/tariffs', async (view) => {
  const { items, discount } = await GET('/tariffs');
  const promoteId = query().get('promote');
  mount(view, h`<div class="wrap"><div class="page-head center" style="margin:0 auto;max-width:720px"><span class="eyebrow">${t('tar.eyebrow', 'Тарифы', 'Plans')}</span><h1 style="margin-top:12px">${t('tar.title2', 'Больше возможностей для поиска', 'More tools for searching')}</h1>
    <p style="margin-left:auto;margin-right:auto">${t('tar.sub', 'Заявки, совпадения, оповещения и чат — бесплатно. Платно — расширенный реестр, продвижение и тариф для организаций.', 'Reports, matches, alerts and chat are free. Paid: extended registry, boosting and a plan for organisations.')}</p>
    ${discount ? h`<span class="chip chip-ok" style="margin-top:14px">${icon('award')}${tr('Ваша скидка по статусу', 'Your status discount')}: ${discount}%</span>` : ''}</div>
    <div class="plans">${items.map((p, i) => h`<div class="plan rise ${p.feature === 'promote' ? 'hl' : ''}" style="--i:${i}">
      <span class="chip ${p.feature === 'promote' ? 'chip-em' : ''}" style="align-self:flex-start">${icon(p.feature === 'registry' ? 'gem' : p.feature === 'promote' ? 'zap' : 'users')}${p.audience === 'partner' ? tr('Для организаций', 'For organisations') : tr('Для пользователей', 'For users')}</span>
      <h3 style="font-size:22px">${state.lang === 'en' ? p.name_en : p.name_ru}</h3>
      <p class="muted">${state.lang === 'en' ? p.desc_en : p.desc_ru}</p>
      <div class="price">${money(p.final_price)}${p.final_price !== p.price ? h`<s>${money(p.price)}</s>` : ''} <small>/ ${p.period_days} ${tr(plural(p.period_days, 'день', 'дня', 'дней'), 'days')}</small></div>
      <button class="btn ${p.feature === 'promote' ? 'btn-red' : ''} btn-block" data-buy="${p.id}" ${state.config.payments === 'none' ? 'disabled' : ''}>${t('tar.buy', 'Подключить', 'Get it')}</button></div>`)}</div>
    ${state.config.payments === 'none' ? h`<div class="note note-amber" style="max-width:720px;margin:20px auto 0">${icon('alert')}<div>${tr('Оплата на сайте временно недоступна. Попробуйте позже или напишите в поддержку.', 'Online payment is temporarily unavailable. Please try later or contact support.')}</div></div>` : ''}
    <p class="xs muted center" style="margin-top:20px">${t('tar.note', 'Оплата картами российских банков и через СБП. Чек отправляется на e-mail или телефон из профиля.', 'Payment by Russian bank cards and SBP. Receipt is sent to your e-mail or phone.')}</p></div>`);
  $$('[data-buy]', view).forEach((b) => b.onclick = async () => {
    if (!state.user) return needLogin();
    const p = items.find((x) => x.id === +b.dataset.buy);
    let apps = [];
    if (p.feature === 'promote') apps = (await GET('/my/applications')).items.filter((a) => a.status === 'published');
    let method = 'card';
    const s = sheet(h`${sheetHead(state.lang === 'en' ? p.name_en : p.name_ru, money(p.final_price))}
      <div class="stack">
        ${p.feature === 'promote' ? (apps.length ? h`<label class="field"><span>${tr('Какую заявку продвинуть', 'Which report to boost')}</span><select name="app">${apps.map((a) => h`<option value="${a.id}" ${String(a.id) === promoteId ? 'selected' : ''}>${a.title}</option>`)}</select></label>` : h`<div class="note note-amber">${icon('alert')}<div>${tr('Нет опубликованных заявок для продвижения', 'No published reports to boost')}</div></div>`) : ''}
        <div class="seg" id="pm"><button class="on" data-v="card">${icon('card', 'ic-sm')}${tr('Карта', 'Card')}</button><button data-v="sbp">${icon('qr', 'ic-sm')}${tr('СБП', 'SBP')}</button>${state.user.card ? h`<button data-v="saved_card">${state.user.card}</button>` : ''}</div>
        <label class="check" id="sc"><input type="checkbox" name="save_card"> ${t('tar.save_card', 'Сохранить карту для автопродления', 'Save card for auto-renewal')}</label>
        <button class="btn btn-red btn-block btn-lg" data-pay ${p.feature === 'promote' && !apps.length ? 'disabled' : ''}>${tr('Оплатить', 'Pay')} ${money(p.final_price)}</button>
        <p class="xs muted center">${icon('lock', 'ic-sm')} ${t('tar.secure', 'Оплата проходит на стороне платёжного провайдера. Мы не храним данные карт.', 'Payment is processed by the payment provider. We do not store card data.')}</p>
      </div>`);
    $$('#pm button', s.el).forEach((x) => x.onclick = () => { method = x.dataset.v; $$('#pm button', s.el).forEach((y) => y.classList.toggle('on', y === x)); $('#sc', s.el).classList.toggle('hide', method !== 'card'); });
    $('[data-pay]', s.el).onclick = (e) => busy(e.currentTarget, async () => {
      try {
        const r = await POST('/payments', { tariff_id: p.id, method, save_card: $('[name=save_card]', s.el).checked, application_id: $('[name=app]', s.el)?.value });
        s.close();
        if (r.status === 'succeeded') { await refreshMe(); toast(tr('Оплачено', 'Paid')); go('#/me/payments'); }
        else if (r.confirmation_url && /^https:\/\//.test(r.confirmation_url)) location.href = r.confirmation_url;
        else go(r.confirmation_url || `#/pay/${r.id}`);
      } catch (er) { toastErr(er); }
    });
  });
});

route('/pay/:id', async (view, p) => {
  const { item } = await GET('/payments/' + p.id);
  const done = (st) => mount(view, h`<div class="wrap"><div class="success"><div class="big-ic ${st === 'succeeded' ? '' : 'wait'}">${icon(st === 'succeeded' ? 'check' : 'x')}</div><h2>${st === 'succeeded' ? tr('Оплата прошла успешно', 'Payment successful') : tr('Платёж отменён', 'Payment canceled')}</h2>
    <p class="muted" style="margin-top:10px">${st === 'succeeded' ? tr('Тариф подключён. Чек отправлен на ваш e-mail или телефон.', 'The plan is active. Receipt sent to your e-mail or phone.') : tr('Деньги не списаны.', 'No money was charged.')}</p>
    <div class="row" style="justify-content:center;margin-top:20px"><a class="btn" href="#/me/payments">${t('me.payments', 'Платежи', 'Payments')}</a>${item.feature === 'promote' && item.application_id ? h`<a class="btn btn-ghost" href="#/a/${item.application_id}">${tr('К заявке', 'To report')}</a>` : ''}</div></div></div>`);
  if (item.status !== 'pending') return done(item.status);
  if (item.provider !== 'test') {
    // Возврат со страницы ЮKassa: ждём подтверждения банка (обычно несколько секунд)
    mount(view, h`<div class="wrap"><div class="success"><div class="big-ic wait">${icon('clock')}</div><h2>${tr('Проверяем оплату…', 'Checking the payment…')}</h2>
      <p class="muted" style="margin-top:10px">${state.lang === 'en' ? item.name_en : item.name_ru} — ${money(item.amount)}. ${tr('Страница обновится сама, как только банк подтвердит платёж.', 'This page updates as soon as the bank confirms the payment.')}</p>
      <div class="row" style="justify-content:center;margin-top:20px;flex-wrap:wrap">${item.confirmation_url ? h`<a class="btn btn-red" href="${item.confirmation_url}">${tr('Перейти к оплате', 'Go to payment')}</a>` : ''}<a class="btn btn-ghost" href="#/me/payments">${t('me.payments', 'Платежи', 'Payments')}</a></div></div></div>`);
    let tries = 0, alive = true; onLeave(() => { alive = false; });
    const poll = async () => {
      if (!alive) return;
      try { const r = await GET('/payments/' + p.id); if (r.item.status !== 'pending') { await refreshMe(); return done(r.item.status); } } catch (e) { /* повторим */ }
      if (++tries < 60) setTimeout(poll, 3000);
    };
    setTimeout(poll, 1500);
    return;
  }
  const qr = Array.from({ length: 441 }, (_, i) => { const x = i % 21, y = Math.floor(i / 21); const f = (a, b) => x >= a && x < a + 7 && y >= b && y < b + 7; const finder = f(0, 0) || f(14, 0) || f(0, 14); if (finder) { const lx = x % 7 === x ? x : x - 14, ly = y % 7 === y ? y : y - 14; const xx = x >= 14 ? x - 14 : x, yy = y >= 14 ? y - 14 : y; return (xx === 0 || xx === 6 || yy === 0 || yy === 6 || (xx >= 2 && xx <= 4 && yy >= 2 && yy <= 4)) ? '' : 'w'; } return ((x * 7 + y * 13 + item.id * 3 + x * y) % 3) ? 'w' : ''; });
  mount(view, h`<div class="wrap"><div class="paybox">
    <div class="pay-top"><div><div class="xs" style="opacity:.6">${tr('Тестовый платёжный шлюз', 'Test payment gateway')}</div><div style="font-weight:700">${state.lang === 'en' ? item.name_en : item.name_ru}</div></div><b>${money(item.amount)}</b></div>
    <div class="pad stack">
      <div class="note note-amber small">${icon('alert')}<div>${tr('Тестовый режим — деньги не списываются. Карта для проверки: 2200 0000 0000 0004.', 'Test mode — no money is charged. Test card: 2200 0000 0000 0004.')}</div></div>
      ${item.method === 'sbp' ? h`<div class="qr">${qr.map((c) => h`<i class="${c}"></i>`)}</div><p class="center small muted">${tr('Отсканируйте QR-код в приложении банка', 'Scan the QR code in your banking app')}</p><button class="btn btn-red btn-block btn-lg" data-ok>${tr('Я оплатил(а) в банке', 'I have paid in my bank app')}</button>`
      : h`<div class="cardviz"><div class="row between"><span style="font-size:13px;opacity:.8">${tr('Тестовая оплата', 'Test payment')}</span>${icon('card')}</div><div id="cvn" style="font-size:20px;letter-spacing:.08em">•••• •••• •••• ••••</div><div class="row between xs"><span>${tr('ВЛАДЕЛЕЦ КАРТЫ', 'CARDHOLDER')}</span><span id="cve">${tr('ММ/ГГ', 'MM/YY')}</span></div></div>
        <form class="stack" id="cf"><label class="field"><span>${tr('Номер карты', 'Card number')}</span><input name="card" inputmode="numeric" autocomplete="cc-number" placeholder="2200 0000 0000 0000" maxlength="23" required></label>
        <div class="grid-2"><label class="field"><span>${tr('Срок', 'Expiry')}</span><input name="exp" placeholder="${tr('ММ/ГГ', 'MM/YY')}" maxlength="5" inputmode="numeric" autocomplete="cc-exp" required></label><label class="field"><span>CVC</span><input name="cvc" type="password" maxlength="3" inputmode="numeric" autocomplete="cc-csc" required></label></div>
        <button class="btn btn-red btn-block btn-lg">${tr('Оплатить', 'Pay')} ${money(item.amount)}</button></form>`}
      <button class="btn btn-ghost btn-block" data-cancel>${tr('Отменить платёж', 'Cancel payment')}</button>
    </div></div></div>`);
  const cf = $('#cf', view);
  if (cf) {
    cf.card.oninput = (e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 19); e.target.value = v.replace(/(.{4})/g, '$1 ').trim(); $('#cvn', view).textContent = (v + '•'.repeat(Math.max(0, 16 - v.length))).replace(/(.{4})/g, '$1 ').trim(); };
    cf.exp.oninput = (e) => { let v = e.target.value.replace(/\D/g, '').slice(0, 4); if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2); e.target.value = v; $('#cve', view).textContent = v || tr('ММ/ГГ', 'MM/YY'); };
    cf.onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { try { const r = await POST(`/payments/${item.id}/confirm`, { success: true, card: cf.card.value }); await refreshMe(); done(r.item.status); } catch (er) { toastErr(er); } }); };
  }
  const ok = $('[data-ok]', view); if (ok) ok.onclick = (e) => busy(e.currentTarget, async () => { const r = await POST(`/payments/${item.id}/confirm`, { success: true }); await refreshMe(); done(r.item.status); });
  $('[data-cancel]', view).onclick = async () => { const r = await POST(`/payments/${item.id}/confirm`, { success: false }); done(r.item.status); };
}, { auth: true });

/* =================== СООБЩЕСТВО =================== */
route('/community', async (view) => {
  const [{ items }, my] = await Promise.all([GET('/rating'), state.user ? GET('/role-requests/my') : Promise.resolve({ items: [] })]);
  const u = state.user;
  const pending = my.items.find((r) => r.status === 'pending');
  mount(view, h`<div class="wrap"><div class="page-head"><span class="eyebrow">${t('com.eyebrow', 'Сообщество', 'Community')}</span><h1 style="margin-top:12px">${t('com.title', 'Волонтёры и партнёры', 'Volunteers & partners')}</h1>
    <p>${t('com.sub', 'Волонтёры и организации получают SOS-оповещения по своему району и помогают искать.', 'Volunteers and organisations get SOS alerts for their area and help search.')}</p></div>
    <div class="grid-2" style="gap:18px;align-items:start">
      <div class="stack">
        ${u && ['volunteer', 'partner', 'moderator', 'admin'].includes(u.role) ? h`<div class="note note-blue">${icon('check')}<div><b>${tr('Вы', 'You are')}: ${ROLE(u.role)}</b>${t('com.active', 'Экстренные оповещения приходят по вашей зоне.', 'Emergency alerts arrive for your zone.')} <a class="link" href="#/me/zone">${t('me.zone', 'Зона оповещений', 'Alert zone')}</a></div></div>`
        : pending ? h`<div class="note note-amber">${icon('clock')}<div><b>${t('com.pending', 'Заявка на рассмотрении', 'Request under review')}</b>${ROLE(pending.role)} · ${ago(pending.created_at)}</div></div>`
        : h`<div class="card pad stack"><div class="seg" id="rs"><button class="on" data-v="volunteer">${icon('heart', 'ic-sm')}${ROLE('volunteer')}</button><button data-v="partner">${icon('users', 'ic-sm')}${ROLE('partner')}</button></div>
          <form class="stack" id="rf">
            <div id="pfields" class="stack hide"><label class="field"><span>${t('com.org', 'Название организации', 'Organisation name')} <em>*</em></span><input name="org_name" maxlength="160"></label>
            <label class="field"><span>${t('com.org_type', 'Тип организации', 'Organisation type')}</span><select name="org_type">${dict('partner_type').map((v) => h`<option>${v}</option>`)}</select></label></div>
            <label class="field"><span>${t('com.about', 'О себе: опыт, транспорт, когда готовы помогать', 'About you: experience, transport, availability')}</span><textarea name="details" rows="3" maxlength="2000"></textarea></label>
            ${u && !u.zone.enabled ? h`<div class="note note-amber small">${icon('zone')}<div>${t('com.need_zone', 'Сначала укажите зону оповещений — туда будут приходить экстренные вызовы.', 'Set your alert zone first — emergency calls will arrive there.')} <a class="link" href="#/me/zone">${tr('Указать', 'Set')}</a></div></div>` : ''}
            <button class="btn btn-block">${t('com.send', 'Отправить заявку', 'Send request')}</button></form></div>`}
        <div class="steps" style="grid-template-columns:1fr">${[[t('com.s1', 'Зона', 'Zone'), t('com.s1t', 'Укажите район, где готовы помогать.', 'Choose the area where you can help.')], [t('com.s2', 'Оповещение', 'Alert'), t('com.s2t', 'При экстренном поиске рядом придёт push без персональных данных.', 'A push without personal data arrives during an emergency nearby.')], [t('com.s3', 'Помощь', 'Help'), t('com.s3t', 'Сообщите о находке или напишите автору в анонимный чат.', 'Report a find or message the author anonymously.')]].map(([a, b]) => h`<div class="step"><h4>${a}</h4><p>${b}</p></div>`)}</div>
      </div>
      <div id="rating"><h2 style="margin-bottom:14px">${t('com.rating', 'Рейтинг', 'Rating')}</h2>
        ${items.length ? h`<div class="list">${items.map((r) => h`<div style="${r.me ? 'background:var(--surface-2)' : ''}"><b style="font-family:var(--display);width:28px;color:${r.place <= 3 ? 'var(--red)' : 'var(--muted)'}">${r.place}</b>${avatar(r, 'ava-sm')}<div class="grow" style="min-width:0"><b>${r.name}</b><div class="xs muted">${ROLE(r.role)} · ${levelName(r.level)}${r.city ? ' · ' + r.city : ''}</div></div><b style="font-family:var(--display)">${r.points}</b></div>`)}</div>` : empty('award', tr('Рейтинг пока пуст', 'Rating is empty'))}
      </div></div></div>`);
  let role = 'volunteer';
  $$('#rs button', view).forEach((b) => b.onclick = () => { role = b.dataset.v; $$('#rs button', view).forEach((x) => x.classList.toggle('on', x === b)); $('#pfields', view).classList.toggle('hide', role !== 'partner'); });
  const rf = $('#rf', view);
  if (rf) rf.onsubmit = (e) => { e.preventDefault(); if (!state.user) return needLogin(); busy(e.submitter, async () => { try { await POST('/role-requests', Object.assign(formData(e.target), { role })); toast(tr('Заявка отправлена на рассмотрение', 'Request sent for review')); go('#/community'); } catch (er) { toastErr(er); } }); };
  if (location.hash.includes('#rating')) requestAnimationFrame(() => { const r = $('#rating', view); if (r) r.scrollIntoView({ block: 'start' }); });
});

/* =================== ПОДДЕРЖКА =================== */
// Обращение — это переписка с оператором в том же виде, что и чат. Статусы: открыто → есть ответ → решено.
const TOPICS = () => [tr('Вход и аккаунт', 'Sign-in & account'), tr('Заявка и поиск', 'Report & search'), tr('Чат и безопасность', 'Chat & safety'), tr('Оплата и тарифы', 'Payments & plans'), tr('Предложение', 'Suggestion'), tr('Другое', 'Other')];
export const tkStatus = (s, staff) => ({
  open: [staff ? tr('Ждёт ответа', 'Awaiting reply') : tr('Открыто', 'Open'), 'chip-warn'],
  answered: [staff ? tr('Отвечено', 'Answered') : tr('Есть ответ', 'Answered'), 'chip-ok'],
  closed: [tr('Решено', 'Resolved'), 'chip-done']
}[s] || [s, '']);
function newTicketSheet() {
  const s = sheet(h`${sheetHead(tr('Новое обращение', 'New request'), tr('Оператор ответит здесь, на сайте, — пришлём уведомление', 'An operator will reply here on the site — we will notify you'))}
    <form class="stack" id="ntf" novalidate>
      <fieldset class="tk-topics"><legend>${tr('О чём вопрос', 'Topic')}</legend><div class="tk-chips">${TOPICS().map((l) => h`<label class="tk-chip"><input type="radio" name="topic" value="${l}"><span>${l}</span></label>`)}</div></fieldset>
      <label class="field"><span>${t('sup.subject', 'Тема', 'Subject')}</span><input name="subject" maxlength="160" autocomplete="off" placeholder="${tr('Коротко, например: не приходит код', 'In short, e.g. the code does not arrive')}"></label>
      <label class="field"><span>${t('f.message', 'Сообщение', 'Message')}</span><textarea name="text" rows="5" maxlength="4000" placeholder="${tr('Что случилось и что вы уже попробовали', 'What happened and what you have already tried')}"></textarea></label>
      <p class="tk-err hide" id="ntErr" role="alert"></p>
      <button class="btn btn-block btn-lg">${icon('send')}${tr('Отправить', 'Send')}</button>
    </form>`);
  const f = $('#ntf', s.el), err = $('#ntErr', f);
  const fail = (m, el) => { err.textContent = m; err.classList.remove('hide'); el.focus(); };
  $$('input[name=topic]', f).forEach((r) => r.onchange = () => { const sj = f.elements.subject; if (!sj.value.trim() || sj.dataset.auto) { sj.value = r.value; sj.dataset.auto = '1'; } err.classList.add('hide'); });
  f.elements.subject.oninput = (e) => { delete e.target.dataset.auto; err.classList.add('hide'); };
  f.elements.text.oninput = () => err.classList.add('hide');
  f.onsubmit = (e) => {
    e.preventDefault();
    const subject = f.elements.subject.value.trim(), text = f.elements.text.value.trim();
    if (!subject) return fail(tr('Выберите тему выше или напишите её', 'Pick a topic above or type a subject'), f.elements.subject);
    if (!text) return fail(tr('Опишите вопрос в сообщении', 'Describe your question in the message'), f.elements.text);
    busy(e.submitter, async () => { try { const r = await POST('/tickets', { subject, text }); s.close(); go('#/support/' + r.id); } catch (er) { toastErr(er); } });
  };
}
route('/support', async (view) => {
  const draw = async () => {
    const { items } = await GET('/tickets');
    mount(view, h`<div class="wrap sup-wrap">
      <div class="sup-head"><div><h1>${t('sup.title', 'Поддержка', 'Support')}</h1><p>${t('sup.sub', 'Опишите вопрос — оператор ответит здесь, а мы пришлём уведомление.', 'Describe your issue — an operator will reply here and we will notify you.')}</p></div>
        <button type="button" class="btn" data-nt>${icon('plus')}${tr('Написать в поддержку', 'Contact support')}</button></div>
      ${items.length ? h`<h2 class="sup-h2">${t('sup.my', 'Мои обращения', 'My requests')}</h2><div class="tk-list">${items.map((x) => { const [sl, sc] = tkStatus(x.status); return h`<a class="tk-item tk-${x.status}" href="#/support/${x.id}">
        <span class="tk-ic">${icon(x.status === 'closed' ? 'check' : 'help')}</span>
        <span class="tk-body"><span class="tk-top"><b>${x.subject}</b><time>${listTime(x.updated_at)}</time></span>
        <span class="tk-last">${x.last_staff ? h`<span class="you">${tr('Поддержка: ', 'Support: ')}</span>` : ''}${x.last || ''}</span>
        <span class="tk-meta"><span class="chip ${sc}">${sl}</span><span>№${x.id} · ${x.msgs} ${tr('сообщ.', 'msgs')}</span></span></span>${icon('chevR', 'ic-sm tk-go')}</a>`; })}</div>`
      : h`<div class="empty sup-empty">${icon('help')}<b>${t('sup.empty', 'Обращений пока нет', 'No requests yet')}</b>${tr('Если что-то не получается — напишите, оператор ответит здесь.', 'If something does not work — write to us, an operator will reply here.')}<div style="margin-top:16px"><button type="button" class="btn" data-nt>${icon('plus')}${tr('Написать в поддержку', 'Contact support')}</button></div></div>`}
      <p class="sup-mail">${icon('mail', 'ic-sm')}<span>${tr('Можно и на почту: ', 'Or by e-mail: ')}<a href="mailto:support@my-bestagent.ru">support@my-bestagent.ru</a></span></p>
    </div>`);
    $$('[data-nt]', view).forEach((b) => b.onclick = newTicketSheet);
  };
  await draw();
  onLeave(onEvent((type) => { if (type === 'ticket') draw().catch(() => {}); }));
  if (query().get('new')) newTicketSheet();
}, { auth: true });

export async function ticketView(view, id, staff) {
  let data = await GET('/tickets/' + id);
  const render = () => {
    const { ticket, messages, user } = data;
    const [sl, sc] = tkStatus(ticket.status, staff);
    const draft = $('#tkt', view)?.value || '';
    const hadFocus = document.activeElement?.id === 'tkt';
    let lastDay = '', prev = null;
    const rows = messages.map((m) => {
      const mine = staff ? !!m.staff : !m.staff;
      const d = dayLabel(m.created_at); let out = '';
      if (d !== lastDay) { out = h`<div class="msg-day"><span>${d}</span></div>`.s; lastDay = d; prev = null; }
      const cont = !!prev && !!prev.staff === !!m.staff && Math.abs(pDate(m.created_at) - pDate(prev.created_at)) < 5 * 60e3;
      prev = m;
      const who = m.staff ? tr('Поддержка', 'Support') : staff ? (user ? user.name : tr('Пользователь', 'User')) : '';
      return out + h`<div class="msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''}">${!mine && !cont && who ? h`<b class="msg-who">${m.staff ? icon('help', 'ic-sm') : ''}${who}</b>` : ''}<span class="msg-text">${m.text}</span><span class="msg-meta"><time>${timeOf(m.created_at)}</time></span></div>`.s;
    }).join('');
    mount(view, h`<div class="wrap tk-page">
      <div class="tk-head">
        <a class="icon-btn" href="${staff ? '#/admin/support' : '#/support'}" aria-label="${tr('К списку обращений', 'Back to requests')}">${icon('chevL')}</a>
        <div class="tk-title"><b>${ticket.subject}</b><span>№${ticket.id} · ${fmtDate(ticket.created_at, true)}</span></div>
        <span class="chip ${sc}">${sl}</span>
      </div>
      ${staff && user ? h`<div class="tk-user">${icon('user', 'ic-sm')}<b>${user.name}</b>${user.email || user.phone ? h`<span>${user.email || user.phone}</span>` : ''}${user.email ? h`<a class="link" href="mailto:${user.email}">${tr('Написать на почту', 'E-mail')}</a>` : ''}</div>` : ''}
      <div class="tk-msgs" id="tkm" role="log" aria-live="polite" aria-label="${tr('Переписка', 'Conversation')}">${raw(rows)}</div>
      <div class="tk-actions">${ticket.status === 'closed'
        ? h`<span>${icon('check', 'ic-sm')}${staff ? tr('Решено. Новое сообщение откроет обращение снова.', 'Resolved. A new message reopens it.') : tr('Вопрос решён. Если нет — напишите, и обращение откроется снова.', 'Resolved. If not — just write, and it reopens.')}</span><button type="button" class="btn btn-ghost btn-sm" id="reo">${icon('refresh', 'ic-sm')}${tr('Открыть снова', 'Reopen')}</button>`
        : h`<button type="button" class="btn btn-ghost btn-sm" id="cl">${icon('check', 'ic-sm')}${staff ? tr('Отметить решённым', 'Mark resolved') : tr('Мой вопрос решён', 'My issue is resolved')}</button>`}</div>
      <form class="composer tk-composer" id="mf"><div class="composer-box"><textarea id="tkt" rows="1" maxlength="4000" aria-label="${tr('Сообщение', 'Message')}" placeholder="${staff ? tr('Ответ пользователю', 'Reply to the user') : t('chat.ph', 'Сообщение', 'Message')}"></textarea></div><button class="send" aria-label="${tr('Отправить', 'Send')}" disabled>${icon('send')}</button></form>
    </div>`);
    const form = $('#mf', view), ta = $('#tkt', view);
    ta.value = draft;
    const sync = bindComposer(form, ta, $('.send', form));
    if (hadFocus) ta.focus();
    form.onsubmit = (e) => {
      e.preventDefault(); const text = ta.value.trim(); if (!text) return;
      busy($('.send', form), async () => { try { await POST(`/tickets/${id}/messages`, { text }); ta.value = ''; sync(); data = await GET('/tickets/' + id); render(); toEnd(); } catch (er) { toastErr(er); } });
    };
    const act = async (path, ok) => { try { await POST(`/tickets/${id}/${path}`); data = await GET('/tickets/' + id); render(); toast(ok); } catch (er) { toastErr(er); } };
    const cl = $('#cl', view); if (cl) cl.onclick = () => act('close', tr('Обращение отмечено решённым', 'Marked as resolved'));
    const reo = $('#reo', view); if (reo) reo.onclick = () => act('reopen', tr('Обращение открыто снова', 'Request reopened'));
  };
  const toEnd = () => requestAnimationFrame(() => { const last = $('#tkm', view)?.lastElementChild; if (last) last.scrollIntoView({ block: 'end' }); });
  render(); toEnd();
  onLeave(onEvent(async (type, d) => { if (type === 'ticket' && Number(d.ticket_id) === Number(id)) { try { data = await GET('/tickets/' + id); render(); toEnd(); } catch (e) { /* обращение недоступно */ } } }));
}
route('/support/:id', (view, p) => ticketView(view, p.id, false), { auth: true });

/* =================== ВХОД И РЕГИСТРАЦИЯ =================== */
route('/login', async (view) => {
  if (state.user) return go(query().get('next') || '#/me');
  const next = query().get('next') || '#/me';
  const demoEmail = state.config?.demoEmail;
  const demoRoles = {
    'anna@example.com': tr('Пользователь', 'User'),
    'igor@example.com': tr('Волонтёр', 'Volunteer'),
    'lizaalert@example.com': tr('Партнёр', 'Partner'),
  };
  let target = '', info = null;
  const shell = (inner) => mount(view, h`<div class="wrap" style="max-width:460px;padding-top:30px"><div class="center" style="margin-bottom:24px"><img src="/assets/logo-256.png" alt="" class="logo-fx" style="width:120px;margin:0 auto 14px"></div><div class="card pad view">${inner}</div>
    <p class="xs muted center" style="margin-top:16px">${demoEmail ? tr('Используйте только вымышленные данные.', 'Please use fictional data only.') : t('login.foot', 'Регистрация доступна с 18 лет.', 'Registration is available from age 18.')}</p></div>`);
  const via = state.config?.login || { email: true, phone: true };
  const step1 = () => {
    if (!demoEmail && !via.email && !via.phone) {
      // рабочий режим, а почта и SMS ещё не подключены — честно говорим об этом вместо формы, которая не сработает
      shell(h`<h2>${t('login.title', 'Вход и регистрация', 'Sign in or sign up')}</h2>
        <div class="note note-blue" style="margin-top:14px">${icon('clock')}<div>${tr('Вход и регистрация откроются совсем скоро. А пока можно смотреть заявки на карте, проверить вещь в реестре ценностей и прочитать документы платформы.', 'Sign-in and sign-up will open very soon. Meanwhile you can browse reports on the map, check an item in the valuables registry and read the platform documents.')}</div></div>
        <div class="stack" style="margin-top:20px"><a class="btn btn-red btn-block btn-lg" href="#/map">${icon('map')}${tr('Открыть карту поиска', 'Open the search map')}</a><a class="btn btn-ghost btn-block" href="#/">${tr('На главную', 'Home')}</a></div>`);
      return;
    }
    const only = via.email && !via.phone ? 'email' : via.phone && !via.email ? 'phone' : '';
    const field = demoEmail
      ? h`<label class="field"><span>${tr('Тестовый профиль', 'Demo profile')}</span><select name="target"><option value="${demoEmail}">${tr('Мой профиль в этом браузере', 'My profile in this browser')}</option>${state.config.demoLogins.map((email) => h`<option value="${email}" ${target === email ? 'selected' : ''}>${demoRoles[email]} · ${email}</option>`)}</select></label>`
      : only === 'email'
        ? h`<label class="field"><span>E-mail</span><input name="target" type="email" required autocomplete="email" inputmode="email" enterkeyhint="next" autocapitalize="off" spellcheck="false" placeholder="name@mail.ru" value="${target}"></label>`
        : only === 'phone'
          ? h`<label class="field"><span>${tr('Телефон', 'Phone')}</span><input name="target" type="tel" required autocomplete="tel" inputmode="tel" enterkeyhint="next" placeholder="+7 900 000-00-00" value="${target}"></label>`
          : h`<label class="field"><span>${t('f.contact', 'Телефон или e-mail', 'Phone or e-mail')}</span><input name="target" required autocomplete="username" inputmode="email" enterkeyhint="next" autocapitalize="off" spellcheck="false" placeholder="+7 900 000-00-00" value="${target}"></label>`;
    shell(h`<h2>${demoEmail ? tr('Вход в демоверсию', 'Demo sign-in') : t('login.title', 'Вход и регистрация', 'Sign in or sign up')}</h2><p class="muted" style="margin-top:8px">${demoEmail ? tr('Создайте свой тестовый профиль или выберите готовый. Готовыми профилями пользуются все посетители.', 'Create your own test profile or choose a sample. Sample profiles are shared by all visitors.') : (only === 'email' ? tr('Введите e-mail — пришлём код.', 'Enter your e-mail — we will send a code.') : only === 'phone' ? tr('Введите номер телефона — пришлём код по SMS.', 'Enter your phone number — we will send a code by SMS.') : t('login.sub', 'Введите e-mail или номер телефона — пришлём код.', 'Enter your e-mail or phone — we will send a code.'))}</p>
      <form class="stack" style="margin-top:20px" id="f1">${field}
      <button class="btn btn-red btn-block btn-lg">${t('login.get_code', 'Получить код', 'Get code')}</button></form>`);
    $('#f1', view).onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { try { info = await POST('/auth/request', { target: e.target.elements.namedItem('target').value }); target = info.target; step2(); } catch (er) { toastErr(er); } }); };
  };
  const step2 = () => {
    shell(h`<button class="back" id="bk">${icon('arrowL', 'ic-sm')}${demoEmail && target === demoEmail ? tr('Мой тестовый профиль', 'My test profile') : target}</button><h2>${t('login.code', 'Введите код', 'Enter the code')}</h2>
      <p class="muted" style="margin-top:8px">${demoEmail ? tr('Введите шесть цифр, показанных ниже.', 'Enter the six digits shown below.') : info.type === 'email' ? t('login.code_email', 'Мы отправили 6-значный код на почту.', 'We sent a 6-digit code to your e-mail.') : t('login.code_sms', 'Мы отправили 6-значный код по SMS.', 'We sent a 6-digit code by SMS.')}</p>
      ${info.devCode ? h`<div class="note note-blue small" style="margin-top:14px">${icon('spark')}<div>${t('login.dev', 'Тестовый режим (SMS/почта не подключены): код', 'Test mode (SMS/e-mail not connected): code')} <b style="font-family:var(--display);letter-spacing:.1em">${info.devCode}</b></div></div>` : ''}
      <form id="f2" style="margin-top:20px" class="stack"><div class="otp">${[0, 1, 2, 3, 4, 5].map((i) => h`<input inputmode="numeric" pattern="[0-9]*" aria-label="${tr('Цифра', 'Digit')} ${i + 1}" autocomplete="${i ? 'off' : 'one-time-code'}">`)}</div>
      ${info.isNew ? h`<div class="divider"></div><p style="font-weight:700">${t('login.new', 'Вы здесь впервые — заполните профиль', 'You are new here — complete your profile')}</p>
        <label class="field"><span>${t('f.name', 'Имя', 'Name')} <em>*</em></span><input name="name" required maxlength="80" autocomplete="name"></label>
        <div class="grid-2"><label class="field"><span>${t('login.birth', 'Дата рождения', 'Date of birth')} <em>*</em></span><input name="birthdate" type="date" required max="${new Date(Date.now() - 18 * 365.25 * 864e5).toISOString().slice(0, 10)}"></label>
        <label class="field"><span>${t('wiz.city', 'Город', 'City')}</span><input name="city" maxlength="80"></label></div>
        <label class="check"><input type="checkbox" name="consent_pd"> <span><a class="doc-link" href="#/legal/consent" data-doc="consent" data-for="consent_pd">${t('login.c1', 'Даю согласие на обработку персональных данных', 'I consent to the processing of personal data')}</a></span></label>
        <label class="check"><input type="checkbox" name="consent_policy"> <span><a class="doc-link" href="#/legal/terms" data-doc="terms,privacy" data-for="consent_policy">${t('login.c2', 'Принимаю пользовательское соглашение и политику конфиденциальности', 'I accept the terms of use and the privacy policy')}</a></span></label>
        <label class="check"><input type="checkbox" name="adult"> <span>${t('login.c3', 'Мне исполнилось 18 лет', 'I am 18 or older')}</span></label>` : ''}
      <button class="btn btn-red btn-block btn-lg">${info.isNew ? t('login.register', 'Зарегистрироваться', 'Sign up') : t('login.enter', 'Войти', 'Sign in')}</button>
      <button type="button" class="btn btn-ghost btn-block" id="re">${t('login.resend', 'Отправить код повторно', 'Resend code')}</button></form>`);
    const boxes = $$('.otp input', view);
    boxes.forEach((b, i) => {
      // поддержка автоподстановки кода из SMS (iOS/Android вставляют все 6 цифр в одно поле) и вставки
      const fill = (v, from) => { v.split('').forEach((c, k) => { if (boxes[from + k]) boxes[from + k].value = c; }); const last = Math.min(5, from + v.length - 1); boxes[Math.min(5, last + 1)].focus(); if (boxes.every((x) => x.value)) { boxes[5].focus(); if (!info.isNew) $('#f2', view).requestSubmit(); } };
      b.oninput = () => { const v = b.value.replace(/\D/g, ''); if (v.length > 1) { fill(v.slice(0, 6 - (v.length >= 6 ? 0 : i)), v.length >= 6 ? 0 : i); return; } b.value = v; if (v && boxes[i + 1]) boxes[i + 1].focus(); if (boxes.every((x) => x.value) && !info.isNew) $('#f2', view).requestSubmit(); };
      b.onfocus = () => b.select();
      b.onkeydown = (e) => { if (e.key === 'Backspace' && !b.value && boxes[i - 1]) boxes[i - 1].focus(); };
      b.onpaste = (e) => { const v = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (v.length) { e.preventDefault(); v.split('').forEach((c, k) => { if (boxes[k]) boxes[k].value = c; }); boxes[Math.min(5, v.length - 1)].focus(); if (v.length === 6 && !info.isNew) $('#f2', view).requestSubmit(); } };
    });
    boxes[0].focus();
    $('#bk', view).onclick = step1;
    $('#re', view).onclick = (e) => busy(e.currentTarget, async () => { try { info = await POST('/auth/request', { target }); toast(tr('Код отправлен', 'Code sent')); step2(); } catch (er) { toastErr(er); } });
    $('#f2', view).onsubmit = (e) => {
      e.preventDefault();
      const f = formData(e.target); const code = boxes.map((b) => b.value).join('');
      if (code.length !== 6) return toast(tr('Введите 6 цифр кода', 'Enter the 6-digit code'), 'err');
      if (info.isNew && !f.adult) return toast(t('login.e_adult', 'Регистрация доступна только с 18 лет', 'Registration is for ages 18+'), 'err');
      busy(e.submitter || $('#f2 .btn-red', view), async () => {
        try {
          const r = await POST('/auth/verify', Object.assign(f, { target, code, lang: state.lang }));
          state.user = r.user; connectStream(); await refreshMe();
          if (r.user.lang !== state.lang && !info.isNew) await setLang(r.user.lang, false);
          toast(info.isNew ? tr('Добро пожаловать!', 'Welcome!') : tr('Вы вошли', 'Signed in'));
          go(next);
        } catch (er) { toastErr(er); }
      });
    };
  };
  step1();
});

/* =================== ПРАВОВЫЕ ДОКУМЕНТЫ =================== */
// Тексты приходят с сервера (/api/legal/:doc) — из того же источника собирается PDF, поэтому страница и файл всегда совпадают.
const LEGAL_IDS = ['terms', 'privacy', 'consent', 'publication'];
const legalTitle = (id) => ({
  terms: t('legal.terms', 'Пользовательское соглашение', 'Terms of use'),
  privacy: t('legal.privacy', 'Политика конфиденциальности', 'Privacy policy'),
  consent: t('legal.consent', 'Согласие на обработку персональных данных', 'Personal data consent'),
  publication: t('legal.publication', 'Согласие на распространение персональных данных', 'Consent to data dissemination')
})[id];
const legalShort = (id) => ({ terms: tr('Соглашение', 'Terms'), privacy: tr('Политика', 'Privacy'), consent: tr('Обработка ПД', 'Processing'), publication: tr('Распространение ПД', 'Dissemination') })[id];
const LEGAL_IC = { terms: 'book', privacy: 'shield', consent: 'seal', publication: 'globe' };
const legalCache = {};
const loadLegal = (id) => (legalCache[id + state.lang] ||= GET(`/legal/${id}?lang=${state.lang}`).catch((e) => { delete legalCache[id + state.lang]; throw e; }));
const legalPdf = (id) => `/api/legal/${id}.pdf?lang=${state.lang}`;
const legalDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString(state.lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
// Длинный документ сгруппирован: каждый раздел — заголовок с плюсиком, текст раскрывается по нажатию.
// Поиск по странице (Ctrl+F) сам раскрывает нужный раздел; при печати раскрыто всё.
const legalItems = (s) => s.items.map((it) => it.bullet ? h`<p class="legal-li">${it.text}</p>` : h`<p class="legal-p">${it.n ? h`<span class="legal-n">${it.n}</span>` : ''}<span>${it.text}</span></p>`);
const legalBody = (d) => {
  const folds = d.sections.filter((s) => s.h).length;
  return h`<div class="legal-body">
  ${folds > 1 ? h`<div class="legal-fold-bar"><button type="button" class="legal-fold-all" data-fold-all aria-expanded="false">${icon('list', 'ic-sm')}<span>${tr('Развернуть все разделы', 'Expand all sections')}</span></button></div>` : ''}
  ${d.sections.map((s, i) => s.h
    ? h`<details class="legal-sec" id="lg-${i}"><summary><h2><span class="legal-hn">${s.n}.</span><span>${s.h}</span></h2><i class="legal-plus" aria-hidden="true"></i></summary><div class="legal-sec-body">${legalItems(s)}</div></details>`
    : h`<section class="legal-sec legal-sec-plain" id="lg-${i}">${legalItems(s)}</section>`)}
  ${d.requisites.length ? h`<div class="legal-req"><b>${tr('Реквизиты оператора', 'Operator details')}</b><dl>${d.requisites.map(([k, v]) => h`<dt>${k}</dt><dd>${v}</dd>`)}</dl></div>` : ''}</div>`;
};
// «Развернуть все / Свернуть все»: подпись кнопки следует за состоянием разделов (и при ручном раскрытии)
function legalFolds(root) {
  const all = $('[data-fold-all]', root); if (!all) return;
  const secs = $$('details.legal-sec', root);
  const sync = () => {
    const open = secs.every((d) => d.open);
    all.setAttribute('aria-expanded', String(open));
    $('span', all).textContent = open ? tr('Свернуть все разделы', 'Collapse all sections') : tr('Развернуть все разделы', 'Expand all sections');
  };
  all.onclick = () => { const open = !secs.every((d) => d.open); secs.forEach((d) => { d.open = open; }); sync(); };
  secs.forEach((d) => d.addEventListener('toggle', sync));
}

// Документ в нижнем листе: читается, не уходя со страницы (форма регистрации не теряется), кнопка «Принимаю» ставит галочку
function legalSheet(ids, onAccept) {
  let cur = ids[0];
  const s = sheet(h`<div class="legal-sheet"></div>`, { wide: true });
  const box = $('.legal-sheet', s.el);
  const draw = async () => {
    let d;
    try { d = await loadLegal(cur); } catch (e) { mount(box, h`${sheetHead(legalTitle(cur))}<div class="empty">${icon('alert')}<b>${e.message}</b></div>`); $('[data-close]', box).onclick = s.close; return; }
    mount(box, h`${sheetHead(d.title, `${tr('Редакция от', 'Effective from')} ${legalDate(d.edition)}`)}
      ${ids.length > 1 ? h`<div class="seg" style="margin-bottom:16px">${ids.map((x) => h`<button type="button" class="${x === cur ? 'on' : ''}" data-t="${x}">${icon(LEGAL_IC[x], 'ic-sm')}${legalShort(x)}</button>`)}</div>` : ''}
      <p class="muted small" style="margin-bottom:6px">${d.lead}</p>
      ${legalBody(d)}
      <div class="legal-sheet-foot"><a class="btn btn-ghost" href="${legalPdf(cur)}" download aria-label="${tr('Скачать PDF', 'Download PDF')}">${icon('download', 'ic-sm')}PDF</a>
        ${onAccept ? h`<button type="button" class="btn btn-red grow" data-accept>${icon('check', 'ic-sm')}${tr('Прочитал(а) и принимаю', 'I have read and accept')}</button>` : h`<button type="button" class="btn grow" data-close>${tr('Закрыть', 'Close')}</button>`}</div>`);
    $$('[data-close]', box).forEach((b) => b.onclick = s.close);
    legalFolds(box);
    $$('[data-t]', box).forEach((b) => b.onclick = () => { cur = b.dataset.t; s.el.scrollTop = 0; draw(); });
    const acc = $('[data-accept]', box); if (acc) acc.onclick = () => { onAccept(); s.close(); };
  };
  mount(box, h`${sheetHead(legalTitle(cur))}<div class="legal-skel"><i></i><i></i><i></i><i></i></div>`);
  $('[data-close]', box).onclick = s.close;
  draw();
}
// Любая ссылка data-doc="terms,privacy" открывает документ в листе; data-for — имя галочки, которую ставит «Принимаю».
// Ctrl/⌘-клик и средняя кнопка по-прежнему открывают страницу документа в новой вкладке.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-doc]');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  e.preventDefault();
  const form = a.closest('form'); const inp = a.dataset.for && form ? form.querySelector(`[name="${a.dataset.for}"]`) : null;
  legalSheet(a.dataset.doc.split(','), inp ? () => { inp.checked = true; inp.dispatchEvent(new Event('change', { bubbles: true })); } : null);
});

route('/legal', (view) => {
  mount(view, h`<div class="wrap legal-wrap"><div class="page-head">${back('back')}<h1>${t('legal.all', 'Документы и согласия', 'Legal documents')}</h1>
    <p>${tr('Правила платформы и согласия по 152-ФЗ. Читайте онлайн или скачайте PDF.', 'Platform rules and personal-data consents. Read online or download a PDF.')}</p></div>
    <div class="legal-index">${LEGAL_IDS.map((id) => h`<div class="card legal-card">
      <a class="legal-card-main" href="#/legal/${id}"><span class="legal-ic">${icon(LEGAL_IC[id], '', 'duo')}</span><span class="grow" style="min-width:0"><b>${legalTitle(id)}</b><span class="small muted" data-lead="${id}"></span></span>${icon('chevR', 'ic-sm')}</a>
      <a class="legal-dl" href="${legalPdf(id)}" download>${icon('download', 'ic-sm')}${tr('Скачать PDF', 'Download PDF')}</a></div>`)}</div>
    <p class="xs muted" style="margin-top:18px">${tr('Вопросы по документам и персональным данным — в разделе', 'Questions about documents and personal data —')} <a class="link" href="#/support">${t('sup.title', 'Поддержка', 'Support')}</a>.</p></div>`);
  LEGAL_IDS.forEach((id) => loadLegal(id).then((d) => { const el = $(`[data-lead="${id}"]`, view); if (el) el.textContent = d.lead; }).catch(() => {}));
});

route('/legal/:doc', async (view, p) => {
  const id = LEGAL_IDS.includes(p.doc) ? p.doc : 'terms';
  const d = await loadLegal(id);
  document.title = `${d.title} — ${tr('Мой лучший агент', 'My Best Agent')}`;
  const toc = d.sections.map((s, i) => [s, i]).filter(([s]) => s.h);
  const wide = matchMedia('(min-width: 980px)').matches;
  mount(view, h`<div class="wrap legal-wrap">
    <div class="page-head">${back('back')}
      <nav class="hscroll legal-tabs" aria-label="${tr('Документы', 'Documents')}">${LEGAL_IDS.map((x) => h`<a class="chip chip-btn ${x === id ? 'chip-dark' : ''}" href="#/legal/${x}" ${x === id ? raw('aria-current="page"') : ''}>${icon(LEGAL_IC[x], 'ic-sm')}${legalShort(x)}</a>`)}</nav>
      <h1>${d.title}</h1><p>${d.lead}</p>
      <div class="legal-meta"><span class="chip">${icon('calendar', 'ic-sm')}${tr('Редакция от', 'Effective from')} ${legalDate(d.edition)}</span>
        <div class="legal-actions"><a class="btn btn-red btn-sm" href="${legalPdf(id)}" download>${icon('download', 'ic-sm')}${tr('Скачать PDF', 'Download PDF')}</a><button type="button" class="btn btn-ghost btn-sm" id="lgPrint">${icon('file', 'ic-sm')}${tr('Печать', 'Print')}</button></div></div>
    </div>
    <div class="legal-layout">
      ${toc.length > 1 ? h`<details class="legal-toc card" ${wide ? raw('open') : ''}><summary>${icon('list', 'ic-sm')}<span class="grow">${tr('Содержание', 'Contents')}</span><span class="xs muted">${toc.length}</span></summary>
        <ol>${toc.map(([s, i]) => h`<li><button type="button" data-go="${i}"><span>${s.n}</span>${s.h}</button></li>`)}</ol></details>` : ''}
      <article class="card pad legal-doc">${legalBody(d)}
        <div class="legal-end"><a class="btn btn-ghost btn-sm" href="${legalPdf(id)}" download>${icon('download', 'ic-sm')}${tr('Скачать PDF', 'Download PDF')}</a><a class="btn btn-ghost btn-sm" href="#/legal">${tr('Все документы', 'All documents')}</a></div></article>
    </div></div>`);
  const tocEl = $('.legal-toc', view);
  legalFolds(view);
  $$('[data-go]', view).forEach((b) => b.onclick = () => {
    const el = document.getElementById('lg-' + b.dataset.go); if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (tocEl && !matchMedia('(min-width: 980px)').matches) tocEl.open = false;
  });
  $('#lgPrint', view).onclick = () => window.print();
  // печать и «Сохранить как PDF» из браузера — со всем текстом, затем разделы возвращаются как были
  const before = () => $$('details.legal-sec', view).forEach((d) => { d.dataset.was = d.open ? '1' : ''; d.open = true; });
  const after = () => $$('details.legal-sec', view).forEach((d) => { if (d.dataset.was !== undefined) { d.open = d.dataset.was === '1'; delete d.dataset.was; } });
  addEventListener('beforeprint', before); addEventListener('afterprint', after);
  onLeave(() => { removeEventListener('beforeprint', before); removeEventListener('afterprint', after); });
  // подсветка текущего раздела в оглавлении
  if (tocEl && 'IntersectionObserver' in window) {
    const btns = new Map($$('[data-go]', tocEl).map((b) => [b.dataset.go, b]));
    const ob = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { btns.forEach((b) => b.classList.remove('on')); const b = btns.get(e.target.id.slice(3)); if (b) b.classList.add('on'); } }), { rootMargin: '-20% 0px -70% 0px' });
    $$('.legal-sec', view).forEach((x) => ob.observe(x));
    onLeave(() => ob.disconnect());
  }
});

/* =================== 404 =================== */
route('/404', (view) => (document.title = `${tr('Страница не найдена', 'Page not found')} — ${tr('Мой лучший агент', 'My Best Agent')}`, mount(view, h`<div class="wrap"><div class="success"><div class="big-ic wait">${icon('search')}</div><h2>${tr('Страница не найдена', 'Page not found')}</h2><a class="btn" style="margin-top:20px" href="#/">${tr('На главную', 'Home')}</a></div></div>`)), { notFound: true });

/* =================== язык и тема =================== */
export async function setLang(lang, persist) {
  state.lang = lang === 'en' ? 'en' : 'ru';
  safeSet('mba.lang', state.lang);
  document.documentElement.lang = state.lang;
  try { state.overrides = await GET('/i18n/' + state.lang); } catch (e) { state.overrides = {}; }
  if (persist && state.user) PATCH('/me', { lang: state.lang }).catch(() => {});
}
export { currentPath };
