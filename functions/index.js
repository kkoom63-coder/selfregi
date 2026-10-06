// Firebase Functions 진입점 — Hosting rewrite(/api/pay/**)로 들어온 결제 API를 처리한다.
// 결제 로직은 Cloudflare Worker 와 같은 코드(shared/ = build_fb.mjs 가 lib·worker/pay 에서 복사)를 쓴다.
// 그 코드는 Web 표준 Request/Response 를 받으므로 여기서 Express 요청을 변환만 한다.
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as create from './shared/worker/pay/create.js';
import * as confirm from './shared/worker/pay/confirm.js';
import * as verify from './shared/worker/pay/verify.js';
import * as review from './shared/worker/pay/review.js';

const TOSSPAY_API_KEY = defineSecret('TOSSPAY_API_KEY');
const PAY_TOKEN_SECRET = defineSecret('PAY_TOKEN_SECRET');

const ROUTES = { '/api/pay/create': create, '/api/pay/confirm': confirm, '/api/pay/verify': verify, '/api/pay/review': review };

// 결제 확인 후기 저장(Firestore reviews/{주문번호}). 주문당 1개 — 이미 있으면 'exists'.
// firebase-admin 은 후기 요청 때만 불러온다(결제 경로에 영향 없게).
let db = null;
async function saveReview(orderNo, doc) {
  if (!db) {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    if (!getApps().length) initializeApp();
    db = getFirestore();
  }
  try { await db.collection('reviews').doc(orderNo).create(doc); return 'ok'; }
  catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS/.test(String(e.message)))) return 'exists'; throw e; }
}

// create 가 결제창 복귀 주소(retUrl)를 요청 도메인으로 만든다. 헤더는 위조될 수 있으므로 허용 목록만 쓴다.
const HOSTS = /^(www\.selfregi24\.com|[a-z0-9-]+\.(web\.app|firebaseapp\.com)|(localhost|127\.0\.0\.1)(:\d+)?)$/;

function originOf(req) {
  const h = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  if (!HOSTS.test(h)) return 'https://www.selfregi24.com';
  return (/^(localhost|127\.)/.test(h) ? 'http://' : 'https://') + h;
}

export const pay = onRequest(
  { region: 'asia-northeast3', secrets: [TOSSPAY_API_KEY, PAY_TOKEN_SECRET], maxInstances: 5, memory: '256MiB', timeoutSeconds: 30 },
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
        saveReview,
      };
      const request = new Request(originOf(req) + req.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: req.rawBody && req.rawBody.length ? req.rawBody : '{}',
      });
      out = await route.onRequestPost({ request, env });
    }
    res.status(out.status);
    out.headers.forEach((v, k) => res.set(k, v));
    res.send(Buffer.from(await out.arrayBuffer()));
  }
);
