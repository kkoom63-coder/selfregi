/* 셀프등기24 결제 · 이용권 (토스페이 · 페이앱 네이버페이/카카오페이 — 2026-10-10 추가)
 *
 * 흐름: 결제 버튼 → /api/pay/create → 토스페이 결제창(새 창) → pay_return.html
 *       → /api/pay/confirm(서버가 상태·금액 확인 후 승인) → 이용권을 localStorage에 저장
 * 이용권 1건 = 부동산 1건의 서류 전체(위임장·신청서·매매목록). 결제일부터 30일.
 * 새 창을 쓰는 이유: 입력 중인 서류 폼을 그대로 두기 위해서다(토스 문서도 iframe 대신 새 창 권장).
 * 새 창이 막히면 같은 창으로 이동하고, 입력값은 이 기기의 sessionStorage에 잠시(1시간 이내) 보관했다가 복원한다.
 * 주민등록번호 칸(id에 rrn)은 보관하지 않는다.
 *
 * 페이앱: 결제 버튼 → /api/pay/payapp-create(주문번호) → 페이앱 결제창(PayAppWindow 새 창) → pay_return.html?pa=1
 *         → /api/pay/payapp-confirm(페이앱 결제통보가 남긴 「결제완료」 기록 확인) → 같은 이용권.
 *
 * 한계: 서류는 브라우저에서 생성되므로 이 잠금은 우회가 가능하다. 첫 유료화 단계에서는 감수한다.
 */
(function () {
  'use strict';
  var PASS_KEY = 'selfregi_pass_v1';
  var PENDING_KEY = 'selfregi_pay_pending';
  var SNAP_KEY = 'selfregi_form_snapshot';
  var PRICE_LABEL = '9,900원';

  function ls(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function track(n, d) { try { window.SR && SR.track(n, d || {}); } catch (e) {} }

  function pass() {
    var p = ls(PASS_KEY);
    return p && p.token && p.exp > Date.now() ? p : null;
  }
  function has() { return !!pass(); }

  function reissueUrl(p) {
    p = p || pass();
    return p ? location.origin + '/normal_form.html?pass=' + encodeURIComponent(p.token) : '';
  }

  function fire() {
    try { window.dispatchEvent(new CustomEvent('srpay:change', { detail: pass() })); } catch (e) {}
  }

  /* ── 입력값 임시 보관(같은 창 이동 시에만) ── */
  function snapshot() {
    var out = {};
    document.querySelectorAll('input[id],select[id],textarea[id]').forEach(function (el) {
      if (el.type === 'file' || el.type === 'password') return;
      if (/rrn/i.test(el.id)) return; // 주민등록번호는 보관하지 않는다 — 복원 후 다시 입력
      out[el.id] = (el.type === 'checkbox' || el.type === 'radio') ? { c: el.checked } : { v: el.value };
    });
    try { sessionStorage.setItem(SNAP_KEY, JSON.stringify({ path: location.pathname, at: Date.now(), f: out })); } catch (e) {}
  }
  function restore() {
    var s;
    try { s = JSON.parse(sessionStorage.getItem(SNAP_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || s.path !== location.pathname || Date.now() - s.at > 3600 * 1000) return;
    try { sessionStorage.removeItem(SNAP_KEY); } catch (e) {}
    // 체크박스(공동명의 등 구획 토글)를 먼저 복원해야 숨은 칸이 열린다.
    var ids = Object.keys(s.f);
    ids.sort(function (a, b) { return ('c' in s.f[b]) - ('c' in s.f[a]); });
    ids.forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      var x = s.f[id];
      if ('c' in x) { if (el.checked !== x.c) { el.checked = x.c; el.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (el.value !== x.v) { el.value = x.v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }

  /* 서버가 JSON 이 아닌 응답(점검 페이지·404)을 주면 기술 문구 대신 안내 문장을 보인다 */
  function asJson(r) {
    return r.json().catch(function () { throw new Error('결제 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'); });
  }

  /* ── 결제 시작 ── */
  var busy = false;
  /* 결제 직전 관문. 페이지가 setGuard 로 등록한다(normal_form 의 결제 전 점검).
     guard 가 false 를 돌려주면 결제창을 열지 않는다 — guard 쪽 안내창이 { skipGuard:true } 로 다시 부른다.
     클릭 제스처가 살아 있을 때 창을 열어야 팝업이 막히지 않으므로, 확인은 브라우저 confirm 이 아니라
     페이지 안의 안내창 버튼(새 클릭)으로 받는다. */
  var guardFn = null;
  function setGuard(fn) { guardFn = typeof fn === 'function' ? fn : null; }
  function start(opts) {
    if (busy) return;
    if (has()) { fire(); return; }
    if (guardFn && !(opts && opts.skipGuard)) { try { if (!guardFn()) return; } catch (e) {} }
    var m = opts && opts.method;
    if (!m) { openSheet('choose'); return; }   // 결제수단 선택(새 클릭에서 창을 열어야 팝업이 막히지 않는다)
    if (m === 'payapp') { startPayapp(); return; }
    busy = true;
    track('begin_checkout', { value: 9900, currency: 'KRW' });
    // 팝업 차단을 피하려면 클릭 직후 동기적으로 창을 먼저 연다.
    var w = null;
    try { w = window.open('', 'srpay', 'width=480,height=780'); } catch (e) { w = null; }
    if (w) { try { w.document.title = '토스페이 결제'; w.document.body.innerHTML = '<p style="font:15px sans-serif;padding:24px;color:#334155">토스페이 결제창을 여는 중입니다…</p>'; } catch (e) {} }

    fetch('/api/pay/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(asJson)
      .then(function (d) {
        busy = false;
        if (!d || !d.ok) throw new Error((d && d.msg) || '결제를 시작하지 못했습니다.');
        ls(PENDING_KEY, { orderNo: d.orderNo, from: location.pathname, at: Date.now() });
        if (w && !w.closed) { w.location.href = d.checkoutPage; watchPopup(w); }
        else { snapshot(); location.href = d.checkoutPage; }
      })
      .catch(function (e) {
        busy = false;
        try { if (w && !w.closed) w.close(); } catch (x) {}
        track('pay_error', { mode: 'create' });
        notify(e.message || '결제를 시작하지 못했습니다.', true);
      });
  }

  /* ── 페이앱(네이버페이·카카오페이) ──
     페이앱 스크립트는 이름이 'PayAppWindow'인 창에 form 을 보낸다(window.open('', 'PayAppWindow')).
     클릭 직후 같은 이름으로 창을 먼저 열어 두면 그 창을 재사용해 팝업 차단을 피한다. */
  var PA_JS = 'https://lite.payapp.kr/public/api/v2/payapp-lite.js', paJs = null;
  function loadPa() {
    if (window.PayApp) return Promise.resolve();
    if (paJs) return paJs;
    paJs = new Promise(function (ok, no) {
      var sc = document.createElement('script'); sc.src = PA_JS; sc.async = true;
      sc.onload = function () { window.PayApp ? ok() : no(new Error('결제 모듈을 불러오지 못했습니다.')); };
      sc.onerror = function () { paJs = null; no(new Error('결제 모듈을 불러오지 못했습니다.')); };
      document.head.appendChild(sc);
    });
    return paJs;
  }
  function startPayapp() {
    busy = true;
    track('begin_checkout', { value: 9900, currency: 'KRW', payment_type: 'payapp' });
    var w = null;
    try { w = window.open('', 'PayAppWindow', 'width=480,height=780'); } catch (e) { w = null; }
    if (w) { try { w.document.title = '네이버페이·카카오페이 결제'; w.document.body.innerHTML = '<p style="font:15px sans-serif;padding:24px;color:#334155">결제창을 여는 중입니다…</p>'; } catch (e) {} }
    Promise.all([
      fetch('/api/pay/payapp-create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(asJson),
      loadPa(),
    ]).then(function (res) {
      var d = res[0];
      busy = false;
      if (!d || !d.ok || !d.param) throw new Error((d && d.msg) || '결제를 시작하지 못했습니다.');
      ls(PENDING_KEY, { orderNo: d.orderNo, m: 'payapp', from: location.pathname, at: Date.now() });
      var P = window.PayApp;
      P.setDefault({ userid: d.param.userid, shopname: d.param.shopname });
      if (w && !w.closed) { P.setTarget('PayAppWindow'); P.setParam(d.param); P.call(); watchPopup(w); }
      else { snapshot(); P.setTarget('_self'); P.setParam(d.param); P.call(); }
    }).catch(function (e) {
      busy = false;
      try { if (w && !w.closed) w.close(); } catch (x) {}
      track('pay_error', { mode: 'payapp_create' });
      notify(e.message || '결제를 시작하지 못했습니다.', true);
    });
  }

  function watchPopup(w) {
    var t = setInterval(function () {
      if (has()) { clearInterval(t); fire(); return; }
      if (w.closed) { clearInterval(t); setTimeout(function () { if (has()) fire(); }, 500); }
    }, 800);
  }

  /* ── 재발급 링크(?pass=) ── */
  function redeem() {
    var q = new URLSearchParams(location.search);
    var tok = q.get('pass');
    if (!tok) return;
    q.delete('pass');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    fetch('/api/pay/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          ls(PASS_KEY, { token: tok, orderNo: d.orderNo, exp: d.exp }); fire();
          /* 이 기기에 입력값이 없으면(다른 기기) 페이지가 「위임장 파일로 이어서 하기」를 안내한다. */
          var m = '';
          try { if (typeof window.SRRedeemMsg === 'function') m = window.SRRedeemMsg(); } catch (e) {}
          notify(m || '재발급 링크가 확인되었습니다. 다시 결제하지 않고 서류를 받으실 수 있습니다.');
          track('pass_redeem', { mode: /입력 내용이 없습니다/.test(m) ? 'empty' : 'filled' });
        }
        else notify((d && d.msg) || '재발급 링크를 확인하지 못했습니다.', true);
      })
      .catch(function () { notify('재발급 링크를 확인하지 못했습니다.', true); });
  }

  /* ── 안내 ── */
  function notify(msg, isErr) {
    if (typeof window.showToast === 'function') window.showToast(msg, isErr ? '#DC2626' : '#047857');
    else alert(msg);
  }

  // 결제 전 다운로드를 누르면 결제 안내창을 띄운다. 다운로드 함수 첫 줄에서 호출.
  function requirePaid() {
    if (has()) return true;
    openSheet();
    return false;
  }

  function openSheet(from) {
    var el = document.getElementById('srpay-sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'srpay-sheet';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'srpay-h');
      el.innerHTML =
        '<div class="srp-bg" data-close></div>' +
        '<div class="srp-card">' +
        '<div id="srpay-h" class="srp-h">서류 자동완성 · 부동산 1건 ' + PRICE_LABEL + '</div>' +
        '<p class="srp-d">결제 후 서류는 두 번에 나눠 받습니다. <b>위임장</b>은 결제 직후 바로, <b>소유권이전등기신청서</b>는 취득세·국민주택채권·등기신청수수료 등 제세공과금을 납부한 뒤 납부하면서 받은 번호를 입력하면 완성됩니다. 한 번 결제로 두 서류가 모두 포함되며, 부가세 포함·추가 요금은 없습니다.</p>' +
        '<ul class="srp-l">' +
        '<li>결제일부터 30일, 동일 부동산·동일 매수인은 횟수 제한 없이 재발급</li>' +
        '<li>등기소 보정 요구에 따른 재작성도 재발급으로 처리</li>' +
        '<li>문서 오류 등 회사 귀책은 전액 환불 (<a href="terms.html#a6" target="_blank" rel="noopener">이용약관 제6조</a>)</li></ul>' +
        '<div class="srp-k">결제 수단을 고르세요</div>' +
        '<button type="button" class="srp-go" data-m="toss">토스페이 <small>토스 앱 · PC는 QR</small></button>' +
        '<button type="button" class="srp-go srp-pa" data-m="payapp">네이버페이 · 카카오페이</button>' +
        '<button type="button" class="srp-x" data-close>닫기</button>' +
        '</div>';
      var css = document.createElement('style');
      css.textContent =
        '#srpay-sheet{position:fixed;inset:0;z-index:9999;display:none;align-items:flex-end;justify-content:center}' +
        '#srpay-sheet.open{display:flex}' +
        '#srpay-sheet .srp-bg{position:absolute;inset:0;background:rgba(15,23,42,.45)}' +
        '#srpay-sheet .srp-card{position:relative;background:#fff;width:100%;max-width:440px;border-radius:16px 16px 0 0;padding:22px 20px calc(18px + env(safe-area-inset-bottom));font-family:inherit;color:#0F172A;box-shadow:0 -8px 30px rgba(0,0,0,.18)}' +
        '@media(min-width:600px){#srpay-sheet{align-items:center}#srpay-sheet .srp-card{border-radius:16px}}' +
        '#srpay-sheet .srp-h{font-size:17px;font-weight:800;margin-bottom:8px}' +
        '#srpay-sheet .srp-d{font-size:14px;line-height:1.6;color:#334155;margin:0 0 10px;word-break:keep-all}' +
        '#srpay-sheet .srp-l{font-size:13px;line-height:1.7;color:#475569;margin:0 0 16px;padding-left:18px;word-break:keep-all}' +
        '#srpay-sheet .srp-k{font-size:13px;font-weight:700;color:#0F172A;margin:0 0 8px}' +
        '#srpay-sheet .srp-go{width:100%;min-height:50px;border:0;border-radius:12px;background:#0064FF;color:#fff;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px}' +
        '#srpay-sheet .srp-go small{font-size:12.5px;font-weight:600;opacity:.85}' +
        '#srpay-sheet .srp-pa{margin-top:8px;background:#0F172A}' +
        '#srpay-sheet .srp-x{width:100%;min-height:44px;border:0;background:none;color:#64748B;font-size:14px;margin-top:6px;cursor:pointer;font-family:inherit}';
      document.head.appendChild(css);
      document.body.appendChild(el);
      el.addEventListener('click', function (e) {
        if (e.target.hasAttribute('data-close')) closeSheet();
        var go = e.target.closest && e.target.closest('.srp-go');
        if (go) { closeSheet(); start({ method: go.getAttribute('data-m'), skipGuard: true }); }
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
    }
    el.classList.add('open');
    track('pay_sheet', { mode: from === 'choose' ? 'choose' : 'download' }); // choose = 결제 버튼, download = 결제 전 다운로드
    var go = el.querySelector('.srp-go'); if (go) go.focus();
  }
  function closeSheet() { var el = document.getElementById('srpay-sheet'); if (el) el.classList.remove('open'); }

  /* ── 다른 창(결제 완료 창)에서 이용권이 저장되면 이 창도 즉시 반영 ── */
  window.addEventListener('storage', function (e) { if (e.key === PASS_KEY) fire(); });
  window.addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data && e.data.type === 'srpay:paid') fire();
  });

  window.SRPay = { has: has, pass: pass, start: start, setGuard: setGuard, requirePaid: requirePaid, reissueUrl: reissueUrl, PRICE_LABEL: PRICE_LABEL, PASS_KEY: PASS_KEY, PENDING_KEY: PENDING_KEY };

  function init() { restore(); redeem(); fire(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
