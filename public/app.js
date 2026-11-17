const $ = (selector) => document.querySelector(selector);
const appConfig = window.APP_CONFIG || {};
const productsApiUrl = appConfig.productsApiUrl || (["localhost", "127.0.0.1", "[::1]"].includes(window.location?.hostname)
  ? "/api/products" : `${appConfig.supabaseUrl}/functions/v1/products`);
const scriptUrl = document.querySelector('script[src$="app.js"]').src;
const appBasePath = new URL(".", scriptUrl).pathname;
const supabaseClient = appConfig.supabaseUrl && appConfig.supabaseAnonKey && window.supabase
  ? window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
  : null;

let selectedProducts = new Map();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function productCard(product) {
  const quantitySourceUrl = product.quantitySourceUrl || product.kujimapUrl;
  const officialPriceUrl = product.officialPriceUrl || product.url;
  const release = product.releaseDate
    ? `<span class="product-date"><span class="product-release-label">발매</span>${escapeHtml(product.releaseDate)}</span>`
    : "";
  return `
    <article class="product-card${product.isIncoming === false ? " is-not-incoming" : ""}">
      <a class="product-image" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeHtml(product.image)}" alt="" loading="lazy">
      </a>
      <div class="product-info">
        ${release}
        <a class="product-name" href="${escapeHtml(product.url)}" title="${escapeHtml(product.nameKo || product.name)}" target="_blank" rel="noopener noreferrer">${escapeHtml(product.nameKo || product.name)}</a>
        <p class="product-retailers"><span>판매처</span> ${escapeHtml(product.retailersKo || product.retailers || "미확인")}</p>
      </div>
      <dl class="product-summary">
        <div class="product-lot"><dt>1세트 장수</dt><dd>${Number(product.ticketsPerSet) > 0 ? `${Number(product.ticketsPerSet).toLocaleString("ko-KR")}<span>장</span>` : "미확인"}</dd></div>
        <div class="product-unit-price"><dt>장당 가격</dt><dd>${Number(product.unitPriceYen) > 0 ? `${Number(product.unitPriceYen).toLocaleString("ko-KR")}<span>엔</span>` : "미확인"}</dd></div>
        <div class="product-price"><dt>세트 매입가</dt><dd>${Number(product.purchasePriceYen) > 0 ? `${Number(product.purchasePriceYen).toLocaleString("ko-KR")}<span>엔</span>` : "미확인"}</dd></div>
        <div class="product-source-links"><dt class="sr-only">정보 출처</dt><dd>${quantitySourceUrl ? `<a href="${escapeHtml(quantitySourceUrl)}" target="_blank" rel="noopener noreferrer">수량 출처 ↗</a>` : ""}${officialPriceUrl ? `<a href="${escapeHtml(officialPriceUrl)}" target="_blank" rel="noopener noreferrer">공식 가격 ↗</a>` : ""}</dd></div>
      </dl>
    </article>`;
}

function setPublicError(message) {
  const error = $("#public-error");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
  error.classList.toggle("error-message", Boolean(message));
}

function renderSelectedProducts(products, now = new Date()) {
  const currentDate = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric" }).formatToParts(now);
  const currentMonth = Number(currentDate.find((part) => part.type === "year").value) * 12
    + Number(currentDate.find((part) => part.type === "month").value) - 1;
  const schedule = (product) => {
    const parts = (product.releaseDate || "").match(/(\d{4})년\s*(\d{1,2})월(?:\s*(\d{1,2})일)?/);
    if (!parts || Number(parts[2]) < 1 || Number(parts[2]) > 12) return { key: Infinity, day: Infinity };
    return { key: Number(parts[1]) * 12 + Number(parts[2]) - 1, year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]) || Infinity };
  };
  const groups = new Map();
  const visibleProducts = products.filter((product) => Number.isFinite(schedule(product).key) && schedule(product).key >= currentMonth);
  visibleProducts.sort((left, right) => schedule(left).key - schedule(right).key || schedule(left).day - schedule(right).day)
    .forEach((product) => {
      const date = schedule(product);
      if (!groups.has(date.key)) groups.set(date.key, { ...date, products: [] });
      groups.get(date.key).products.push(product);
    });
  $("#product-count").textContent = visibleProducts.length;
  $("#empty-state").hidden = visibleProducts.length > 0;
  $("#selected-products").innerHTML = [...groups.values()].map((group, index) => `
    <section class="arrival-month" aria-labelledby="arrival-month-${index}">
      <div class="arrival-month-heading">
        <h3 id="arrival-month-${index}">${group.month ? `<span class="arrival-period"><span class="arrival-year">${group.year}년</span><strong>${group.month}<span class="arrival-month-unit">월</span></strong></span>` : "입고 월 미정"}</h3>
        <span class="arrival-count"><strong>${group.products.length}</strong>개 상품</span>
      </div>
      <div class="product-grid">${group.products.map(productCard).join("")}</div>
    </section>`).join("");
}

function renderPublicSkeleton() {
  return `<span class="sr-only">상품 목록을 불러오는 중입니다.</span>
    <div class="public-skeleton" aria-hidden="true">
      <div class="arrival-month-heading"><span class="skeleton skeleton-month"></span></div>
      <div class="product-grid">${Array.from({ length: 3 }, () => `
        <div class="product-card">
          <span class="product-image skeleton"></span>
          <div class="product-info"><span class="skeleton skeleton-date"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line skeleton-line-short"></span></div>
          <div class="product-summary"><span class="skeleton skeleton-number"></span><span class="skeleton skeleton-number"></span><span class="skeleton skeleton-number"></span><span class="skeleton skeleton-sources"></span></div>
        </div>`).join("")}</div>
    </div>`;
}

let publicProductsLoaded = false;
let publicProductsLoading = false;
let publicView = "incoming";
let publicRegisteredProducts = [];
let publicCatalogProducts = null;
let publicCatalogSnapshot = null;
let publicCatalogLoading = false;
let publicCatalogMonthCount = 0;
let publicCatalogStart = null;
let publicLoadError = "";
let publicCatalogError = "";

function mergePublicCatalog(catalog, registered, snapshot) {
  const merged = new Map();
  for (const product of catalog) {
    const details = applyQuantitySnapshot(product, product, { year: product.catalogYear, month: product.catalogMonth }, snapshot);
    merged.set(product.id, { ...details, isIncoming: false });
  }
  for (const product of registered) merged.set(product.id, { ...merged.get(product.id), ...product, isIncoming: true });
  return [...merged.values()];
}

function renderPublicProductList() {
  const all = publicView === "all";
  const waiting = (!publicProductsLoaded && publicProductsLoading) || (all && publicCatalogLoading && !publicCatalogProducts);
  const loading = $("#public-loading");
  loading.hidden = !waiting;
  $("#selected-products").hidden = waiting;
  $("#selected-products").setAttribute("aria-busy", String(waiting));
  if (waiting) {
    loading.innerHTML = renderPublicSkeleton();
    $("#empty-state").hidden = true;
  } else if (publicProductsLoaded && (!all || publicCatalogProducts)) {
    renderSelectedProducts(all ? mergePublicCatalog(publicCatalogProducts, publicRegisteredProducts, publicCatalogSnapshot) : publicRegisteredProducts);
  } else {
    $("#empty-state").hidden = true;
    $("#selected-products").innerHTML = "";
    $("#product-count").textContent = "0";
  }
  setPublicError(all ? publicCatalogError || publicLoadError : publicLoadError);
  const title = $("#list-title-text");
  if (title) title.textContent = all ? "전체 쿠지 상품" : "입고 예정 상품";
  const emptyTitle = $("#public-empty-title");
  const emptyCopy = $("#public-empty-copy");
  if (emptyTitle) emptyTitle.textContent = all ? "이 기간에 공개된 쿠지 상품이 없습니다" : "등록된 입고 예정 상품이 없습니다";
  if (emptyCopy) emptyCopy.textContent = all ? "이번 달과 다음 달의 상품이 공개되면 이곳에서 확인할 수 있습니다." : "관리자가 상품을 등록하면 이곳에서 확인할 수 있습니다.";
  const range = $("#public-catalog-range");
  if (range) {
    range.hidden = !all;
    const months = publicCatalogStart && publicCatalogMonthCount ? getTargetMonths(0, publicCatalogMonthCount, publicCatalogStart) : [];
    range.textContent = months.length ? `${formatMonth(months[0])} – ${formatMonth(months[months.length - 1])} · 발매일순` : "이번 달 이후 공개된 쿠지 상품을 불러옵니다.";
  }
}

async function loadPublicCatalog() {
  if (publicCatalogLoading || publicCatalogProducts) return;
  publicCatalogLoading = true;
  publicCatalogError = "";
  if (!publicCatalogStart) {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric" }).formatToParts(new Date());
    publicCatalogStart = new Date(Number(parts.find((part) => part.type === "year").value), Number(parts.find((part) => part.type === "month").value) - 1, 1);
  }
  const months = getTargetMonths(0, 2, publicCatalogStart);
  renderPublicProductList();
  try {
    const [results, snapshot] = await Promise.all([Promise.all(months.map(fetchProducts)), loadQuantitySnapshot()]);
    const products = results.flatMap((result) => result.products.map((product) => ({ ...product, catalogYear: result.year, catalogMonth: result.month })));
    publicCatalogProducts = products;
    publicCatalogSnapshot = snapshot || publicCatalogSnapshot;
    publicCatalogMonthCount = months.length;
  } catch (error) {
    publicCatalogError = `전체 상품을 불러오지 못했습니다: ${error.message} 전체 보기를 눌러 다시 시도해 주세요.`;
  } finally {
    publicCatalogLoading = false;
    renderPublicProductList();
  }
}

async function setPublicView(view) {
  if (view !== "incoming" && view !== "all") return;
  publicView = view;
  document.querySelectorAll("[data-public-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.publicView === view)));
  if (view === "all" && !publicCatalogProducts) await loadPublicCatalog();
  else renderPublicProductList();
}

async function loadPublicProducts() {
  if (publicProductsLoading) return;
  if (!supabaseClient) {
    publicLoadError = "공용 상품 목록을 불러오려면 Supabase 설정이 필요합니다.";
    renderPublicProductList();
    return;
  }
  publicProductsLoading = true;
  renderPublicProductList();
  try {
    const { data, error } = await supabaseClient
      .from("display_products")
      .select("id, product");
    if (error) throw error;

    publicLoadError = "";
    publicRegisteredProducts = data.map((row) => row.product);
    publicProductsLoaded = true;
  } catch (error) {
    publicLoadError = `상품 목록을 불러오지 못했습니다: ${error.message}`;
  } finally {
    publicProductsLoading = false;
    renderPublicProductList();
  }
}

function getTargetMonths(startOffset = 0, count = 2, now = new Date()) {
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() + startOffset + offset, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  });
}

function formatMonth({ year, month }) {
  return `${year}년 ${month}월`;
}

async function fetchProducts(month) {
  const cached = await loadCachedProducts(month);
  if (cached.length) return { ...month, products: cached };
  const query = new URLSearchParams(month);
  const response = await fetch(`${productsApiUrl}?${query}`, {
    headers: {
      apikey: appConfig.supabaseAnonKey,
      Authorization: `Bearer ${appConfig.supabaseAnonKey}`
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "상품 목록을 불러오지 못했습니다.");
  return payload;
}

async function loadCachedProducts(month) {
  if (!appConfig.supabaseUrl) return [];
  try {
    const query = new URLSearchParams({ select: "product", catalog_year: `eq.${month.year}`, catalog_month: `eq.${month.month}` });
    const response = await fetch(`${appConfig.supabaseUrl}/rest/v1/catalog_products?${query}`, {
      headers: { apikey: appConfig.supabaseAnonKey, Authorization: `Bearer ${appConfig.supabaseAnonKey}` },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows.map((row) => row.product).filter((product) => product?.id) : [];
  } catch { return []; }
}

function updateSelectionStatus(message) {
  const status = $("#selection-status");
  const count = selectedProducts.size;
  status.textContent = message || `${count}개 상품 등록됨 · 정보 확인 후 등록하기를 눌러 공개하세요.`;
}

function showAdminError(message) {
  const error = $("#admin-error");
  error.textContent = message;
  error.hidden = !message;
}

const cardStates = new Map();

function normalizeProduct(product) {
  const integer = (value) => {
    if (typeof value === "string") {
      const text = value.trim();
      if (!/^\d+(?:,\d{3})*$/.test(text)) return null;
      value = Number(text.replace(/,/g, ""));
    }
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  const ticketsPerSet = integer(product.ticketsPerSet);
  const unitPriceYen = integer(product.unitPriceYen);
  const total = ticketsPerSet && unitPriceYen ? ticketsPerSet * unitPriceYen : null;
  return { ...product, nameKo: typeof product.nameKo === "string" ? product.nameKo.trim() : "",
    ticketsPerSet, unitPriceYen, purchasePriceYen: Number.isSafeInteger(total) ? total : null };
}

function registrationIssue(product) {
  if (!product) return "상품 정보를 먼저 조회해 주세요.";
  const normalized = normalizeProduct(product);
  const missing = [];
  if (!normalized.nameKo) missing.push("번역 제목");
  if (!normalized.ticketsPerSet) missing.push("세트 장수");
  if (!normalized.unitPriceYen) missing.push("장당 가격");
  if (missing.length) return `${missing.join(" · ")} 정보가 없어 등록할 수 없습니다. 다시 조회해 주세요.`;
  return normalized.purchasePriceYen ? "" : "매입가를 계산할 수 없습니다. 다시 조회해 주세요.";
}

function isCompleteProduct(product) {
  return !registrationIssue(product);
}

async function saveProductSelection(product, isSelected) {
  const savedProduct = { ...normalizeProduct(product), quantitySourceUrl: product.quantitySourceUrl || product.kujimapUrl || "", officialPriceUrl: product.officialPriceUrl || product.url };
  showAdminError("");
  try {
    const result = isSelected
      ? await supabaseClient.from("display_products").upsert({ id: product.id, product: savedProduct })
      : await supabaseClient.from("display_products").delete().eq("id", product.id);
    if (result.error) throw result.error;
    if (isSelected) selectedProducts.set(product.id, savedProduct);
    else selectedProducts.delete(product.id);
    updateSelectionStatus();
    return true;
  } catch (error) {
    showAdminError(`상품을 저장하지 못했습니다: ${error.message || String(error)}`);
    return false;
  }
}

function renderCardDetails(state) {
  const registered = selectedProducts.has(state.product.id);
  if (state.draft) state.draft = normalizeProduct(state.draft);
  const product = state.draft;
  const issue = product ? registrationIssue(product) : "";
  const message = issue ? [state.message, issue].filter(Boolean).join(" ") : state.message;
  const busy = state.loading || state.saving;
  state.card.classList.toggle("has-details", Boolean(state.loading || product || state.message));
  state.card.setAttribute("aria-busy", String(busy));
  state.card.querySelector(".product-name").textContent = product?.nameKo || state.product.name;
  const toggle = state.card.querySelector(".registration-toggle");
  toggle.classList.toggle("is-registered", registered);
  toggle.setAttribute("aria-pressed", String(registered));
  toggle.setAttribute("aria-label", registered ? "등록 취소" : "미등록");
  toggle.title = registered ? "등록 취소" : "미등록";
  toggle.disabled = !registered || busy;
  state.card.classList.toggle("is-registered", registered);
  const details = state.card.querySelector(".card-details");
  details.innerHTML = state.loading
    ? '<p class="card-status card-loading" role="status"><span class="loading-dot" aria-hidden="true"></span>데이터 가져오는 중…</p>'
    : `<div class="card-detail-content">${product ? `
        <p class="card-retailers"><strong>취급 점포</strong> ${escapeHtml(product.retailersKo || product.retailers || "점포 정보 미확인 · 다시 조회해 주세요.")}</p>
        <dl class="card-numbers">
          <div><dt>1세트 장수</dt><dd>${product.ticketsPerSet ? escapeHtml(product.ticketsPerSet) + "장" : "미확인"}</dd></div>
          <div><dt>장당 가격</dt><dd>${product.unitPriceYen ? Number(product.unitPriceYen).toLocaleString("ko-KR") + "엔" : "미확인"}</dd></div>
          <div class="card-total"><dt>매입가</dt><dd>${product.purchasePriceYen ? Number(product.purchasePriceYen).toLocaleString("ko-KR") + "엔" : "미확인"}</dd></div>
        </dl>
        <p class="card-sources">${product.quantitySourceUrl || product.kujimapUrl ? `<a href="${escapeHtml(product.quantitySourceUrl || product.kujimapUrl)}" target="_blank" rel="noopener noreferrer">수량 출처 ↗</a> · ` : ""}<a href="${escapeHtml(state.product.url)}" target="_blank" rel="noopener noreferrer">공식 가격 ↗</a></p>` : ""}
      ${message ? `<p class="card-status" role="status">${escapeHtml(message)}</p>` : ""}
      </div>
      <div class="card-actions">
        <button class="button button-outline" type="button" data-action="collect" ${busy ? "disabled" : ""}>${product || state.message ? "다시 조회" : "조회"}</button>
        ${product ? `<button class="button button-dark" type="button" data-action="publish" ${busy || issue ? "disabled" : ""} ${issue ? `title="${escapeHtml(issue)}"` : ""}>${state.saving ? "저장 중…" : issue ? "정보 확인 필요" : registered ? "수정 등록" : "등록하기"}</button>` : ""}
      </div>`;
}

async function loadQuantitySnapshot() {
  const bundledUrl = new URL("data/lot-quantities.json", scriptUrl).href;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location?.hostname);
  const urls = !local && appConfig.quantitySnapshotUrl ? [appConfig.quantitySnapshotUrl, bundledUrl] : [bundledUrl];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) continue;
      const snapshot = await response.json();
      if (Array.isArray(snapshot?.products)) return snapshot;
    } catch { /* Keep the packaged catalogue available during data-host failures. */ }
  }
  return null;
}

function applyQuantitySnapshot(product, details, month, snapshot, now = Date.now()) {
  if (details.ticketsPerSet > 0) return details;
  const normalize = (value) => String(value).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const matches = (Array.isArray(snapshot?.products) ? snapshot.products : []).filter((entry) =>
    entry.id === product.id && normalize(entry.name) === normalize(product.name) &&
    entry.year === month.year && entry.month === month.month && entry.method === "browser");
  if (matches.length !== 1) return details;
  const entry = matches[0];
  const age = now - Date.parse(entry.checkedAt);
  if (!Number.isFinite(age) || age < -300000 || age > 7 * 86400000 || !Number.isSafeInteger(entry.ticketsPerSet) || entry.ticketsPerSet < 1 || entry.ticketsPerSet > 10000) return details;
  try {
    const url = new URL(entry.quantitySourceUrl);
    const prefix = `/1bankuji/1bankuji_${month.year}${String(month.month).padStart(2, "0")}/`;
    if (url.origin !== "https://kujimap.com" || !url.pathname.startsWith(prefix)) return details;
  } catch { return details; }
  return { ...details, ticketsPerSet: entry.ticketsPerSet, quantitySourceUrl: entry.quantitySourceUrl,
    quantityCheckedAt: entry.checkedAt, quantityMethod: "browser-snapshot",
    warnings: (details.warnings || []).filter((warning) => !warning.startsWith("이 상품의 세트 수량") && !warning.startsWith("출처에서 수량을 확인하지 못해") && !warning.startsWith("쿠지맵에서 일치하는 상품의 수량")) };
}

async function translateTitleInBrowser(name) {
  const isIchiban = name.startsWith("一番くじ");
  const text = isIchiban ? name.slice("一番くじ".length).trim() : name;
  if (!text && isIchiban) return "이치방쿠지";
  const query = new URLSearchParams({ client: "gtx", sl: "ja", tl: "ko", dt: "t", q: text });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("브라우저 번역 실패");
  const payload = await response.json();
  const translated = Array.isArray(payload?.[0]) ? payload[0]
    .map((part) => Array.isArray(part) && typeof part[0] === "string" ? part[0] : "").join("").replace(/[\u200b-\u200d\ufeff]/g, "").trim() : "";
  if (!translated || (/[\u3040-\u30ff\u3400-\u9fff]/.test(translated) && !/[가-힣]/.test(translated))) throw new Error("유효한 번역 결과가 없습니다.");
  return isIchiban ? `이치방쿠지 ${translated}` : translated;
}

async function collectCardProduct(state) {
  if (state.loading || state.saving) return;
  state.loading = true;
  state.message = "";
  renderCardDetails(state);
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data.session) throw new Error("다시 로그인해 주세요.");
    const query = new URLSearchParams({ action: "inspect", id: state.product.id, name: state.product.name, ...state.month, requestId: String(Date.now()) });
    const [response, snapshot] = await Promise.all([
      fetch(`${productsApiUrl}?${query}`, {
        cache: "no-store",
        headers: { apikey: appConfig.supabaseAnonKey, Authorization: `Bearer ${data.session.access_token}` }
      }),
      loadQuantitySnapshot()
    ]);
    let details = await response.json();
    if (!response.ok) throw new Error(details.error || "정보 조회 실패");
    details = applyQuantitySnapshot(state.product, details, state.month, snapshot);
    if (!details.nameKo?.trim()) {
      try {
        details.nameKo = await translateTitleInBrowser(state.product.name);
        details.translationMethod = "browser-retry";
        details.warnings = (details.warnings || []).filter((warning) => !warning.startsWith("자동 번역에 실패"));
      } catch { /* Retain the server warning if both independent attempts fail. */ }
    }
    state.draft = normalizeProduct({ ...state.product, ...details });
    const cached = await supabaseClient.from("catalog_products").upsert({ id: state.product.id,
      catalog_year: state.month.year, catalog_month: state.month.month, product: state.draft, updated_at: new Date().toISOString() });
    if (cached.error) details.warnings = [...(details.warnings || []), "조회 정보 캐시 저장에 실패했습니다."];
    state.message = (details.warnings || []).join(" ") || (isCompleteProduct(state.draft) ? "조회 완료 · 확인 후 등록하세요." : "");
  } catch (error) {
    state.message = `${error.message} 다시 조회해 주세요.`;
  } finally {
    state.loading = false;
    renderCardDetails(state);
  }
}

async function persistCardProduct(state, isSelected) {
  if (state.loading || state.saving || (isSelected && !isCompleteProduct(state.draft))) return;
  state.saving = true;
  renderCardDetails(state);
  try {
    const saved = await saveProductSelection(isSelected ? state.draft : state.product, isSelected);
    state.message = saved ? (isSelected ? "등록되었습니다." : "등록이 취소되었습니다.") : "저장하지 못했습니다. 다시 시도해 주세요.";
  } finally {
    state.saving = false;
    renderCardDetails(state);
  }
}

function renderAdminSkeleton() {
  return `<span class="sr-only" role="status">상품 목록을 불러오는 중입니다.</span>
    <div aria-hidden="true">${Array.from({ length: 2 }, () => `
      <section class="month-group">
        <div class="month-heading"><span class="skeleton skeleton-heading"></span></div>
        <div class="admin-product-grid">${Array.from({ length: 6 }, () => `
          <div class="admin-product-card skeleton-card">
            <span class="skeleton skeleton-image"></span>
            <div class="admin-product-info">
              <span class="skeleton skeleton-date"></span>
              <span class="skeleton skeleton-line"></span>
              <span class="skeleton skeleton-line skeleton-line-short"></span>
            </div>
          </div>`).join("")}</div>
      </section>`).join("")}</div>`;
}

let loadedMonthCount = 0;
let catalogStartMonth = new Date();
let adminLoading = false;

async function loadAdminProducts(append = false) {
  if (adminLoading) return;
  adminLoading = true;
  if (!append) {
    loadedMonthCount = 0;
    catalogStartMonth = new Date();
    cardStates.clear();
  }
  const months = getTargetMonths(loadedMonthCount, 2, catalogStartMonth);
  const container = $("#admin-months");
  const moreButton = $("#load-more-months");
  moreButton.disabled = true;
  moreButton.textContent = "불러오는 중…";
  container.setAttribute("aria-busy", "true");
  const batch = document.createElement("div");
  batch.className = "month-batch";
  batch.innerHTML = renderAdminSkeleton();
  if (!append) container.replaceChildren(batch);
  else container.append(batch);
  showAdminError("");

  try {
    const [{ data, error }, ...results] = await Promise.all([
      append ? Promise.resolve({ data: null, error: null }) : supabaseClient.from("display_products").select("id, product"),
      ...months.map(fetchProducts)
    ]);
    if (error) throw error;

    if (!append) selectedProducts = new Map(data.map((row) => [row.id, row.product]));
    batch.innerHTML = results.map((result) => `
      <section class="month-group">
        <div class="month-heading">
          <h3>${formatMonth(result)}</h3>
          <span>${result.products.length}개 상품</span>
        </div>
        ${result.products.length
          ? `<div class="admin-product-grid">${result.products.map((product) => `
              <article class="admin-product-card" data-product-id="${escapeHtml(product.id)}">
                <button class="registration-toggle" data-action="remove" type="button" aria-label="미등록" aria-pressed="false" disabled><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg></button>
                <a class="card-site-link" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(product.name)} 공식 사이트">
                  <img src="${escapeHtml(product.image)}" alt="" loading="lazy">
                  <span class="admin-product-info">
                    ${product.releaseDate ? `<span class="product-date">${escapeHtml(product.releaseDate)}</span>` : ""}
                    <span class="product-name">${escapeHtml(product.name)}</span>
                  </span>
                </a>
                <div class="card-details"></div>
              </article>`).join("")}</div>`
          : `<p class="no-products">이 달에 공개된 상품이 없습니다.</p>`}
      </section>`).join("");

    batch.querySelectorAll("[data-product-id]").forEach((card) => {
      const result = results.find((result) => result.products.some((product) => product.id === card.dataset.productId));
      const product = result.products.find((product) => product.id === card.dataset.productId);
      const state = { card, product, month: { year: result.year, month: result.month }, draft: selectedProducts.get(product.id) || (product.checkedAt ? normalizeProduct(product) : null), loading: false, saving: false, message: "" };
      cardStates.set(product.id, state);
      renderCardDetails(state);
      card.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) {
          if (!event.target.closest("a")) window.open(product.url, "_blank", "noopener,noreferrer");
          return;
        }
        if (button.disabled) return;
        if (button.dataset.action === "collect") collectCardProduct(state);
        else if (button.dataset.action === "publish") persistCardProduct(state, true);
        else if (button.dataset.action === "remove" && selectedProducts.has(product.id)) persistCardProduct(state, false);
      });
    });
    loadedMonthCount += months.length;
    const firstMonth = getTargetMonths(0, 1, catalogStartMonth)[0];
    $("#month-range").textContent = `${formatMonth(firstMonth)}부터 ${formatMonth(months[months.length - 1])}까지`;
    moreButton.hidden = false;
    updateSelectionStatus();
  } catch (error) {
    if (append) {
      batch.remove();
      showAdminError(`추가 상품을 불러오지 못했습니다: ${error.message} 더 가져오기를 눌러 다시 시도해 주세요.`);
    } else {
      batch.innerHTML = `<div class="error-message" role="alert">${escapeHtml(error.message)}<button class="button button-outline" id="retry-load" type="button">다시 시도</button></div>`;
      batch.querySelector("#retry-load").addEventListener("click", () => loadAdminProducts());
    }
  } finally {
    adminLoading = false;
    moreButton.disabled = false;
    moreButton.textContent = "더 가져오기";
    container.setAttribute("aria-busy", "false");
  }
}

async function openAdmin() {
  try {
    const { data, error } = await supabaseClient.rpc("is_admin");
    if (error) throw error;
    if (!data) {
      const { error: signOutError } = await supabaseClient.auth.signOut();
      if (signOutError) throw signOutError;
      throw new Error("이 계정에 관리자 권한이 없습니다.");
    }
    $("#admin-auth").hidden = true;
    await loadAdminProducts();
  } catch (error) {
    $("#admin-auth").hidden = false;
    $("#auth-error").textContent = error.message;
    $("#auth-error").hidden = false;
  }
}

const adminView = $("#admin-months");
if (adminView) {
  $("#load-more-months").addEventListener("click", () => loadAdminProducts(true));
  adminView.innerHTML = renderAdminSkeleton();
  adminView.setAttribute("aria-busy", "true");
  const authDialog = $("#admin-auth");
  const authError = $("#auth-error");

  if (!supabaseClient) {
    adminView.innerHTML = "";
    adminView.setAttribute("aria-busy", "false");
    authDialog.hidden = true;
    showAdminError("Supabase 설정을 먼저 완료해 주세요. 설정 방법은 README를 확인하세요.");
  } else {
    $("#admin-auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      authError.hidden = true;
      try {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email: $("#admin-email").value,
          password: $("#admin-password").value
        });
        if (error) throw error;
        await openAdmin();
      } catch {
        authError.textContent = "로그인하지 못했습니다. 이메일과 비밀번호를 확인해 주세요.";
        authError.hidden = false;
      }
    });

    $("#logout-link").addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        window.location.href = appBasePath;
      } catch (error) {
        showAdminError(`로그아웃하지 못했습니다: ${error.message}`);
      }
    });

    authDialog.hidden = true;
    supabaseClient.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        if (data.session) return openAdmin();
        authDialog.hidden = false;
        $("#admin-email").focus();
      })
      .catch((error) => {
        authDialog.hidden = false;
        authError.textContent = `로그인 상태를 확인하지 못했습니다: ${error.message}`;
        authError.hidden = false;
      });
  }
} else {
  $("#public-view-switch")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-public-view]");
    if (button) setPublicView(button.dataset.publicView);
  });
  loadPublicProducts();
  window.setInterval(() => {
    if (document.visibilityState === "visible") loadPublicProducts();
  }, 60000);
}
