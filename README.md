# 치바쿠지 입고 상품 안내

## 상품 확인 및 등록

상품 목록은 이번 달과 다음 달을 먼저 불러옵니다. 목록 아래 **더 가져오기**를 누르면
이후 두 달씩 추가하며, 기존 카드의 조회 결과와 등록 상태는 유지합니다.

관리자 화면에서 카드나 **조회** 버튼을 누르면 카드 안에서 데이터를 가져옵니다. 조회만으로 공개되지 않습니다.
한글 제목, 1세트당 장수, 장당 가격(엔·세금 포함)을 자동 수집하고 매입가를 계산합니다.
관리자는 결과를 확인한 뒤 **등록하기**만 누르면 됩니다. 직접 입력할 필요가 없습니다.
공개 화면에는 저장된 한글 제목과 세트 매입가가 표시됩니다. 기존 상품은 다시 조회 후 수정 등록할 수 있고,
카드 오른쪽 위 체크 원을 누르면 등록이 취소됩니다. 등록 전에는 원이 채워지지 않습니다.
매입가는 `세트 장수 × 장당 가격`이며 배송비, 관세, 환율, 도매 할인은 포함하지 않습니다.

자동 번역은 별도 키 없이 Google 번역의 공개 웹 엔드포인트를 사용합니다.
선택적으로 서버에 DeepL API 키를 설정하면 먼저 사용하고, 실패 시 기본 번역으로 전환합니다.
키를 브라우저 설정에 넣지 마세요.

```text
supabase secrets set DEEPL_AUTH_KEY=발급받은_키
supabase functions deploy products
```

자동 번역 시 상품명이 Google 또는 설정된 DeepL로 전송됩니다.
Google 공개 웹 엔드포인트는 공식 유료 API와 달리 안정성이 보장되지 않습니다.
쿠지맵은 선택 월의 목록에서 원문 상품명이 일치하는 상세 페이지를 찾습니다.
공백 및 전각/반각만 정규화하며 유사한 다른 상품은 자동 선택하지 않습니다.
상세 수량 표를 읽을 수 없으면 쿠지맵 운영자 `whitenoize`의 공개 공지를
`teapaw.org/whitenoize`에서 자동 수집합니다. 공지의 전체 상품 URL이 일치하고
`ロット内訳 全N本`이 명시된 경우에만 장수를 적용합니다. 수량 출처 링크도 저장합니다.
최근 타임라인 5페이지를 조회하고 10분 동안 캐시합니다. 다른 상품, 리트윗, 미공개 수량은 제외합니다.
두 경로에서 수량을 찾지 못하면 `ufocatchers.com/1kuji/공식상품ID/`도 조회합니다.
공식 상품 링크·일본어 제목·발매 연월이 모두 일치하고 총 장수가 명시된 경우에만 사용하며,
수량 출처는 실제로 읽은 페이지 주소로 저장합니다.
동적 표는 `lib/kujimap-browser.cjs`가 일반 브라우저에서 정상 로딩한 뒤 직접 읽습니다.
광고 상태나 잠금 해제 토큰을 위조하지 않습니다. 사이트가 브라우저 접근을 거절하면 실패로 처리합니다.
로컬은 설치된 Microsoft Edge를 자동 실행합니다. 상품별 고정 수량이나 수동 검증 예외는 사용하지 않습니다.

화면 배포와 수량 수집은 별도 워크플로입니다.
`Publish GitHub Pages`는 `public` 폴더만 배포하며 npm 설치나 브라우저 수집을 실행하지 않습니다.
`Collect Product Quantities`는 하루 두 번(한국 시간 00시·12시), 수집 코드 변경 시 또는 수동 실행 시
현재 월부터 4개월을 Chromium으로 수집합니다. 결과는 소스 코드와 분리된 `catalog-data` 브랜치의
`lot-quantities.json`에 저장합니다. 실패 시 직전 결과를 유지하며 `main`이나 Pages 배포를 변경하지 않습니다.
수집에는 저장소의 기본 `GITHUB_TOKEN`을 사용하며 별도 토큰 설정은 필요하지 않습니다.

공개 페이지는 `public/config.js`의 `quantitySnapshotUrl`에서 갱신된 데이터를 직접 읽으므로
수집 후 화면 재배포가 필요하지 않습니다. 이 URL은 공개 저장소의 데이터 브랜치를 가리킵니다.
첫 수집 전이거나 데이터 주소에 연결할 수 없으면 배포에 포함된 `public/data/lot-quantities.json`을 사용합니다.
로컬에서는 이 파일을 사용합니다.
수집 결과는 공식 ID·원문 제목·발매 연월·출처 주소를 대조하고, 7일 이상 지난 결과는 적용하지 않습니다.
GitHub Actions의 실제 실행 결과는 저장소 Actions 탭에서 확인할 수 있습니다.

로컬에서 자동 수집 결과를 생성하려면 Node.js 24 이상에서 다음을 실행합니다.

```text
npm ci
node scripts/collect-lots.cjs
```

Linux에서는 `npx playwright install --with-deps chromium` 후 Xvfb 환경에서 실행해야 합니다.
수량이나 가격이 아직 공개되지 않았거나 수집이 실패하면 등록 버튼을 비활성화하고 **다시 수집**을 제공합니다.
기존 JSON 상품 필드를 확장하므로 데이터베이스 스키마 변경은 필요하지 않습니다.

검증: Node.js 24 이상에서 `node --test tests/*.test.cjs`를 실행합니다.

GitHub Pages에서 정적 화면을 제공하고, Supabase에서 관리자 인증과 공용 상품 목록을 관리합니다. 상품 정보는 Supabase Edge Function이 1kuji.com에서 가져옵니다.

## 1. Supabase 준비

1. Supabase 프로젝트를 만들고 SQL Editor에서 [`supabase/schema.sql`](./supabase/schema.sql)을 실행합니다.
2. Authentication 설정에서 공개 회원가입을 비활성화하고, 관리자 사용자를 직접 생성합니다.
3. 생성된 사용자의 UUID를 확인한 뒤 SQL Editor에서 등록합니다.

   ```sql
   insert into public.admin_users (user_id)
   values ('관리자-사용자-UUID');
   ```

4. 프로젝트의 Project URL과 공개용 anon/publishable key를 [`public/config.js`](./public/config.js)에 입력합니다.

   ```js
   window.APP_CONFIG = {
     supabaseUrl: "https://프로젝트참조.supabase.co",
     supabaseAnonKey: "공개용-키"
   };
   ```

   이 공개용 키는 브라우저에 노출되는 값입니다. `service_role` 키는 절대 여기에 넣지 마세요. 데이터베이스 RLS 정책은 관리자만 상품을 쓰거나 삭제하도록 제한합니다.

5. Supabase CLI를 설치하고 프로젝트 루트에서 프로젝트를 연결한 뒤 Edge Function을 배포합니다.

   ```text
   supabase login
   supabase link --project-ref 프로젝트참조
   supabase functions deploy products
   ```

## 2. GitHub Pages 배포

1. 변경 사항을 GitHub 저장소의 `main` 또는 `master` 브랜치에 올립니다.
2. 저장소 Settings → Pages에서 Build and deployment의 Source를 **GitHub Actions**로 설정합니다.
3. `Publish GitHub Pages` 작업이 완료되면 저장소의 Pages URL에서 사용할 수 있습니다. 관리자 페이지 주소는 사이트 URL 뒤에 `admin/`을 붙입니다.

상품 선택은 Supabase에 저장되므로 방문자 모두에게 공유됩니다. 사용자 화면은 1분마다 목록을 새로 확인하며, 관리자 로그인은 Supabase Auth 계정을 사용합니다.

## 로컬 실행

Node.js 24 이상에서 `public/config.js`를 설정한 뒤:

```text
npm start
```

그다음 `http://localhost:3000`을 엽니다.
로컬은 `/api/products`에서 현재 Edge Function 소스를 직접 실행하므로 함수 재배포 없이 수집기 변경이 적용됩니다.
수집기 소스를 수정하면 Node 서버를 다시 시작하세요. GitHub Pages에서는 배포된 Edge Function을 사용합니다.
