// Cloudflare Workers 진입점 — /api/pay/* 만 처리하고 나머지는 정적 파일(dist)을 그대로 서빙한다.
// Pages 대신 Workers를 쓰는 이유: Pages는 /page.html → /page 로 강제 308 이동시켜
// 검색엔진에 색인된 .html 주소·canonical·sitemap 과 어긋난다. Workers 정적 자산은
// html_handling: "none" 으로 주소를 그대로 유지할 수 있다(wrangler.jsonc).
import * as create from './pay/create.js';
import * as confirm from './pay/confirm.js';
import * as verify from './pay/verify.js';

const ROUTES = { '/api/pay/create': create, '/api/pay/confirm': confirm, '/api/pay/verify': verify };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (route) {
      return request.method === 'POST' ? route.onRequestPost({ request, env }) : route.onRequest();
    }
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not Found', { status: 404 });
    }
    // html_handling:none 에서는 / 가 index.html 로 자동 연결되지 않는다.
    // 홈은 / 한 주소로만 둔다(Vercel 때와 같은 동작: /index.html → / 301).
    if (url.pathname === '/index.html') {
      return Response.redirect(url.origin + '/' + url.search, 301);
    }
    if (url.pathname === '/') {
      return env.ASSETS.fetch(new Request(url.origin + '/index.html', request));
    }
    return env.ASSETS.fetch(request);
  },
};
