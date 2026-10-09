// POST /api/pay/payapp-confirm { orderNo } — 결제 완료 화면이 부른다.
// 페이앱 결제통보가 저장소에 「paid」로 남긴 주문에만 이용권을 발급한다(토스와 같은 이용권).
// 통보가 화면 복귀보다 늦게 올 수 있어, 아직이면 202(pending)를 돌려주고 화면이 다시 묻는다.
import { PRICE, ORDER_RE, json, secret, payappKeys, signPass, readJson } from '../../lib/paycore.js';

export async function onRequestPost({ request, env }) {
  if (!secret(env) || !payappKeys(env) || !env.paStore) return json(503, { ok: false, msg: '결제 설정이 아직 완료되지 않았습니다.' });

  const { orderNo } = await readJson(request);
  if (!ORDER_RE.test(orderNo || '')) return json(400, { ok: false, msg: '주문번호가 올바르지 않습니다.' });

  try {
    const doc = await env.paStore.get(orderNo);
    if (!doc) return json(404, { ok: false, msg: '결제 내역을 찾지 못했습니다.' });
    if (doc.st === 'cancel') return json(409, { ok: false, msg: '취소된 결제입니다.' });
    if (doc.st !== 'paid') return json(202, { ok: false, pending: true, msg: '결제 확인을 기다리는 중입니다.' });
    const pass = await signPass(env, orderNo, doc.paidAt || Date.now());
    return json(200, { ok: true, orderNo, token: pass.token, exp: pass.exp, amount: PRICE });
  } catch (e) {
    console.error('payapp confirm error', orderNo, e && e.message);
    return json(502, { ok: false, msg: '결제 확인 중 오류가 발생했습니다. 이 화면을 새로고침해 주세요.' });
  }
}

export function onRequest() {
  return json(405, { ok: false, msg: 'POST only' });
}
