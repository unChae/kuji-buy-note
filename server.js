const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const configContext = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(publicDirectory, "config.js"), "utf8"), configContext);
const appConfig = configContext.window.APP_CONFIG || {};
let productsHandler;
const productsContext = vm.createContext({
  Response, Request, URL, URLSearchParams, AbortSignal, console, fetch, Set, Date,
  Deno: {
    env: { get: (name) => process.env[name] || ({ SUPABASE_URL: appConfig.supabaseUrl, SUPABASE_ANON_KEY: appConfig.supabaseAnonKey })[name] },
    serve: (handler) => { productsHandler = handler; }
  }
});
const productsSource = fs.readFileSync(path.join(__dirname, "supabase/functions/products/index.ts"), "utf8");
vm.runInContext(stripTypeScriptTypes(productsSource.replace(/^export /gm, "")), productsContext);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (requestUrl.pathname === "/api/products") {
    try {
      const result = await productsHandler(new Request(requestUrl, { method: request.method, headers: request.headers }));
      response.writeHead(result.status, { ...Object.fromEntries(result.headers), "Cache-Control": "no-store" });
      response.end(await result.text());
    } catch (error) {
      console.error("Local products API:", error.message);
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "자동 수집 서버 연결에 실패했습니다. 다시 시도해 주세요." }));
    }
    return;
  }
  let requestedPath = requestUrl.pathname === "/"
    ? "/index.html"
    : requestUrl.pathname === "/admin" || requestUrl.pathname === "/admin/"
      ? "/admin/index.html"
      : requestUrl.pathname;
  const filePath = path.resolve(publicDirectory, `.${requestedPath}`);

  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(contents);
  });
});

server.listen(port, () => {
  console.log(`치바쿠지 입고 안내가 http://localhost:${port} 에서 실행 중입니다.`);
});
