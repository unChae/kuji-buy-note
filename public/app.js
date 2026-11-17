const $ = (selector) => document.querySelector(selector);
const appConfig = window.APP_CONFIG || {};
const scriptUrl = document.querySelector('script[src$="app.js"]').src;
const appBasePath = new URL(".", scriptUrl).pathname;
const supabaseClient = appConfig.supabaseUrl && appConfig.supabaseAnonKey && window.supabase
  ? window.supabase.createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey)
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
  const release = product.releaseDate
    ? `<span class="product-date">${escapeHtml(product.releaseDate)}</span>`
    : "";
  return `
    <article class="product-card">
      <a class="product-image" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">
        <img src="${escapeHtml(product.image)}" alt="" loading="lazy">
      </a>
      <div class="product-info">
        ${release}
        <a class="product-name" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(product.name)}</a>
      </div>
    </article>`;
}

function setPublicError(message) {
  const error = $("#public-error");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
  error.classList.toggle("error-message", Boolean(message));
}

function renderSelectedProducts(products) {
  products.sort((left, right) => {
    const toTimestamp = (date) => {
      const parts = date.match(/(\d+)년 (\d+)월 (\d+)일/);
      return parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).getTime() : Infinity;
    };
    return toTimestamp(left.releaseDate || "") - toTimestamp(right.releaseDate || "");
  });
  $("#product-count").textContent = products.length;
  $("#empty-state").hidden = products.length > 0;
  $("#selected-products").innerHTML = products.map(productCard).join("");
}

async function loadPublicProducts() {
  if (!supabaseClient) {
    setPublicError("공용 상품 목록을 불러오려면 Supabase 설정이 필요합니다.");
    $("#empty-state").hidden = true;
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from("display_products")
      .select("id, product");
    if (error) throw error;

    setPublicError("");
    renderSelectedProducts(data.map((row) => row.product));
  } catch (error) {
    setPublicError(`상품 목록을 불러오지 못했습니다: ${error.message}`);
    $("#empty-state").hidden = true;
  }
}

function getTargetMonths() {
  const now = new Date();
  return Array.from({ length: 4 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  });
}

function formatMonth({ year, month }) {
  return `${year}년 ${month}월`;
}

async function fetchProducts(month) {
  const query = new URLSearchParams(month);
  const response = await fetch(`${appConfig.supabaseUrl}/functions/v1/products?${query}`, {
    headers: {
      apikey: appConfig.supabaseAnonKey,
      Authorization: `Bearer ${appConfig.supabaseAnonKey}`
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "상품 목록을 불러오지 못했습니다.");
  return payload;
}

function updateSelectionStatus(message) {
  const status = $("#selection-status");
  const count = selectedProducts.size;
  status.textContent = message || `${count}개 상품 등록됨 · 선택하면 모든 방문자에게 반영됩니다.`;
}

function showAdminError(message) {
  const error = $("#admin-error");
  error.textContent = message;
  error.hidden = !message;
}

async function saveProductSelection(product, isSelected, checkbox) {
  checkbox.disabled = true;
  updateSelectionStatus("저장 중입니다…");
  showAdminError("");

  let error;
  try {
    const result = isSelected
      ? await supabaseClient.from("display_products").upsert({ id: product.id, product })
      : await supabaseClient.from("display_products").delete().eq("id", product.id);
    error = result.error;
  } catch (requestError) {
    error = requestError;
  }
  checkbox.disabled = false;

  if (error) {
    checkbox.checked = !isSelected;
    const message = error instanceof Error ? error.message : String(error);
    showAdminError(`상품을 저장하지 못했습니다: ${message}`);
    updateSelectionStatus();
    return;
  }

  if (isSelected) selectedProducts.set(product.id, product);
  else selectedProducts.delete(product.id);
  updateSelectionStatus();
}

async function loadAdminProducts() {
  const months = getTargetMonths();
  const container = $("#admin-months");
  $("#month-range").textContent = `${formatMonth(months[0])}부터 ${formatMonth(months[3])}까지`;
  container.innerHTML = `<p class="loading-message">1kuji.com 상품을 불러오는 중입니다…</p>`;
  showAdminError("");

  try {
    const [{ data, error }, ...results] = await Promise.all([
      supabaseClient.from("display_products").select("id, product"),
      ...months.map(fetchProducts)
    ]);
    if (error) throw error;

    selectedProducts = new Map(data.map((row) => [row.id, row.product]));
    container.innerHTML = results.map((result) => `
      <section class="month-group">
        <div class="month-heading">
          <h3>${formatMonth(result)}</h3>
          <span>${result.products.length}개 상품</span>
        </div>
        ${result.products.length
          ? `<div class="admin-product-grid">${result.products.map((product) => `
              <label class="admin-product-card">
                <input type="checkbox" value="${escapeHtml(product.id)}" ${selectedProducts.has(product.id) ? "checked" : ""}>
                <span class="checkmark" aria-hidden="true">✓</span>
                <img src="${escapeHtml(product.image)}" alt="" loading="lazy">
                <span class="admin-product-info">
                  ${product.releaseDate ? `<span class="product-date">${escapeHtml(product.releaseDate)}</span>` : ""}
                  <span class="product-name">${escapeHtml(product.name)}</span>
                </span>
              </label>`).join("")}</div>`
          : `<p class="no-products">이 달에 공개된 상품이 없습니다.</p>`}
      </section>`).join("");

    container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const product = results.flatMap((result) => result.products)
          .find((item) => item.id === checkbox.value);
        if (product) saveProductSelection(product, checkbox.checked, checkbox);
      });
    });
    updateSelectionStatus();
  } catch (error) {
    container.innerHTML = `<div class="error-message" role="alert">${escapeHtml(error.message)}<button class="button button-outline" id="retry-load" type="button">다시 시도</button></div>`;
    $("#retry-load").addEventListener("click", loadAdminProducts);
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
  const authDialog = $("#admin-auth");
  const authError = $("#auth-error");

  if (!supabaseClient) {
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
  loadPublicProducts();
  window.setInterval(() => {
    if (document.visibilityState === "visible") loadPublicProducts();
  }, 60000);
}
