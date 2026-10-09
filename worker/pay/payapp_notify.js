// POST /api/pay/payapp-notify — 페이앱 결제통보(feedbackurl). 페이앱 서버가 form 방식으로 보낸다.
// 응답 규칙(문서): HTTP 200 + 본문 정확히 'SUCCESS'. 그 밖의 응답은 실패로 보고 재전송(checkretry=y, 최대 10회).
// JS 결제창은 pay_state=1(요청) 통보에도 SUCCESS 를 받아야 결제가 진행된다.
// 검증: 판매자 아이디 · 연동KEY · 연동VALUE · 금액 · 우리가 만든 주문번호(var1). 하나라도 틀리면 기록하지 않는다.
// 같은 통보가 여러 번 와도 결과가 같다(이미 결제완료면 그대로 둔다).
import { PRICE, ORDER_RE, PAYAPP_USERID, PA_PAID, PA_CANCEL, payappKeys, sameStr } from '../../lib/paycore.js';

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const keys = payappKeys(env);
  if (!keys || !env.paStore) return text(503, 'NOT_READY');

  let f;
  try { f = new URLSearchParams(await request.text()); } catch (e) { return text(400, 'BAD_BODY'); }
  const g = (k) => String(f.get(k) || '').trim();

  // form 해석에서 '+'가 공백으로 바뀌는 경우(인코딩하지 않고 보낸 값)도 같은 값으로 본다.
  const same = (got, want) => sameStr(got, want) || sameStr(got.replace(/ /g, '+'), want);
  const uidOk = g('userid') === PAYAPP_USERID, keyOk = same(g('linkkey'), keys.linkkey), valOk = same(g('linkval'), keys.linkval);
  if (!uidOk || !keyOk || !valOk) {
    // 값은 남기지 않는다 — 어느 항목이 틀렸는지와 길이만 기록한다.
    console.error('payapp notify auth fail', JSON.stringify({ order: g('var1'), uidOk, keyOk, valOk,
      keyLen: g('linkkey').length, keyWant: keys.linkkey.length, valLen: g('linkval').length, valWant: keys.linkval.length }));
    return text(403, 'AUTH_FAIL');
  }
  const orderNo = g('var1'), state = g('pay_state');
  if (!ORDER_RE.test(orderNo)) return text(400, 'BAD_ORDER');
  if (Number(g('price')) !== PRICE) {
    console.error('payapp notify price mismatch', orderNo, g('price'));
    return text(409, 'BAD_PRICE');
  }

  try {
    const doc = await env.paStore.get(orderNo);
    if (!doc) { console.error('payapp notify unknown order', orderNo); return text(404, 'NO_ORDER'); }
    const base = { mul_no: g('mul_no'), pay_type: g('pay_type'), pay_state: state, at: Date.now() };
    if (state === PA_PAID) {
      if (doc.st !== 'paid') await env.paStore.update(orderNo, { ...base, st: 'paid', paidAt: Date.now(), pay_date: g('pay_date') });
    } else if (PA_CANCEL.includes(state)) {
      await env.paStore.update(orderNo, { ...base, st: 'cancel', canceldate: g('canceldate') });
    } else if (doc.st !== 'paid') {
      await env.paStore.update(orderNo, { ...base, st: state === '1' ? 'requested' : 'state' + state });
    }
  } catch (e) {
    console.error('payapp notify store fail', orderNo, e && e.message);
    return text(500, 'STORE_FAIL'); // 실패 응답 → 페이앱이 다시 보낸다
  }
  return text(200, 'SUCCESS');
}

export function onRequest() {
  return text(405, 'POST only');
}
