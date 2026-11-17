const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-18T03:00:00Z'])); }
    static now() { return Date.parse('2026-11-18T03:00:00Z'); }
  }
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', hidden: false,
      attributes: {}, classList: { toggle() {} }, setAttribute(key, value) { this.attributes[key] = value; } });
    return elements.get(selector);
  };
  const buttons = ['incoming', 'all'].map((view) => Object.assign(element(view), { dataset: { publicView: view } }));
  const product = (id, name, day) => ({ id, name, image: 'https://example.com/image.jpg', url: `https://1kuji.com/products/${id}`, releaseDate: `2026년 11월 ${day}일` });
  const registered = { ...product('a', '公式A', 28), nameKo: '등록 상품', ticketsPerSet: 80, unitPriceYen: 850, purchasePriceYen: 68000 };
  const state = { registered: [registered], requests: [], cached: [], cacheFail: false, fail: false, pause: null };
  const context = vm.createContext({ URL, URLSearchParams, AbortSignal, Date: FixedDate, console,
    window: { APP_CONFIG: { supabaseUrl: 'https://db.example', supabaseAnonKey: 'anon' },
      supabase: { createClient: () => ({ from: () => ({ select: async () => ({ data: state.registered.map((product) => ({ product })) }) }) }) } },
    document: { querySelector: (selector) => selector.startsWith('script') ? { src: 'https://app.example/app.js' } : element(selector), querySelectorAll: () => buttons },
    fetch: async (url) => {
      const query = new URL(url).searchParams;
      if (new URL(url).pathname.endsWith('/catalog_products')) {
        if (state.cacheFail) return Response.json({}, { status: 503 });
        return Response.json(query.get('catalog_month') === 'eq.11' ? state.cached.map((product) => ({ product })) : []);
      }
      if (new URL(url).pathname.endsWith('.json')) return Response.json({ products: [] });
      assert.equal(query.get('action'), null, 'public view must not inspect every product');
      state.requests.push(`${query.get('year')}-${query.get('month')}`);
      if (state.pause) await state.pause;
      if (state.fail) return Response.json({ error: 'offline' }, { status: 503 });
      return Response.json({ year: Number(query.get('year')), month: Number(query.get('month')),
        products: query.get('year') === '2026' && query.get('month') === '11' ? [product('a', '公式A', 28), product('b', '公式B', 21)] : [] });
    }
  });
  vm.runInContext(fs.readFileSync('public/app.js', 'utf8').split('const adminView =')[0], context);
  return { context, state, element };
}

test('default shows registered items; all view merges by ID, sorts dates and marks unregistered items', async () => {
  const { context, state, element } = setup();
  await vm.runInContext('loadPublicProducts()', context);
  assert.equal(state.requests.length, 0);
  assert.match(element('#selected-products').innerHTML, /등록 상품/);
  assert.doesNotMatch(element('#selected-products').innerHTML, /公式B|입고 예정 없음/);
  await vm.runInContext('setPublicView("all")', context);
  const html = element('#selected-products').innerHTML;
  assert.equal(state.requests.length, 2);
  assert.equal(element('#product-count').textContent, 2);
  assert.ok(html.indexOf('公式B') < html.indexOf('등록 상품'));
  assert.equal((html.match(/<article class="product-card/g) || []).length, 2);
  assert.equal((html.match(/product-card is-not-incoming/g) || []).length, 1);
  assert.doesNotMatch(html, /not-incoming-badge/);
  assert.match(html, /68,000/);
  await vm.runInContext('setPublicView("incoming")', context);
  assert.doesNotMatch(element('#selected-products').innerHTML, /公式B/);
  await vm.runInContext('setPublicView("all")', context);
  assert.equal(state.requests.length, 2, 'switching views reuses the catalogue');
  state.registered = [];
  await vm.runInContext('loadPublicProducts()', context);
  assert.equal((element('#selected-products').innerHTML.match(/product-card is-not-incoming/g) || []).length, 2);
});

test('all view reads saved details without marking cached products as incoming', async () => {
  const { context, state, element } = setup();
  state.cached = [{ id: 'b', name: '公式B', nameKo: '저장된 전체 상품', releaseDate: '2026년 11월 21일', image: 'https://example.com/b.jpg', url: 'https://1kuji.com/products/b', ticketsPerSet: 70, unitPriceYen: 900, purchasePriceYen: 63000, checkedAt: '2026-11-18T00:00:00Z' }];
  await vm.runInContext('loadPublicProducts()', context);
  await vm.runInContext('setPublicView("all")', context);
  const html = element('#selected-products').innerHTML;
  assert.match(html, /저장된 전체 상품/);
  assert.match(html, /63,000/);
  assert.equal((html.match(/product-card is-not-incoming/g) || []).length, 1);
  assert.equal(state.registered.length, 1);
  assert.deepEqual(state.requests, ['2026-12'], 'cached month does not call the live collector');
});

test('catalogue remains available when detail cache cannot be read', async () => {
  const { context, state, element } = setup();
  state.cacheFail = true;
  await vm.runInContext('loadPublicProducts()', context);
  await vm.runInContext('setPublicView("all")', context);
  assert.equal(element('#product-count').textContent, 2);
  assert.equal(element('#public-error').hidden, true);
});

test('catalogue failure retries the same two months', async () => {
  const { context, state, element } = setup();
  await vm.runInContext('loadPublicProducts()', context);
  state.fail = true;
  await vm.runInContext('setPublicView("all")', context);
  assert.match(element('#public-error').textContent, /offline/);
  assert.equal(vm.runInContext('publicCatalogMonthCount', context), 0);
  state.fail = false;
  await vm.runInContext('setPublicView("all")', context);
  assert.deepEqual(state.requests.slice(0, 2), state.requests.slice(2, 4));
  assert.equal(vm.runInContext('publicCatalogMonthCount', context), 2);
});

test('returning to incoming while the catalogue loads does not switch back on completion', async () => {
  const { context, state, element } = setup();
  await vm.runInContext('loadPublicProducts()', context);
  let finish;
  state.pause = new Promise((resolve) => { finish = resolve; });
  const loading = vm.runInContext('setPublicView("all")', context);
  assert.equal(element('#public-loading').hidden, false);
  await vm.runInContext('setPublicView("incoming")', context);
  assert.equal(element('#public-loading').hidden, true);
  finish();
  await loading;
  assert.doesNotMatch(element('#selected-products').innerHTML, /公式B/);
  assert.equal(vm.runInContext('publicView', context), 'incoming');
});
