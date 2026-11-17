const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

test('public arrivals group chronologically across years and highlight lot and price', () => {
  const elements = new Map();
  const context = vm.createContext({ URL, window: { APP_CONFIG: {} }, document: {
    querySelector: (selector) => {
      if (selector.startsWith('script')) return { src: 'https://app.example/app.js' };
      if (!elements.has(selector)) elements.set(selector, {});
      return elements.get(selector);
    }
  } });
  vm.runInContext(fs.readFileSync('public/app.js', 'utf8').split('const adminView =')[0], context);
  context.products = [
    { id: 'later', name: '다음 해', releaseDate: '2027년 1월 2일', ticketsPerSet: 72, purchasePriceYen: 56880 },
    { id: 'unknown', name: '미정' },
    { id: 'past', name: '지난달 상품', releaseDate: '2026년 11월 30일' },
    { id: 'earlier', name: '이번 해', releaseDate: '2026년 12월 2일', ticketsPerSet: 80, purchasePriceYen: 68000 }
  ];
  vm.runInContext('renderSelectedProducts(products, new Date("2026-12-15T00:00:00Z"))', context);
  const html = elements.get('#selected-products').innerHTML;
  assert.ok(html.indexOf('이번 해') < html.indexOf('다음 해'));
  assert.doesNotMatch(html, /입고 월 미정|지난달 상품/);
  assert.match(html, /2026년/);
  assert.match(html, /2027년/);
  assert.match(html, /1세트 장수/);
  assert.match(html, /56,880<span>엔/);
  assert.match(html, /72<span>장/);
  assert.match(html, /확인 중/);
  assert.equal(elements.get('#product-count').textContent, 2);
  vm.runInContext('renderSelectedProducts(products, new Date("2026-12-31T16:00:00Z"))', context);
  assert.equal(elements.get('#product-count').textContent, 1);
  assert.doesNotMatch(elements.get('#selected-products').innerHTML, /이번 해|지난달 상품/);
  vm.runInContext('renderSelectedProducts([])', context);
  assert.equal(elements.get('#selected-products').innerHTML, '');
  assert.equal(elements.get('#empty-state').hidden, false);
});

test('month pagination appends two months and preserves drafts when an additional fetch fails', async () => {
  const elements = new Map();
  const batches = [];
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: true, disabled: false, setAttribute() {} });
    return elements.get(id);
  };
  Object.assign(getElement('#admin-months'), {
    replaceChildren(batch) { batches.splice(0, batches.length, batch); },
    append(batch) { batches.push(batch); }
  });
  let fail = false;
  let selectionReads = 0;
  const requests = [];
  const context = vm.createContext({ URL, URLSearchParams, console,
    window: { APP_CONFIG: { supabaseUrl: 'https://db.example', supabaseAnonKey: 'anon' }, supabase: { createClient: () => ({
      from: () => ({ select: async () => { selectionReads++; return { data: [] }; } })
    }) } },
    document: {
      querySelector: (selector) => selector.startsWith('script') ? { src: 'https://app.example/app.js' } : getElement(selector),
      createElement: () => {
        const batch = { innerHTML: '', querySelectorAll: () => [], remove() { batches.splice(batches.indexOf(batch), 1); } };
        return batch;
      }
    },
    fetch: async (url) => {
      const params = new URL(url).searchParams;
      requests.push(params.get('year') + '-' + params.get('month'));
      if (fail) return Response.json({ error: 'offline' }, { status: 502 });
      return Response.json({ year: Number(params.get('year')), month: Number(params.get('month')), products: [] });
    }
  });
  vm.runInContext(fs.readFileSync('public/app.js', 'utf8').split('const adminView =')[0], context);
  await vm.runInContext('loadAdminProducts()', context);
  assert.equal(requests.length, 2);
  const originalBatch = batches[0];
  vm.runInContext('cardStates.set("draft", {draft: "keep"})', context);
  fail = true;
  await vm.runInContext('loadAdminProducts(true)', context);
  assert.equal(batches.length, 1);
  assert.equal(batches[0], originalBatch);
  assert.equal(vm.runInContext('loadedMonthCount', context), 2);
  fail = false;
  await vm.runInContext('loadAdminProducts(true)', context);
  assert.deepEqual(requests.slice(2, 4), requests.slice(4, 6));
  assert.equal(batches.length, 2);
  assert.equal(batches[0], originalBatch);
  assert.equal(selectionReads, 1);
  assert.equal(vm.runInContext('cardStates.get("draft").draft', context), 'keep');
  assert.equal(getElement('#load-more-months').disabled, false);
  assert.equal(vm.runInContext('JSON.stringify(getTargetMonths(0, 2, new Date(2026, 11, 1)))', context), '[{"year":2026,"month":12},{"year":2027,"month":1}]');
});

function backend(fetch = () => { throw new Error('unexpected fetch'); }) {
  let handler;
  const source = fs.readFileSync('supabase/functions/products/index.ts', 'utf8').replace(/export /g, '');
  const context = vm.createContext({
    Response, URL, URLSearchParams, AbortSignal, console, fetch,
    Deno: { serve: (fn) => { handler = fn; }, env: { get: (key) => ({ SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon' })[key] } }
  });
  vm.runInContext(stripTypeScriptTypes(source), context);
  return { context, request: (url) => handler(new Request(url, { headers: { Authorization: 'Bearer admin' } })) };
}

test('extracts explicitly labelled ticket price and set size', () => {
  const { context } = backend();
  assert.equal(vm.runInContext('extractPrice("<li>■メーカー希望小売価格：1回790円(税10％込)</li>")', context), 790);
  assert.equal(vm.runInContext('extractSetCount("<th>1セット（８０本）内訳</th>")', context), 80);
  assert.equal(vm.runInContext('extractSetCount("全20種 80店舗")', context), null);
  assert.equal(vm.runInContext('extractPrice("当選は1回まで 790円")', context), null);
});

test('inspection matches normalized title and calculates independent source fields', async () => {
  const { request } = backend(async (url) => {
    if (url.endsWith('/rpc/is_admin')) return Response.json(true);
    if (url.startsWith('https://translate.googleapis.com/')) return Response.json([[['테스트']]]);
    if (url === 'https://1kuji.com/products/test') return new Response('メーカー希望小売価格：1回1,000円（税込）');
    if (url.endsWith('1bankuji_202611')) return new Response('<h3><a href="https://kujimap.com/1bankuji/1bankuji_202611/test">一番くじ テスト</a></h3>');
    if (url.endsWith('/test')) return new Response('1セット（70本）内訳');
    throw new Error(url);
  });
  const response = await request('https://edge.example/?action=inspect&id=test&name=' + encodeURIComponent('一番くじ　テスト') + '&year=2026&month=11');
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.unitPriceYen, 1000);
  assert.equal(data.ticketsPerSet, 70);
  assert.equal(data.nameKo, '이치방쿠지 테스트');
  assert.equal(data.warnings.length, 0);
});

test('protected tables and failed translation remain missing, never guessed', async () => {
  const { request } = backend(async (url) => {
    if (url.endsWith('/rpc/is_admin')) return Response.json(true);
    if (url.includes('1kuji.com')) return new Response('メーカー希望小売価格：1回790円');
    if (url.endsWith('1bankuji_202611')) return new Response('<h3><a href="https://kujimap.com/1bankuji/1bankuji_202611/test">テスト</a></h3>');
    return new Response('<div data-kujimap-protected="table">通信環境を確認しています。</div>');
  });
  const data = await (await request('https://edge.example/?action=inspect&id=test&name=' + encodeURIComponent('テスト') + '&year=2026&month=11')).json();
  assert.equal(data.ticketsPerSet, null);
  assert.equal(data.unitPriceYen, 790);
  assert.ok(data.warnings.some((warning) => warning.includes('자동 수집하지 못했습니다')));
});

test('inspection requires admin and rejects invalid product identifiers', async () => {
  const denied = backend(async () => Response.json(false));
  assert.equal((await denied.request('https://edge.example/?action=inspect')).status, 403);
  const allowed = backend(async () => Response.json(true));
  assert.equal((await allowed.request('https://edge.example/?action=inspect&id=../private&name=x&year=2026&month=11')).status, 400);
});

test('blocked detail table falls back to operator announcement for the exact product URL', async () => {
  const { request } = backend(async (url) => {
    if (url.endsWith('/rpc/is_admin')) return Response.json(true);
    if (url.startsWith('https://translate.googleapis.com/')) return Response.json([[['테스트']]]);
    if (url === 'https://1kuji.com/products/test') return new Response('メーカー希望小売価格：1回790円');
    if (url.endsWith('1bankuji_202611')) return new Response('<h3><a href="https://kujimap.com/1bankuji/1bankuji_202611/test">一番くじ テスト</a></h3>');
    if (url === 'https://teapaw.org/whitenoize') return new Response(`
      <div class="timeline-item author-whitenoize" data-username="whitenoize"><a class="tweet-link" href="/whitenoize/status/123#m"></a>
      <div class="tweet-content media-body"><a href="https://kujimap.com/1bankuji/1bankuji_202611/test">商品</a>ロット内訳 全72本</div></div>
      <div class="timeline-item author-whitenoize" data-username="whitenoize"><a class="tweet-link" href="/whitenoize/status/122#m"></a>
      <div class="tweet-content media-body"><a href="https://kujimap.com/1bankuji/1bankuji_202611/other">似た商品</a>ロット内訳 全80本</div></div>`);
    return new Response('<div data-kujimap-protected="table">確認中</div>');
  });
  const data = await (await request('https://edge.example/?action=inspect&id=test&name=' + encodeURIComponent('一番くじ テスト') + '&year=2026&month=11')).json();
  assert.equal(data.ticketsPerSet, 72);
  assert.equal(data.unitPriceYen, 790);
  assert.equal(data.quantitySourceUrl, 'https://teapaw.org/whitenoize/status/123');
  assert.equal(data.warnings.length, 0);
});

test('operator parser excludes retweets, unknown counts and unrelated statistics', () => {
  const { context } = backend();
  context.html = `<div class="timeline-item" data-username="someone"><a class="tweet-link" href="/whitenoize/status/1#m"></a><div class="tweet-content media-body"><a href="https://kujimap.com/1bankuji/x/y">商品</a>ロット内訳 全80本</div></div>
    <div class="timeline-item" data-username="whitenoize"><a class="tweet-link" href="/whitenoize/status/2#m"></a><div class="tweet-content media-body"><a href="https://kujimap.com/1bankuji/x/y">商品</a>458店舗 全20種 1セット（???本）</div></div>`;
  assert.equal(vm.runInContext('extractLotNotices(html).length', context), 0);
});

test('cards collect independently and only publish or remove on explicit action', async () => {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: '', textContent: '', disabled: false, attributes: {},
      classList: { toggle() {} }, setAttribute(name, value) { this.attributes[name] = value; }
    });
    return elements.get(selector);
  }
  const writes = [];
  let failSave = false;
  const context = vm.createContext({
    URL, URLSearchParams, console,
    window: { APP_CONFIG: { supabaseUrl: 'https://db.example', supabaseAnonKey: 'anon' }, supabase: { createClient: () => ({
      auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
      from: () => ({
        upsert: async (row) => { if (failSave) return { error: new Error('save failed') }; writes.push(row); return {}; },
        delete: () => ({ eq: async (key, id) => { writes.push({ removed: id }); return {}; } })
      })
    }) } },
    document: { querySelector: (selector) => selector.startsWith('script') ? { src: 'https://app.example/app.js' } : element(selector) },
    fetch: async (url) => Response.json({ nameKo: '이치방쿠지 테스트', ticketsPerSet: new URL(url).searchParams.get('id') === 'test' ? 80 : 70, unitPriceYen: 790, warnings: [] })
  });
  const source = fs.readFileSync('public/app.js', 'utf8').split('const adminView =')[0];
  vm.runInContext(source, context);
  function state(id) {
    return { product: { id, name: 'テスト', url: 'https://1kuji.com/products/' + id }, month: { year: 2026, month: 11 },
      card: { classList: { toggle() {} }, setAttribute() {}, querySelector: (selector) => element(id + selector) },
      loading: false, saving: false, draft: null, message: '' };
  }
  context.first = state('test');
  context.second = state('other');
  const firstRequest = vm.runInContext('collectCardProduct(first)', context);
  const secondRequest = vm.runInContext('collectCardProduct(second)', context);
  assert.match(element('test.card-details').innerHTML, /데이터 가져오는 중/);
  assert.equal(context.first.loading, true);
  await Promise.all([firstRequest, secondRequest]);
  assert.equal(writes.length, 0);
  assert.match(element('test.card-details').innerHTML, /63,200엔/);
  assert.match(element('other.card-details').innerHTML, /55,300엔/);
  assert.equal(element('test.registration-toggle').attributes['aria-pressed'], 'false');
  await vm.runInContext('persistCardProduct(first, true)', context);
  assert.equal(writes[0].product.nameKo, '이치방쿠지 테스트');
  assert.equal(element('test.registration-toggle').attributes['aria-pressed'], 'true');
  assert.equal(element('other.registration-toggle').attributes['aria-pressed'], 'false');
  failSave = true;
  await vm.runInContext('persistCardProduct(second, true)', context);
  assert.equal(element('other.registration-toggle').attributes['aria-pressed'], 'false');
  assert.match(element('other.card-details').innerHTML, /저장하지 못했습니다/);
  await vm.runInContext('persistCardProduct(first, false)', context);
  assert.equal(writes[1].removed, 'test');
  assert.equal(element('test.registration-toggle').attributes['aria-pressed'], 'false');
  context.second.draft.ticketsPerSet = null;
  await vm.runInContext('persistCardProduct(second, true)', context);
  assert.equal(writes.length, 2);
});
