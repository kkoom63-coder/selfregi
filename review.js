/* review.js — 결제 확인 후기 카드 (2026-10-07)
   .rv-slot[data-from] 자리에 카드를 그린다. 결제 이용권(SRPay.pass)이 있을 때만 보이고,
   주문 1건당 한 번만 받는다(서버 /api/pay/review 가 확인). 이름·연락처는 받지 않는다. */
(function () {
  'use strict';
  var DONE_KEY = 'sr_review_done', LATER_KEY = 'sr_review_later';
  var SLOWS = [['docs', '서류 준비'], ['tax', '취득세 신고'], ['bond', '채권 매입'], ['form', '서류 작성'], ['visit', '등기소 접수'], ['none', '없음']];
  var RESULTS = [['done', '접수 완료'], ['fix', '보정명령 받음'], ['pending', '아직 접수 전']];

  function pass() { try { return window.SRPay && SRPay.pass(); } catch (e) { return null; } }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function trk(n, d) { try { window.SR && SR.track(n, d || {}); } catch (e) {} }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function chips(name, list, multi) {
    return list.map(function (x) {
      return '<button type="button" class="rv-chip" data-g="' + name + '" data-v="' + x[0] + '" aria-pressed="false">' + esc(x[1]) + '</button>';
    }).join('');
  }

  function thanks(slot, fix) {
    slot.innerHTML = '<div class="rv rv-done"><b>후기를 보내 주셔서 감사합니다.</b>'
      + (fix ? '<span>보정명령을 받으셨다면 <a href="guide.html">셀프등기 가이드</a>에서 자주 반려되는 항목을 확인해 보세요. 보정은 등기소에서 알려 준 서류만 고쳐 다시 내면 됩니다.</span>' : '<span>다음에 셀프등기를 할 분들께 큰 도움이 됩니다.</span>')
      + '</div>';
  }

  function render(slot) {
    var p = pass();
    if (!p) { slot.hidden = true; return; }
    slot.hidden = false;
    if (ls(DONE_KEY) === p.token.slice(0, 24)) { thanks(slot, false); return; }
    if (ss(LATER_KEY)) { slot.innerHTML = '<button type="button" class="rv-reopen">후기 남기기</button>'; slot.querySelector('.rv-reopen').onclick = function () { try { sessionStorage.removeItem(LATER_KEY); } catch (e) {} render(slot); }; return; }
    var from = slot.getAttribute('data-from') || 'form';
    var defResult = from === 'visit' ? 'done' : '';
    slot.innerHTML =
      '<form class="rv" novalidate>'
      + '<div class="rv-badge">결제 확인됨 · 소유권이전등기</div>'
      + '<div class="rv-h">셀프등기, 해 보시니 어떠셨나요?</div>'
      + '<p class="rv-s">다음에 셀프등기를 할 분들께 보여드립니다. 1분이면 됩니다.</p>'
      + '<div class="rv-q">만족도</div><div class="rv-stars" role="radiogroup" aria-label="만족도">'
      + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="rv-star" role="radio" aria-checked="false" aria-label="' + n + '점" data-n="' + n + '">★</button>'; }).join('')
      + '</div>'
      + '<div class="rv-q">등기 결과</div><div class="rv-chips">' + chips('result', RESULTS) + '</div>'
      + '<div class="rv-q">가장 오래 걸린 단계 <small>선택</small></div><div class="rv-chips">' + chips('slow', SLOWS) + '</div>'
      + '<label class="rv-q" for="rv-t-' + from + '">한 줄 후기</label>'
      + '<textarea id="rv-t-' + from + '" class="rv-t" maxlength="300" rows="2" placeholder="예: 등기부를 올리니 칸이 거의 다 채워져서 편했습니다"></textarea>'
      + '<label class="rv-pub"><input type="checkbox" class="rv-p" checked> <span>홈페이지에 공개해도 됩니다 <small>이름 없이 「이용자 · 작성 월」로 표시됩니다. 체크를 풀면 서비스 개선에만 씁니다.</small></span></label>'
      + '<div class="rv-msg" role="status" aria-live="polite"></div>'
      + '<div class="rv-a"><button type="submit" class="rv-send">후기 보내기</button><button type="button" class="rv-later">나중에</button></div>'
      + '</form>';
    var f = slot.querySelector('form'), st = { rating: 0, result: defResult, slow: '' };
    function paint() {
      f.querySelectorAll('.rv-star').forEach(function (b) { var on = +b.dataset.n <= st.rating; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(+b.dataset.n === st.rating)); });
      f.querySelectorAll('.rv-chip').forEach(function (b) { b.setAttribute('aria-pressed', String(st[b.dataset.g] === b.dataset.v)); });
    }
    paint();
    f.addEventListener('click', function (e) {
      var s = e.target.closest('.rv-star'); if (s) { st.rating = +s.dataset.n; paint(); return; }
      var c = e.target.closest('.rv-chip'); if (c) { var g = c.dataset.g; st[g] = (st[g] === c.dataset.v && g === 'slow') ? '' : c.dataset.v; paint(); return; }
      if (e.target.closest('.rv-later')) { ss(LATER_KEY, '1'); trk('review_later', { from: from }); render(slot); }
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.rv-msg'), text = f.querySelector('.rv-t').value.trim();
      var miss = !st.rating ? '만족도를 골라 주세요.' : (!st.result ? '등기 결과를 골라 주세요.' : (text.length < 5 ? '한 줄 후기를 5자 이상 적어 주세요.' : ''));
      if (miss) { msg.textContent = miss; msg.className = 'rv-msg err'; return; }
      var btn = f.querySelector('.rv-send'); btn.disabled = true; btn.textContent = '보내는 중…'; msg.textContent = '';
      fetch('/api/pay/review', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: p.token, rating: st.rating, result: st.result, slow: st.slow, text: text, publish: f.querySelector('.rv-p').checked, from: from }) })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }).then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (x) {
          if (x.j && x.j.ok || x.s === 409) {
            ls(DONE_KEY, p.token.slice(0, 24)); trk('review_submit', { from: from, key: String(st.rating), mode: st.result });
            document.querySelectorAll('.rv-slot').forEach(function (o) { thanks(o, st.result === 'fix'); });
            return;
          }
          msg.textContent = (x.j && x.j.msg) || '후기를 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; msg.className = 'rv-msg err';
          btn.disabled = false; btn.textContent = '후기 보내기';
        })
        .catch(function () { msg.textContent = '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'; msg.className = 'rv-msg err'; btn.disabled = false; btn.textContent = '후기 보내기'; });
    });
    trk('review_view', { from: from });
  }

  function boot() {
    document.querySelectorAll('.rv-slot').forEach(render);
    window.addEventListener('srpay:change', function () { document.querySelectorAll('.rv-slot').forEach(render); });
  }
  if (document.readyState !== 'loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();

/* 카드 스타일 — 페이지마다 따로 넣지 않도록 여기서 한 번 주입한다(디자인 토큰은 각 페이지 :root 값을 쓴다) */
(function () {
  if (document.getElementById('rv-css')) return;
  var css = ''
    + '.rv-slot[hidden]{display:none}'
    + '.rv{margin-top:12px;padding:16px;border:1px solid #BAE6FD;border-radius:12px;background:#F0F9FF;color:#0F172A;font-size:14px;line-height:1.6;text-align:left}'
    + '.rv-badge{display:inline-block;font-size:12px;font-weight:700;color:#047857;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:20px;padding:1px 10px}'
    + '.rv-h{font-size:16px;font-weight:800;margin-top:8px}'
    + '.rv-s{font-size:13px;color:#475569;margin:2px 0 4px}'
    + '.rv-q{display:block;font-size:13px;font-weight:700;margin:12px 0 6px}'
    + '.rv-q small{font-weight:500;color:#64748B;margin-left:4px}'
    + '.rv-stars{display:flex;gap:4px}'
    + '.rv-star{width:40px;height:40px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;font-size:20px;line-height:1;color:#CBD5E1;cursor:pointer}'
    + '.rv-star.on{color:#F59E0B;border-color:#FCD34D;background:#FFFBEB}'
    + '.rv-chips{display:flex;flex-wrap:wrap;gap:6px}'
    + '.rv-chip{min-height:36px;padding:0 12px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;font-family:inherit;font-size:13px;font-weight:600;color:#334155;cursor:pointer}'
    + '.rv-chip[aria-pressed="true"]{background:#0369A1;border-color:#0369A1;color:#fff}'
    + '.rv-t{display:block;width:100%;box-sizing:border-box;min-height:64px;padding:10px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:inherit;font-size:15px;line-height:1.55;resize:vertical;background:#fff}'
    + '.rv-t:focus{outline:2px solid #0369A1;outline-offset:1px}'
    + '.rv-pub{display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:13px;font-weight:600;cursor:pointer}'
    + '.rv-pub input{width:18px;height:18px;margin-top:2px;flex-shrink:0;accent-color:#0369A1}'
    + '.rv-pub small{display:block;font-weight:500;color:#475569;font-size:12.5px}'
    + '.rv-msg{min-height:0;font-size:13px;margin-top:8px}.rv-msg.err{color:#B91C1C;font-weight:600}'
    + '.rv-a{display:flex;align-items:center;gap:8px;margin-top:10px}'
    + '.rv-send{min-height:44px;padding:0 20px;border:0;border-radius:10px;background:#0F172A;color:#fff;font-family:inherit;font-size:14px;font-weight:800;cursor:pointer}'
    + '.rv-send:disabled{opacity:.6;cursor:default}'
    + '.rv-later,.rv-reopen{min-height:44px;padding:0 14px;border:1px solid #E2E8F0;border-radius:10px;background:#fff;font-family:inherit;font-size:13px;font-weight:700;color:#475569;cursor:pointer}'
    + '.rv-reopen{margin-top:12px}'
    + '.rv-done b{display:block;font-size:15px}.rv-done span{display:block;font-size:13px;color:#334155;margin-top:2px}.rv-done a{color:#0369A1;font-weight:700}'
    + '.rv :focus-visible{outline:2px solid #0369A1;outline-offset:2px}';
  var st = document.createElement('style'); st.id = 'rv-css'; st.textContent = css; document.head.appendChild(st);
})();
