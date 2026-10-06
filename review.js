/* review.js — 결제 확인 후기 팝업 (2026-10-07)
   로드맵에서 신청서를 내려받은 직후에만 연다(SRReview.afterDownload). 결제 이용권(SRPay.pass)이 있어야 하고,
   주문 1건당 한 번만 받는다(서버 /api/pay/review). 항목은 만족도 · 한 줄 후기 · 공개 동의뿐. 이름·연락처는 받지 않는다.
   「나중에」로 닫으면 다운로드 자리(.rv-slot)에 「후기 남기기」 버튼만 남긴다. */
(function () {
  'use strict';
  var DONE_KEY = 'sr_review_done', SEEN_KEY = 'sr_review_seen';
  /* 서버 준비(Firestore 생성 + 결제 함수 재배포) 전까지 꺼 둔다. 켜는 법: ON = true 로 바꿔 배포.
     확인용 페이지는 window.SR_REVIEW_FORCE = true 로 미리 본다. */
  var ON = true; // 2026-10-07 서버(Firestore default·결제 함수) 가동
  var dlg = null, last = null;
  var LABELS = ['', '아쉬웠어요', '그저 그랬어요', '괜찮았어요', '좋았어요', '아주 좋았어요'];
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';

  function pass() { try { return window.SRPay && SRPay.pass(); } catch (e) { return null; } }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function trk(n, d) { try { window.SR && SR.track(n, d || {}); } catch (e) {} }
  function done(p) { return p && ls(DONE_KEY) === p.token.slice(0, 24); }

  function slots(html) { document.querySelectorAll('.rv-slot').forEach(function (s) { s.innerHTML = html; s.hidden = !html; }); }
  function laterButton() {
    slots('<button type="button" class="rv-reopen">후기 남기기</button>');
    document.querySelectorAll('.rv-reopen').forEach(function (b) { b.onclick = function () { open('reopen'); }; });
  }

  function build() {
    dlg = document.createElement('div');
    dlg.className = 'rv-back'; dlg.hidden = true;
    dlg.innerHTML =
      '<form class="rv" role="dialog" aria-modal="true" aria-labelledby="rv-h" tabindex="-1" novalidate>'
      + '<button type="button" class="rv-x" aria-label="닫기">×</button>'
      + '<div class="rv-h" id="rv-h">셀프등기24를 선택해 주셔서 감사합니다</div>'
      + '<p class="rv-s">남겨 주신 한 줄이 다음 분들께 가장 큰 참고가 됩니다.</p>'
      + '<div class="rv-q" id="rv-q1">서류 준비 과정은 어떠셨나요?</div>'
      + '<div class="rv-rate"><div class="rv-stars" role="radiogroup" aria-labelledby="rv-q1">'
      + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="rv-star" role="radio" aria-checked="false" aria-label="' + n + '점 ' + LABELS[n] + '" data-n="' + n + '">' + STAR + '</button>'; }).join('')
      + '</div><span class="rv-rl" aria-hidden="true"></span></div>'
      + '<label class="rv-q" for="rv-t">한 줄 후기</label>'
      + '<textarea id="rv-t" class="rv-t" maxlength="300" rows="2" placeholder="예: 칸이 거의 다 채워져서 편했습니다"></textarea>'
      + '<label class="rv-pub"><input type="checkbox" class="rv-p"> <span>홈페이지에 공개해도 됩니다 <small>이름 없이 「이용자 · 작성 월」로 표시됩니다.</small></span></label>'
      + '<div class="rv-msg" role="status" aria-live="polite"></div>'
      + '<div class="rv-a"><button type="submit" class="rv-send">후기 보내기</button><button type="button" class="rv-later">나중에</button></div>'
      + '</form>';
    document.body.appendChild(dlg);
    var f = dlg.querySelector('form'), rating = 0;
    function paint(h) { var v = h || rating; f.querySelectorAll('.rv-star').forEach(function (b) { b.classList.toggle('on', +b.dataset.n <= v); b.setAttribute('aria-checked', String(+b.dataset.n === rating)); }); f.querySelector('.rv-rl').textContent = LABELS[v] || ''; }
    f.querySelector('.rv-stars').addEventListener('mouseover', function (e) { var s = e.target.closest('.rv-star'); if (s) paint(+s.dataset.n); });
    f.querySelector('.rv-stars').addEventListener('mouseleave', function () { paint(); });
    f.addEventListener('click', function (e) {
      var s = e.target.closest('.rv-star'); if (s) { rating = +s.dataset.n; paint(); return; }
      if (e.target.closest('.rv-later') || e.target.closest('.rv-x')) { trk('review_later', {}); close(); laterButton(); }
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) { close(); laterButton(); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg && !dlg.hidden) { close(); laterButton(); } });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var p = pass(), msg = f.querySelector('.rv-msg'), text = f.querySelector('.rv-t').value.trim();
      var miss = !rating ? '별을 눌러 만족도를 골라 주세요.' : (text.length < 5 ? '한 줄 후기를 5자 이상 적어 주세요.' : '');
      if (miss) { msg.textContent = miss; msg.className = 'rv-msg err'; return; }
      if (!p) { msg.textContent = '결제 확인이 되지 않았습니다. 재발급 링크로 다시 들어와 주세요.'; msg.className = 'rv-msg err'; return; }
      var btn = f.querySelector('.rv-send'); btn.disabled = true; btn.textContent = '보내는 중…'; msg.textContent = '';
      fetch('/api/pay/review', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: p.token, rating: rating, text: text, publish: f.querySelector('.rv-p').checked, from: 'roadmap' }) })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }).then(function (j) { return { s: r.status, j: j }; }); })
        .then(function (x) {
          if ((x.j && x.j.ok) || x.s === 409) {
            ls(DONE_KEY, p.token.slice(0, 24)); trk('review_submit', { key: String(rating) });
            f.innerHTML = '<div class="rv-done"><b>후기를 보내 주셔서 감사합니다.</b><span>등기소 접수까지 잘 마치시길 바랍니다.</span><button type="button" class="rv-send rv-ok">닫기</button></div>';
            f.querySelector('.rv-ok').onclick = close;
            slots('');
            return;
          }
          msg.textContent = (x.j && x.j.msg) || '후기를 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.'; msg.className = 'rv-msg err';
          btn.disabled = false; btn.textContent = '후기 보내기';
        })
        .catch(function () { msg.textContent = '인터넷 연결을 확인한 뒤 다시 시도해 주세요.'; msg.className = 'rv-msg err'; btn.disabled = false; btn.textContent = '후기 보내기'; });
    });
  }

  function open(from) {
    var p = pass(); if (!p || done(p)) return;
    if (!dlg) build();
    last = document.activeElement;
    dlg.hidden = false; document.documentElement.classList.add('rv-open');
    setTimeout(function () { try { dlg.querySelector('.rv').focus({ preventScroll: true }); } catch (e) {} }, 50); /* 첫 별에 포커스 테두리가 생기지 않게 팝업 자체에 */
    trk('review_view', { from: from || 'roadmap' });
  }
  function close() {
    if (!dlg) return; dlg.hidden = true; document.documentElement.classList.remove('rv-open');
    if (last && last.focus) try { last.focus({ preventScroll: true }); } catch (e) {}
  }

  window.SRReview = {
    /* 신청서 다운로드 직후 호출. 같은 주문에서 이미 보여 줬으면 팝업 대신 버튼만 둔다. */
    afterDownload: function () {
      if (!ON) return;
      var p = pass(); if (!p || done(p)) return;
      if (ls(SEEN_KEY) === p.token.slice(0, 24)) { laterButton(); return; }
      ls(SEEN_KEY, p.token.slice(0, 24));
      setTimeout(function () { open('roadmap'); }, 1200); // 다운로드 완료 안내를 먼저 읽게
    },
    open: open
  };

  var css = ''
    + '.rv-slot[hidden],.rv-back[hidden]{display:none}'
    + '.rv-back{position:fixed;inset:0;z-index:1300;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:16px}'
    + 'html.rv-open,html.rv-open body{overflow:hidden}'
    + '.rv{position:relative;width:100%;max-width:400px;box-sizing:border-box;padding:22px 20px 18px;border-radius:16px;background:#fff;color:#0F172A;font-size:14px;line-height:1.6;text-align:left;box-shadow:0 20px 50px rgba(15,23,42,.3);font-family:inherit}'
    + '@media(max-width:560px){.rv-back{align-items:flex-end;padding:0}.rv{max-width:none;border-radius:16px 16px 0 0;padding-bottom:calc(18px + env(safe-area-inset-bottom,0px))}}'
    + '.rv-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:8px;background:#F1F5F9;font-size:20px;line-height:1;color:#475569;cursor:pointer}'
    + '.rv-h{font-size:18px;font-weight:800;line-height:1.45;letter-spacing:-.02em;padding-right:34px}'
    + '.rv-s{font-size:13.5px;color:#475569;line-height:1.6;margin:6px 0 4px}'
    + '.rv-rate{display:flex;align-items:center;gap:12px}'
    + '.rv-stars{display:flex;gap:2px;margin-left:-6px}'
    + '.rv-star{width:40px;height:40px;padding:6px;border:0;border-radius:8px;background:none;cursor:pointer;line-height:0}'
    + '.rv-star svg{width:28px;height:28px;fill:#fff;stroke:#64748B;stroke-width:1.4;stroke-linejoin:round;transition:fill .12s,stroke .12s,transform .12s}'
    + '.rv-star:hover svg{transform:scale(1.08)}'
    + '.rv-star.on svg{fill:#F59E0B;stroke:#D97706}'
    + '.rv-rl{font-size:13px;font-weight:700;color:#B45309;min-width:6em}'
    + '@media(prefers-reduced-motion:reduce){.rv-star svg{transition:none}.rv-star:hover svg{transform:none}}'
    + '.rv-q{display:block;font-size:13px;font-weight:700;margin:14px 0 6px}'
    + '.rv-t{display:block;width:100%;box-sizing:border-box;min-height:64px;padding:10px 12px;border:1px solid #E2E8F0;border-radius:10px;font-family:inherit;font-size:15px;line-height:1.55;resize:vertical;background:#fff}'
    + '.rv-pub{display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:13px;font-weight:600;cursor:pointer}'
    + '.rv-pub input{width:18px;height:18px;margin-top:2px;flex-shrink:0;accent-color:#0369A1}'
    + '.rv-pub small{display:block;font-weight:500;color:#475569;font-size:12.5px}'
    + '.rv-msg{font-size:13px;margin-top:8px}.rv-msg.err{color:#B91C1C;font-weight:600}'
    + '.rv-a{display:flex;gap:8px;margin-top:12px}'
    + '.rv-send{flex:1;min-height:48px;border:0;border-radius:10px;background:#0F172A;color:#fff;font-family:inherit;font-size:15px;font-weight:800;cursor:pointer}'
    + '.rv-send:disabled{opacity:.6;cursor:default}'
    + '.rv-later,.rv-reopen{min-height:48px;padding:0 16px;border:1px solid #E2E8F0;border-radius:10px;background:#fff;font-family:inherit;font-size:14px;font-weight:700;color:#475569;cursor:pointer}'
    + '.rv-reopen{min-height:40px;margin-top:10px;font-size:13px;color:#0369A1;border-color:#BAE6FD;background:#F0F9FF}'
    + '.rv-done b{display:block;font-size:17px;font-weight:800}.rv-done span{display:block;font-size:13.5px;color:#334155;margin:4px 0 14px}.rv-done .rv-ok{width:100%}'
    + '.rv:focus{outline:none}.rv :focus-visible,.rv-reopen:focus-visible{outline:2px solid #0369A1;outline-offset:2px}';
  var st = document.createElement('style'); st.id = 'rv-css'; st.textContent = css; document.head.appendChild(st);
})();
