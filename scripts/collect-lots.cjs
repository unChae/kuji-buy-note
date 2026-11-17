const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { readRenderedKujiLot, closeBrowser } = require('../lib/kujimap-browser.cjs');

const root = path.resolve(__dirname, '..');
const parser = vm.createContext({ URL, Response, console, Deno: { serve() {} } });
vm.runInContext(stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions/products/index.ts'), 'utf8').replace(/^export /gm, '')), parser);

async function read(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function main() {
  const output = path.join(root, 'public/data/lot-quantities.json');
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(output, 'utf8')).products || []; } catch {}
  const products = new Map(previous.map((product) => [`${product.year}-${product.month}-${product.id}`, product]));
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const first = new Date(Number(parts.find((p) => p.type === 'year').value), Number(parts.find((p) => p.type === 'month').value) - 1, 1);
  const months = Number(process.argv.find((arg) => arg.startsWith('--months='))?.split('=')[1] || 4);
  if (!Number.isInteger(months) || months < 1 || months > 6) throw new Error('months must be between 1 and 6');
  let collected = 0;
  let failed = 0;
  try {
    for (let offset = 0; offset < months; offset++) {
      const date = new Date(first.getFullYear(), first.getMonth() + offset, 1);
      const year = date.getFullYear(), month = date.getMonth() + 1;
      const [official, listing] = await Promise.all([
        read(`https://1kuji.com/products?sale_month=${month}&sale_year=${year}`),
        read(`https://kujimap.com/1bankuji/1bankuji_${year}${String(month).padStart(2, '0')}`).catch(() => '')
      ]);
      for (const product of parser.extractProducts(official)) {
        const quantitySourceUrl = parser.findKujimapProductUrl(listing, product.name, year, month);
        if (!quantitySourceUrl) { failed++; continue; }
        try {
          const ticketsPerSet = parser.extractSetCount(await readRenderedKujiLot(quantitySourceUrl));
          if (!ticketsPerSet) throw new Error('No lot size published');
          products.set(`${year}-${month}-${product.id}`, {
            id: product.id, name: product.name, year, month, ticketsPerSet,
            quantitySourceUrl, checkedAt: new Date().toISOString(), method: 'browser'
          });
          collected++;
          console.log(`${product.id}: ${ticketsPerSet}`);
        } catch (error) { failed++; console.warn(`${product.id}: ${error.message}`); }
      }
    }
  } finally { await closeBrowser(); }
  // Never silently publish an empty catalogue when the browser environment fails.
  if (!collected) throw new Error('No quantities extracted; previous published catalogue must be retained.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), products: [...products.values()] }, null, 2) + '\n');
  console.log(`Quantities: ${collected} collected, ${failed} unavailable`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
