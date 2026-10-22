// 결제 흐름 로컬 시험 서버 — 정적 파일(D:\Selfregi) + /api/pay/* 를 운영 함수와 같은 worker 코드로 처리.
// 토스페이 테스트 키(sk_test_…, PAY_ALLOW_TEST=1) · 저장소는 메모리. 127.0.0.1에서만 연다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2] || 'D:\\Selfregi';
const PORT = +(process.argv[3] || 4610);
const W = (n) => import(pathToFileURL(path.join(ROOT, 'functions/shared/worker/pay', n + '.js')).href);
const ROUTES = {
  '/api/pay/create': 'create', '/api/pay/confirm': 'confirm', '/api/pay/verify': 'verify', '/api/pay/review': 'review',
  '/api/pay/payapp-create': 'payapp_create', '/api/pay/payapp-notify': 'payapp_notify', '/api/pay/payapp-confirm': 'payapp_confirm',
  '/api/pay/bind': 'bind',
};
const mem = { payapp: {}, binds: {}, reviews: {} };
const merge = (o, k, p) => { o[k] = { ...(o[k] || {}), ...p }; };
const env = {
  TOSSPAY_API_KEY: process.env.TOSSPAY_API_KEY,
  PAY_TOKEN_SECRET: process.env.PAY_TOKEN_SECRET,
  PAY_ALLOW_TEST: '1',
  PAYAPP_LINKKEY: process.env.PAYAPP_LINKKEY || 'local-linkkey',
  PAYAPP_LINKVAL: process.env.PAYAPP_LINKVAL || 'local-linkval',
  saveReview: async (o, d) => { if (mem.reviews[o]) return 'exists'; mem.reviews[o] = d; console.log('[review]', o, d.rating); return 'ok'; },
  paStore: {
    async create(o, d) { if (mem.payapp[o]) throw new Error('exists'); mem.payapp[o] = d; },
    async get(o) { return mem.payapp[o] || null; },
    async update(o, p) { merge(mem.payapp, o, p); },
  },
  bindStore: new Proxy({ async get(o) { return mem.binds[o] || null; } }, {
    get(t, k) { return k in t ? t[k] : async (o, p) => merge(mem.binds, o, p); }, // get 외 쓰기 메서드는 이름과 상관없이 병합 저장
  }),
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:' + PORT);
  try {
    if (ROUTES[u.pathname]) {
      const mod = await W(ROUTES[u.pathname]);
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const out = req.method === 'POST'
        ? await mod.onRequestPost({ request: new Request('http://127.0.0.1:' + PORT + u.pathname, { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] || 'application/json' }, body: body.length ? body : '{}' }), env })
        : mod.onRequest();
      const txt = await out.text();
      console.log('[api]', u.pathname, out.status, txt.slice(0, 160));
      res.writeHead(out.status, Object.fromEntries(out.headers)); res.end(txt); return;
    }
    if (u.pathname === '/__mem') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(mem)); return; }
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!path.resolve(f).startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); res.writeHead(500); res.end(String(e && e.message || e)); }
}).listen(PORT, '127.0.0.1', () => console.log('paydev on http://127.0.0.1:' + PORT));
