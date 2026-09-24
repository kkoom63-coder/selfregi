// POST /api/pay/create — 결제 건을 만들고 토스페이 결제창 URL을 돌려준다.
// autoExecute:false — 구매자 인증 후 /api/pay/confirm 에서 가맹점이 직접 승인한다(콜백·저장소 불필요).
import { PRICE, PRODUCT, json, apiKey, secret, tossPost, makeOrderNo } from '../../lib/paycore.js';

export async function onRequestPost({ request, env }) {
  const key = apiKey(env);
  if (!key || !secret(env)) return json(503, { ok: false, msg: '결제 설정이 아직 완료되지 않았습니다.' });

  const origin = new URL(request.url).origin;
  const orderNo = makeOrderNo();

  let r;
  try {
    r = await tossPost('/api/v2/payments', {
      orderNo,
      amount: PRICE,
      amountTaxFree: 0,
      productDesc: PRODUCT,
      apiKey: key,
      autoExecute: false,
      retUrl: origin + '/pay_return.html',
      retCancelUrl: origin + '/pay_return.html?cancel=1',
      cashReceipt: true,
    });
  } catch (e) {
    return json(502, { ok: false, msg: '결제 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (!r || r.code !== 0 || !r.checkoutPage) {
    console.error('toss create fail', r && r.code, r && (r.errorCode || r.msg));
    return json(502, { ok: false, msg: '결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  return json(200, { ok: true, orderNo, checkoutPage: r.checkoutPage, amount: PRICE });
}

export function onRequest() {
  return json(405, { ok: false, msg: 'POST only' });
}
