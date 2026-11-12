'use strict';
// Начальное наполнение базы.
// • Всегда: тарифы и справочники (если их ещё нет) и администратор из ADMIN_EMAIL.
// • Демо-данные (пользователи, заявки, истории, чаты) — только в тестовом режиме или при SEED_DEMO=1.
//   В рабочем режиме (NODE_ENV=production) демо-данные не создаются никогда, если явно не задано SEED_DEMO=1.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { get, run, tx, DATA_DIR } = require('./db');

// Демо-фото копируются в загрузки под хеш-именем, как будто их загрузил пользователь.
function demoPhoto(name) {
  try {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'demo', name));
    const id = crypto.createHash('md5').update(buf).digest('hex');
    const dir = path.join(DATA_DIR, 'uploads'); fs.mkdirSync(dir, { recursive: true });
    const dst = path.join(dir, id + '.jpg'); if (!fs.existsSync(dst)) fs.writeFileSync(dst, buf);
    return '/uploads/' + id + '.jpg';
  } catch (e) { return ''; }
}
const photos = (...names) => names.map(demoPhoto).filter(Boolean);

const DEMO = process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : process.env.NODE_ENV !== 'production';

// Тарифы и справочники — нужны и на рабочем сайте (редактируются в админке)
function seedBase() {
  if (get('SELECT COUNT(*) c FROM tariffs').c > 0) return;
  tx(() => {
    const T = (code, nr, ne, dr, de, aud, price, days, feature, sort) => run(
      'INSERT INTO tariffs (code, name_ru, name_en, desc_ru, desc_en, audience, price, period_days, feature, sort) VALUES (?,?,?,?,?,?,?,?,?,?)',
      code, nr, ne, dr, de, aud, price, days, feature, sort);
    T('registry_plus', 'Реестр ценностей+', 'Valuables Registry+', 'До 100 предметов в реестре, приоритетная проверка', 'Up to 100 items in the registry, priority checks', 'user', 299, 30, 'registry', 1);
    T('promote', 'Продвижение заявки', 'Boost a report', 'Заявка выше в списках и на карте 7 дней', 'Report pinned higher in lists and on the map for 7 days', 'user', 199, 7, 'promote', 2);
    T('partner', 'Партнёр', 'Partner', 'Профиль организации, оповещения по зоне, значок партнёра', 'Organisation profile, zone alerts, partner badge', 'partner', 2990, 30, 'partner', 3);

    const D = (type, list) => list.forEach(([r, e], i) => run('INSERT INTO dicts (type, value_ru, value_en, sort) VALUES (?,?,?,?)', type, r, e, i));
    D('species', [['Собака', 'Dog'], ['Кошка', 'Cat'], ['Птица', 'Bird'], ['Грызун', 'Rodent'], ['Другое', 'Other']]);
    D('complaint_reason', [['Мошенничество', 'Fraud'], ['Ложная информация', 'False information'], ['Оскорбления', 'Abuse'], ['Спам', 'Spam'], ['Нарушение приватности', 'Privacy violation'], ['Другое', 'Other']]);
    D('partner_type', [['Служба такси', 'Taxi service'], ['Служба доставки', 'Delivery service'], ['Приют для животных', 'Animal shelter'], ['Поисковый отряд', 'Search team'], ['Ветклиника', 'Vet clinic'], ['Другое', 'Other']]);
  });
}

// Первый администратор рабочего сайта: ADMIN_EMAIL=you@company.ru — входит по коду, как все пользователи
function ensureAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const u = get('SELECT id, role FROM users WHERE email = ?', email);
  if (!u) run("INSERT INTO users (email, name, role, consent_at) VALUES (?, 'Администратор', 'admin', datetime('now'))", email);
  else if (u.role !== 'admin') run("UPDATE users SET role = 'admin' WHERE id = ?", u.id);
}

function seed() {
  seedBase();
  const demo = seedDemo();
  ensureAdmin();
  return demo;
}

// Демо-наполнение для показа и автотестов
function seedDemo() {
  if (!DEMO || get('SELECT COUNT(*) c FROM users').c > 0) return false;
  tx(() => {
    const u = (email, phone, name, role, extra = {}) => run(
      `INSERT INTO users (email, phone, name, role, birthdate, city, points, zone_enabled, zone_lat, zone_lng, zone_radius, org_name, consent_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      email, phone, name, role, '1990-01-01', extra.city || 'Москва', extra.points || 0,
      extra.zone ? 1 : 0, extra.zone ? extra.zone[0] : null, extra.zone ? extra.zone[1] : null, extra.zone ? extra.zone[2] : 3,
      extra.org || ''
    ).lastInsertRowid;

    const admin = u('admin@mba.local', '+70000000001', 'Администратор', 'admin');
    u('moderator@mba.local', '+70000000002', 'Модератор Анна', 'moderator');
    const anna = u('anna@example.com', '+79990000001', 'Анна Смирнова', 'user', { points: 40, zone: [55.7601, 37.6186, 3] });
    const igor = u('igor@example.com', '+79990000002', 'Игорь Волков', 'volunteer', { points: 260, zone: [55.7558, 37.6173, 5] });
    const lisa = u('lisa@example.com', '+79990000003', 'Елизавета Котова', 'volunteer', { points: 180, zone: [55.7887, 37.6790, 4] });
    u('lizaalert@example.com', '+79990000004', 'Координатор отряда', 'partner', { points: 420, zone: [55.7520, 37.5960, 5], org: 'Поисковый отряд «Север»' });
    u('max@example.com', '+79990000005', 'Максим Орлов', 'volunteer', { points: 95, zone: [55.7310, 37.6030, 3] });

    const A = (o) => run(
      `INSERT INTO applications (user_id, kind, category, status, title, description, features, person_name, person_age, relation,
        species, event_date, lat, lng, address, city, contact, reward, photos, created_at, updated_at, found_at, emergency_radius, emergency_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', ?),datetime('now', ?),?,?,?)`,
      o.user, o.kind, o.category, o.status || 'published', o.title, o.description || '', o.features || '',
      o.person_name || '', o.person_age || null, o.relation || '', o.species || '',
      o.date, o.lat, o.lng, o.address || '', o.city || 'Москва', o.contact || '+7 999 000-00-00', o.reward || 0,
      JSON.stringify(o.photos || []), o.ago || '-1 hours', o.ago || '-1 hours', o.found_at || null,
      o.er || null, o.es || 'none'
    ).lastInsertRowid;
    const d = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

    A({ user: anna, kind: 'lost', category: 'people', title: 'Пропал пожилой мужчина, 78 лет', person_name: 'Пётр Иванович С.', person_age: 78, relation: 'relative',
      description: 'Вышел из дома за хлебом и не вернулся. Страдает потерей памяти, может не помнить адрес.', features: 'серая куртка, синяя кепка, седые волосы, трость',
      date: d(0), lat: 55.7642, lng: 37.6056, address: 'Тверская ул., у метро Пушкинская', ago: '-3 hours', er: 3, es: 'active' });
    A({ user: igor, kind: 'found', category: 'people', title: 'Пожилой мужчина без документов', relation: '',
      description: 'Сидел на лавке у метро, растерян, не помнит адрес. Передан сотрудникам полиции.', features: 'седые волосы, трость, серая куртка',
      date: d(0), lat: 55.7660, lng: 37.6110, address: 'Страстной бульвар', ago: '-1 hours' });
    A({ user: lisa, kind: 'lost', category: 'animals', title: 'Потерялся рыжий кот Барсик', species: 'кот',
      description: 'Домашний, пугливый. Выпрыгнул с балкона второго этажа.', features: 'рыжий, белая грудка, зелёный ошейник, чип', reward: 5000,
      date: d(1), lat: 55.7890, lng: 37.6795, address: 'Сокольники, 3-я Сокольническая ул.', ago: '-20 hours', photos: photos('cat.jpg') });
    A({ user: anna, kind: 'found', category: 'animals', title: 'Найдена собака — лабрадор', species: 'собака',
      description: 'Бегала без поводка у пруда, ласковая. Временно у меня дома.', features: 'светлый лабрадор, красный ошейник без адресника',
      date: d(0), lat: 55.7313, lng: 37.6033, address: 'Парк Горького, Голицынский пруд', ago: '-5 hours', photos: photos('labrador.jpg') });
    A({ user: igor, kind: 'lost', category: 'things', title: 'Чёрный рюкзак с ноутбуком', description: 'Оставил в такси, ехал от Белорусского вокзала.',
      features: 'чёрный рюкзак, ноутбук, наушники, брелок-ракета', reward: 10000,
      date: d(2), lat: 55.7766, lng: 37.5813, address: 'Белорусский вокзал', ago: '-2 days', photos: photos('backpack.jpg') });
    A({ user: lisa, kind: 'found', category: 'things', title: 'Найдена связка ключей', description: 'Лежали на скамейке у фонтана. Передал в охрану ТЦ.',
      features: 'три ключа, брелок домик, домофонный чип синий', date: d(0), lat: 55.7580, lng: 37.6200, address: 'Никольская ул.', ago: '-6 hours', photos: photos('keys.jpg') });
    A({ user: anna, kind: 'found', category: 'things', title: 'Паспорт на имя гражданина', description: 'Найден в вагоне метро. Передам владельцу через чат после проверки.',
      features: 'паспорт РФ в синей обложке', date: d(3), lat: 55.7520, lng: 37.5920, address: 'метро Арбатская', ago: '-3 days' });
    A({ user: igor, kind: 'lost', category: 'animals', title: 'Пропала собака породы шпиц', species: 'собака',
      description: 'Сорвалась с поводка во время прогулки.', features: 'белый шпиц, розовый ошейник, маленькая',
      date: d(4), lat: 55.7000, lng: 37.5300, address: 'Воробьёвы горы', ago: '-4 days', status: 'found', found_at: d(1), photos: photos('spitz.jpg') });

    // дополнительные заявки — чтобы карта и списки были наполнены
    const max = get("SELECT id FROM users WHERE email = 'max@example.com'").id;
    A({ user: max, kind: 'found', category: 'animals', title: 'Найдена собака — бело-рыжая, похожа на овчарку', species: 'собака',
      description: 'Бегала вдоль набережной, без ошейника, очень дружелюбная. Сейчас на передержке.', features: 'бело-рыжая, пушистая, уши торчком, около 3 лет',
      date: d(0), lat: 55.7445, lng: 37.6290, address: 'Космодамианская наб.', ago: '-2 hours', photos: photos('dog-happy.jpg') });
    A({ user: max, kind: 'lost', category: 'animals', title: 'Улетел попугай-корелла', species: 'птица',
      description: 'Вылетел в открытое окно. Ручной, откликается на имя Кеша.', features: 'серый, жёлтая голова, оранжевые щёки', reward: 3000,
      date: d(1), lat: 55.7953, lng: 37.5390, address: 'Ходынское поле', ago: '-1 days' });
    A({ user: lisa, kind: 'found', category: 'things', title: 'Найдены беспроводные наушники в кейсе', description: 'Лежали на сиденье в вагоне МЦК. Опишите кейс — верну.',
      features: 'белый кейс, наклейка со звёздочкой', date: d(1), lat: 55.7710, lng: 37.6470, address: 'станция МЦК Рижская', ago: '-1 days' });
    A({ user: max, kind: 'lost', category: 'things', title: 'Потерян кошелёк с картами', description: 'Выпал из кармана в районе Чистых прудов.',
      features: 'коричневый кожаный кошелёк, внутри банковские карты и пропуск', reward: 2000,
      date: d(0), lat: 55.7647, lng: 37.6386, address: 'Чистопрудный бульвар', ago: '-4 hours' });
    A({ user: max, kind: 'lost', category: 'people', status: 'pending', title: 'Пропал брат, 34 года', person_name: 'Дмитрий О.', person_age: 34, relation: 'relative',
      description: 'Не вышел на связь после работы, телефон выключен.', features: 'рост около 185, тёмная куртка, рюкзак',
      date: d(0), lat: 55.7300, lng: 37.6600, address: 'район Таганской', ago: '-40 minutes' });

    const S = (cat, tr, te, xr, xe, city, photo) => run('INSERT INTO stories (category, title_ru, title_en, text_ru, text_en, city, photo) VALUES (?,?,?,?,?,?,?)', cat, tr, te, xr, xe, city, photo || '');
    S('people', 'Нашли за 40 минут', 'Found in 40 minutes',
      'Экстренное оповещение получили 120 волонтёров рядом. Мужчину с потерей памяти узнали у остановки и передали семье.',
      'An emergency alert reached 120 nearby volunteers. A man with memory loss was recognised at a bus stop and reunited with his family.', 'Москва', demoPhoto('volunteer.jpg'));
    S('animals', 'Барсик вернулся домой', 'Barsik is back home',
      'Система сама сопоставила заявку о пропаже кота с находкой волонтёра в соседнем дворе — совпадение 86%.',
      'The platform matched a lost-cat report with a volunteer\'s find in the next courtyard — an 86% match.', 'Казань', demoPhoto('cat-home.jpg'));
    S('things', 'Документы вернулись через чат', 'Documents returned via chat',
      'Таксист нашёл паспорт и связался с владельцем через анонимный чат, не раскрывая телефон.',
      'A taxi driver found a passport and contacted the owner through anonymous chat without revealing a phone number.', 'Санкт-Петербург');


    S('animals', 'Лабрадор нашёлся в парке', 'A labrador found in the park',
      'Хозяйка увидела заявку на карте через полчаса после публикации и забрала собаку в тот же вечер.',
      'The owner spotted the report on the map half an hour after it was posted and picked the dog up that evening.', 'Москва', demoPhoto('labrador.jpg'));

    // активность пользователей: чаты, уведомления, баллы, реестр, поддержка, заявки в админку
    const at = (rel) => `datetime('now', '${rel}')`;
    const chat = (appId, owner, other, msgs) => {
      const c = run(`INSERT INTO chats (application_id, owner_id, other_id, created_at) VALUES (?,?,?,${at(msgs[0][2])})`, appId, owner, other).lastInsertRowid;
      msgs.forEach(([from, text, rel, extra = {}]) => run(`INSERT INTO messages (chat_id, sender_id, text, lat, lng, read, created_at) VALUES (?,?,?,?,?,?,${at(rel)})`,
        c, from, text, extra.lat ?? null, extra.lng ?? null, extra.read === 0 ? 0 : 1));
      return c;
    };
    chat(4, anna, max, [[max, 'Здравствуйте! Кажется, это собака наших соседей. У неё есть шрам на левом ухе?', '-4 hours'],
      [anna, 'Добрый день! Да, есть небольшой шрам. Собака у меня, сыта и спокойна.', '-230 minutes'],
      [max, 'Отлично, передам соседям. Можно им написать вам здесь же?', '-3 hours', { read: 0 }]]);
    chat(3, lisa, anna, [[anna, 'Вчера вечером видела похожего рыжего кота у выхода из метро Сокольники.', '-10 hours'],
      [anna, 'Вот точка, где он сидел.', '-599 minutes', { lat: 55.7889, lng: 37.6797 }],
      [lisa, 'Спасибо огромное! Иду туда с переноской.', '-9 hours']]);

    const N = (uid, type, title, body, link, rel, read = 0) => run(`INSERT INTO notifications (user_id, type, title, body, link, read, created_at) VALUES (?,?,?,?,?,?,${at(rel)})`, uid, type, title, body, link, read);
    N(anna, 'chat', 'Новое сообщение', 'По заявке «Найдена собака — лабрадор»', '#/chats', '-3 hours');
    N(anna, 'points', '+20 баллов', 'За помощь в поиске: подсказка в чате по заявке о коте', '#/me', '-9 hours', 1);
    N(anna, 'status', 'Заявка опубликована', '«Найдена собака — лабрадор» видна на карте', '#/a/4', '-5 hours', 1);
    N(lisa, 'chat', 'Новое сообщение', 'Подсказка по заявке «Потерялся рыжий кот Барсик»', '#/chats', '-10 hours', 1);

    const P = (uid, delta, reason, rel) => run(`INSERT INTO points_log (user_id, delta, reason, created_at) VALUES (?,?,?,${at(rel)})`, uid, delta, reason);
    P(anna, 10, 'Регистрация на платформе', '-20 days'); P(anna, 10, 'Публикация заявки', '-5 hours'); P(anna, 20, 'Помощь в поиске', '-9 hours');
    P(igor, 100, 'Возврат найденного владельцу', '-1 days'); P(igor, 60, 'Участие в экстренном поиске', '-3 days'); P(igor, 100, 'Подтверждённая находка', '-12 days');
    P(lisa, 80, 'Возврат найденного владельцу', '-2 days'); P(lisa, 100, 'Подтверждённая находка', '-8 days');
    P(max, 50, 'Участие в экстренном поиске', '-4 days'); P(max, 45, 'Помощь в поиске', '-6 days');

    run('INSERT INTO valuables (user_id, title, description, serials, marks) VALUES (?,?,?,?,?)', anna, 'Велосипед Merida Big.Nine', 'Горный велосипед, рама 17", чёрно-зелёный', 'WMB2209871', 'царапина на верхней трубе, наклейка «МСК»');
    run('INSERT INTO valuables (user_id, title, description, serials, marks) VALUES (?,?,?,?,?)', anna, 'Ноутбук в сером корпусе', '14 дюймов, 2023 год', 'C02XL0GHJGH5', 'гравировка «A.S.» на крышке');
    run(`INSERT INTO valuables (user_id, title, description, serials, marks, photos, status, status_at) VALUES (?,?,?,?,?,?,'lost',${at('-2 days')})`, igor, 'Рюкзак с ноутбуком', 'Чёрный городской рюкзак', 'NB-77120934', 'брелок-ракета', JSON.stringify(photos('backpack.jpg')));

    run('INSERT INTO saved (user_id, application_id) VALUES (?,?)', anna, 3);
    run('INSERT INTO saved (user_id, application_id) VALUES (?,?)', anna, 5);

    const tk = run(`INSERT INTO tickets (user_id, subject, status, created_at, updated_at) VALUES (?,?,'answered',${at('-1 days')},${at('-20 hours')})`, anna, 'Как включить оповещения по району?').lastInsertRowid;
    run(`INSERT INTO ticket_messages (ticket_id, user_id, staff, text, created_at) VALUES (?,?,0,?,${at('-1 days')})`, tk, anna, 'Хочу получать уведомления о пропажах рядом с домом. Где это настраивается?');
    run(`INSERT INTO ticket_messages (ticket_id, user_id, staff, text, created_at) VALUES (?,?,1,?,${at('-20 hours')})`, tk, admin, 'Здравствуйте! Кабинет → «Зона оповещений»: отметьте точку на карте и радиус. Push придут, когда рядом появится экстренный поиск.');
    const tk2 = run(`INSERT INTO tickets (user_id, subject, created_at, updated_at) VALUES (?,?,${at('-2 hours')},${at('-2 hours')})`, max, 'Не приходит код по SMS').lastInsertRowid;
    run(`INSERT INTO ticket_messages (ticket_id, user_id, staff, text, created_at) VALUES (?,?,0,?,${at('-2 hours')})`, tk2, max, 'Пытаюсь войти по номеру телефона, код не приходит уже 10 минут.');

    run("INSERT INTO complaints (user_id, target_type, target_id, reason) VALUES (?, 'application', 7, 'Нарушение приватности')", lisa);
    run("INSERT INTO deletion_requests (application_id, name, contact, reason) VALUES (2, 'Олег С.', '+7 916 000-11-22', 'Это мой отец, он уже дома. Прошу удалить заявку.')");
    run("INSERT INTO leads (kind, name, contact, org, message) VALUES ('partner', 'Ирина Белова', 'partners@taxi-example.ru', 'Служба такси «Бриз»', 'Хотим подключить водителей: находки в салонах сразу публиковать на платформе.')");
    run("INSERT INTO role_requests (user_id, role, org_name, org_type, details) VALUES (?, 'partner', 'Приют «Лапа помощи»', 'Приют для животных', 'Принимаем найденных животных, готовы публиковать их на платформе.')", max);

    const tar = get("SELECT id FROM tariffs WHERE code = 'promote'").id;
    run(`INSERT INTO payments (user_id, tariff_id, application_id, amount, discount, method, status, provider_id, receipt, created_at, paid_at) VALUES (?,?,?,?,0,'sbp','succeeded','test_seed01',?,${at('-5 hours')},${at('-5 hours')})`,
      anna, tar, 4, 199, JSON.stringify({ customer: 'anna@example.com', items: [{ name: 'Продвижение заявки', quantity: 1, price: 199, vat: 'none', payment_subject: 'service', payment_mode: 'full_payment' }], total: 199, method: 'sbp' }));
    run("UPDATE applications SET promoted_until = datetime('now', '+7 days') WHERE id = 4");

    run("INSERT INTO audit (user_id, action, target) VALUES (?, 'system.seed', 'initial data')", admin);
  });
  return true;
}

module.exports = { seed };
