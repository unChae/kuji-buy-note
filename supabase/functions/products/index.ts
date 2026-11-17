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

function extractProducts(html: string) {
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
