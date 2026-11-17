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

export function extractSetCount(html: string): number | null {
  const match = stripTags(html).normalize("NFKC").match(/1\s*セット\s*[(（]\s*([\d,]+)\s*(?:本|枚)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

const normalizeTitle = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

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

export async function translateTitle(name: string): Promise<string> {
  const key = Deno.env.get("DEEPL_AUTH_KEY");
  if (key) {
    try {
      const host = key.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
      const response = await fetch(`https://${host}/v2/translate`, {
        method: "POST", headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: [name], source_lang: "JA", target_lang: "KO" }), signal: AbortSignal.timeout(15000)
      });
      if (response.ok) {
        const result = (await response.json()).translations?.[0]?.text;
        if (typeof result === "string" && /[가-힣]/.test(result)) return result;
      }
    } catch { /* Fall back to the public translation service. */ }
  }
  const isIchiban = name.startsWith("一番くじ");
  const text = isIchiban ? name.slice("一番くじ".length).trim() : name;
  const query = new URLSearchParams({ client: "gtx", sl: "ja", tl: "ko", dt: "t", q: text });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("자동 번역 서비스 응답 오류");
  const payload = await response.json();
  const translated = Array.isArray(payload?.[0]) ? payload[0].map((part: unknown[]) => typeof part?.[0] === "string" ? part[0] : "").join("").replace(/[\u200b-\u200d\ufeff]/g, "").trim() : "";
  if (!translated) throw new Error("자동 번역 결과 없음");
  return isIchiban ? `이치방쿠지 ${translated}` : translated;
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
  let ticketsPerSet: number | null = null;
  let nameKo = "";
  let kujimapUrl = "";
  let quantitySourceUrl = "";
  await Promise.all([
    (async () => {
      try { unitPriceYen = extractPrice(await readSource(`https://1kuji.com/products/${id}`)); }
      catch { warnings.push("공식 사이트 가격을 가져오지 못했습니다."); }
      if (!unitPriceYen) warnings.push("공식 사이트에 장당 가격이 아직 공개되지 않았거나 수집에 실패했습니다. 다시 수집해 주세요.");
    })(),
    (async () => {
      try {
        const listUrl = `https://kujimap.com/1bankuji/1bankuji_${year}${String(month).padStart(2, "0")}`;
        const html = await readSource(listUrl);
        const matches = [...html.matchAll(/<h3\b[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
          .filter((m) => normalizeTitle(stripTags(m[2])) === normalizeTitle(name));
        if (matches.length !== 1) throw new Error("일치하는 상품을 유일하게 찾지 못했습니다.");
        const target = new URL(decodeHtmlEntities(matches[0][1]), listUrl);
        if (target.origin !== "https://kujimap.com" || !target.pathname.startsWith(new URL(listUrl).pathname + "/")) throw new Error("잘못된 상세 주소");
        kujimapUrl = target.href;
        try { ticketsPerSet = extractSetCount(await readSource(kujimapUrl)); }
        catch { /* A blocked detail response can still have a public lot announcement. */ }
        if (ticketsPerSet) quantitySourceUrl = kujimapUrl;
        else {
          const notice = (await readLotNotices()).find((item) => item.productUrl === kujimapUrl.replace(/\/$/, ""));
          if (notice) {
            ticketsPerSet = notice.ticketsPerSet;
            quantitySourceUrl = notice.sourceUrl;
          }
        }
        if (!ticketsPerSet) warnings.push("이 상품의 세트 수량을 자동 수집하지 못했습니다. 수량 공개 후 다시 수집해 주세요.");
      } catch { warnings.push("쿠지맵에서 일치하는 상품의 수량을 가져오지 못했습니다."); }
    })(),
    (async () => {
      try {
        nameKo = await translateTitle(name);
      } catch { warnings.push("자동 번역에 실패했습니다. 다시 수집해 주세요."); }
    })()
  ]);
  return jsonResponse({ nameKo, unitPriceYen, ticketsPerSet, kujimapUrl, quantitySourceUrl, warnings, checkedAt: new Date().toISOString() });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
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
