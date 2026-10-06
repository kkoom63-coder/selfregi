// POST /api/pay/review { token, rating, result, slow, text, publish, from } — 결제 확인 후기를 받는다.
// 이용권(결제 토큰)으로 결제를 확인하고 주문 1건당 1개만 받는다. 저장은 호출하는 쪽이 env.saveReview 로 넘긴다
// (Firebase: Firestore). 이름·연락처는 받지 않는다. 본문 속 전화번호·주민번호·이메일·동호수는 저장 전에 가린다.
import { json, secret, verifyPass, readJson } from '../../lib/paycore.js';

const RESULTS = ['', 'done', 'fix', 'pending'];             // (선택) 접수 완료 · 보정명령 받음 · 아직 접수 전 — 현재 화면은 받지 않음
const SLOWS = ['', 'docs', 'tax', 'bond', 'form', 'visit', 'none']; // 가장 오래 걸린 단계(선택)
const FROMS = ['form', 'roadmap', 'visit', 'reissue'];

export function maskText(s) {
  return String(s || '')
    .replace(/\d{6}\s*-?\s*[1-4]\d{6}/g, '******-*******')                 // 주민등록번호
    .replace(/0\d{1,2}\s*-?\s*\d{3,4}\s*-?\s*\d{4}/g, '***-****-****')       // 전화번호
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '(이메일)')                         // 이메일
    .replace(/제?\s*\d{1,4}\s*동\s*제?\s*\d{1,5}\s*호/g, '○동 ○호')           // 동·호수
    .replace(/\s+/g, ' ').trim();
}

export async function onRequestPost({ request, env }) {
  if (!secret(env) || typeof env.saveReview !== 'function') return json(503, { ok: false, msg: '후기 접수가 아직 준비되지 않았습니다.' });
  const b = await readJson(request);
  const p = await verifyPass(env, b.token);
  if (!p) return json(400, { ok: false, msg: '결제 확인이 되지 않았습니다. 재발급 링크로 다시 들어와 주세요.' });

  const rating = Math.round(+b.rating);
  const result = String(b.result || '');
  const slow = String(b.slow || '');
  const text = maskText(b.text).slice(0, 300);
  if (!(rating >= 1 && rating <= 5)) return json(400, { ok: false, msg: '만족도를 골라 주세요.' });
  if (!RESULTS.includes(result)) return json(400, { ok: false, msg: '등기 결과 값이 올바르지 않습니다.' });
  if (!SLOWS.includes(slow)) return json(400, { ok: false, msg: '단계 값이 올바르지 않습니다.' });
  if (text.length < 5) return json(400, { ok: false, msg: '한 줄 후기를 5자 이상 적어 주세요.' });

  const now = new Date(Date.now() + 9 * 3600e3); // KST
  const doc = {
    orderNo: p.o, rating, result, slow, text,
    publish: b.publish === true,
    from: FROMS.includes(b.from) ? b.from : 'form',
    month: now.toISOString().slice(0, 7).replace('-', '.'),
    status: 'new', // 공개 전 확인(욕설·개인정보만 비공개)
    createdAt: Date.now(),
  };
  try {
    const r = await env.saveReview(p.o, doc);
    if (r === 'exists') return json(409, { ok: false, msg: '이 결제로는 이미 후기를 남기셨습니다. 감사합니다.' });
  } catch (e) {
    return json(500, { ok: false, msg: '후기를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
  return json(200, { ok: true });
}

export function onRequest() {
  return json(405, { ok: false, msg: 'POST only' });
}
