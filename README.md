# 치바쿠지 입고 상품 안내

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

`public/config.js` 설정과 Edge Function 배포를 마친 뒤:

```text
npm start
```

그다음 `http://localhost:3000`을 엽니다.
