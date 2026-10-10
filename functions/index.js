// Firebase Functions 진입점 — Hosting rewrite(/api/pay/**)로 들어온 결제 API를 처리한다.
// 결제 로직은 Cloudflare Worker 와 같은 코드(shared/ = build_fb.mjs 가 lib·worker/pay 에서 복사)를 쓴다.
// 그 코드는 Web 표준 Request/Response 를 받으므로 여기서 Express 요청을 변환만 한다.
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as create from './shared/worker/pay/create.js';
import * as confirm from './shared/worker/pay/confirm.js';
import * as verify from './shared/worker/pay/verify.js';
import * as review from './shared/worker/pay/review.js';
import * as paCreate from './shared/worker/pay/payapp_create.js';
import * as paNotify from './shared/worker/pay/payapp_notify.js';
import * as paConfirm from './shared/worker/pay/payapp_confirm.js';
import * as bind from './shared/worker/pay/bind.js';

const TOSSPAY_API_KEY = defineSecret('TOSSPAY_API_KEY');
const PAY_TOKEN_SECRET = defineSecret('PAY_TOKEN_SECRET');
const PAYAPP_LINKKEY = defineSecret('PAYAPP_LINKKEY');   // 페이앱 연동KEY
const PAYAPP_LINKVAL = defineSecret('PAYAPP_LINKVAL');   // 페이앱 연동VALUE

const ROUTES = {
  '/api/pay/create': create, '/api/pay/confirm': confirm, '/api/pay/verify': verify, '/api/pay/review': review,
  '/api/pay/payapp-create': paCreate, '/api/pay/payapp-notify': paNotify, '/api/pay/payapp-confirm': paConfirm,
  '/api/pay/bind': bind,
};
// 페이앱 결제통보는 form 방식(application/x-www-form-urlencoded)으로 온다 — 본문을 그대로 넘긴다.
const RAW_BODY = new Set(['/api/pay/payapp-notify']);

// 결제 확인 후기 저장(Firestore reviews/{주문번호}). 주문당 1개 — 이미 있으면 'exists'.
// firebase-admin 은 후기 요청 때만 불러온다(결제 경로에 영향 없게).
let db = null;
async function fs() {
  if (!db) {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    if (!getApps().length) initializeApp();
    db = getFirestore('default'); // 콘솔에서 만든 DB ID가 '(default)'가 아니라 'default'
  }
  return db;
}
async function saveReview(orderNo, doc) {
  await fs();
  try { await db.collection('reviews').doc(orderNo).create(doc); return 'ok'; }
  catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)))) return 'exists'; throw e; }
}

// create 가 결제창 복귀 주소(retUrl)를 요청 도메인으로 만든다. 헤더는 위조될 수 있으므로 허용 목록만 쓴다.
const HOSTS = /^(www\.selfregi24\.com|[a-z0-9-]+\.(web\.app|firebaseapp\.com)|(localhost|127\.0\.0\.1)(:\d+)?)$/;

// 페이앱 주문 기록: Firestore payapp/{주문번호}. 결제통보가 상태를 바꾸고 confirm 이 읽는다.
const paStore = {
  async create(orderNo, doc) { await (await fs()).collection('payapp').doc(orderNo).create(doc); },
  async get(orderNo) { const s = await (await fs()).collection('payapp').doc(orderNo).get(); return s.exists ? s.data() : null; },
  async update(orderNo, patch) { await (await fs()).collection('payapp').doc(orderNo).set(patch, { merge: true }); },
};

// 부동산 확인: Firestore binds/{주문번호} = { u, a(HMAC 값), swaps, first, at } — 이용권을 처음 쓴 부동산에 묶는다.
const bindStore = {
  async get(orderNo) { const s = await (await fs()).collection('binds').doc(orderNo).get(); return s.exists ? s.data() : null; },
  async set(orderNo, patch) {
    const p = patch.first ? { ...patch, expireAt: new Date(patch.first + 90 * 86400 * 1000) } : patch; // 개인정보처리방침 제4조: 90일 이내 파기
    await (await fs()).collection('binds').doc(orderNo).set(p, { merge: true });
  },
};

function originOf(req) {
  const h = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  if (!HOSTS.test(h)) return 'https://www.selfregi24.com';
  return (/^(localhost|127\.)/.test(h) ? 'http://' : 'https://') + h;
}

export const pay = onRequest(
  { region: 'asia-northeast3', secrets: [TOSSPAY_API_KEY, PAY_TOKEN_SECRET, PAYAPP_LINKKEY, PAYAPP_LINKVAL], maxInstances: 5, memory: '256MiB', timeoutSeconds: 30 },
  async (req, res) => {
    const route = ROUTES[req.path];
    let out;
    if (!route) {
      out = new Response('Not Found', { status: 404 });
    } else if (req.method !== 'POST') {
      out = route.onRequest();
    } else {
      const env = {
        TOSSPAY_API_KEY: TOSSPAY_API_KEY.value(),
        PAY_TOKEN_SECRET: PAY_TOKEN_SECRET.value(),
        PAY_ALLOW_TEST: process.env.PAY_ALLOW_TEST,
        PAYAPP_LINKKEY: PAYAPP_LINKKEY.value(),
        PAYAPP_LINKVAL: PAYAPP_LINKVAL.value(),
        saveReview,
        paStore,
        bindStore,
      };
      const raw = RAW_BODY.has(req.path);
      const request = new Request(originOf(req) + req.path, {
        method: 'POST',
        headers: { 'Content-Type': raw ? String(req.get('content-type') || 'application/x-www-form-urlencoded') : 'application/json' },
        body: req.rawBody && req.rawBody.length ? req.rawBody : (raw ? '' : '{}'),
      });
      out = await route.onRequestPost({ request, env });
    }
    res.status(out.status);
    out.headers.forEach((v, k) => res.set(k, v));
    res.send(Buffer.from(await out.arrayBuffer()));
  }
);
