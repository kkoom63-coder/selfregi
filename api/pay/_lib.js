// 토스페이 결제 공통 모듈 — 파일명이 _로 시작해 Vercel이 엔드포인트로 노출하지 않는다.
// 근거 문서: docs-pay.toss.im (결제 생성 /api/v2/payments · 승인 /api/v2/execute · 상태 /api/v2/status)
//
// 환경변수 (Vercel 프로젝트 설정에만 둔다. 코드·브라우저에 절대 넣지 않는다)
//   TOSSPAY_API_KEY   sk_test_… 또는 sk_live_…
//   PAY_TOKEN_SECRET  이용권 서명용 임의 문자열(32자 이상)
//   PAY_ALLOW_TEST    '1'이면 테스트 결제(mode TEST)로도 이용권을 발급한다. 운영에서는 두지 않는다.
const crypto = require('crypto');

const PRICE = 9900; // VAT 포함. 금액은 서버만 정한다 — 브라우저가 보낸 값은 쓰지 않는다.
const PRODUCT = '셀프등기24 서류 자동완성 (부동산 1건)';
const PASS_DAYS = 30; // 약관 제5조: 결제일부터 30일 재발급
const TOSS = 'https://pay.toss.im';
const ORDER_RE = /^SR\d{14}-[A-Z0-9]{6}$/;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function apiKey() {
  const k = process.env.TOSSPAY_API_KEY || '';
  return /^sk_(test|live)_/.test(k) ? k : null;
}

async function tossPost(path, body) {
  const r = await fetch(TOSS + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { return { code: -1, msg: 'invalid response', raw: text.slice(0, 200) }; }
}

function makeOrderNo() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const ts = d.toISOString().replace(/\D/g, '').slice(0, 14);
  const rand = crypto.randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').toUpperCase().padEnd(6, 'X').slice(0, 6);
  return 'SR' + ts + '-' + rand;
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function secret() {
  const s = process.env.PAY_TOKEN_SECRET || '';
  return s.length >= 32 ? s : null;
}

// 이용권: 결제 완료 주문번호에 서명한 값. DB 없이 주문번호·만료만 검증한다.
function signPass(orderNo, paidAtMs) {
  const payload = { o: orderNo, iat: paidAtMs, exp: paidAtMs + PASS_DAYS * 86400 * 1000 };
  const p = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac('sha256', secret()).update(p).digest());
  return { token: p + '.' + sig, exp: payload.exp };
}

function verifyPass(token) {
  if (typeof token !== 'string' || token.length > 400) return null;
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const want = b64u(crypto.createHmac('sha256', secret()).update(p).digest());
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(unb64u(p).toString('utf8')); } catch (e) { return null; }
  if (!payload || !ORDER_RE.test(payload.o) || !(payload.exp > Date.now())) return null;
  return payload;
}

function modeAllowed(mode) {
  return mode === 'LIVE' || (mode === 'TEST' && process.env.PAY_ALLOW_TEST === '1');
}

module.exports = { PRICE, PRODUCT, ORDER_RE, json, apiKey, tossPost, makeOrderNo, secret, signPass, verifyPass, modeAllowed };
