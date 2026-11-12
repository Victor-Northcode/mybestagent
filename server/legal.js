'use strict';
// Юридические документы платформы: тексты (RU/EN), реквизиты оператора и выгрузка в PDF.
// Реквизиты и любой документ целиком администратор может переопределить в админке → «Переводы»
// (ключи legal.op.* и legal.text.<doc>). Без переопределений используются тексты ниже.
const path = require('path');
const PDFDocument = require('pdfkit');
const { all } = require('./db');

const EDITION = '2026-11-09'; // дата редакции документов
const DOC_IDS = ['terms', 'privacy', 'consent', 'publication'];

/* ---------- реквизиты оператора ---------- */
// Реквизиты фонда-оператора. Любое поле можно заменить в админке → «Переводы» (ключ legal.op.<поле>) или переменной LEGAL_<ПОЛЕ>.
const OP_FIELDS = ['name', 'inn', 'kpp', 'ogrn', 'address', 'account', 'bank', 'bik', 'corr', 'email'];
const OP_COMMON = { inn: '6685217330', kpp: '668501001', ogrn: '1246600008434', account: '40703810005000000829', bik: '046577975', corr: '30101810500000000975', email: 'support@mybestagent.ru' };
const OP_DEFAULTS = {
  ru: { ...OP_COMMON, name: '', address: '', bank: 'Уральский филиал ПАО «Банк ПСБ», г. Екатеринбург' },
  en: { ...OP_COMMON, name: '', address: '', bank: 'Ural branch of PSB Bank PJSC, Yekaterinburg' }
};
const OP_LOCALIZED = ['name', 'bank']; // остальные поля от языка не зависят
function overrides(lang) {
  const o = {};
  for (const r of all("SELECT key, value FROM translations WHERE lang = ? AND key LIKE 'legal.%'", lang)) o[r.key] = r.value;
  return o;
}
function operator(lang, ov) {
  const d = OP_DEFAULTS[lang];
  // ИНН, КПП, ОГРН, счета, адрес и e-mail от языка не зависят: если заданы только по-русски, берём их и для английской версии
  const ru = lang === 'en' ? overrides('ru') : {};
  const pick = (k) => (ov['legal.op.' + k] || (!OP_LOCALIZED.includes(k) ? ru['legal.op.' + k] : '') || process.env['LEGAL_' + k.toUpperCase()] || d[k] || '').trim();
  const op = { site: (process.env.BASE_URL || 'https://mybestagent.ru').replace(/\/$/, '') };
  for (const k of OP_FIELDS) op[k] = pick(k);
  return op;
}
const operatorInfo = (lang) => operator(lang === 'en' ? 'en' : 'ru', overrides(lang === 'en' ? 'en' : 'ru'));

/* ---------- тексты ----------
   Каждый документ: заголовок, краткое описание и разделы. Пункты нумеруются автоматически (1.1, 1.2 …).
   Строка, начинающаяся с «— », — маркированный подпункт без номера. {email}, {site} подставляются; {op} — « — название оператора» (пусто, пока реквизиты не заданы). */
const RU = {
  terms: {
    title: 'Пользовательское соглашение',
    lead: 'Правила использования платформы «Мой лучший агент»: регистрация, заявки, экстренные оповещения, анонимный чат, баллы, реестр ценностей и платные услуги.',
    sections: [
      ['Общие положения', [
        'Настоящее Соглашение регулирует отношения между оператором платформы «Мой лучший агент»{op} (далее — «Оператор») и физическим лицом, использующим платформу (далее — «Пользователь»).',
        'Платформа — веб-сайт {site} и устанавливаемое веб-приложение (PWA), предназначенные для поиска и возврата потерянных людей, животных и вещей.',
        'Соглашение является публичной офертой (ст. 437 ГК РФ). Регистрация на Платформе означает полное и безоговорочное принятие Соглашения (акцепт). Если вы не согласны с условиями, не используйте Платформу.',
        'Термины: «Заявка» — публикация о потере («Потерял») или находке («Нашёл») в категориях «Люди», «Животные», «Вещи»; «Модератор» — сотрудник Оператора, проверяющий заявки и жалобы; «Волонтёр» и «Партнёр» — пользователи и организации, помогающие в поиске; «Анонимный чат» — переписка по заявке без раскрытия контактов; «Баллы» — внутренние условные единицы за полезные действия.'
      ]],
      ['Регистрация и учётная запись', [
        'Зарегистрироваться может дееспособное лицо, достигшее 18 лет. Вход выполняется по одноразовому коду, отправленному на телефон или e-mail.',
        'Пользователь указывает достоверные данные, не передаёт доступ к учётной записи третьим лицам и отвечает за действия, совершённые под его учётной записью.',
        'Пользователь может создать семейный аккаунт и пригласить родственников. Члены семьи видят и редактируют общие заявки и переписку по ним.',
        'Пользователь может удалить учётную запись в разделе «Кабинет → Настройки». Вместе с ней удаляются его заявки, переписка и реестр ценностей, за исключением сведений, которые Оператор обязан хранить по закону.'
      ]],
      ['Назначение Платформы и её ограничения', [
        'Платформа помогает в поиске, но не заменяет полицию, МЧС и поисковые службы. При пропаже человека Пользователь обязан незамедлительно обратиться в полицию по номерам 102 или 112.',
        'Оператор не гарантирует, что потерянное будет найдено, и не проверяет достоверность каждой заявки, кроме заявок категории «Люди», которые публикуются после проверки модератором.',
        'Автоматический подбор совпадений носит рекомендательный характер: процент совпадения — оценка похожести, а не подтверждение.'
      ]],
      ['Заявки', [
        'Заявка может содержать описание, приметы, до 5 фотографий, место на карте и дату. Контакт для связи не публикуется: его видят только модераторы, связь с автором — через анонимный чат.',
        'Заявки категорий «Животные» и «Вещи» публикуются сразу и проверяются модератором по жалобам. Заявки категории «Люди» публикуются только после проверки модератором.',
        'Заявку о пропаже человека может подать только его родственник или законный представитель; заявку о несовершеннолетнем — только законный представитель. Подавая заявку, Пользователь подтверждает это право.',
        'В заявке запрещено указывать сведения о состоянии здоровья и диагнозах, реквизиты документов, полный домашний адрес и иные сведения, не нужные для поиска. Модератор вправе удалить такие сведения или отклонить заявку.',
        'После отметки «найдено» персональные данные в заявке о человеке скрываются из публичного доступа.',
        'Человек, о котором подана заявка, или его законный представитель вправе потребовать её удаления по ссылке «Это заявка обо мне — запросить удаление» на странице заявки.',
        'Пользователь может редактировать, закрывать и удалять свои заявки. Повторная проверка заявки о человеке выполняется после её изменения.'
      ]],
      ['Экстренные оповещения', [
        'По заявке о пропаже человека или животного автор может запросить экстренное оповещение в радиусе от 1 до 5 км. Оповещение запускает модератор после проверки.',
        'Оповещение получают пользователи, волонтёры и партнёры, чья зона оповещений пересекается с зоной поиска. Push-уведомление не содержит персональных данных; подробности доступны на странице заявки.',
        'Пользователь может в любой момент отключить экстренные оповещения или изменить зону в разделе «Кабинет → Зона оповещений».'
      ]],
      ['Анонимный чат и правила общения', [
        'Переписка ведётся без раскрытия телефонов и e-mail. В чате можно отправлять текст, фотографии и точку на карте.',
        'Запрещено требовать или переводить деньги до фактической передачи найденного, запрашивать коды из SMS, данные банковских карт и документы. Встречи рекомендуется проводить в людных местах.',
        'Пользователь может пожаловаться на сообщение или собеседника и заблокировать переписку. Модераторы рассматривают жалобы и вправе ограничить доступ нарушителю.'
      ]],
      ['Вознаграждения и баллы', [
        'Вознаграждение, указанное в заявке, выплачивает её автор напрямую нашедшему, вне Платформы. Оператор не является стороной этой договорённости и не отвечает за её исполнение.',
        'Баллы начисляются за подтверждённые находки, участие в экстренных поисках и полезную информацию. Баллы не имеют денежного выражения, не обмениваются на деньги и не передаются другим пользователям.',
        'Статус, рассчитанный по баллам, даёт скидку на платные услуги Платформы в размере, указанном в кабинете.'
      ]],
      ['Реестр ценностей', [
        'Пользователь может зарегистрировать ценные вещи и антиквариат: фото, описание, серийные номера и особые приметы, а также отметить вещь как украденную или утерянную.',
        'Сведения реестра вносятся со слов владельца. Оператор не проводит экспертизу подлинности и не подтверждает право собственности. Отсутствие отметки в реестре не гарантирует законность происхождения вещи.',
        'Любой посетитель может проверить предмет по номеру или названию и анонимно сообщить владельцу о находке.'
      ]],
      ['Платные услуги и оплата', [
        'Основные функции Платформы бесплатны. Дополнительные услуги (расширенный реестр, продвижение заявки, тариф для организаций) оказываются по ценам, опубликованным на странице «Тарифы» на момент оплаты.',
        'Оплата принимается банковскими картами российских банков и через Систему быстрых платежей. Кассовый чек в соответствии с 54-ФЗ направляется на e-mail или телефон из профиля.',
        'При оплате картой Пользователь может сохранить её для автопродления. Данные карты обрабатывает платёжный провайдер; Оператор хранит только маску номера. Автопродление и привязку карты можно отключить в разделе «Кабинет → Платежи».',
        'Услуга считается оказанной с момента её подключения. Если услуга не была предоставлена по вине Оператора, деньги возвращаются по заявлению в поддержку в течение 10 рабочих дней тем же способом, которым была произведена оплата.'
      ]],
      ['Запрещённые действия', [
        'Пользователю запрещается:',
        '— публиковать заведомо ложные заявки, а также заявки о людях без права на это;',
        '— использовать Платформу для мошенничества, вымогательства, преследования или слежки за людьми;',
        '— размещать чужие персональные данные, не нужные для поиска, а также оскорбительные и незаконные материалы;',
        '— рассылать рекламу и спам, создавать несколько учётных записей для обхода ограничений;',
        '— вмешиваться в работу Платформы, подбирать коды доступа, собирать данные автоматизированными средствами.'
      ]],
      ['Материалы пользователей', [
        'Пользователь сохраняет права на загружаемые фотографии и тексты и предоставляет Оператору безвозмездную неисключительную лицензию на их хранение, обработку и показ на Платформе в течение срока публикации заявки.',
        'Пользователь гарантирует, что вправе размещать загружаемые материалы и что они не нарушают прав третьих лиц.'
      ]],
      ['Ответственность', [
        'Платформа предоставляется «как есть». Оператор принимает разумные меры для её бесперебойной работы, но не отвечает за временные перерывы, вызванные техническими работами, сбоями связи или действиями третьих лиц.',
        'Оператор не отвечает за действия пользователей, за содержание заявок и переписки, а также за результаты встреч и договорённостей между пользователями.',
        'Пользователь возмещает Оператору убытки, причинённые нарушением настоящего Соглашения.'
      ]],
      ['Блокировка учётной записи', [
        'Оператор вправе ограничить доступ к Платформе или заблокировать учётную запись при нарушении Соглашения, по обоснованным жалобам других пользователей или по требованию уполномоченных органов.',
        'Пользователь может обжаловать блокировку, написав в поддержку на {email}.'
      ]],
      ['Изменение Соглашения и разрешение споров', [
        'Оператор вправе изменять Соглашение. Новая редакция вступает в силу с момента публикации на Платформе. Продолжение использования Платформы означает согласие с новой редакцией.',
        'К отношениям сторон применяется право Российской Федерации. Споры решаются путём переговоров; срок ответа на претензию — 30 дней. При недостижении согласия спор передаётся в суд по месту нахождения Оператора, если иное не предусмотрено законодательством о защите прав потребителей.'
      ]],
      ['Контакты', [
        'Вопросы по работе Платформы — в разделе «Поддержка» или по адресу {email}.'
      ]]
    ]
  },
  privacy: {
    title: 'Политика конфиденциальности',
    lead: 'Какие персональные данные обрабатывает платформа «Мой лучший агент», зачем, как долго хранит и как их защищает. Документ составлен в соответствии с Федеральным законом № 152-ФЗ «О персональных данных».',
    sections: [
      ['Общие положения', [
        'Политика определяет порядок обработки и меры по защите персональных данных пользователей платформы «Мой лучший агент» (сайт {site} и веб-приложение). Обработку персональных данных осуществляет оператор платформы{op} (далее — «Оператор»).',
        'Политика применяется ко всем сведениям, которые Оператор получает при использовании Платформы. Регистрируясь и используя Платформу, Пользователь подтверждает, что ознакомился с Политикой.',
        'Обработка персональных данных ведётся на законной и справедливой основе, ограничивается конкретными целями, а объём данных соответствует этим целям.'
      ]],
      ['Какие данные мы обрабатываем', [
        'Данные учётной записи: имя, номер телефона и (или) e-mail, дата рождения, город, фотография профиля (по желанию), язык и настройки уведомлений.',
        'Зона оповещений: координаты выбранной точки и радиус — только если Пользователь включил оповещения.',
        'Данные заявок: описание, приметы, фотографии, место и дата события, контакт для связи. В заявках категории «Люди» — ФИО, возраст, приметы и фотографии разыскиваемого человека, а также степень родства заявителя.',
        'Переписка в анонимном чате, обращения в поддержку, жалобы и запросы об удалении.',
        'Реестр ценностей: описания, фото, серийные номера и приметы зарегистрированных вещей.',
        'Платежи: тариф, сумма, способ оплаты, данные кассового чека, маска номера и токен карты при её привязке. Полные реквизиты карты обрабатывает платёжный провайдер, Оператор их не получает.',
        'Технические данные: IP-адрес, сведения о браузере и устройстве, идентификатор сессии, подписка на push-уведомления, журнал действий в учётной записи.'
      ]],
      ['Цели и правовые основания', [
        'Регистрация, вход и работа учётной записи — исполнение Пользовательского соглашения и согласие Пользователя (п. 1, 5 ч. 1 ст. 6 152-ФЗ).',
        'Публикация заявок, подбор совпадений, анонимный чат, уведомления и экстренные оповещения — исполнение Соглашения и согласие Пользователя, в том числе на распространение данных.',
        'Обработка сведений о разыскиваемом человеке — защита его жизни, здоровья и иных жизненно важных интересов, когда получить его согласие невозможно (п. 6 ч. 1 ст. 6 152-ФЗ).',
        'Приём платежей и выдача кассовых чеков — исполнение договора и требования законодательства (54-ФЗ, 402-ФЗ).',
        'Обеспечение безопасности, рассмотрение жалоб, предотвращение мошенничества — законные интересы Оператора и пользователей.',
        'Ответы на запросы уполномоченных органов — исполнение требований закона.'
      ]],
      ['Сведения о здоровье и специальные категории данных', [
        'Оператор не собирает намеренно сведения о состоянии здоровья, национальности, религиозных и политических взглядах. В заявках запрещено указывать диагнозы и подобные сведения.',
        'Если такие сведения всё же попали в заявку, модератор удаляет их или отклоняет заявку.'
      ]],
      ['Что видят другие пользователи', [
        'Публично доступны опубликованные заявки (без контакта автора), их фотографии и примерное место на карте.',
        'Контакт для связи из заявки видят только модераторы. Пользователи общаются через анонимный чат без раскрытия телефона и e-mail.',
        'В рейтинге волонтёров показываются имя и первая буква фамилии (или название организации-партнёра), город, фото профиля, баллы и статус.',
        'После отметки «найдено» персональные данные в заявке о человеке скрываются из публичного доступа.'
      ]],
      ['Хранение и локализация', [
        'Персональные данные граждан Российской Федерации записываются, систематизируются, хранятся и обновляются в базах данных, расположенных на территории Российской Федерации (ч. 5 ст. 18 152-ФЗ). Трансграничная передача не осуществляется.',
        'Сроки хранения:',
        '— данные учётной записи — до её удаления Пользователем или Оператором;',
        '— заявки и переписка по ним — до удаления заявки или учётной записи;',
        '— одноразовые коды входа — 10 минут, сессии входа — до выхода из учётной записи, но не более 30 дней;',
        '— журнал действий и технические данные — не более 1 года;',
        '— сведения о платежах и кассовых чеках — 5 лет (ст. 29 402-ФЗ);',
        '— резервные копии — 14 дней, после чего перезаписываются.',
        'По истечении сроков или при достижении целей обработки данные удаляются или обезличиваются.'
      ]],
      ['Передача данных третьим лицам', [
        'Оператор не продаёт персональные данные и не передаёт их для рекламы.',
        'Данные могут передаваться по поручению Оператора и только в объёме, необходимом для оказания услуг: хостинг-провайдеру в РФ, сервисам отправки SMS и e-mail, платёжному провайдеру и оператору фискальных данных. Такие лица обязаны соблюдать конфиденциальность и требования 152-ФЗ.',
        'Сведения предоставляются полиции, суду и иным уполномоченным органам только в случаях, предусмотренных законом.'
      ]],
      ['Cookie, локальное хранилище, геолокация и push', [
        'Платформа использует один служебный cookie — идентификатор сессии (httpOnly), без которого невозможен вход. В локальном хранилище браузера сохраняются только выбранные язык и тема оформления. Рекламные и аналитические cookie не используются.',
        'Геолокация запрашивается только после нажатия кнопки «Моё местоположение» и с разрешения браузера; координаты не отслеживаются в фоне.',
        'Push-уведомления включаются только с согласия Пользователя и отключаются в настройках кабинета или браузера.'
      ]],
      ['Защита данных', [
        'Оператор применяет правовые, организационные и технические меры защиты: передача данных только по HTTPS, разграничение прав доступа по ролям, вход по одноразовым кодам, защищённые cookie, журналирование действий модераторов и администраторов, ежедневное резервное копирование, ограничение числа запросов.',
        'Доступ к персональным данным имеют только сотрудники, которым он необходим для выполнения обязанностей.'
      ]],
      ['Права пользователя', [
        'Пользователь вправе получить сведения об обработке своих данных, потребовать их уточнения, блокирования или уничтожения, отозвать согласие на обработку и распространение, обжаловать действия Оператора в Роскомнадзоре или в суде (ст. 14–17 152-ФЗ).',
        'Изменить данные можно в разделе «Кабинет → Профиль», удалить учётную запись — в разделе «Кабинет → Настройки». Иные запросы направляются через раздел «Поддержка» или на {email}.',
        'Оператор отвечает на запрос в течение 10 рабочих дней с момента его получения; срок может быть продлён не более чем на 5 рабочих дней с уведомлением о причинах.',
        'Человек, о котором опубликована заявка, может потребовать её удаления по ссылке на странице заявки без регистрации.'
      ]],
      ['Несовершеннолетние', [
        'Регистрация на Платформе доступна с 18 лет. Заявку о несовершеннолетнем может подать только его законный представитель; такая заявка публикуется после проверки модератором.'
      ]],
      ['Изменение Политики и контакты', [
        'Оператор вправе изменять Политику. Новая редакция вступает в силу с момента публикации на Платформе; действующая редакция всегда доступна по адресу {site}/#/legal/privacy.',
        'Вопросы об обработке персональных данных: {email}.'
      ]]
    ]
  },
  consent: {
    title: 'Согласие на обработку персональных данных',
    lead: 'Согласие, которое пользователь даёт при регистрации на платформе «Мой лучший агент». Составлено в соответствии со ст. 9 Федерального закона № 152-ФЗ «О персональных данных».',
    sections: [
      ['Кто и кому даёт согласие', [
        'Я, пользователь платформы «Мой лучший агент», указавший свои данные при регистрации (далее — «Субъект»), свободно, своей волей и в своём интересе даю согласие оператору платформы{op} (далее — «Оператор») на обработку моих персональных данных на условиях ниже.',
        'Согласие даётся в электронной форме путём проставления отметки в форме регистрации и подтверждения входа одноразовым кодом.'
      ]],
      ['Перечень персональных данных', [
        'Имя; номер телефона и (или) адрес электронной почты; дата рождения; город; фотография профиля (если загружена); координаты и радиус зоны оповещений (если включена); сведения, которые я указываю в заявках, переписке, обращениях в поддержку и реестре ценностей; сведения о платежах; IP-адрес, данные о браузере и устройстве, идентификатор сессии и подписки на push-уведомления.'
      ]],
      ['Цели обработки', [
        'Регистрация и идентификация на Платформе, вход по одноразовому коду.',
        'Публикация заявок, автоматический подбор совпадений, работа анонимного чата.',
        'Направление уведомлений о совпадениях, сообщениях и статусе заявок, в том числе push-уведомлений, SMS и e-mail; экстренные оповещения в выбранной зоне.',
        'Начисление баллов и формирование рейтинга волонтёров.',
        'Приём оплаты, направление кассовых чеков, автопродление услуг.',
        'Ответы на обращения, рассмотрение жалоб, обеспечение безопасности и предотвращение мошенничества.'
      ]],
      ['Действия с данными и способы обработки', [
        'Сбор, запись, систематизация, накопление, хранение, уточнение (обновление, изменение), извлечение, использование, передача (предоставление, доступ), обезличивание, блокирование, удаление и уничтожение.',
        'Обработка ведётся с использованием средств автоматизации и без них. Данные хранятся в базах данных на территории Российской Федерации.'
      ]],
      ['Передача по поручению Оператора', [
        'Я согласен с тем, что для достижения указанных целей Оператор вправе поручать обработку хостинг-провайдеру в РФ, сервисам отправки SMS и e-mail, платёжному провайдеру и оператору фискальных данных в объёме, необходимом для оказания услуг, с соблюдением конфиденциальности.'
      ]],
      ['Срок действия и отзыв согласия', [
        'Согласие действует с момента регистрации до удаления учётной записи либо до его отзыва.',
        'Я могу отозвать согласие, удалив учётную запись в разделе «Кабинет → Настройки» или направив заявление на {email}. Оператор прекращает обработку и уничтожает данные в течение 30 дней с момента получения отзыва, за исключением сведений, хранение которых обязательно по закону (в частности, данных о платежах — 5 лет).',
        'Отзыв согласия не влияет на законность обработки, выполненной до отзыва.'
      ]],
      ['Подтверждение', [
        'Я подтверждаю, что мне исполнилось 18 лет, я ознакомлен с Политикой конфиденциальности и Пользовательским соглашением, а предоставленные мной сведения достоверны.'
      ]]
    ]
  },
  publication: {
    title: 'Согласие на распространение персональных данных',
    lead: 'Согласие на то, чтобы часть сведений была видна другим посетителям платформы: опубликованные заявки и рейтинг волонтёров. Составлено в соответствии со ст. 10.1 Федерального закона № 152-ФЗ.',
    sections: [
      ['Предмет согласия', [
        'Я, пользователь платформы «Мой лучший агент», даю оператору платформы{op} (далее — «Оператор») согласие на распространение — раскрытие неопределённому кругу лиц через сайт {site} и веб-приложение — персональных данных, перечисленных ниже.',
        'Согласие даётся отдельно от согласия на обработку персональных данных и действует при публикации каждой заявки и при участии в рейтинге волонтёров.'
      ]],
      ['Какие данные становятся общедоступными', [
        'В опубликованных мной заявках: заголовок, описание и приметы, загруженные фотографии, примерное место на карте и адресный ориентир, город, дата события, сумма вознаграждения (если указана).',
        'В рейтинге волонтёров: имя и первая буква фамилии (для партнёров — название организации), город, фотография профиля, количество баллов и статус.',
        'Номер телефона, адрес электронной почты и дата рождения не распространяются ни при каких условиях.'
      ]],
      ['Условия и запреты', [
        'Распространение допускается только на страницах Платформы и в ссылках «Поделиться», которые я отправляю сам.',
        'Я запрещаю Оператору передавать перечисленные данные третьим лицам для рекламы, а также публиковать их на других ресурсах без моего отдельного согласия.',
        'Я могу установить дополнительные условия или запреты, направив их на {email}. Оператор обязан опубликовать сведения о таких условиях в течение 3 рабочих дней.'
      ]],
      ['Срок действия и прекращение', [
        'Согласие действует до закрытия или удаления соответствующей заявки, до удаления учётной записи либо до отзыва согласия.',
        'Чтобы прекратить распространение, достаточно закрыть или удалить заявку в кабинете либо направить требование на {email}. Оператор прекращает распространение в течение 3 рабочих дней с момента получения требования (ч. 14 ст. 10.1 152-ФЗ).',
        'После отметки «найдено» персональные данные в заявке о человеке скрываются из публичного доступа автоматически.'
      ]]
    ]
  }
};

const EN = {
  terms: {
    title: 'Terms of Use',
    lead: 'Rules for using the My Best Agent platform: registration, reports, emergency alerts, anonymous chat, points, the valuables registry and paid services.',
    sections: [
      ['General provisions', [
        'These Terms govern the relationship between the operator of the My Best Agent platform{op} (the "Operator") and any individual using the platform (the "User").',
        'The Platform is the website {site} and the installable web app (PWA) for finding and returning lost people, animals and things.',
        'These Terms are a public offer (Art. 437 of the Civil Code of the Russian Federation). Registering on the Platform means full acceptance of the Terms. If you do not agree, do not use the Platform.',
        'Definitions: a "Report" is a "Lost" or "Found" publication in the People, Animals or Things categories; a "Moderator" is an Operator employee who reviews reports and complaints; "Volunteers" and "Partners" are users and organisations helping with searches; the "Anonymous chat" is messaging about a report without revealing contact details; "Points" are internal units for helpful actions.'
      ]],
      ['Registration and account', [
        'Only persons aged 18 or older with full legal capacity may register. Sign-in uses a one-time code sent by SMS or e-mail.',
        'The User provides accurate information, does not share account access and is responsible for all actions taken under the account.',
        'The User may create a family account and invite relatives, who can then see and edit shared reports and their chats.',
        'The User can delete the account under Account → Settings. Reports, chats and the valuables registry are deleted with it, except for information the Operator must retain by law.'
      ]],
      ['Purpose and limitations', [
        'The Platform assists in searches but does not replace the police, emergency services or search teams. If a person goes missing, the User must contact the police immediately at 102 or 112.',
        'The Operator does not guarantee that anything will be found and does not verify every report, except People reports, which are published after moderator review.',
        'Automatic matching is advisory: the match percentage is a similarity estimate, not a confirmation.'
      ]],
      ['Reports', [
        'A report may contain a description, distinctive features, up to 5 photos, a map location and a date. The contact is not published: only moderators see it; people reach the author via the anonymous chat.',
        'Animals and Things reports are published immediately and reviewed on complaint. People reports are published only after moderator review.',
        'Only a relative or legal representative may report a missing person; only a legal representative may report a minor. By filing, the User confirms this right.',
        'Reports must not contain health information or diagnoses, document details, a full home address or other information not needed for the search. Moderators may remove such information or reject the report.',
        'Once marked as found, personal data in a People report is hidden from public view.',
        'The person a report is about, or their legal representative, may request its removal via the "This report is about me" link on the report page.',
        'Users may edit, close and delete their reports. An edited People report is reviewed again.'
      ]],
      ['Emergency alerts', [
        'For a missing person or animal, the author may request an emergency alert within a 1–5 km radius. A moderator starts it after review.',
        'Users, volunteers and partners whose alert zone overlaps the search area receive it. Push notifications contain no personal data.',
        'Users can turn alerts off or change their zone at any time under Account → Alert zone.'
      ]],
      ['Anonymous chat and conduct', [
        'Chats do not reveal phone numbers or e-mails. Users can send text, photos and a map location.',
        'It is forbidden to demand or send money before the item is handed over, or to ask for SMS codes, card details or documents. Meet in public places.',
        'Users can report messages or users and block a chat. Moderators review complaints and may restrict offenders.'
      ]],
      ['Rewards and points', [
        'A reward stated in a report is paid by its author directly to the finder, outside the Platform. The Operator is not a party to this arrangement.',
        'Points are awarded for confirmed finds, emergency searches and useful information. Points have no monetary value, cannot be exchanged for money or transferred.',
        'Status based on points gives a discount on paid services as shown in the account.'
      ]],
      ['Valuables registry', [
        'Users can register valuables and antiques with photos, descriptions, serial numbers and marks, and flag an item as stolen or lost.',
        'Registry data is provided by owners. The Operator does not verify authenticity or ownership. The absence of a flag does not guarantee lawful origin.',
        'Anyone can check an item by number or name and anonymously notify the owner.'
      ]],
      ['Paid services and payment', [
        'Core features are free. Additional services (extended registry, report boost, organisation plan) are provided at the prices on the Plans page at the time of payment.',
        'Payment is accepted by cards of Russian banks and via the Faster Payments System. A fiscal receipt (Federal Law 54-FZ) is sent to the e-mail or phone in the profile.',
        'When paying by card, the User may save it for auto-renewal. Card details are processed by the payment provider; the Operator stores only the masked number. Auto-renewal and the saved card can be removed under Account → Payments.',
        'A service is deemed provided once activated. If it was not provided through the Operator\'s fault, the money is refunded on request within 10 business days by the original payment method.'
      ]],
      ['Prohibited actions', [
        'Users must not:',
        '— publish knowingly false reports or People reports without the right to do so;',
        '— use the Platform for fraud, extortion, harassment or tracking people;',
        '— post third-party personal data not needed for the search, or offensive or unlawful content;',
        '— send advertising or spam, or create multiple accounts to bypass restrictions;',
        '— interfere with the Platform, brute-force access codes or scrape data.'
      ]],
      ['User content', [
        'Users keep the rights to their photos and texts and grant the Operator a free, non-exclusive licence to store, process and display them on the Platform while the report is published.',
        'Users warrant that they may publish the content and that it does not infringe third-party rights.'
      ]],
      ['Liability', [
        'The Platform is provided "as is". The Operator takes reasonable measures to keep it running but is not liable for interruptions caused by maintenance, network failures or third parties.',
        'The Operator is not liable for users\' actions, the content of reports and chats, or the outcome of arrangements between users.',
        'Users compensate the Operator for losses caused by breaching these Terms.'
      ]],
      ['Account suspension', [
        'The Operator may restrict access or block an account for breaching the Terms, on justified complaints or at the request of authorities.',
        'Users can appeal by writing to {email}.'
      ]],
      ['Changes and disputes', [
        'The Operator may amend these Terms. A new version takes effect when published on the Platform; continued use means acceptance.',
        'Russian law applies. Disputes are settled by negotiation; claims are answered within 30 days. Failing agreement, disputes go to the court at the Operator\'s location unless consumer protection law provides otherwise.'
      ]],
      ['Contacts', [
        'Questions about the Platform: the Support section or {email}.'
      ]]
    ]
  },
  privacy: {
    title: 'Privacy Policy',
    lead: 'What personal data the My Best Agent platform processes, why, how long it is kept and how it is protected. Prepared in accordance with Russian Federal Law No. 152-FZ "On Personal Data".',
    sections: [
      ['General provisions', [
        'This Policy sets out how personal data of users of the My Best Agent platform ({site} and the web app) is processed and protected. The data controller is the operator of the Platform{op} (the "Operator").',
        'The Policy applies to all information the Operator receives through the Platform. By registering and using the Platform, the User confirms having read it.',
        'Data is processed lawfully and fairly, limited to specific purposes, and its scope matches those purposes.'
      ]],
      ['Data we process', [
        'Account data: name, phone number and/or e-mail, date of birth, city, profile photo (optional), language and notification settings.',
        'Alert zone: coordinates of the chosen point and the radius — only if alerts are enabled.',
        'Report data: description, features, photos, place and date, contact. People reports also contain the missing person\'s name, age, features and photos, and the filer\'s relationship.',
        'Anonymous chat messages, support requests, complaints and removal requests.',
        'Valuables registry: descriptions, photos, serial numbers and marks.',
        'Payments: plan, amount, method, receipt data, masked card number and card token if saved. Full card details are processed by the payment provider; the Operator never receives them.',
        'Technical data: IP address, browser and device information, session ID, push subscription, account activity log.'
      ]],
      ['Purposes and legal grounds', [
        'Registration, sign-in and account operation — performance of the Terms and the User\'s consent (Art. 6(1)(1),(5) of 152-FZ).',
        'Publishing reports, matching, anonymous chat, notifications and emergency alerts — performance of the Terms and consent, including consent to dissemination.',
        'Processing data about a missing person — protecting their life, health or other vital interests when consent cannot be obtained (Art. 6(1)(6) of 152-FZ).',
        'Payments and fiscal receipts — performance of the contract and legal requirements (54-FZ, 402-FZ).',
        'Security, complaint handling and fraud prevention — legitimate interests of the Operator and users.',
        'Responding to lawful requests from authorities — legal obligation.'
      ]],
      ['Health data and special categories', [
        'The Operator does not intentionally collect health, ethnic, religious or political data. Reports must not contain diagnoses or similar details.',
        'If such data appears in a report, a moderator removes it or rejects the report.'
      ]],
      ['What other users see', [
        'Published reports (without the author\'s contact), their photos and approximate map location are public.',
        'The contact in a report is visible only to moderators. Users talk via the anonymous chat without revealing phone or e-mail.',
        'The volunteer rating shows first name and surname initial (or partner organisation name), city, profile photo, points and status.',
        'Once marked as found, personal data in a People report is hidden from public view.'
      ]],
      ['Storage and localisation', [
        'Personal data of Russian citizens is recorded, systematised, stored and updated in databases located in the Russian Federation (Art. 18(5) of 152-FZ). No cross-border transfer takes place.',
        'Retention periods:',
        '— account data — until the account is deleted;',
        '— reports and their chats — until the report or account is deleted;',
        '— one-time sign-in codes — 10 minutes; sign-in sessions — until sign-out, at most 30 days;',
        '— activity log and technical data — up to 1 year;',
        '— payment and receipt records — 5 years (Art. 29 of 402-FZ);',
        '— backups — 14 days, then overwritten.',
        'When the period expires or the purpose is achieved, data is deleted or anonymised.'
      ]],
      ['Sharing with third parties', [
        'The Operator does not sell personal data or share it for advertising.',
        'Data may be processed on the Operator\'s behalf, only as needed to provide the service, by a hosting provider in Russia, SMS and e-mail services, the payment provider and the fiscal data operator, all bound by confidentiality and 152-FZ.',
        'Information is disclosed to the police, courts or other authorities only where required by law.'
      ]],
      ['Cookies, local storage, location and push', [
        'The Platform uses one essential cookie — the session ID (httpOnly) required for sign-in. Local storage keeps only the chosen language and theme. No advertising or analytics cookies are used.',
        'Location is requested only after tapping "My location" and with browser permission; it is not tracked in the background.',
        'Push notifications are enabled only with consent and can be turned off in account or browser settings.'
      ]],
      ['Security', [
        'The Operator applies legal, organisational and technical measures: HTTPS only, role-based access, one-time sign-in codes, secure cookies, logging of moderator and admin actions, daily backups and rate limiting.',
        'Only staff who need it for their duties have access to personal data.'
      ]],
      ['User rights', [
        'Users may obtain information about the processing of their data, request correction, blocking or deletion, withdraw consent to processing and dissemination, and complain to Roskomnadzor or a court (Arts. 14–17 of 152-FZ).',
        'Profile data can be changed under Account → Profile; the account can be deleted under Account → Settings. Other requests go to Support or {email}.',
        'The Operator responds within 10 business days of receipt; this may be extended by up to 5 business days with notice of the reasons.',
        'A person a report is about can request its removal via the link on the report page without registering.'
      ]],
      ['Minors', [
        'Registration is available from age 18. Only a legal representative may report a missing minor; such reports are published after moderator review.'
      ]],
      ['Changes and contacts', [
        'The Operator may amend this Policy. A new version takes effect when published; the current version is always at {site}/#/legal/privacy.',
        'Questions about personal data: {email}.'
      ]]
    ]
  },
  consent: {
    title: 'Consent to Personal Data Processing',
    lead: 'The consent a user gives when registering on the My Best Agent platform. Prepared in accordance with Art. 9 of Russian Federal Law No. 152-FZ.',
    sections: [
      ['Who gives consent and to whom', [
        'I, a user of the My Best Agent platform who provided my details at registration (the "Data Subject"), freely, of my own will and in my own interest, consent to the operator of the Platform{op} (the "Operator") processing my personal data on the terms below.',
        'Consent is given electronically by ticking the box in the registration form and confirming sign-in with a one-time code.'
      ]],
      ['Personal data covered', [
        'Name; phone number and/or e-mail; date of birth; city; profile photo (if uploaded); alert zone coordinates and radius (if enabled); information I provide in reports, chats, support requests and the valuables registry; payment information; IP address, browser and device data, session ID and push subscription.'
      ]],
      ['Purposes', [
        'Registration, identification and sign-in with one-time codes.',
        'Publishing reports, automatic matching and the anonymous chat.',
        'Notifications about matches, messages and report status, including push, SMS and e-mail; emergency alerts in the chosen zone.',
        'Awarding points and compiling the volunteer rating.',
        'Accepting payments, sending receipts and auto-renewal.',
        'Answering requests, handling complaints, security and fraud prevention.'
      ]],
      ['Actions and methods', [
        'Collection, recording, systematisation, accumulation, storage, updating, retrieval, use, transfer (provision, access), anonymisation, blocking, deletion and destruction.',
        'Processing is automated and manual. Data is stored in databases in the Russian Federation.'
      ]],
      ['Processing on the Operator\'s behalf', [
        'I agree that, for these purposes, the Operator may engage a hosting provider in Russia, SMS and e-mail services, the payment provider and the fiscal data operator to process data as needed to provide the service, subject to confidentiality.'
      ]],
      ['Term and withdrawal', [
        'Consent is valid from registration until the account is deleted or consent is withdrawn.',
        'I can withdraw consent by deleting my account under Account → Settings or by writing to {email}. The Operator stops processing and destroys the data within 30 days of receiving the withdrawal, except data that must be kept by law (e.g. payment records — 5 years).',
        'Withdrawal does not affect the lawfulness of processing carried out before it.'
      ]],
      ['Confirmation', [
        'I confirm that I am 18 or older, have read the Privacy Policy and the Terms of Use, and that the information I provide is accurate.'
      ]]
    ]
  },
  publication: {
    title: 'Consent to Dissemination of Personal Data',
    lead: 'Consent for certain information to be visible to other visitors of the platform: published reports and the volunteer rating. Prepared in accordance with Art. 10.1 of Russian Federal Law No. 152-FZ.',
    sections: [
      ['Subject of consent', [
        'I, a user of the My Best Agent platform, consent to the operator of the Platform{op} (the "Operator") disseminating — disclosing to an unlimited number of persons via {site} and the web app — the personal data listed below.',
        'This consent is separate from the consent to processing and applies to each report I publish and to my participation in the volunteer rating.'
      ]],
      ['Data made public', [
        'In my published reports: title, description and features, uploaded photos, approximate map location and landmark, city, event date, reward amount (if stated).',
        'In the volunteer rating: first name and surname initial (organisation name for partners), city, profile photo, points and status.',
        'Phone number, e-mail and date of birth are never disseminated.'
      ]],
      ['Conditions and restrictions', [
        'Dissemination is allowed only on Platform pages and through "Share" links I send myself.',
        'I prohibit the Operator from passing this data to third parties for advertising or publishing it elsewhere without my separate consent.',
        'I may set additional conditions or prohibitions by writing to {email}; the Operator publishes them within 3 business days.'
      ]],
      ['Term and termination', [
        'Consent is valid until the relevant report is closed or deleted, the account is deleted, or consent is withdrawn.',
        'To stop dissemination, close or delete the report in the account or send a request to {email}. The Operator stops dissemination within 3 business days of receipt (Art. 10.1(14) of 152-FZ).',
        'Once marked as found, personal data in a People report is hidden from public view automatically.'
      ]]
    ]
  }
};

const TITLES = { ru: {}, en: {} };
for (const id of DOC_IDS) { TITLES.ru[id] = RU[id].title; TITLES.en[id] = EN[id].title; }

/* ---------- сборка документа ---------- */
// Если администратор вставил свой текст (legal.text.<doc>), он заменяет стандартный: абзацы — по пустой строке,
// строка вида «1. Заголовок» начинает новый раздел.
function fromPlain(text) {
  const sections = []; let cur = null;
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const b = block.trim(); if (!b) continue;
    const m = b.match(/^(\d+)\.\s+([^\n]{2,120})$/);
    if (m) { cur = { h: m[2], items: [] }; sections.push(cur); continue; }
    if (!cur) { cur = { h: '', items: [] }; sections.push(cur); }
    cur.items.push(b);
  }
  return sections;
}

function getDoc(id, lang) {
  if (!DOC_IDS.includes(id)) return null;
  lang = lang === 'en' ? 'en' : 'ru';
  const ov = overrides(lang);
  const op = operator(lang, ov);
  const src = (lang === 'en' ? EN : RU)[id];
  const fill = (s) => s.replace(/\{op\}/g, op.name ? ' — ' + op.name : '').replace(/\{email\}/g, op.email).replace(/\{site\}/g, op.site);
  const custom = (ov['legal.text.' + id] || '').trim();
  const sections = custom
    ? fromPlain(fill(custom))
    : src.sections.map(([hd, items]) => ({ h: hd, items: items.map(fill) }));
  // нумерация пунктов: 1.1, 1.2 …; подпункты «— » без номера
  let si = 0;
  const numbered = sections.map((s) => {
    if (s.h) si++; let pi = 0;
    return { n: s.h ? String(si) : '', h: s.h, items: s.items.map((t) => (t.startsWith('— ') ? { bullet: true, text: t.slice(2) } : { n: s.h ? `${si}.${++pi}` : "", text: t })) };
  });
  const req = [];
  const L = lang === 'en'
    ? { name: 'Operator', inn: 'TIN (INN)', kpp: 'KPP', ogrn: 'OGRN', address: 'Address', account: 'Settlement account', bank: 'Bank', bik: 'BIC', corr: 'Correspondent account', email: 'E-mail', site: 'Website' }
    : { name: 'Оператор', inn: 'ИНН', kpp: 'КПП', ogrn: 'ОГРН', address: 'Адрес', account: 'Расчётный счёт', bank: 'Банк', bik: 'БИК', corr: 'Корр. счёт', email: 'E-mail', site: 'Сайт' };
  for (const k of [...OP_FIELDS, 'site']) if (op[k]) req.push([L[k], op[k]]);
  return { id, lang, title: (ov['legal.' + id] || '').trim() || src.title, lead: fill(src.lead), edition: EDITION, custom: !!custom, sections: numbered, requisites: req, docs: DOC_IDS.map((d) => ({ id: d, title: TITLES[lang][d] })) };
}

/* ---------- PDF ---------- */
const FONT_R = path.join(__dirname, 'fonts', 'PT_Sans-Web-Regular.ttf');
const FONT_B = path.join(__dirname, 'fonts', 'PT_Sans-Web-Bold.ttf');
const LOGO = path.join(__dirname, '..', 'public', 'assets', 'logo-256.png');
const RED = '#e0192d', INK = '#0e0f13', MUTED = '#6a6d78', LINE = '#e6e4df';
// Символы, которых нет в шрифте (стрелки, эмодзи из пользовательского текста), заменяем, чтобы в PDF не было «квадратиков»
let glyphs = null;
function clean(s) {
  if (!glyphs) { try { glyphs = require('fontkit').openSync(FONT_R); } catch (e) { glyphs = { hasGlyphForCodePoint: () => true }; } } // fontkit приходит вместе с pdfkit
  return String(s).replace(/→/g, '›').replace(/[^\n]/gu, (ch) => (ch.codePointAt(0) < 128 || glyphs.hasGlyphForCodePoint(ch.codePointAt(0)) ? ch : ''));
}

function fmtEdition(lang) {
  const d = new Date(EDITION + 'T00:00:00Z');
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function renderPdf(src, res) {
  const doc = { ...src, title: clean(src.title), lead: clean(src.lead), requisites: src.requisites.map(([k, v]) => [k, clean(v)]),
    sections: src.sections.map((s) => ({ ...s, h: clean(s.h), items: s.items.map((it) => ({ ...it, text: clean(it.text) })) })) };
  const en = doc.lang === 'en';
  const pdf = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 }, bufferPages: true,
    info: { Title: doc.title, Author: en ? 'My Best Agent' : 'Мой лучший агент', Subject: doc.lead, CreationDate: new Date(EDITION + 'T00:00:00Z') } });
  pdf.registerFont('R', FONT_R); pdf.registerFont('B', FONT_B);
  pdf.pipe(res);
  const W = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  const X = pdf.page.margins.left;

  // шапка первой страницы
  try { pdf.image(LOGO, X, 52, { width: 46 }); } catch (e) { /* без логотипа */ }
  pdf.font('B').fontSize(12).fillColor(INK).text(en ? 'My Best Agent' : 'Мой лучший агент', X + 58, 58);
  pdf.font('R').fontSize(9).fillColor(MUTED).text(en ? 'people, pets & things finder' : 'поиск людей, животных и вещей', X + 58, 74);
  pdf.moveTo(X, 112).lineTo(X + W, 112).lineWidth(0.8).strokeColor(LINE).stroke();
  pdf.rect(X, 130, 28, 3).fill(RED);
  pdf.font('B').fontSize(22).fillColor(INK).text(doc.title, X, 142, { width: W, lineGap: 2 });
  pdf.moveDown(0.4);
  pdf.font('R').fontSize(10).fillColor(MUTED).text(`${en ? 'Effective from' : 'Редакция от'} ${fmtEdition(doc.lang)}`, { width: W });
  pdf.moveDown(0.8);
  pdf.font('R').fontSize(10.5).fillColor('#2a2c33').text(doc.lead, { width: W, lineGap: 2.5 });
  pdf.moveDown(1.2);

  const ensure = (h) => { if (pdf.y + h > pdf.page.height - pdf.page.margins.bottom) pdf.addPage(); };
  for (const s of doc.sections) {
    if (s.h) {
      // заголовок раздела не остаётся внизу страницы в одиночку: переносим его вместе с первым пунктом
      const first = s.items[0]; pdf.font('R').fontSize(10.5);
      ensure(34 + (first ? Math.min(pdf.heightOfString(first.text, { width: W - 34, lineGap: 2.5 }), 64) : 0));
      pdf.font('B').fontSize(13).fillColor(INK).text(`${s.n}. ${s.h}`, X, pdf.y, { width: W });
      pdf.moveDown(0.45);
    }
    for (const it of s.items) {
      pdf.font('R').fontSize(10.5).fillColor('#24262c');
      if (it.bullet) {
        const h = pdf.heightOfString(it.text, { width: W - 46, lineGap: 2.5 }); ensure(h + 4);
        const y = pdf.y; pdf.circle(X + 38, y + 6.5, 1.8).fill(RED);
        pdf.fillColor('#24262c').text(it.text, X + 46, y, { width: W - 46, lineGap: 2.5 });
      } else if (it.n) {
        const h = pdf.heightOfString(it.text, { width: W - 34, lineGap: 2.5 }); ensure(Math.min(h, 60) + 6);
        const y = pdf.y;
        pdf.font('B').fontSize(10).fillColor(MUTED).text(it.n, X, y + 0.5, { width: 32 });
        pdf.font('R').fontSize(10.5).fillColor('#24262c').text(it.text, X + 34, y, { width: W - 34, lineGap: 2.5 });
      } else {
        pdf.text(it.text, X, pdf.y, { width: W, lineGap: 2.5 });
      }
      pdf.moveDown(0.45);
    }
    pdf.moveDown(0.6);
  }

  // реквизиты оператора: высота строки — по самому длинному значению (название банка может переноситься)
  pdf.font('R').fontSize(9.5);
  const rowH = doc.requisites.map(([k, v]) => Math.max(16, pdf.heightOfString(k, { width: 120 }) + 4, pdf.heightOfString(v, { width: W - 156 }) + 4));
  const boxH = 38 + rowH.reduce((a, b) => a + b, 0);
  ensure(boxH + 12);
  pdf.moveDown(0.4);
  const top = pdf.y;
  pdf.roundedRect(X, top, W, boxH, 10).fillColor('#f6f5f2').fill();
  pdf.font('B').fontSize(11).fillColor(INK).text(en ? 'Operator details' : 'Реквизиты оператора', X + 16, top + 12);
  let ry = top + 32;
  doc.requisites.forEach(([k, v], i) => {
    pdf.font('R').fontSize(9.5).fillColor(MUTED).text(k, X + 16, ry, { width: 120 });
    pdf.font('R').fontSize(9.5).fillColor(INK).text(v, X + 140, ry, { width: W - 156 });
    ry += rowH[i];
  });
  pdf.y = top + boxH;

  // колонтитулы и номера страниц
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    const y = pdf.page.height - 42;
    pdf.page.margins.bottom = 0; // чтобы текст колонтитула не создавал новую страницу
    pdf.moveTo(X, y - 8).lineTo(X + W, y - 8).lineWidth(0.5).strokeColor(LINE).stroke();
    pdf.font('R').fontSize(8).fillColor(MUTED).text(`${doc.title} · ${fmtEdition(doc.lang)}`, X, y, { width: W * 0.7, lineBreak: false });
    pdf.text(`${en ? 'Page' : 'Стр.'} ${i + 1} ${en ? 'of' : 'из'} ${range.count}`, X + W * 0.7, y, { width: W * 0.3, align: 'right', lineBreak: false });
  }
  pdf.end();
}

const FILE = { terms: ['polzovatelskoe-soglashenie', 'terms-of-use'], privacy: ['politika-konfidencialnosti', 'privacy-policy'], consent: ['soglasie-na-obrabotku-pd', 'personal-data-consent'], publication: ['soglasie-na-rasprostranenie-pd', 'data-dissemination-consent'] };
function sendPdf(id, lang, res, inline) {
  const doc = getDoc(id, lang); if (!doc) return false;
  const ascii = FILE[id][doc.lang === 'en' ? 1 : 0] + '.pdf';
  const utf = encodeURIComponent(`${doc.title} — ${doc.lang === 'en' ? 'My Best Agent' : 'Мой лучший агент'}.pdf`);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf}`, 'Cache-Control': 'no-cache' });
  // Готовый PDF кэшируется по содержимому документа: правка реквизитов меняет ключ, повторная генерация не нужна
  const key = require('crypto').createHash('sha1').update(JSON.stringify(doc)).digest('hex');
  const hit = pdfCache.get(key);
  if (hit) { res.end(hit); return true; }
  const parts = [], sink = new (require('stream').Writable)({ write(c, e, cb) { parts.push(c); cb(); } });
  sink.on('finish', () => { const buf = Buffer.concat(parts); if (pdfCache.size > 32) pdfCache.clear(); pdfCache.set(key, buf); res.end(buf); });
  renderPdf(doc, sink);
  return true;
}
const pdfCache = new Map();

module.exports = { DOC_IDS, getDoc, sendPdf, EDITION, operatorInfo };
