// Уведомления и установка приложения — блоки личного кабинета.
// pushCard — настройки уведомлений (это устройство, что присылать, письма); installCard — «Установить приложение»;
// meNudge — одна ненавязчивая подсказка на главной кабинета (установить или включить уведомления).
import {
  state, t, tr, h, raw, mount, $, $$, icon, GET, POST, PATCH, refreshMe, toast, toastErr, busy, onLeave, ago, plural,
  enablePush, disablePush, pushStatus, isIOS, isAndroid, isStandalone
} from './core.js';

const PUSH_TYPES = () => [
  ['match', 'match', tr('Совпадения и находки', 'Matches and sightings'), tr('Нашлась похожая заявка или замечен ваш предмет из реестра', 'A similar report was found or your registry item was spotted')],
  ['chat', 'chat', tr('Сообщения в чатах', 'Chat messages'), tr('Отклики и новые сообщения по заявкам', 'Replies and new messages on reports')],
  ['support', 'help', tr('Ответы поддержки', 'Support replies'), tr('Когда поддержка ответит на ваше обращение', 'When support answers your request')],
  ['emergency', 'siren', tr('Экстренные оповещения рядом', 'Emergency alerts nearby'), tr('Срочный поиск в вашей зоне оповещений', 'Urgent search in your alert zone')],
  ['moderation', 'file', tr('Статус заявок', 'Report status'), tr('Проверка модератором, публикация, «найдено»', 'Moderation, publication, “found”')],
  ['account', 'wallet', tr('Аккаунт', 'Account'), tr('Оплата, баллы, семья, роль волонтёра', 'Payments, points, family, volunteer role')]
];
const plat = () => (isIOS() ? 'ios' : isAndroid() ? 'android' : 'desktop');
const touch = () => matchMedia('(pointer: coarse)').matches;

// значки шагов установки — как их рисуют сами браузеры
const SVG = {
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M7 10H6a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18 10h-1"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 8v8M8 12h8"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10 18.5h4"/></svg>'
};
const step = (n, svg, text) => h`<li class="ins-step"><span class="ins-n">${n}</span><span class="ins-ic">${raw(SVG[svg])}</span><span class="ins-tx">${text}</span></li>`;

/* =================== уведомления =================== */
export async function pushCard(el) {
  const u = state.user; if (!u) return;
  const ps = await pushStatus();
  const prefs = u.push_prefs || {};
  const devs = ps === 'on' || u.push_devices ? (await GET('/push/devices').catch(() => ({ items: [] }))).items : [];
  const p = plat();
  const deniedHow = p === 'ios'
    ? tr('Откройте «Настройки» iPhone → «Уведомления» → «Мой агент» → включите «Допуск уведомлений».', 'Open iPhone Settings → Notifications → My Best Agent → turn on Allow Notifications.')
    : p === 'android'
      ? tr('Нажмите на значок слева от адреса сайта → «Разрешения» → «Уведомления» → «Разрешить». Если приложение установлено: «Настройки» телефона → «Приложения» → «Мой агент» → «Уведомления».', 'Tap the icon left of the site address → Permissions → Notifications → Allow. For the installed app: phone Settings → Apps → My Best Agent → Notifications.')
      : tr('Нажмите на значок замка слева от адреса сайта → «Уведомления» → «Разрешить», затем обновите страницу.', 'Click the lock icon left of the site address → Notifications → Allow, then reload the page.');
  const others = devs.length - (ps === 'on' ? 1 : 0);
  const block = {
    on: h`<div class="pn-state pn-on"><span class="pn-badge">${icon('check', 'ic-sm')}</span><div class="grow"><b>${tr('Включены на этом устройстве', 'On for this device')}</b>
        <span>${others > 0 ? tr(`И ещё на ${others} ${plural(others, 'устройстве', 'устройствах', 'устройствах')}`, `And on ${others} more ${others === 1 ? 'device' : 'devices'}`) : tr('Придут, даже когда сайт закрыт', 'They arrive even when the site is closed')}</span></div></div>
      <div class="pn-actions"><button type="button" class="btn btn-soft btn-sm" id="pnTest">${icon('bell', 'ic-sm')}${tr('Прислать проверочное', 'Send a test')}</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pnOff">${tr('Выключить на этом устройстве', 'Turn off on this device')}</button></div>`,
    off: h`<div class="pn-state"><span class="pn-badge pn-badge-off">${icon('bell', 'ic-sm')}</span><div class="grow"><b>${tr('На этом устройстве выключены', 'Off on this device')}</b>
        <span>${tr('Включите — и узнаете о совпадении или новом сообщении сразу, даже когда сайт закрыт.', 'Turn them on to hear about a match or a new message right away, even when the site is closed.')}</span></div></div>
      <button type="button" class="btn btn-blue pn-main" id="pnOn">${icon('bell')}${tr('Включить уведомления', 'Turn on notifications')}</button>
      <p class="xs muted pn-hint">${tr('Браузер спросит разрешение — нажмите «Разрешить».', 'Your browser will ask for permission — tap Allow.')}</p>`,
    denied: h`<div class="pn-state pn-warn"><span class="pn-badge pn-badge-warn">${icon('lock', 'ic-sm')}</span><div class="grow"><b>${tr('Уведомления запрещены в браузере', 'Notifications are blocked in the browser')}</b>
        <span>${deniedHow}</span></div></div>
      <button type="button" class="btn btn-soft btn-sm pn-retry" id="pnRetry">${icon('refresh', 'ic-sm')}${tr('Я разрешил — проверить', 'I allowed it — check again')}</button>`,
    unsupported: isIOS() && !isStandalone()
      ? h`<div class="pn-state pn-warn"><span class="pn-badge pn-badge-warn">${icon('phoneapp', 'ic-sm')}</span><div class="grow"><b>${tr('На iPhone уведомления приходят в приложении', 'On iPhone, notifications come through the app')}</b>
          <span>${tr('Установите сайт на экран «Домой» (это бесплатно и занимает 10 секунд), откройте его оттуда и включите уведомления здесь же.', 'Add the site to your Home Screen (free, 10 seconds), open it from there and turn notifications on here.')}</span></div></div>
        <a class="btn btn-soft btn-sm pn-retry" href="#installCard" id="pnHow">${tr('Как установить', 'How to install')}</a>`
      : h`<div class="pn-state pn-warn"><span class="pn-badge pn-badge-warn">${icon('alert', 'ic-sm')}</span><div class="grow"><b>${tr('Этот браузер не поддерживает уведомления', 'This browser does not support notifications')}</b>
          <span>${tr('Откройте сайт в Chrome, Яндекс Браузере, Edge, Firefox или Safari.', 'Open the site in Chrome, Edge, Firefox or Safari.')}</span></div></div>`
  }[ps];
  mount(el, h`<div class="pn-head"><h3>${t('set.notif', 'Уведомления', 'Notifications')}</h3><span class="chip ${ps === 'on' ? 'chip-ok' : ''}">${ps === 'on' ? tr('включены', 'on') : tr('выключены', 'off')}</span></div>
    ${block}
    ${devs.length ? h`<details class="pn-devs"><summary>${tr('Где включены', 'Where they are on')} · ${devs.length}</summary><ul>${devs.map((d) => h`<li>${icon(/iPhone|Android/.test(d.ua) ? 'phoneapp' : 'globe', 'ic-sm')}<span class="grow">${d.ua || tr('Браузер', 'Browser')}</span><span class="xs muted">${d.last_at ? tr('последнее ', 'last ') + ago(d.last_at) : tr('ещё не было', 'none yet')}</span></li>`)}</ul></details>` : ''}
    <div class="pn-types" role="group" aria-labelledby="pnTypesH">
      <div class="pn-sub"><b id="pnTypesH">${tr('Что присылать', 'What to send')}</b><span class="xs muted">${tr('для всех ваших устройств', 'for all your devices')}</span></div>
      ${PUSH_TYPES().map(([k, ic, ti, sub]) => h`<label class="pn-type"><span class="pn-ic">${icon(ic, 'ic-sm')}</span><span class="grow"><b>${ti}</b><span>${sub}</span></span>
        <span class="switch"><input type="checkbox" data-k="${k}" ${prefs[k] !== false ? 'checked' : ''} aria-label="${ti}"></span></label>`)}
    </div>
    <label class="pn-type pn-mail"><span class="pn-ic">${icon('mail', 'ic-sm')}</span><span class="grow"><b>${t('set.email', 'Письма на e-mail', 'E-mail notifications')}</b><span>${u.email || tr('E-mail не указан в профиле', 'No e-mail in your profile')}</span></span>
      <span class="switch"><input type="checkbox" id="pnMail" ${u.notify_email ? 'checked' : ''} ${u.email ? '' : 'disabled'}></span></label>`);

  const again = () => pushCard(el);
  const on = $('#pnOn', el);
  if (on) on.onclick = (e) => busy(e.currentTarget, async () => {
    try { await enablePush(); await refreshMe(); toast(tr('Уведомления включены', 'Notifications are on'), 'ok', tr('Пришлём проверочное — посмотрите, как оно выглядит', 'We sent a test one so you can see it')); setTimeout(() => POST('/push/test').catch(() => {}), 1500); } // новому адресу push-сервис отвечает не сразу
    catch (er) { if (er.code !== 'denied' && er.code !== 'default') toastErr(er); else if (er.code === 'default') toast(tr('Разрешение не выдано', 'Permission was not granted'), 'info', tr('Нажмите «Включить» ещё раз и выберите «Разрешить»', 'Tap Turn on again and choose Allow')); }
    again();
  });
  const off = $('#pnOff', el);
  if (off) off.onclick = (e) => busy(e.currentTarget, async () => { await disablePush(); await refreshMe(); toast(tr('Уведомления на этом устройстве выключены', 'Notifications are off on this device')); again(); });
  const test = $('#pnTest', el);
  if (test) test.onclick = (e) => busy(e.currentTarget, async () => {
    try { await POST('/push/test'); toast(tr('Отправлено', 'Sent'), 'ok', tr('Уведомление появится через пару секунд. Если сайт открыт перед вами — сверните его, чтобы увидеть.', 'It will appear in a few seconds.')); }
    catch (er) { toastErr(er); again(); }
  });
  const retry = $('#pnRetry', el);
  if (retry) retry.onclick = async () => {
    const st = await pushStatus();
    if (st === 'denied') { toast(tr('Пока запрещено', 'Still blocked'), 'info', tr('Разрешите уведомления по инструкции и обновите страницу', 'Allow notifications as described and reload the page')); return; }
    try { await enablePush(); await refreshMe(); toast(tr('Уведомления включены', 'Notifications are on')); } catch (er) { /* остаёмся на подсказке */ }
    again();
  };
  const how = $('#pnHow', el);
  if (how) how.onclick = (e) => { e.preventDefault(); const c = document.getElementById('installCard'); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1400); } };
  $$('.pn-types input[data-k]', el).forEach((inp) => inp.onchange = async () => {
    try { await PATCH('/me', { push_prefs: { [inp.dataset.k]: inp.checked } }); await refreshMe(); toast(tr('Сохранено', 'Saved')); }
    catch (er) { inp.checked = !inp.checked; toastErr(er); }
  });
  const mail = $('#pnMail', el);
  if (mail) mail.onchange = async () => { try { await PATCH('/me', { notify_email: mail.checked }); await refreshMe(); toast(tr('Сохранено', 'Saved')); } catch (er) { mail.checked = !mail.checked; toastErr(er); } };
}

/* =================== установка приложения =================== */
// compact — подсказка на главной кабинета: только на телефоне, с «Не сейчас»; без compact — полный блок в настройках
const DISMISS = 'mba.install.later';
const dismissed = () => { try { return Date.now() - Number(localStorage.getItem(DISMISS) || 0) < 14 * 864e5; } catch (e) { return false; } };
export function installCard(el, { compact = false } = {}) {
  if (!el) return;
  const draw = () => {
    if (!el.isConnected) return false;
    const done = isStandalone() || state.installed;
    if (compact && (done || !touch() || dismissed())) { mount(el, ''); el.hidden = true; return true; }
    el.hidden = false;
    if (done) { mount(el, h`<div class="ins-done">${icon('check', 'ic-sm')}<b>${t('set.installed', 'Приложение установлено на этом устройстве', 'The app is installed on this device')}</b></div>`); return true; }
    const p = plat(), prompt = state.installPrompt;
    const steps = prompt ? '' : p === 'ios'
      ? h`<ol class="ins-steps">${step(1, 'share', tr('Нажмите «Поделиться» — в Safari внизу экрана, в Chrome справа в адресной строке', 'Tap Share — at the bottom in Safari, in the address bar in Chrome'))}
          ${step(2, 'add', tr('Выберите «На экран „Домой“» (если не видно — прокрутите список вниз)', 'Choose Add to Home Screen (scroll down if you don’t see it)'))}
          ${step(3, 'home', tr('Откройте «Мой агент» с экрана и включите уведомления', 'Open My Best Agent from the Home Screen and turn on notifications'))}</ol>`
      : p === 'android'
        ? h`<ol class="ins-steps">${step(1, 'menu', tr('Откройте меню браузера — три точки ⋮ справа вверху', 'Open the browser menu — three dots ⋮ at the top right'))}
            ${step(2, 'add', tr('Выберите «Установить приложение» или «Добавить на главный экран»', 'Choose Install app or Add to Home screen'))}
            ${step(3, 'home', tr('Откройте «Мой агент» с главного экрана', 'Open My Best Agent from your home screen'))}</ol>`
        : h`<ol class="ins-steps">${step(1, 'add', tr('В адресной строке нажмите значок установки справа (монитор со стрелкой)', 'Click the install icon at the right of the address bar'))}
            ${step(2, 'menu', tr('Или меню браузера ⋮ → «Установить приложение» («Приложения» → «Установить»)', 'Or browser menu ⋮ → Install app'))}</ol>`;
    mount(el, h`<div class="ins ${compact ? 'ins-compact' : ''}">
      <div class="ins-top"><img class="ins-app" src="/assets/icon-192.png" alt="" width="52" height="52"><div class="grow"><b>${t('set.install', 'Установите приложение', 'Install the app')}</b>
        <span>${tr('Иконка на экране, открывается без браузера, уведомления о совпадениях и сообщениях', 'Home screen icon, opens without the browser, notifications about matches and messages')}</span></div>
        ${compact ? h`<button type="button" class="icon-btn ins-x" id="insLater" aria-label="${tr('Не сейчас', 'Not now')}">${icon('x', 'ic-sm')}</button>` : ''}</div>
      ${prompt ? h`<button type="button" class="btn btn-blue ins-go" id="insGo">${icon('download', 'ic-sm')}${tr('Установить', 'Install')}</button>`
        : compact ? h`<button type="button" class="btn btn-soft ins-how" id="insHow" aria-expanded="false">${tr('Как установить — 3 шага', 'How to install — 3 steps')}${icon('chevR', 'ic-sm')}</button><div class="ins-more" hidden>${steps}</div>` : steps}
    </div>`);
    const go = $('#insGo', el);
    if (go) go.onclick = async () => {
      const ev = state.installPrompt; if (!ev) return draw();
      ev.prompt();
      const r = await ev.userChoice.catch(() => ({}));
      state.installPrompt = null;
      if (r.outcome === 'accepted') { state.installed = true; toast(tr('Приложение устанавливается', 'Installing the app'), 'ok', tr('Иконка появится на экране через несколько секунд', 'The icon will appear in a few seconds')); }
      draw();
    };
    const how = $('#insHow', el);
    if (how) how.onclick = () => { const more = $('.ins-more', el); more.hidden = !more.hidden; how.setAttribute('aria-expanded', String(!more.hidden)); how.classList.toggle('open', !more.hidden); };
    const later = $('#insLater', el);
    if (later) later.onclick = () => { try { localStorage.setItem(DISMISS, String(Date.now())); } catch (e) { /* без хранилища — просто скрываем */ } el.hidden = true; mount(el, ''); };
    return true;
  };
  draw();
  const re = () => { if (!draw()) removeEventListener('mba:install', re); };
  addEventListener('mba:install', re);
  onLeave(() => removeEventListener('mba:install', re));
}

/* =================== подсказка на главной кабинета =================== */
// Не больше одной за раз: сначала «установите приложение» (на телефоне), иначе — «включите уведомления»
export async function meNudge(host) {
  if (!host || !state.user) return;
  const box = document.createElement('div'); box.className = 'me-nudge';
  const anchor = host.querySelector('.profile-card'); if (anchor) anchor.after(box); else host.prepend(box);
  const canInstall = touch() && !isStandalone() && !dismissed();
  if (canInstall) { installCard(box, { compact: true }); if (!box.hidden) return; }
  const ps = await pushStatus();
  if (ps !== 'off') { box.remove(); return; }
  try { if (Date.now() - Number(localStorage.getItem('mba.push.later') || 0) < 7 * 864e5) { box.remove(); return; } } catch (e) { /* ок */ }
  mount(box, h`<div class="pn-nudge"><span class="pn-badge pn-badge-off">${icon('bell', 'ic-sm')}</span><div class="grow"><b>${tr('Не пропустите совпадение', 'Don’t miss a match')}</b><span>${tr('Включите уведомления — сообщим сразу, даже когда сайт закрыт', 'Turn on notifications — we’ll tell you right away, even when the site is closed')}</span></div>
    <button type="button" class="btn btn-blue btn-sm" id="nuOn">${tr('Включить', 'Turn on')}</button><button type="button" class="icon-btn" id="nuX" aria-label="${tr('Не сейчас', 'Not now')}">${icon('x', 'ic-sm')}</button></div>`);
  $('#nuOn', box).onclick = (e) => busy(e.currentTarget, async () => {
    try { await enablePush(); await refreshMe(); toast(tr('Уведомления включены', 'Notifications are on')); box.remove(); setTimeout(() => POST('/push/test').catch(() => {}), 1500); }
    catch (er) { if (er.code === 'denied') { toast(tr('Уведомления запрещены в браузере', 'Notifications are blocked'), 'info', tr('Как разрешить — в «Настройках» кабинета', 'See Settings for how to allow them')); box.remove(); } else if (er.code !== 'default') toastErr(er); }
  });
  $('#nuX', box).onclick = () => { try { localStorage.setItem('mba.push.later', String(Date.now())); } catch (e) { /* ок */ } box.remove(); };
}
