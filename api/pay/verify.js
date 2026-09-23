// POST /api/pay/verify { token } — 재발급 링크(?pass=)로 들어온 이용권을 확인한다.
// 서명·만료를 본 뒤, 환불된 주문이면 거절한다.
const { json, apiKey, tossPost, secret, verifyPass } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { ok: false, msg: 'POST only' });
  const key = apiKey();
  if (!key || !secret()) return json(res, 503, { ok: false, msg: '결제 설정이 아직 완료되지 않았습니다.' });

  const p = verifyPass(req.body && req.body.token);
  if (!p) return json(res, 400, { ok: false, msg: '재발급 링크가 만료되었거나 올바르지 않습니다.' });

  try {
    const st = await tossPost('/api/v2/status', { apiKey: key, orderNo: p.o });
    if (st && st.code === 0 && /REFUND/.test(st.payStatus || '')) {
      return json(res, 410, { ok: false, msg: '환불된 결제의 재발급 링크입니다.' });
    }
  } catch (e) { /* 상태 조회 실패 시 서명만으로 통과 — 재발급을 막지 않는다 */ }

  return json(res, 200, { ok: true, orderNo: p.o, exp: p.exp });
};
