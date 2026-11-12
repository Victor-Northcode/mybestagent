// Точка входа: оболочка (шапка, нижнее меню, подвал), язык, тема, realtime, PWA.
import { state, t, tr, h, raw, mount, $, $$, icon, GET, refreshMe, handleRoute, setChrome, currentPath, connectStream, onEvent, toast, go, observeReveal } from './core.js';
import { setLang, setTheme, sosSheet } from './views.js';
import './admin.js';

const chrome = () => {
  const u = state.user, p = currentPath();
  const on = (pre) => (pre === '/' ? p === '/' : p.startsWith(pre)) ? 'on' : '';
  mount($('#top'), h`<div class="wrap top-in">
    <button type="button" class="skip-link" id="skipBtn">${tr('К содержимому', 'Skip to content')}</button>
    <a class="brand" href="#/" aria-label="${tr('Мой лучший агент — на главную', 'My Best Agent — home')}"><img src="/assets/logo-256.png" alt=""><span>${tr('Мой лучший агент', 'My Best Agent')}<small>${tr('поиск людей, животных и вещей', 'people, pets & things finder')}</small></span></a>
    <nav class="nav">
      <a href="#/map" class="${on('/map')}">${t('nav.map', 'Карта и поиск', 'Map & search')}</a>
      <a href="#/registry" class="${on('/registry')}">${t('nav.registry', 'Реестр', 'Registry')}</a>
      <a href="#/community" class="${on('/community')}">${t('nav.community', 'Волонтёры', 'Volunteers')}</a>
      ${u && ['moderator', 'admin'].includes(u.role) ? h`<a href="#/admin" class="${on('/admin')}">${t('nav.admin', 'Админ', 'Admin')}</a>` : ''}
    </nav>
    <div class="top-act">
      ${quickNew('qn', 'ic-sm')}
      <button type="button" class="sos-btn" id="sosBtn" aria-haspopup="dialog" aria-label="${tr('SOS: экстренные службы — куда обратиться', 'SOS: emergency services — where to get help')}"><i class="sos-dot" aria-hidden="true"></i>SOS</button>
      <button class="icon-btn lang-btn" id="langBtn" aria-label="${tr('Язык: русский. Переключить на английский (English)', 'Language: English. Switch to Russian (Русский)')}" title="${tr('Switch to English', 'Переключить на русский')}">${icon('globe', 'ic-sm')}<span>${state.lang === 'en' ? 'EN' : 'RU'}</span></button>
      ${u ? h`<a class="icon-btn desk-only" href="#/chats" aria-label="${tr('Сообщения', 'Messages')}">${icon('chat')}${u.unreadChats ? h`<span class="dotbadge">${u.unreadChats}</span>` : ''}</a>
        <a class="icon-btn" href="#/notifications" aria-label="${tr('Уведомления', 'Notifications')}">${icon('bell')}${u.unread ? h`<span class="dotbadge">${u.unread > 99 ? '99+' : u.unread}</span>` : ''}</a>
        <a class="icon-btn desk-only" href="#/me" aria-label="${tr('Кабинет', 'Account')}">${icon('user')}</a>`
      : h`<a class="btn btn-sm" href="#/login">${t('nav.login', 'Войти', 'Sign in')}</a>`}
    </div></div>`);
  const tb = (pre, href, ic, label, extra = '') => { const a = on(pre); return h`<a class="tab ${a}" href="${href}" ${a ? raw('aria-current="page"') : ''}>${icon(ic, '', a ? 'fill' : '')}<span>${label}</span>${extra}</a>`; };
  $('#tabbar').setAttribute('aria-label', tr('Основная навигация', 'Main navigation'));
  mount($('#tabbar'), h`
    ${tb('/', '#/', 'home', t('tab.home', 'Главная', 'Home'))}
    ${tb('/map', '#/map', 'map', t('tab.map', 'Карта', 'Map'))}
    ${quickNew('tn', '')}
    ${tb('/chat', '#/chats', 'chat', t('tab.chats', 'Чаты', 'Chats'), u && u.unreadChats ? h`<span class="dotbadge">${u.unreadChats}</span>` : '')}
    ${u ? tb(currentPath().startsWith('/admin') ? '/admin' : '/me', '#/me', 'user', t('tab.me', 'Кабинет', 'Account')) : tb('/login', '#/login', 'user', t('nav.login', 'Войти', 'Sign in'))}`);
  // шапка перерисовывается целиком — возвращаем фокус на нажатую кнопку, чтобы не терять место при работе с клавиатуры
  $('#langBtn').onclick = async () => { await setLang(state.lang === 'en' ? 'ru' : 'en', true); await handleRoute(); $('#langBtn')?.focus(); };
  $('#skipBtn').onclick = () => { const v = $('#view'); v.tabIndex = -1; v.focus(); };
  $('#sosBtn').onclick = sosSheet;
  const hideFoot = ['map', 'chat', 'admin', 'pay', 'new', 'edit'].includes(document.body.dataset.route);
  $('#foot').classList.toggle('hide', hideFoot);
  if (!hideFoot) footer();
  document.title = tr('Мой лучший агент — поиск людей, животных и вещей', 'My Best Agent — find people, pets and things');
};
function footer() {
  mount($('#foot'), h`<div class="wrap"><div class="footer-grid">
    <div><a class="brand" href="#/"><img src="/assets/logo-256.png" alt=""><span>${tr('Мой лучший агент', 'My Best Agent')}</span></a><p style="margin-top:12px;max-width:340px">${t('foot.about', 'Поиск людей, животных и вещей. Не заменяет полицию: 102, 112.', 'Finding people, pets and things. Does not replace the police: 102, 112.')}</p></div>
    <div><h5>${tr('Платформа', 'Platform')}</h5><a href="#/map">${t('nav.map', 'Карта и поиск', 'Map & search')}</a><a href="#/new/lost">${t('nav.lost', 'Потерял', 'Lost')}</a><a href="#/new/found">${t('nav.found', 'Нашёл', 'Found')}</a><a href="#/registry">${t('nav.registry', 'Реестр', 'Registry')}</a><a href="#/tariffs">${t('tar.title', 'Тарифы', 'Plans')}</a></div>
    <div><h5>${tr('Сообщество', 'Community')}</h5><a href="#/community">${t('nav.community', 'Волонтёры', 'Volunteers')}</a><a href="#/community#rating">${t('home.rating', 'Рейтинг', 'Rating')}</a><a href="#/" data-partner>${t('home.inv', 'Стать партнёром или инвестором', 'Become a partner or investor')}</a><a href="#/support">${t('sup.title', 'Поддержка', 'Support')}</a></div>
    <div><h5>${tr('Документы', 'Legal')}</h5><a href="#/legal/terms">${t('legal.terms', 'Пользовательское соглашение', 'Terms of use')}</a><a href="#/legal/privacy">${t('legal.privacy', 'Политика конфиденциальности', 'Privacy policy')}</a><a href="#/legal/consent">${t('legal.consent', 'Согласие на обработку персональных данных', 'Personal data consent')}</a><a href="#/legal/publication">${t('legal.publication', 'Согласие на распространение персональных данных', 'Consent to data dissemination')}</a><a href="#/legal">${tr('Все документы в PDF', 'All documents (PDF)')}</a></div>
  </div><div class="foot-bottom xs"><span>© ${new Date().getFullYear()} ${tr('Мой лучший агент', 'My Best Agent')}</span><span>${tr('Данные хранятся на серверах в РФ', 'Data is stored on servers in Russia')}</span><span>${tr('Картографические данные © участники OpenStreetMap', 'Map data © OpenStreetMap contributors')}</span></div></div>`);
  const pl = $('[data-partner]', $('#foot')); if (pl) pl.onclick = (e) => { e.preventDefault(); go('#/'); setTimeout(() => { const el = document.getElementById('partner'); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 400); };
}
// «Потерял» и «Нашёл» — главные действия сайта: всегда на виду, в шапке (компьютер) и в нижнем меню (телефон)
function quickNew(cls, icCls) {
  const p = currentPath();
  const btn = (kind, ic, label) => {
    const cur = p.startsWith('/new/' + kind);
    return h`<a href="#/new/${kind}" class="${cls} ${cls}-${kind} ${cur ? 'on' : ''}" ${cur ? raw('aria-current="page"') : ''}>${icon(ic, icCls)}<span>${label}</span></a>`;
  };
  return h`<div class="${cls}-group" role="group" aria-label="${tr('Новая заявка', 'New report')}">
    ${btn('lost', 'search', t('nav.lost', 'Потерял', 'Lost'))}${btn('found', 'heart', t('nav.found', 'Нашёл', 'Found'))}</div>`;
}

// Язык определяется автоматически по настройкам браузера; сменить можно кнопкой в шапке.
function detectLang() {
  const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'ru'];
  for (const l of list) { const c = String(l).slice(0, 2).toLowerCase(); if (['ru', 'uk', 'be', 'kk', 'ky', 'uz', 'hy', 'az', 'tg'].includes(c)) return 'ru'; if (c === 'en') return 'en'; }
  return 'en';
}

async function boot() {
  setTheme(); // тёмной темы нет — сайт всегда светлый
  // глобальные обработчики
  document.addEventListener('submit', (e) => e.preventDefault(), true);
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-back]'); if (b) { e.preventDefault(); if (history.length > 1) history.back(); else go('#/'); } });
  // шапка: тень при прокрутке; на телефоне прячется при движении вниз и возвращается при движении вверх
  // направление считаем от точки разворота, а не по одному событию: плавная прокрутка даёт много мелких шагов
  let lastY = scrollY, turnY = scrollY, dir = 0;
  addEventListener('scroll', () => {
    const y = scrollY, top = $('#top'); top.classList.toggle('scrolled', y > 4);
    const d = Math.sign(y - lastY); if (d && d !== dir) { dir = d; turnY = lastY; }
    if (innerWidth < 980 && !document.querySelector('.overlay') && !document.body.classList.contains('kb')) {
      if (y < 80 || (dir < 0 && turnY - y > 24)) top.classList.remove('up');
      else if (dir > 0 && y > 160 && y - turnY > 24) top.classList.add('up');
    }
    lastY = y;
  }, { passive: true });
  addEventListener('hashchange', () => $('#top').classList.remove('up'));
  // клавиатура на телефоне: прячем нижнее меню, чтобы оно не перекрывало поле ввода и кнопки
  const touch = matchMedia('(pointer: coarse)').matches;
  const typing = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'file', 'button', 'submit'].includes(el.type)));
  if (touch) {
    document.addEventListener('focusin', (e) => { if (typing(e.target)) { document.body.classList.add('kb'); $('#top').classList.remove('up'); } });
    document.addEventListener('focusout', () => setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove('kb'); }, 120));
  }
  // реальная видимая высота (на iOS клавиатура не уменьшает 100dvh) — по ней строится экран чата
  const vv = window.visualViewport;
  if (vv) {
    const onVv = () => { document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px'); if (document.body.dataset.route === 'chat' && touch) scrollTo(0, 0); };
    vv.addEventListener('resize', onVv); onVv();
  }
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installPrompt = e; });
  setChrome(chrome);

  const [cfg, me] = await Promise.all([GET('/config'), GET('/me').catch(() => ({ user: null }))]);
  state.config = cfg; state.user = me.user;
  let lang = state.lang;
  if (!lang) lang = state.user?.lang || detectLang(); // язык определяется сам при первом входе
  await setLang(lang, !state.lang && !!state.user);

  connectStream();
  onEvent((type, d) => {
    if (type === 'notification') {
      toast(d.title, d.type === 'emergency' ? 'err' : 'info', d.body, () => d.link && go(d.link));
      refreshMe().catch(() => {});
    }
    if (type === 'message' && !location.hash.startsWith('#/chat/' + d.chat_id)) refreshMe().catch(() => {});
  });
  addEventListener('hashchange', handleRoute);
  await handleRoute();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data && e.data.url) location.href = e.data.url; });
  // обновлять счётчики при возврате во вкладку
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) refreshMe().catch(() => {}); });
}
boot().catch((e) => { document.getElementById('view').innerHTML = '<div class="wrap"><div class="empty" style="margin-top:40px"><b>Не удалось загрузить платформу</b>' + (e.message || '') + '</div></div>'; });
export { observeReveal };
