'use strict';
// Параметры заявок о вещах: тип вещи и уточнения, которые помогают узнать именно эту вещь.
// Хранятся в applications.details (JSON); русское название типа дублируется в species — по нему работают поиск и совпадения.
const THING_TYPES = {
  clothes: { ru: 'Одежда', en: 'Clothing', fields: ['size', 'color', 'brand'] },
  accessories: { ru: 'Аксессуары', en: 'Accessories', fields: ['brand', 'color', 'material'] },
  jewelry: { ru: 'Украшения', en: 'Jewellery', fields: ['metal', 'stones', 'engraving'] },
  auto: { ru: 'Авто', en: 'Car', fields: ['brand', 'model', 'color', 'plate'] },
  other: { ru: 'Другое', en: 'Other', fields: [] }
};
// предельная длина каждого уточнения
const THING_TEXT = { size: 20, color: 40, brand: 60, model: 60, material: 60, metal: 40, stones: 80, engraving: 80, plate: 12 };

const clean = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '');

// src — объект details из запроса; неизвестный тип и чужие для типа поля отбрасываются
function readThingDetails(src) {
  const type = src && Object.hasOwn(THING_TYPES, src.thing_type) ? src.thing_type : null;
  if (!type) return {};
  const d = { thing_type: type };
  for (const k of THING_TYPES[type].fields) {
    let v = clean(src[k], THING_TEXT[k]);
    if (k === 'plate') v = v.toUpperCase();
    if (v) d[k] = v;
  }
  return d;
}

module.exports = { THING_TYPES, THING_TEXT, readThingDetails };
