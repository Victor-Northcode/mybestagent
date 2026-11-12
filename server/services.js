'use strict';
// Сервисы: уведомления (в платформе / push / e-mail), SMS, подбор совпадений, гео, уровни пользователей.
// E-mail уходит через SMTP (SMTP_URL), SMS — через SMS.ru (SMSRU_API_ID). Каждое сообщение пишется в журнал
// «Исходящие» (без одноразовых кодов) со статусом доставки. Без провайдера (только при локальной разработке)
// сообщение лишь записывается в журнал.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const { all, get, run, DATA_DIR } = require('./db');
const { toEn } = require('./i18n');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/* ---------- VAPID для push ---------- */
const vapidFile = path.join(DATA_DIR, 'vapid.json');
let vapid;
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) {
  vapid = { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
} else if (fs.existsSync(vapidFile)) {
  vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8'));
} else {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(vapidFile, JSON.stringify(vapid));
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@my-bestagent.ru', vapid.publicKey, vapid.privateKey);

/* ---------- SSE: события в реальном времени ---------- */
const streams = new Map(); // userId -> Set(res)
function addStream(userId, res) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  const set = streams.get(userId);
  if (set.size >= 5) { const old = set.values().next().value; set.delete(old); try { old.end(); } catch (e) { /* закрыт */ } } // не больше 5 вкладок
  set.add(res);
  return () => { const s = streams.get(userId); if (s) { s.delete(res); if (!s.size) streams.delete(userId); } };
}
function emit(userId, event, data) {
  const s = streams.get(userId);
  if (!s) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of s) { try { res.write(payload); } catch (e) { /* соединение закрыто */ } }
}
// Выход из аккаунта или блокировка — закрываем все открытые потоки пользователя
function dropStreams(userId) { const s = streams.get(userId); if (!s) return; streams.delete(userId); for (const r of s) { try { r.end(); } catch (e) { /* закрыт */ } } }
setInterval(() => { for (const s of streams.values()) for (const r of s) { try { r.write(': ping\n\n'); } catch (e) {} } }, 25000).unref();

/* ---------- E-mail (SMTP) и SMS (SMS.ru) ---------- */
// SMTP_URL, например: smtps://robot%40my-bestagent.ru:ПАРОЛЬ@smtp.yandex.ru:465 (подойдёт почта любого провайдера)
const mailer = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL, { pool: true, maxConnections: 3 }) : null;
const MAIL_FROM = process.env.MAIL_FROM || '«Мой лучший агент» <noreply@my-bestagent.ru>';
const SMSRU = process.env.SMSRU_API_ID || '';
const SMS_API = process.env.SMSRU_API_URL || 'https://sms.ru/sms/send';
const channels = { email: mailer ? 'SMTP' : '', sms: SMSRU ? 'SMS.ru' : '' };
// secret — одноразовый код: адресату уходит полностью, в журнал — замаскированным
const masked = (body, secret) => (secret ? body.split(secret).join('••••••') : body);
const logOut = (channel, to, subject, body, status) => run('INSERT INTO outbox (channel, target, subject, body, status) VALUES (?,?,?,?,?)', channel, to, subject, body, status).lastInsertRowid;
const setOut = (id, status, error = '') => run('UPDATE outbox SET status = ?, error = ? WHERE id = ?', status, String(error).slice(0, 300), id);
// Возвращает Promise: 'sent' — доставлено провайдеру, 'failed' — ошибка, 'logged' — провайдер не подключён
function sendEmail(to, subject, body, secret) {
  if (!to) return Promise.resolve('failed');
  if (!mailer) { logOut('email', to, subject, masked(body, secret), 'logged'); return Promise.resolve('logged'); }
  const id = logOut('email', to, subject, masked(body, secret), 'queued');
  return mailer.sendMail({ from: MAIL_FROM, to, subject, text: body })
    .then(() => { setOut(id, 'sent'); return 'sent'; }, (e) => { setOut(id, 'failed', e.message); console.error('E-mail не отправлен:', e.message); return 'failed'; });
}
function sendSms(to, body, secret) {
  if (!to) return Promise.resolve('failed');
  if (!SMSRU) { logOut('sms', to, '', masked(body, secret), 'logged'); return Promise.resolve('logged'); }
  const id = logOut('sms', to, '', masked(body, secret), 'queued');
  const form = new URLSearchParams({ api_id: SMSRU, to: String(to).replace(/\D/g, ''), msg: body, json: '1' });
  if (process.env.SMSRU_FROM) form.set('from', process.env.SMSRU_FROM);
  return fetch(SMS_API, { method: 'POST', body: form, signal: AbortSignal.timeout(15000) })
    .then((r) => r.json())
    .then((j) => {
      const one = j && j.sms ? Object.values(j.sms)[0] : null;
      if (j && j.status === 'OK' && one && one.status === 'OK') { setOut(id, 'sent'); return 'sent'; }
      throw new Error((one && one.status_text) || (j && j.status_text) || 'SMS.ru: ошибка отправки');
    })
    .catch((e) => { setOut(id, 'failed', e.message); console.error('SMS не отправлено:', e.message); return 'failed'; });
}

/* ---------- Push (без персональных данных) ---------- */
async function sendPush(userId, payload) {
  const subs = all('SELECT * FROM push_subs WHERE user_id = ?', userId);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(JSON.parse(s.data), JSON.stringify(payload), { TTL: 3600 });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subs WHERE id = ?', s.id);
    }
  }));
}

/**
 * Уведомление пользователю по всем включённым каналам.
 * title/body в платформе могут быть подробными; в push уходит только обезличенный текст (pushTitle/pushBody).
 */
function notify(userId, { type, title, body = '', link = '', pushTitle, pushBody, email = true }) {
  const user = get('SELECT id, email, lang, notify_push, notify_email, blocked FROM users WHERE id = ?', userId);
  if (!user || user.blocked) return;
  const id = run('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)', userId, type, title, body, link).lastInsertRowid;
  const en = user.lang === 'en', L = en ? toEn : (x) => x; // в БД — русский текст, получателю — на его языке
  emit(userId, 'notification', { id, type, title: L(title), body: L(body), link });
  if (user.notify_push) sendPush(userId, { title: L(pushTitle || 'Мой лучший агент'), body: L(pushBody || 'Новое уведомление'), url: '/' + (link || '') }).catch(() => {});
  if (email && user.notify_email && user.email) sendEmail(user.email, L(title), `${L(body)}\n\n${en ? 'Open' : 'Открыть'}: ${BASE_URL}/${link || ''}`);
}

/* ---------- Гео ---------- */
function distKm(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some((v) => v == null || isNaN(v))) return null;
  const R = 6371, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/* ---------- Подбор совпадений «потерял» ↔ «нашёл» ---------- */
const STOP = new Set(('и в во на с со по за из у от до для при не нет без это как что или его её их был была было около очень ' +
  'найден найдена найдено найдены нашел нашла потерян потеряна потеряно потерялся потерялась пропал пропала пропали улетел убежал ' +
  'возле рядом сейчас домой дома меня мой моя мое мои лет года год').split(' '));
// Простой стеммер: отсекаем типичные русские окончания, чтобы «рыжий/рыжего», «кот/кота» совпадали.
const END = /(иями|ями|ами|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ий|ый|ой|ам|ям|ах|ях|ов|ев|ей|ом|ем|ью|ия|а|я|ы|и|о|е|у|ю|ь)$/;
function stem(w) { if (/^[0-9]+$/.test(w) || w.length <= 3) return w; const r = w.replace(END, ''); return r.length >= 3 ? r : w; }
function words(s) {
  return new Set(String(s || '').toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я0-9]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)).map(stem) || []);
}
// Вид животного: собака ≠ кошка — такие пары не совпадают, даже если рядом и в один день.
const SPECIES = [['dog', /соба|пес|пёс|щен|шпиц|лабрад|овчар|терьер|хаски|такс|dog|puppy/], ['cat', /кот|кош|котен|котён|cat|kitten/],
  ['bird', /птиц|попуг|корелл|голуб|bird|parrot/], ['rodent', /хомя|крыс|морск.*свин|шинш|rodent|hamster/]];
function speciesOf(a) { const txt = [a.species, a.title].join(' ').toLowerCase(); const m = SPECIES.find(([, re]) => re.test(txt)); return m ? m[0] : null; }
const detailsOf = (a) => { try { return JSON.parse(a.details || '{}'); } catch (e) { return {}; } };
// Одежда, обувь и ориентир — тоже приметы для сравнения
const detailWords = (d) => [d.clothes_top, d.clothes_bottom, d.headwear, d.shoes, d.landmark].filter(Boolean).join(' ');
function matchScore(a, b) {
  if (a.category !== b.category || a.kind === b.kind) return 0;
  if (a.category === 'animals') { const sa = speciesOf(a), sb = speciesOf(b); if (sa && sb && sa !== sb) return 0; }
  const da = detailsOf(a), db = detailsOf(b);
  if (a.category === 'people') {
    // разный пол или заметно разный возраст (у найденного возраст примерный) — не тот человек
    if (da.sex && db.sex && da.sex !== db.sex) return 0;
    if (a.person_age != null && b.person_age != null && Math.abs(a.person_age - b.person_age) > 15) return 0;
  }
  const wa = words([a.title, a.features, a.description, a.species, detailWords(da)].join(' '));
  const wb = words([b.title, b.features, b.description, b.species, detailWords(db)].join(' '));
  const generic = /^(соба|пес|кот|кош|птиц|живот|вещ|предм|человек|мужчин|женщин|dog|cat)/; // слова-виды не считаются приметой
  let hit = 0; for (const w of wa) if (wb.has(w) && !generic.test(w)) hit++;
  if (!hit) return 0; // без общих примет совпадением не считаем — только место и дата недостаточно
  let s = Math.min(45, hit * 9);
  const d = distKm(a.lat, a.lng, b.lat, b.lng);
  if (d != null && d > 60) return 0; // разные города — не совпадение, даже если приметы похожи
  if (d != null) s += d <= 1 ? 35 : d <= 3 ? 28 : d <= 10 ? 18 : d <= 30 ? 8 : 0;
  else if (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) s += 12;
  if (a.event_date && b.event_date) {
    const days = Math.abs(new Date(a.event_date) - new Date(b.event_date)) / 864e5;
    const lost = a.kind === 'lost' ? a : b, found = a.kind === 'lost' ? b : a;
    const order = new Date(found.event_date) >= new Date(lost.event_date) - 864e5; // находка не раньше пропажи
    if (order) s += days <= 2 ? 20 : days <= 7 ? 12 : days <= 30 ? 5 : 0;
  }
  return Math.min(100, s);
}
const MATCH_MIN = 50;

function runMatching(app) {
  if (app.status !== 'published') return [];
  const other = app.kind === 'lost' ? 'found' : 'lost';
  const cands = all("SELECT * FROM applications WHERE status = 'published' AND kind = ? AND category = ? AND user_id != ?", other, app.category, app.user_id);
  const created = [];
  for (const c of cands) {
    const score = matchScore(app, c);
    if (score < MATCH_MIN) continue;
    const lost = app.kind === 'lost' ? app : c, found = app.kind === 'lost' ? c : app;
    const r = run('INSERT OR IGNORE INTO matches (lost_id, found_id, score) VALUES (?,?,?)', lost.id, found.id, score);
    if (!r.changes) continue;
    created.push({ lost, found, score });
    for (const [mine, theirs] of [[lost, found], [found, lost]]) {
      notify(mine.user_id, {
        type: 'match',
        title: `Возможное совпадение ${score}%`,
        body: `По вашей заявке «${mine.title}» найдена похожая: «${theirs.title}».`,
        link: `#/a/${theirs.id}`,
        pushTitle: 'Возможное совпадение', pushBody: 'По вашей заявке найдено похожее объявление'
      });
    }
  }
  return created;
}

/* ---------- Экстренное оповещение по зонам ---------- */
function broadcastEmergency(app) {
  const users = all("SELECT id, zone_lat, zone_lng, zone_radius FROM users WHERE zone_enabled = 1 AND blocked = 0 AND zone_lat IS NOT NULL AND id != ?", app.user_id);
  let n = 0;
  for (const u of users) {
    const d = distKm(u.zone_lat, u.zone_lng, app.lat, app.lng);
    // Получатель — тот, чья зона оповещений пересекается с кругом экстренного поиска.
    if (d != null && d <= (app.emergency_radius || 3) + (u.zone_radius || 0)) {
      notify(u.id, {
        type: 'emergency',
        title: app.category === 'people' ? 'Экстренный поиск человека рядом' : 'Экстренный поиск животного рядом',
        body: `${app.title}. ${app.address || ''}`.trim(),
        link: `#/a/${app.id}`,
        pushTitle: 'Экстренный поиск рядом с вами',
        pushBody: 'Нужна помощь в вашем районе. Откройте платформу, чтобы узнать подробности.',
        email: false
      });
      n++;
    }
  }
  return n;
}

/* ---------- Уровни и скидки ---------- */
const LEVELS = [
  { min: 0, code: 'novice', ru: 'Новичок', en: 'Newcomer', discount: 0 },
  { min: 50, code: 'helper', ru: 'Помощник', en: 'Helper', discount: 5 },
  { min: 150, code: 'agent', ru: 'Агент', en: 'Agent', discount: 10 },
  { min: 400, code: 'best', ru: 'Лучший агент', en: 'Best Agent', discount: 15 }
];
function levelOf(points) { let l = LEVELS[0]; for (const x of LEVELS) if (points >= x.min) l = x; return l; }
function addPoints(userId, delta, reason) {
  run('UPDATE users SET points = MAX(0, points + ?) WHERE id = ?', delta, userId);
  run('INSERT INTO points_log (user_id, delta, reason) VALUES (?,?,?)', userId, delta, reason);
  if (delta > 0) notify(userId, { type: 'points', title: `+${delta} баллов`, body: reason, link: '#/me/rewards', pushTitle: 'Начислены баллы', pushBody: 'Спасибо за помощь!', email: false });
}

module.exports = {
  vapidPublic: vapid.publicKey, addStream, dropStreams, emit, notify, sendEmail, sendSms, sendPush, channels,
  distKm, matchScore, runMatching, broadcastEmergency, LEVELS, levelOf, addPoints, BASE_URL
};
