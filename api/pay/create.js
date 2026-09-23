// POST /api/pay/create — 결제 건을 만들고 토스페이 결제창 URL을 돌려준다.
// autoExecute:false — 구매자 인증 후 /api/pay/confirm 에서 가맹점이 직접 승인한다.
// (콜백 수신·저장소가 필요 없는 구조. 정적 사이트 + 서버리스 함수만으로 완결된다)
const { PRICE, PRODUCT, json, apiKey, tossPost, makeOrderNo, secret } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { ok: false, msg: 'POST only' });
  const key = apiKey();
  if (!key || !secret()) return json(res, 503, { ok: false, msg: '결제 설정이 아직 완료되지 않았습니다.' });

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = 'https://' + host;
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
    return json(res, 502, { ok: false, msg: '결제 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  if (!r || r.code !== 0 || !r.checkoutPage) {
    console.error('toss create fail', r && r.code, r && (r.errorCode || r.msg));
    return json(res, 502, { ok: false, msg: '결제를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  return json(res, 200, { ok: true, orderNo, checkoutPage: r.checkoutPage, amount: PRICE });
};
