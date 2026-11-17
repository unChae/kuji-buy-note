const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { spawnSync } = require('node:child_process');
const { readRenderedKujiLot, closeBrowser } = require('../lib/kujimap-browser.cjs');

const root = path.resolve(__dirname, '..');
const parser = vm.createContext({ URL, URLSearchParams, Response, AbortSignal, fetch, console, Deno: { serve() {}, env: { get: (key) => process.env[key] } } });
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions/products/index.ts'), 'utf8').replace(/^export /gm, '')), parser);
const config = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/config.js'), 'utf8'), config);
const { supabaseUrl, supabaseAnonKey } = config.window.APP_CONFIG;
const headers = { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` };
const output = path.join(root, 'supabase/.temp/catalog-upsert.sql');
const collectedFile = path.join(root, 'supabase/.temp/catalog-collected.json');

function upsertSql(products) {
  if (!products.length) throw new Error('No products collected');
  const rows = products.map((product) => {
    const json = JSON.stringify(product).replace(/'/g, "''");
    return `('${product.id.replace(/'/g, "''")}', ${product.catalogYear}, ${product.catalogMonth}, '${json}'::jsonb)`;
  });
  return `insert into public.catalog_products (id, catalog_year, catalog_month, product) values\n${rows.join(',\n')}\non conflict (id) do update set catalog_year = excluded.catalog_year, catalog_month = excluded.catalog_month, product = catalog_products.product || jsonb_strip_nulls(excluded.product), updated_at = now();\n`;
}

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'public/data/lot-quantities.json'), 'utf8'));
  const registeredResponse = await fetch(`${supabaseUrl}/rest/v1/display_products?select=product`, { headers });
  if (!registeredResponse.ok) throw new Error('Cannot read registered products');
  const registered = new Map((await registeredResponse.json()).map((row) => [row.product.id, row.product]));
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const first = new Date(Number(parts.find((p) => p.type === 'year').value), Number(parts.find((p) => p.type === 'month').value) - 1, 1);
  const collected = [];
  try {
    for (let offset = 0; offset < 2; offset++) {
      const date = new Date(first.getFullYear(), first.getMonth() + offset, 1);
      const year = date.getFullYear(), month = date.getMonth() + 1;
      const listing = await read(`https://1kuji.com/products?sale_month=${month}&sale_year=${year}`);
      let kujimap = '';
      try { kujimap = await read(`https://kujimap.com/1bankuji/1bankuji_${year}${String(month).padStart(2, '0')}`); } catch {}
      for (const product of parser.extractProducts(listing)) {
        const known = registered.get(product.id) || {};
        const details = { ...product, catalogYear: year, catalogMonth: month, officialPriceUrl: product.url, warnings: [] };
        try {
          const html = await read(product.url);
          details.unitPriceYen = parser.extractPrice(html) || known.unitPriceYen || null;
          details.retailers = parser.extractRetailers(html) || known.retailers || '';
          details.retailersKo = parser.formatRetailersKo(details.retailers) || known.retailersKo || '';
        } catch { details.unitPriceYen = known.unitPriceYen || null; details.warnings.push('공식 가격 수집 실패'); }
        try { details.nameKo = known.nameKo || await parser.translateTitle(product.name); }
        catch { details.warnings.push('자동 번역 실패'); }
        const normalize = (value) => String(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
        const quantity = snapshot.products.find((entry) => entry.id === product.id && entry.year === year && entry.month === month && normalize(entry.name) === normalize(product.name) && entry.method === 'browser' && Number.isSafeInteger(entry.ticketsPerSet) && entry.ticketsPerSet > 0);
        if (quantity) {
          details.ticketsPerSet = quantity.ticketsPerSet;
          details.quantitySourceUrl = quantity.quantitySourceUrl;
          details.quantityCheckedAt = quantity.checkedAt;
          details.quantityMethod = 'browser-snapshot';
        } else if (known.ticketsPerSet > 0) {
          details.ticketsPerSet = known.ticketsPerSet;
          details.quantitySourceUrl = known.quantitySourceUrl;
        } else {
          const target = parser.findKujimapProductUrl(kujimap, product.name, year, month);
          if (target) {
            try {
              details.ticketsPerSet = parser.extractSetCount(await readRenderedKujiLot(target));
              if (details.ticketsPerSet) details.quantitySourceUrl = target;
            } catch { /* Unpublished or blocked counts remain unknown. */ }
          }
        }
        if (!details.ticketsPerSet) details.warnings.push('세트 장수 미확인');
        if (!details.unitPriceYen) details.warnings.push('장당 가격 미확인');
        if (details.ticketsPerSet && details.unitPriceYen) details.purchasePriceYen = details.ticketsPerSet * details.unitPriceYen;
        details.checkedAt = new Date().toISOString();
        collected.push(details);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(collectedFile, JSON.stringify(collected, null, 2));
        console.log(`${product.id}: ${details.ticketsPerSet || '?'} tickets x ${details.unitPriceYen || '?'} yen${details.warnings.length ? ' (incomplete)' : ''}`);
      }
    }
  } finally { await closeBrowser(); }
  fs.writeFileSync(output, upsertSql(collected));
  const complete = collected.filter((p) => p.ticketsPerSet && p.unitPriceYen && p.nameKo).length;
  console.log(`Collected ${collected.length}; complete ${complete}; incomplete ${collected.length - complete}`);
  if (process.argv.includes('--save')) {
    const cli = path.join(root, 'node_modules/supabase/dist/supabase.js');
    const run = spawnSync(process.execPath, [cli, 'db', 'query', `--remote=${new URL(supabaseUrl).hostname.split('.')[0]}`, '--file', output, '--yes'], { stdio: 'inherit' });
    if (run.error) throw run.error;
    if (run.status !== 0) throw new Error(`DB save failed (${run.status}); collected data retained at ${collectedFile}`);
  } else console.log('Review supabase/.temp/catalog-upsert.sql; use --save to store in DB.');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { upsertSql };
