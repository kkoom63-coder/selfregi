// POST /api/pay/bind { token, u, a } — 이용권을 처음 서류를 받은 부동산에 묶는다(약관 「동일 부동산」 재발급).
// u = 부동산 고유번호, a = 소재지번. 브라우저가 표기를 정리해 SHA-256 한 값만 보낸다(원문은 받지 않는다).
// 서버는 비밀키로 한 번 더 HMAC 해 저장한다 — 저장값만으로는 원래 번호·주소를 알 수 없다.
// 동·호, 매수인 이름은 비교하지 않는다(판독·오타로 자주 바뀌고, 같은 집이면 악용 이득이 없다).
//
// 규칙 (2026-10-10 사용자 결정)
//   · 빈 값은 비교하지 않는다 — 빈 양식으로 받았다가 나중에 채우는 것은 항상 허용
//   · 고유번호·소재지번 중 하나만 바뀌면 허용(판독 오류·오타 정정). 저장값은 처음 값 유지 — 하나씩 바꿔 옮겨 가기 방지
//   · 둘 다 바뀌면 「다른 부동산」 — 1회만 허용(처음에 다른 등기부를 잘못 올린 경우), 그 뒤로 거절
import { json, secret, verifyPass, readJson, hmacHex } from '../../lib/paycore.js';

const HEX = /^[0-9a-f]{64}$/;
const SWAP_LIMIT = 1;

export async function onRequestPost({ request, env }) {
  if (!secret(env) || !env.bindStore) return json(503, { ok: false, msg: '확인 설정이 아직 완료되지 않았습니다.' });

  const b = await readJson(request);
  const p = await verifyPass(env, b.token);
  if (!p) return json(400, { ok: false, msg: '이용권이 만료되었거나 올바르지 않습니다.' });

  const u = HEX.test(String(b.u || '')) ? await hmacHex(env, 'u:' + b.u) : '';
  const a = HEX.test(String(b.a || '')) ? await hmacHex(env, 'a:' + b.a) : '';
  if (!u && !a) return json(200, { ok: true, bound: false });

  let doc;
  try { doc = await env.bindStore.get(p.o); } catch (e) {
    console.error('bind store read fail', p.o, e && e.message);
    return json(200, { ok: true, bound: false }); // 저장소 장애로 결제한 이용자를 막지 않는다
  }
  const now = Date.now();
  try {
    if (!doc) {
      await env.bindStore.set(p.o, { u, a, swaps: 0, first: now, at: now });
      return json(200, { ok: true, bound: true });
    }
    const uDiff = !!(u && doc.u && u !== doc.u);
    const aDiff = !!(a && doc.a && a !== doc.a);
    if (uDiff && aDiff) {
      const swaps = Number(doc.swaps || 0);
      if (swaps >= SWAP_LIMIT) {
        console.warn('bind other property', p.o);
        return json(403, { ok: false, code: 'OTHER_PROPERTY',
          msg: '이 결제는 처음 서류를 받은 부동산용입니다. 다른 부동산은 새로 결제해 주세요. 정정이 필요하면 주문번호와 함께 selfregi999@gmail.com으로 문의해 주세요.' });
      }
      await env.bindStore.set(p.o, { u, a, swaps: swaps + 1, at: now });
      return json(200, { ok: true, bound: true, swapped: true });
    }
    // 하나만 바뀐 경우 저장값은 그대로 둔다(비어 있던 칸만 채운다).
    // 갱신하면 고유번호 → 주소 순으로 하나씩 바꿔 다른 집으로 옮겨 가는 길이 열린다.
    const patch = { at: now };
    if (u && !doc.u) patch.u = u;
    if (a && !doc.a) patch.a = a;
    await env.bindStore.set(p.o, patch);
    return json(200, { ok: true, bound: true });
  } catch (e) {
    console.error('bind store write fail', p.o, e && e.message);
    return json(200, { ok: true, bound: false });
  }
}

export function onRequest() {
  return json(405, { ok: false, msg: 'POST only' });
}
