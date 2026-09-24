// POST /api/pay/confirm { orderNo } — 구매자 인증이 끝난 결제를 승인하고 이용권을 발급한다.
// retUrl 파라미터만 믿지 않는다(토스 문서 권고). 상태 API로 금액·상태를 서버가 직접 확인한다.
// 같은 주문으로 여러 번 호출돼도 안전하다: 이미 완료된 건은 승인 없이 이용권만 다시 발급한다.
import { PRICE, ORDER_RE, DONE, json, apiKey, secret, tossPost, signPass, modeAllowed, readJson } from '../../lib/paycore.js';

export async function onRequestPost({ request, env }) {
  const key = apiKey(env);
  if (!key || !secret(env)) return json(503, { ok: false, msg: '결제 설정이 아직 완료되지 않았습니다.' });

  const { orderNo } = await readJson(request);
  if (!ORDER_RE.test(orderNo || '')) return json(400, { ok: false, msg: '주문번호가 올바르지 않습니다.' });

  try {
    let st = await tossPost('/api/v2/status', { apiKey: key, orderNo });
    if (!st || st.code !== 0) return json(404, { ok: false, msg: '결제 내역을 찾지 못했습니다.' });
    if (st.amount !== PRICE) return json(409, { ok: false, msg: '결제 금액이 일치하지 않습니다.' });
    if (!modeAllowed(env, st.mode)) return json(403, { ok: false, msg: '테스트 결제는 이용권이 발급되지 않습니다.' });

    if (st.payStatus === 'PAY_APPROVED') {
      const ex = await tossPost('/api/v2/execute', { apiKey: key, payToken: st.payToken, orderNo });
      if (!ex || ex.code !== 0) {
        // 응답 유실·중복 승인 대비: 상태를 다시 본다.
        st = await tossPost('/api/v2/status', { apiKey: key, orderNo });
        if (!st || st.code !== 0 || !DONE.includes(st.payStatus)) {
          console.error('toss execute fail', orderNo, ex && (ex.errorCode || ex.msg));
          return json(402, { ok: false, msg: (ex && ex.msg) || '결제 승인에 실패했습니다.' });
        }
      }
    } else if (!DONE.includes(st.payStatus)) {
      const m = st.payStatus === 'PAY_CANCEL' ? '결제가 취소되었습니다.'
        : /REFUND/.test(st.payStatus || '') ? '환불된 결제입니다.'
        : '결제가 아직 완료되지 않았습니다.';
      return json(409, { ok: false, msg: m, payStatus: st.payStatus });
    }

    const pass = await signPass(env, orderNo, Date.now());
    return json(200, { ok: true, orderNo, token: pass.token, exp: pass.exp, amount: PRICE });
  } catch (e) {
    console.error('confirm error', orderNo, e && e.message);
    return json(502, { ok: false, msg: '결제 확인 중 오류가 발생했습니다. 이 화면을 새로고침해 주세요.' });
  }
}

export function onRequest() {
  return json(405, { ok: false, msg: 'POST only' });
}
