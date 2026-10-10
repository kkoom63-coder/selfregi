// 토스페이 결제 공통 로직 — Cloudflare Pages Functions용 (Web 표준 API만 사용).
// functions/api/pay/*.js 가 import 한다. 배포 산출물(dist)에는 포함하지 않는다(build_cf.sh).
// 근거 문서: docs-pay.toss.im (결제 생성 /api/v2/payments · 승인 /api/v2/execute · 상태 /api/v2/status)
//
// 환경변수 (Cloudflare Pages → Settings → Variables and Secrets. 코드·브라우저에 절대 넣지 않는다)
//   TOSSPAY_API_KEY   sk_test_… 또는 sk_live_…
//   PAY_TOKEN_SECRET  이용권 서명용 임의 문자열(32자 이상)
//   PAY_ALLOW_TEST    '1'이면 테스트 결제(mode TEST)로도 이용권을 발급한다. 운영에서는 두지 않는다.

export const PRICE = 9900; // VAT 포함. 금액은 서버만 정한다.
export const PRODUCT = '셀프등기24 서류 자동완성 (부동산 1건)';
const PASS_DAYS = 30; // 약관 제5조: 결제일부터 30일 재발급
const TOSS = 'https://pay.toss.im';
export const ORDER_RE = /^SR\d{14}-[A-Z0-9]{6}$/;
export const DONE = ['PAY_COMPLETE', 'SETTLEMENT_COMPLETE'];

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function apiKey(env) {
  const k = (env && env.TOSSPAY_API_KEY) || '';
  return /^sk_(test|live)_/.test(k) ? k : null;
}

export function secret(env) {
  const s = (env && env.PAY_TOKEN_SECRET) || '';
  return s.length >= 32 ? s : null;
}

export function modeAllowed(env, mode) {
  return mode === 'LIVE' || (mode === 'TEST' && env && env.PAY_ALLOW_TEST === '1');
}

export async function readJson(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

export async function tossPost(path, body) {
  const r = await fetch(TOSS + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { return { code: -1, msg: 'invalid response' }; }
}

export function makeOrderNo() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // KST
  const ts = d.toISOString().replace(/\D/g, '').slice(0, 14);
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (const b of rnd) s += A[b % A.length];
  return 'SR' + ts + '-' + s;
}

const enc = new TextEncoder();
function b64u(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

// 부동산 확인(bind)용: 브라우저가 보낸 SHA-256 값을 비밀키로 한 번 더 HMAC 해 저장한다(원문 복원 불가).
export async function hmacHex(env, data) {
  return Array.from(await hmac(secret(env), data), (b) => b.toString(16).padStart(2, '0')).join('');
}

// 이용권: 결제 완료 주문번호에 서명한 값. DB 없이 주문번호·만료만 검증한다.
export async function signPass(env, orderNo, paidAtMs) {
  const payload = { o: orderNo, iat: paidAtMs, exp: paidAtMs + PASS_DAYS * 86400 * 1000 };
  const p = b64u(enc.encode(JSON.stringify(payload)));
  const sig = b64u(await hmac(secret(env), p));
  return { token: p + '.' + sig, exp: payload.exp };
}

export async function verifyPass(env, token) {
  if (typeof token !== 'string' || token.length > 400) return null;
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  const want = b64u(await hmac(secret(env), p));
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(unb64u(p))); } catch (e) { return null; }
  if (!payload || !ORDER_RE.test(payload.o) || !(payload.exp > Date.now())) return null;
  return payload;
}

// ── 페이앱(네이버페이·카카오페이) — 2026-10-10 ──────────────────────────────
// 근거 문서: docs.payapp.kr/dev_center01.html (JS 결제창 · 결제통보 feedbackurl)
// 페이앱에는 결제 조회 API가 없다 → 결제통보(notify)가 유일한 결제 증거다.
// 통보 내용은 env.paStore(Firestore payapp/{주문번호})에 저장하고, confirm 이 그 기록으로 이용권을 발급한다.
// 환경변수(비밀값): PAYAPP_LINKKEY · PAYAPP_LINKVAL — 페이앱 판매자 관리자의 연동KEY·연동VALUE.
export const PAYAPP_USERID = 'kkoom63';          // 판매자 아이디(결제창에 노출되는 공개값)
export const PAYAPP_SHOP = '셀프등기24';
export const PAYAPP_TYPES = 'naverpay,kakaopay';  // 결제창에 보일 수단(판매자 설정이 우선)
export const PA_PAID = '4';                        // pay_state 4 = 결제완료
export const PA_CANCEL = ['8', '9', '16', '31', '32', '64', '70', '71']; // 요청취소·승인취소·부분취소(문서 표·예제 코드 값 합집합)

export function payappKeys(env) {
  // 비밀값 끝에 붙여넣기 줄바꿈·공백이 들어가는 경우가 있어 양끝을 다듬는다(2026-10-10 실결제 테스트에서 인증 실패).
  // 보이지 않는 입력칸에 두 번 붙여넣어 같은 값이 두 번 이어진 경우(2026-10-10 실제 발생)는 한 번으로 본다.
  const once = (x) => { const h = x.length / 2; return x.length >= 8 && x.length % 2 === 0 && x.slice(0, h) === x.slice(h) ? x.slice(0, h) : x; };
  const k = once(String((env && env.PAYAPP_LINKKEY) || '').trim()), v = once(String((env && env.PAYAPP_LINKVAL) || '').trim());
  return k && v ? { linkkey: k, linkval: v } : null;
}

// 길이가 같을 때만 비교하고, 문자마다 XOR — 응답 시간으로 키를 추측하지 못하게.
export function sameStr(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
