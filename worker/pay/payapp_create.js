// POST /api/pay/payapp-create — 페이앱(네이버페이·카카오페이) 결제 건을 만든다.
// 주문번호를 서버가 정해 저장소에 남기고, 브라우저는 그 번호(var1)로 페이앱 결제창을 연다.
// 금액은 서버 값만 쓴다. 결제 확인은 페이앱 결제통보(payapp_notify)가 저장소에 남긴 기록으로만 한다.
import { PRICE, PRODUCT, PAYAPP_USERID, PAYAPP_SHOP, PAYAPP_TYPES, json, secret, payappKeys, makeOrderNo } from '../../lib/paycore.js';

export async function onRequestPost({ request, env }) {
  if (!secret(env) || !payappKeys(env) || !env.paStore) return json(503, { ok: false, msg: '결제 설정이 아직 완료되지 않았습니다.' });

  const origin = new URL(request.url).origin;
  const orderNo = makeOrderNo();
  try {
    await env.paStore.create(orderNo, { st: 'created', price: PRICE, at: Date.now() });
  } catch (e) {
    console.error('payapp create store fail', e && e.message);
    return json(502, { ok: false, msg: '결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  return json(200, {
    ok: true,
    orderNo,
    amount: PRICE,
    param: {
      userid: PAYAPP_USERID,
      shopname: PAYAPP_SHOP,
      goodname: PRODUCT,
      price: String(PRICE),
      openpaytype: PAYAPP_TYPES,
      var1: orderNo,
      feedbackurl: origin + '/api/pay/payapp-notify',
      returnurl: origin + '/pay_return.html?pa=1&orderNo=' + orderNo,
      checkretry: 'y',
      smsuse: 'n',
      skip_cstpage: 'y',
    },
  });
}

export function onRequest() {
  return json(405, { ok: false, msg: 'POST only' });
}
