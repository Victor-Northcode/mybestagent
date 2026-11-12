'use strict';
// Обратное геокодирование для мастера заявки: по точке на карте подставляем город, адрес и парк.
// Источник — Nominatim (OpenStreetMap). Его правила: не чаще 1 запроса в секунду, свой User-Agent, кэширование ответов.
// Браузер ходит только на свой сервер (CSP connect-src 'self'), поэтому запрос идёт через этот модуль.
const ENDPOINT = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/reverse';
// В тестах наружу не ходим, если не подставлен свой адрес геокодера; GEOCODER=off выключает подсказки совсем
const OFF = process.env.GEOCODER === 'off' || (process.env.NODE_ENV === 'test' && !process.env.GEOCODER_URL);
const UA = 'MyBestAgent/1.0 (+' + String(process.env.BASE_URL || 'https://my-bestagent.ru').replace(/\/$/, '') + ')';
const GAP_MS = process.env.GEOCODER_URL ? 0 : 1100;

const cache = new Map();
const CACHE_MAX = 5000;
let chain = Promise.resolve(), last = 0, waiting = 0;

// Очередь: к Nominatim — по одному запросу в секунду со всего сервера; при длинной очереди сразу отказываем
function slot() {
  if (waiting >= 20) return Promise.reject(Object.assign(new Error('busy'), { code: 'geo_busy' }));
  waiting++;
  const p = chain.then(async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  }).finally(() => { waiting--; });
  chain = p.catch(() => {});
  return p;
}

const PARK_TYPES = /^(park|garden|nature_reserve|recreation_ground)$/;
function parse(j) {
  const a = (j && j.address) || {};
  const city = a.city || a.town || a.village || a.municipality || a.hamlet || '';
  const street = a.road || a.pedestrian || a.footway || a.path || a.square || '';
  const address = [street, a.house_number].filter(Boolean).join(', ') || a.suburb || a.neighbourhood || a.city_district || '';
  let park = '';
  if (j && (j.category === 'leisure' || j.class === 'leisure') && PARK_TYPES.test(j.type || '') && j.name) park = j.name;
  else if (a.park) park = a.park;
  return { city: String(city).slice(0, 80), address: String(address).slice(0, 200), park: String(park).slice(0, 120) };
}

async function reverse(lat, lng, lang = 'ru') {
  if (OFF) throw Object.assign(new Error('off'), { code: 'geo_off' });
  const key = `${lat.toFixed(4)},${lng.toFixed(4)},${lang}`;
  if (cache.has(key)) return cache.get(key);
  await slot();
  const url = `${ENDPOINT}?format=jsonv2&addressdetails=1&zoom=18&accept-language=${lang}&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw Object.assign(new Error('geocoder ' + r.status), { code: 'geo_failed' });
  const out = parse(await r.json());
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

module.exports = { reverse, parse, enabled: !OFF };
