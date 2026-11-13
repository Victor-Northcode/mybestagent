'use strict';
// Письма платформы: единый оформленный шаблон (HTML для почтовых программ + простой текст).
// Вёрстка таблицами и inline-стилями — так письмо одинаково выглядит в Gmail, Яндекс.Почте, Mail.ru, Outlook и на телефоне.
// Картинка одна — логотип по абсолютному адресу сайта; внешних шрифтов и скриптов нет.
// Каждый шаблон возвращает { subject, text, html, preheader }. Пользовательские данные экранируются.

const BASE = () => (process.env.BASE_URL || 'https://my-bestagent.ru').replace(/\/$/, '');
const SUPPORT = 'support@my-bestagent.ru';
const C = { bg: '#f3f4f6', card: '#ffffff', ink: '#1b1b1f', ink2: '#303139', muted: '#676a74', line: '#e7e8ec', brand: '#b31746', brand2: '#8f1239', brandSoft: '#fbe9ef', red: '#d9232c', redSoft: '#fdeaea' };
const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const T = (lang, ru, en) => (lang === 'en' ? en : ru);
const brandName = (lang) => T(lang, 'Мой лучший агент', 'My Best Agent');
const host = () => BASE().replace(/^https?:\/\//, '');
// абсолютная ссылка на раздел сайта: '#/chat/5' → https://my-bestagent.ru/#/chat/5
const siteUrl = (link = '') => BASE() + '/' + String(link || '').replace(/^\/+/, '');

// название фонда-оператора для подвала; без базы данных (юнит-тесты) — без названия
function operatorName(lang) {
  try { return require('./legal').operatorInfo(lang).name || ''; } catch (e) { return ''; }
}

/* ---------- строительные блоки ---------- */
const p = (html, extra = '') => `<p style="margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:1.55;color:${C.ink2};${extra}">${html}</p>`;
// текст пользователя: экранирование и переносы строк
const userText = (s) => esc(s).replace(/\r?\n/g, '<br>');

function codeBox(code, caption) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border-collapse:separate">
  <tr><td align="center" bgcolor="${C.brandSoft}" style="background:${C.brandSoft};border-radius:14px;padding:22px 12px 18px">
    <div class="code" style="font-family:${MONO};font-size:40px;line-height:1.1;font-weight:700;letter-spacing:10px;padding-left:10px;color:${C.brand2};mso-line-height-rule:exactly">${esc(code)}</div>
    <div style="margin-top:10px;font-family:${FONT};font-size:13px;line-height:1.4;color:${C.muted}">${esc(caption)}</div>
  </td></tr></table>`;
}

// «пуленепробиваемая» кнопка: таблица с цветной ячейкой — работает и в Outlook
function button(label, url, color = C.brand) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;border-collapse:separate">
  <tr><td align="center" bgcolor="${color}" style="background:${color};border-radius:12px">
    <a href="${esc(url)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;line-height:1.2;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px">${esc(label)}</a>
  </td></tr></table>`;
}

function chip(label, tone) {
  const red = tone === 'red';
  return `<div style="margin:0 0 14px"><span style="display:inline-block;padding:4px 10px;border-radius:999px;font-family:${FONT};font-size:13px;line-height:1.3;font-weight:600;color:${red ? C.red : C.brand2};background:${red ? C.redSoft : C.brandSoft}">${esc(label)}</span></div>`;
}

/**
 * Общий макет письма.
 * o: { lang, subject, preheader, title, chip:{label,tone}, blocks:[html], note, reason, notifications }
 */
function layout(o) {
  const lang = o.lang === 'en' ? 'en' : 'ru';
  const site = BASE(), name = brandName(lang), op = operatorName(lang);
  const pre = esc(o.preheader || '') + '&#8199;&#65279;&#847;'.repeat(40); // пустые символы — чтобы почта не подтягивала в превью текст письма
  const note = o.note ? `<p style="margin:24px 0 0;padding-top:18px;border-top:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:1.5;color:${C.muted}">${o.note}</p>` : '';
  const foot = [
    o.reason ? `<p style="margin:0 0 10px">${o.reason}</p>` : '',
    `<p style="margin:0 0 6px">${op ? esc(op) + '<br>' : ''}<a href="${esc(site)}" target="_blank" style="color:${C.muted};text-decoration:underline">${esc(host())}</a> &nbsp;|&nbsp; <a href="mailto:${SUPPORT}" style="color:${C.muted};text-decoration:underline">${SUPPORT}</a></p>`,
    `<p style="margin:0">${T(lang, 'Письмо отправлено автоматически, отвечать на него не нужно.', 'This is an automated message — please do not reply.')}</p>`
  ].join('');
  const html = `<!DOCTYPE html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<title>${esc(o.subject)}</title>
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; }
  img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  @media (max-width: 620px) {
    .outer { padding: 12px 8px !important; }
    .card { padding: 28px 20px !important; border-radius: 14px !important; }
    .title { font-size: 22px !important; }
    .code { font-size: 34px !important; letter-spacing: 7px !important; padding-left: 7px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">
<tr><td class="outer" align="center" style="padding:28px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate">
    <tr><td style="padding:0 6px 16px">
      <a href="${esc(site)}" target="_blank" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:12px"><img src="${esc(site)}/assets/logo-256.png" width="60" height="49" alt="" style="display:block;width:60px;height:49px"></td>
        <td style="vertical-align:middle;font-family:${FONT};font-size:18px;line-height:1.2;font-weight:700;color:${C.ink}">${esc(name)}<div style="font-size:13px;font-weight:400;color:${C.muted};margin-top:2px">${T(lang, 'поиск людей, животных и вещей', 'finding people, pets and belongings')}</div></td>
      </tr></table></a>
    </td></tr>
    <tr><td class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:18px;padding:36px 40px">
      ${o.chip ? chip(o.chip.label, o.chip.tone) : ''}
      <h1 class="title" style="margin:0 0 14px;font-family:${FONT};font-size:24px;line-height:1.3;font-weight:700;color:${C.ink}">${esc(o.title)}</h1>
      ${(o.blocks || []).join('\n      ')}
      ${note}
    </td></tr>
    <tr><td align="center" style="padding:22px 16px 8px;font-family:${FONT};font-size:13px;line-height:1.55;color:${C.muted};text-align:center">${foot}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  return html;
}

// текстовая версия: тот же смысл без оформления
function plain(lang, parts, reason) {
  const op = operatorName(lang);
  return [...parts.filter((x) => x != null), '', '—', brandName(lang) + (op ? ' · ' + op : ''), BASE(), SUPPORT, ...(reason ? ['', reason] : [])]
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- письма ---------- */

// Код входа ('login') или подтверждения нового e-mail ('contact')
function codeMail(lang, purpose, code) {
  const login = purpose !== 'contact';
  const subject = login ? T(lang, `Код входа: ${code}`, `Your sign-in code: ${code}`) : T(lang, `Код подтверждения: ${code}`, `Confirmation code: ${code}`);
  const title = login ? T(lang, 'Код для входа', 'Your sign-in code') : T(lang, 'Подтвердите e-mail', 'Confirm your e-mail');
  const intro = login
    ? T(lang, `Введите этот код на сайте «${brandName(lang)}», чтобы войти или зарегистрироваться.`, `Enter this code on ${brandName(lang)} to sign in or create an account.`)
    : T(lang, 'Введите этот код в личном кабинете, чтобы привязать этот адрес к аккаунту.', 'Enter this code in your account to link this address.');
  const valid = T(lang, 'Код действует 10 минут', 'The code is valid for 10 minutes');
  const warn = login
    ? T(lang, 'Никому не сообщайте код — сотрудники платформы никогда его не спрашивают. Если вы не запрашивали вход, просто проигнорируйте письмо: без кода в аккаунт не войти.',
      'Never share this code — our staff will never ask for it. If you did not request it, just ignore this e-mail: nobody can sign in without the code.')
    : T(lang, 'Если вы не меняли контакт в аккаунте, просто проигнорируйте письмо.', 'If you did not change your contact details, just ignore this e-mail.');
  const preheader = T(lang, `${code} — код действует 10 минут. Никому его не сообщайте.`, `${code} — valid for 10 minutes. Never share it.`);
  return {
    subject, preheader,
    html: layout({ lang, subject, preheader, title, blocks: [p(esc(intro)), codeBox(code, valid)], note: esc(warn) }),
    text: plain(lang, [title, '', intro, '', `${T(lang, 'Код', 'Code')}: ${code}`, valid + '.', '', warn])
  };
}

// Старому адресу: контакт для входа изменён
function contactChangedMail(lang, type) {
  const what = type === 'email' ? T(lang, 'e-mail', 'e-mail address') : T(lang, 'номер телефона', 'phone number');
  const subject = T(lang, 'Контакт для входа изменён', 'Your sign-in contact was changed');
  const title = type === 'email' ? T(lang, 'E-mail для входа изменён', 'Your sign-in e-mail was changed') : T(lang, 'Телефон для входа изменён', 'Your sign-in phone was changed');
  const intro = T(lang, `В вашем аккаунте «${brandName(lang)}» изменён ${what} для входа. Теперь входить нужно по новому контакту.`, `The ${what} used to sign in to your ${brandName(lang)} account has been changed.`);
  const warn = T(lang, `Если это были не вы — сразу напишите в поддержку: ${SUPPORT}. Мы поможем вернуть доступ.`, `If this wasn't you, contact support right away at ${SUPPORT} and we'll help you regain access.`);
  return {
    subject, preheader: intro,
    html: layout({ lang, subject, preheader: intro, title, blocks: [p(esc(intro)), p(esc(warn)), button(T(lang, 'Написать в поддержку', 'Contact support'), `mailto:${SUPPORT}`)] }),
    text: plain(lang, [title, '', intro, '', warn])
  };
}

// Приглашение в семейный аккаунт для того, кто ещё не зарегистрирован
function familyInviteMail(lang, inviter) {
  const subject = T(lang, `${inviter} приглашает вас в семейный аккаунт`, `${inviter} invites you to a family account`);
  const title = T(lang, 'Вас приглашают в семейный аккаунт', "You're invited to a family account");
  const intro = T(lang, `<b style="color:${C.ink}">${esc(inviter)}</b> приглашает вас в семейный аккаунт на платформе «${esc(brandName(lang))}» — сервисе поиска пропавших людей, животных и вещей.`,
    `<b style="color:${C.ink}">${esc(inviter)}</b> invites you to a family account on ${esc(brandName(lang))}, a service for finding missing people, pets and belongings.`);
  const how = T(lang, 'Войдите на сайт с этим e-mail — приглашение будет ждать вас в разделе «Семья» личного кабинета.', 'Sign in with this e-mail address — the invitation will be waiting in the "Family" section of your account.');
  const ignore = T(lang, 'Если вы не знаете этого человека, просто проигнорируйте письмо.', "If you don't know this person, just ignore this e-mail.");
  const url = siteUrl('#/me/family');
  return {
    subject, preheader: T(lang, 'Примите приглашение в личном кабинете', 'Accept the invitation in your account'),
    html: layout({ lang, subject, preheader: T(lang, 'Примите приглашение в личном кабинете', 'Accept the invitation in your account'), title, blocks: [p(intro), p(esc(how)), button(T(lang, 'Принять приглашение', 'Accept invitation'), url)], note: esc(ignore) }),
    text: plain(lang, [title, '', T(lang, `${inviter} приглашает вас в семейный аккаунт на платформе «${brandName(lang)}».`, `${inviter} invites you to a family account on ${brandName(lang)}.`), '', how, url, '', ignore])
  };
}

// Уведомление платформы (title/body — уже на языке получателя)
const KIND = {
  match: ['Совпадение', 'Match'], chat: ['Сообщение', 'Message'], support: ['Поддержка', 'Support'], moderation: ['Модерация', 'Moderation'],
  status: ['Заявка', 'Report'], payment: ['Оплата', 'Payment'], family: ['Семья', 'Family'], registry: ['Реестр ценностей', 'Valuables registry'],
  points: ['Баллы', 'Points'], role: ['Роль на платформе', 'Platform role'], emergency: ['Экстренно', 'Urgent']
};
function actionLabel(lang, link) {
  const l = String(link || '');
  if (l.startsWith('#/chat')) return T(lang, 'Открыть чат', 'Open chat');
  if (l.startsWith('#/support')) return T(lang, 'Открыть обращение', 'Open request');
  if (l.startsWith('#/a/')) return T(lang, 'Открыть заявку', 'Open report');
  if (l.startsWith('#/admin')) return T(lang, 'Открыть панель', 'Open admin panel');
  if (l.startsWith('#/me/family')) return T(lang, 'Открыть «Семью»', 'Open Family');
  if (l.startsWith('#/me/payments')) return T(lang, 'Открыть платежи', 'Open payments');
  return T(lang, 'Открыть', 'Open');
}
function notifyMail(lang, { type, title, body = '', link = '' }) {
  const kind = KIND[type];
  const url = siteUrl(link);
  const reasonText = T(lang, 'Вы получили это письмо, потому что включены уведомления на e-mail. Отключить их можно в личном кабинете → «Настройки».',
    'You received this e-mail because e-mail notifications are on. You can turn them off in your account → Settings.');
  const settings = siteUrl('#/me/settings');
  const reason = T(lang, `Вы получили это письмо, потому что включены уведомления на e-mail. <a href="${esc(settings)}" target="_blank" style="color:${C.muted};text-decoration:underline">Отключить уведомления</a>`,
    `You received this e-mail because e-mail notifications are on. <a href="${esc(settings)}" target="_blank" style="color:${C.muted};text-decoration:underline">Turn them off</a>`);
  const blocks = [body ? p(userText(body)) : '', button(actionLabel(lang, link), url, type === 'emergency' ? C.red : C.brand)];
  return {
    subject: title, preheader: body || title,
    html: layout({ lang, subject: title, preheader: body || title, title, chip: kind ? { label: T(lang, kind[0], kind[1]), tone: type === 'emergency' ? 'red' : '' } : null, blocks, reason }),
    text: plain(lang, [title, '', body, '', `${actionLabel(lang, link)}: ${url}`], reasonText + ' ' + settings)
  };
}

module.exports = { codeMail, contactChangedMail, familyInviteMail, notifyMail, layout, esc };
