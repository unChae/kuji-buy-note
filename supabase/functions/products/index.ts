const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

interface Product {
  id: string;
  name: string;
  image: string;
  url: string;
  releaseDate: string;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function extractProducts(html: string) {
  const products: Product[] = [];
  const anchorPattern = /<a\b[^>]*href=["'](\/products\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const [, href, contents] = match;
    const image = contents.match(/<img\b[^>]*src=["']([^"']+)["']/i);
    const text = stripTags(contents);
    if (!image || !text) continue;

    const dates = text.match(/\d{4}年\d{1,2}月\d{1,2}日(?:\([^)]*\))?/g) || [];
    const titleParts = text.split(/\d{4}年\d{1,2}月\d{1,2}日(?:\([^)]*\))?/);
    const title = titleParts[titleParts.length - 1]
      .replace(/店頭販売|オンライン販売|より順次発売予定|より発売予定|\d{1,2}:\d{2}より販売開始予定/g, "")
      .trim();
    if (!title) continue;

    const releaseDate = dates[0]?.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    products.push({
      id: href.replace(/^\/products\//, ""),
      name: title,
      image: image[1].startsWith("//") ? `https:${image[1]}` : image[1],
      url: `https://1kuji.com${href}`,
      releaseDate: releaseDate ? `${releaseDate[1]}년 ${releaseDate[2]}월 ${releaseDate[3]}일` : ""
    });
  }

  return products;
}

export function extractPrice(html: string): number | null {
  const match = stripTags(html).normalize("NFKC").match(/(?:メーカー希望小売価格|価格)[：:\s]*1回\s*([\d,]+)\s*円/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

export function extractRetailers(html: string): string {
  const row = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripTags(match[1]))
    .find((text) => /^\s*■?\s*(?:取扱店|取り扱い店舗)\s*[：:]/.test(text));
  return row ? row.replace(/^\s*■?\s*(?:取扱店|取り扱い店舗)\s*[：:]\s*/, "").trim().replace(/\s*、\s*/g, "、") : "";
}

export function formatRetailersKo(value: string): string {
  const labels: Record<string, string> = {
    "一番くじ公式ショップ": "이치방쿠지 공식숍", "一番くじONLINE": "이치방쿠지 ONLINE",
    "ローソン": "로손", "セブン-イレブン": "세븐일레븐", "ファミリーマート": "패밀리마트",
    "ミニストップ": "미니스톱", "イトーヨーカドー": "이토요카도", "書店": "서점",
    "ホビーショップ": "하비숍", "アニメショップ": "애니메이션숍", "アニメイト": "애니메이트",
    "ゲームセンター": "게임센터", "ドラッグストア": "드럭스토어", "一部店舗": "일부 매장", "など": " 등"
  };
  let result = value;
  for (const [original, translated] of Object.entries(labels)) result = result.replaceAll(original, translated);
  return result.replace(/、/g, ", ").replace(/\s+/g, " ").trim();
}

export function extractSetCount(html: string): number | null {
  const match = stripTags(html).normalize("NFKC").match(/1\s*セット\s*[(（]\s*([\d,]+)\s*(?:本|枚)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

const normalizeTitle = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export function extractAlternateSetCount(html: string, id: string, name: string, year: number, month: number): number | null {
  const title = html.match(/<p\b[^>]*class=["'][^"']*\bpagehead__origin\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (!title || normalizeTitle(stripTags(title)) !== normalizeTitle(name)) return null;
  const matchesOfficialId = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].some((match) => {
    try {
      const url = new URL(decodeHtmlEntities(match[1]));
      return url.origin === "https://1kuji.com" && url.pathname.replace(/\/$/, "") === `/products/${id}`;
    } catch { return false; }
  });
  if (!matchesOfficialId) return null;
  const facts = [...html.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl>/gi)].map((match) => match[1])
    .find((contents) => contents.includes("總抽數") && contents.includes("發售日"));
  if (!facts) return null;
  const date = stripTags(facts).normalize("NFKC").match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (!date || Number(date[1]) !== year || Number(date[2]) !== month) return null;
  const count = facts.normalize("NFKC").match(/<dt\b[^>]*>\s*總抽數\s*<\/dt>\s*<dd\b[^>]*>\s*([\d,]+)\s*抽\s*<\/dd>/i);
  const total = count ? Number(count[1].replace(/,/g, "")) : 0;
  return Number.isSafeInteger(total) && total > 0 && total <= 10000 ? total : null;
}

export function findKujimapProductUrl(html: string, name: string, year: number, month: number): string | null {
  const base = `https://kujimap.com/1bankuji/1bankuji_${year}${String(month).padStart(2, "0")}`;
  const matches = [...html.matchAll(/<h3\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((m) => normalizeTitle(stripTags(m[2])) === normalizeTitle(name));
  if (matches.length !== 1) return null;
  const target = new URL(decodeHtmlEntities(matches[0][1]), base);
  return target.origin === "https://kujimap.com" && target.pathname.startsWith(new URL(base).pathname + "/") ? target.href : null;
}

async function readSource(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`출처 응답 오류 (${response.status})`);
  return response.text();
}

interface LotNotice { productUrl: string; sourceUrl: string; ticketsPerSet: number }

// Match the operator's own announcements by the full product URL, never a similar title.
export function extractLotNotices(html: string): LotNotice[] {
  const notices: LotNotice[] = [];
  for (const block of html.split(/<div class="timeline-item\b/).slice(1)) {
    if (!/^[^>]*data-username="whitenoize"/.test(block)) continue;
    const contents = block.match(/class="tweet-content media-body"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const post = block.match(/class="tweet-link" href="(\/whitenoize\/status\/\d+)[^"']*"/)?.[1];
    if (!contents || !post) continue;
    const count = stripTags(contents).normalize("NFKC").match(/ロット内訳\s*全\s*([\d,]+)\s*(?:本|枚)/);
    const links = [...contents.matchAll(/href="(https:\/\/kujimap\.com\/1bankuji\/[^"?#]+)"/g)];
    if (!count || links.length !== 1) continue;
    const ticketsPerSet = Number(count[1].replace(/,/g, ""));
    if (ticketsPerSet <= 0 || ticketsPerSet > 10000) continue;
    notices.push({ productUrl: decodeHtmlEntities(links[0][1]).replace(/\/$/, ""), sourceUrl: `https://teapaw.org${post}`, ticketsPerSet });
  }
  return notices;
}

let noticeCache: { expires: number; notices: LotNotice[] } | null = null;
let noticeRequest: Promise<LotNotice[]> | null = null;

async function readLotNotices(): Promise<LotNotice[]> {
  if (noticeCache && noticeCache.expires > Date.now()) return noticeCache.notices;
  if (noticeRequest) return noticeRequest;
  noticeRequest = (async () => {
    const notices: LotNotice[] = [];
    let url = "https://teapaw.org/whitenoize";
    const visited = new Set<string>();
    for (let page = 0; page < 5 && !visited.has(url); page++) {
      visited.add(url);
      const html = await readSource(url);
      notices.push(...extractLotNotices(html));
      const next = html.match(/class="show-more"[\s\S]*?<a[^>]*href="([^"]+)"/)?.[1];
      if (!next) break;
      const target = new URL(decodeHtmlEntities(next), url);
      if (target.origin !== "https://teapaw.org" || target.pathname !== "/whitenoize") break;
      url = target.href;
    }
    noticeCache = { expires: Date.now() + 10 * 60 * 1000, notices };
    return notices;
  })();
  try { return await noticeRequest; } finally { noticeRequest = null; }
}

const titleTranslations = new Map<string, { value: string; expires: number }>();

function translatedText(value: unknown, original: string): string {
  if (typeof value !== "string") return "";
  const result = decodeHtmlEntities(value).replace(/[\u200b-\u200d\ufeff]/g, "").trim();
  if (!result) return "";
  // An unchanged Japanese response is not a completed Korean translation.
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(original) && normalizeTitle(result) === normalizeTitle(original)) return "";
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(result) && !/[가-힣]/.test(result)) return "";
  return result;
}

export async function translateTitle(name: string): Promise<string> {
  const cached = titleTranslations.get(name);
  if (cached && cached.expires > Date.now()) return cached.value;
  const remember = (value: string) => {
    if (titleTranslations.size >= 1000) {
      const oldest = titleTranslations.keys().next().value;
      if (oldest !== undefined) titleTranslations.delete(oldest);
    }
    titleTranslations.set(name, { value, expires: Date.now() + 6 * 3600000 });
    return value;
  };
  const key = Deno.env.get("DEEPL_AUTH_KEY");
  if (key) {
    try {
      const host = key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
      const response = await fetch(`https://${host}/v2/translate`, {
        method: "POST", headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: [name], source_lang: "JA", target_lang: "KO" }), signal: AbortSignal.timeout(8000)
      });
      if (response.ok) {
        const result = translatedText((await response.json()).translations?.[0]?.text, name);
        if (result) return remember(result);
      }
    } catch { /* Fall back to the public translation service. */ }
  }
  const isIchiban = name.startsWith("一番くじ");
  const text = isIchiban ? name.slice("一番くじ".length).trim() : name;
  if (!text && isIchiban) return remember("이치방쿠지");
  const query = new URLSearchParams({ client: "gtx", sl: "ja", tl: "ko", dt: "t", q: text });
  for (const host of ["translate.googleapis.com", "translate.google.com"]) {
    try {
      const response = await fetch(`https://${host}/translate_a/single?${query}`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) continue;
      const payload = await response.json();
      const value = Array.isArray(payload?.[0]) ? payload[0].map((part: unknown) => Array.isArray(part) && typeof part[0] === "string" ? part[0] : "").join("") : "";
      const translated = translatedText(value, text);
      if (translated) return remember(isIchiban ? `이치방쿠지 ${translated}` : translated);
    } catch { /* Try the next provider on timeout, malformed JSON, or an upstream failure. */ }
  }
  try {
    const fallbackQuery = new URLSearchParams({ q: text, langpair: "ja|ko" });
    const response = await fetch(`https://api.mymemory.translated.net/get?${fallbackQuery}`, { signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const payload = await response.json();
      if (Number(payload.responseStatus) === 200 && !payload.quotaFinished) {
        const translated = translatedText(payload.responseData?.translatedText, text);
        if (translated) return remember(isIchiban ? `이치방쿠지 ${translated}` : translated);
      }
    }
  } catch { /* Never store a provider's error message as the product title. */ }
  throw new Error("자동 번역 서비스를 사용할 수 없습니다.");
}

async function inspectProduct(request: Request, params: URLSearchParams): Promise<Response> {
  const token = request.headers.get("Authorization") || "";
  const base = Deno.env.get("SUPABASE_URL")!;
  const headers = { Authorization: token, apikey: Deno.env.get("SUPABASE_ANON_KEY")!, "Content-Type": "application/json" };
  const admin = await fetch(`${base}/rest/v1/rpc/is_admin`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(10000) });
  if (!admin.ok || await admin.json() !== true) return jsonResponse({ error: "관리자 로그인이 필요합니다." }, 403);
  const id = params.get("id") || "";
  const name = params.get("name") || "";
  const year = Number(params.get("year"));
  const month = Number(params.get("month"));
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id) || !name || name.length > 500 || !Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return jsonResponse({ error: "올바른 상품과 월을 선택해 주세요." }, 400);
  }
  const warnings: string[] = [];
  let unitPriceYen: number | null = null;
  let retailers = "";
  let retailersKo = "";
  let ticketsPerSet: number | null = null;
  let nameKo = "";
  let kujimapUrl = "";
  let quantitySourceUrl = "";
  await Promise.all([
    (async () => {
      try {
        const html = await readSource(`https://1kuji.com/products/${id}`);
        unitPriceYen = extractPrice(html);
        retailers = extractRetailers(html);
        retailersKo = formatRetailersKo(retailers);
      }
      catch { warnings.push("공식 사이트 가격을 가져오지 못했습니다."); }
      if (!unitPriceYen) warnings.push("공식 사이트에 장당 가격이 아직 공개되지 않았거나 수집에 실패했습니다. 다시 수집해 주세요.");
    })(),
    (async () => {
      try {
        const listUrl = `https://kujimap.com/1bankuji/1bankuji_${year}${String(month).padStart(2, "0")}`;
        const html = await readSource(listUrl);
        const target = findKujimapProductUrl(html, name, year, month);
        if (!target) throw new Error("일치하는 상품을 유일하게 찾지 못했습니다.");
        kujimapUrl = target;
        try { ticketsPerSet = extractSetCount(await readSource(kujimapUrl)); }
        catch { /* A blocked detail response can still have a public lot announcement. */ }
        if (!ticketsPerSet) {
          const render = (globalThis as unknown as { readRenderedKujiLot?: (url: string) => Promise<string> }).readRenderedKujiLot;
          if (render) {
            try { ticketsPerSet = extractSetCount(await render(kujimapUrl)); }
            catch (error) { console.warn("Rendered quantity unavailable:", String(error)); }
          }
        }
        if (ticketsPerSet) quantitySourceUrl = kujimapUrl;
        else {
          const notice = (await readLotNotices().catch(() => [])).find((item) => item.productUrl === kujimapUrl.replace(/\/$/, ""));
          if (notice) {
            ticketsPerSet = notice.ticketsPerSet;
            quantitySourceUrl = notice.sourceUrl;
          }
        }
      } catch { /* A second catalogue may already have the same product's published lot size. */ }
      if (!ticketsPerSet) {
        const alternateUrl = `https://ufocatchers.com/1kuji/${id}/`;
        try {
          ticketsPerSet = extractAlternateSetCount(await readSource(alternateUrl), id, name, year, month);
          if (ticketsPerSet) quantitySourceUrl = alternateUrl;
        } catch { /* Leave unverified quantities empty. */ }
      }
      if (!ticketsPerSet) warnings.push("출처에서 수량을 확인하지 못해 매입가를 계산할 수 없습니다. 다시 수집해 주세요.");
    })(),
    (async () => {
      try {
        nameKo = await translateTitle(name);
      } catch { warnings.push("자동 번역에 실패했습니다. 다시 수집해 주세요."); }
    })()
  ]);
  return jsonResponse({ apiVersion: "2026-11-17.3", nameKo, unitPriceYen, ticketsPerSet, retailers, retailersKo, kujimapUrl, quantitySourceUrl, warnings, checkedAt: new Date().toISOString() });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: "지원하지 않는 요청입니다." }, 405);
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.get("action") === "inspect") {
    try { return await inspectProduct(request, requestUrl.searchParams); }
    catch { return jsonResponse({ error: "상품 정보를 확인하지 못했습니다. 다시 시도해 주세요." }, 502); }
  }
  const year = Number(requestUrl.searchParams.get("year"));
  const month = Number(requestUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
      !Number.isInteger(month) || month < 1 || month > 12) {
    return jsonResponse({ error: "올바른 연도와 월을 입력해 주세요." }, 400);
  }

  try {
    const sourceUrl = `https://1kuji.com/products?sale_month=${month}&sale_year=${year}`;
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "ChibakujiStockList/1.0" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      console.error(`1kuji.com returned ${response.status}`);
      return jsonResponse({ error: "1kuji.com에서 상품 목록을 가져오지 못했습니다." }, 502);
    }

    const products = extractProducts(await response.text());
    return jsonResponse({ year, month, products });
  } catch (error) {
    console.error("Failed to fetch 1kuji.com product list:", error);
    return jsonResponse({ error: "1kuji.com에서 상품 목록을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }
});
