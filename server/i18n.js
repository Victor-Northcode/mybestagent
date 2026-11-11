'use strict';
// Перевод системных уведомлений и начислений баллов на английский.
// В БД хранится русский текст; англоязычный пользователь получает перевод при выдаче
// (по заголовку X-Lang) и в push / e-mail / всплывающих уведомлениях (по языку профиля).
// Пользовательские данные в «кавычках» (названия заявок, имена) не переводятся.
const { all } = require('./db');

const EXACT = {
  // заголовки
  'Новая заявка на проверке': 'New report awaiting review',
  'Запрос экстренного оповещения': 'Emergency alert request',
  'Заявка изменена и ждёт проверки': 'Report edited, awaiting review',
  'Заявка отмечена «найдено»': 'Report marked as found',
  'Заявка закрыта': 'Report closed',
  'Запрос на удаление заявки': 'Removal request',
  'Новый отклик по заявке': 'New response to your report',
  'Новое сообщение': 'New message',
  'Новая жалоба': 'New complaint',
  'Ваш предмет из реестра замечен': 'Your registered item was spotted',
  'Оплата прошла успешно': 'Payment successful',
  'Приглашение в семейный аккаунт': 'Family account invitation',
  'Заявка партнёра': 'Partner application',
  'Заявка волонтёра': 'Volunteer application',
  'Заявка инвестора': 'Investor application',
  'Заявка партнёра (с сайта)': 'Partner application (website)',
  'Новое обращение в поддержку': 'New support request',
  'Ответ поддержки': 'Support reply',
  'Новое сообщение в обращении': 'New message in a support request',
  'Заявка опубликована': 'Report published',
  'Заявка отклонена': 'Report rejected',
  'Экстренное оповещение запущено': 'Emergency alert launched',
  'Вы стали партнёром платформы': 'You are now a platform partner',
  'Вы стали волонтёром': 'You are now a volunteer',
  'Заявка на роль отклонена': 'Role request declined',
  'Экстренный поиск человека рядом': 'Urgent search for a person nearby',
  'Экстренный поиск животного рядом': 'Urgent search for a pet nearby',
  // push
  'Мой лучший агент': 'My Best Agent',
  'Новое уведомление': 'New notification',
  'Откройте панель администратора': 'Open the admin panel',
  'Новый отклик': 'New response',
  'По вашей заявке написали в чат': 'Someone wrote about your report',
  'Вам написали в анонимном чате': 'You have a new anonymous message',
  'Предмет из реестра замечен': 'Registered item spotted',
  'Откройте платформу, чтобы узнать подробности': 'Open the platform for details',
  'Оплата прошла': 'Payment received',
  'Тариф подключён': 'Plan activated',
  'Приглашение в семью': 'Family invitation',
  'Откройте личный кабинет': 'Open your account',
  'Откройте обращение': 'Open the request',
  'Ваша заявка прошла проверку': 'Your report passed review',
  'Заявка не прошла проверку': 'Report did not pass review',
  'Откройте заявку, чтобы узнать причину': 'Open the report to see why',
  'Оповещение запущено': 'Alert launched',
  'Люди рядом получили уведомление': 'People nearby were notified',
  'Возможное совпадение': 'Possible match',
  'По вашей заявке найдено похожее объявление': 'A similar report was found',
  'Экстренный поиск рядом с вами': 'Urgent search near you',
  'Нужна помощь в вашем районе. Откройте платформу, чтобы узнать подробности.': 'Help is needed in your area. Open the platform for details.',
  'Начислены баллы': 'Points added',
  'Спасибо за помощь!': 'Thanks for helping!',
  'Push-уведомления работают': 'Push notifications are working',
  // тексты
  'Спасибо за участие!': 'Thank you for taking part!',
  'Теперь вы получаете экстренные оповещения по своей зоне': 'You now receive emergency alerts for your area',
  // причины баллов
  'Заявка отмечена как «найдено»': 'Report marked as found',
  'Начисление модератором за полезную информацию': 'Awarded by a moderator for useful information',
  'Регистрация на платформе': 'Signed up',
  'Публикация заявки': 'Report published',
  'Помощь в поиске': 'Helped with a search',
  'Возврат найденного владельцу': 'Returned a found item to its owner',
  'Участие в экстренном поиске': 'Took part in an emergency search',
  'Подтверждённая находка': 'Confirmed find',
  'За помощь в поиске: подсказка в чате по заявке о коте': 'For helping: a tip in the chat about a cat'
};

const RULES = [
  [/^Возможное совпадение (\d+)%$/, 'Possible match $1%'],
  [/^\+(\d+) балл(?:ов|а)?$/, '+$1 points'],
  [/^По вашей заявке «(.*)» найдена похожая: «(.*)»\.$/s, 'A similar report was found for «$1»: «$2».'],
  [/^«(.*)», радиус ([\d.]+) км$/s, '«$1», radius $2 km'],
  [/^Чат по заявке «(.*)»$/s, 'Chat about «$1»'],
  [/^По заявке «(.*)»$/s, 'About «$1»'],
  [/^Подсказка по заявке «(.*)»$/s, 'A tip about «$1»'],
  [/^«(.*)» видна на карте$/s, '«$1» is now on the map'],
  [/^«(.*)» прошла проверку$/s, '«$1» passed review'],
  [/^Оповещено пользователей рядом: (\d+)$/, 'Users notified nearby: $1'],
  [/^(.*) приглашает вас в «(.*)»$/s, '$1 invites you to «$2»'],
  [/^Подтверждённая помощь в заявке «(.*)»$/s, 'Confirmed help with «$1»'],
  [/^(.*) — (\d+) ₽\. Чек отправлен на (.*)\.$/s, (m, name, sum, to) => `${tariffEn(name)} — ${sum} ₽. Receipt sent to ${to}.`]
];

function tariffEn(name) {
  const t = all('SELECT name_en FROM tariffs WHERE name_ru = ?', name)[0];
  return t ? t.name_en : name;
}

function toEn(text) {
  if (!text || typeof text !== 'string') return text;
  if (EXACT[text]) return EXACT[text];
  for (const [re, rep] of RULES) if (re.test(text)) return text.replace(re, rep);
  return text;
}
const isEn = (req) => req.get('X-Lang') === 'en';
// Перевод полей объекта/списка для англоязычного клиента
function localize(rows, fields, en) {
  if (!en) return rows;
  return rows.map((r) => { const o = { ...r }; for (const f of fields) o[f] = toEn(o[f]); return o; });
}

module.exports = { toEn, isEn, localize };
