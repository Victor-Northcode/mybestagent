// Shared banner on the home page and the search map.
import { h, tr, icon } from './core.js';

export function searchMasthead() {
  return h`<section class="hound-mast">
    <div class="wrap hound-mast-inner">
      <div class="hound-intro">
        <h1>${tr('Поиск рядом', 'Search nearby')}</h1>
        <p>${tr('Помогаем искать людей, питомцев и потерянные вещи.', 'Find missing people, pets and belongings in your area.')}</p>
        <div class="hound-actions">
          <a class="btn hound-report" href="#/new/lost">${icon('search', 'ic-sm')}${tr('Я потерял', 'I lost something')}</a>
          <a class="btn hound-found" href="#/new/found">${icon('check', 'ic-sm')}${tr('Я нашёл', 'I found something')}</a>
        </div>
      </div>
      <div class="hound-art" aria-hidden="true">
        <svg viewBox="0 0 680 220" fill="none" focusable="false"><path d="M-28 160C9 135 52 108 87 128c52 30-21 55-25 24-3-28 69-65 128-64m262 63c54 38 83 49 120 40 43-11 58-54 108-72" stroke="currentColor" stroke-width="2.5" stroke-dasharray="2 9" stroke-linecap="round"/></svg>
        <img src="/assets/brand/hound-run.webp" alt="" width="960" height="446" fetchpriority="high">
      </div>
    </div>
  </section>`;
}
