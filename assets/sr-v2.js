/* 셀프등기24 디자인 시스템 v2 — 계산식·움직임 도우미.
   문구는 여기 두지 않는다(검색에 읽히도록 HTML 에 직접 적는다).
   규칙 원문: DESIGN-V2.md */
(function () {
  'use strict';
  var SR = (window.SRV = {}); /* window.SR 은 운영의 이벤트 추적 모듈이라 쓰지 않는다 */
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  SR.reduce = reduce;

  /* 법무사 기본보수 상한 — 운영본 cost.html · calculator.html 의 lawyerBaseFee 와 같은 산정식
     (대한법무사협회 「법무사보수기준」 제9조 [부표], 별표 2026. 8. 20. 개정). */
  function lawyerBaseFee(base) {
    if (base <= 50000000) return 210000;
    if (base <= 100000000) return 210000 + (base - 50000000) * 10 / 10000;
    if (base <= 300000000) return 260000 + (base - 100000000) * 9 / 10000;
    if (base <= 500000000) return 440000 + (base - 300000000) * 8 / 10000;
    if (base <= 1000000000) return 600000 + (base - 500000000) * 7 / 10000;
    if (base <= 2000000000) return 950000 + (base - 1000000000) * 5 / 10000;
    if (base <= 20000000000) return 1450000 + (base - 2000000000) * 4 / 10000;
    return 8650000 + (base - 20000000000) * 1 / 10000;
  }
  SR.PRICE = 9900;
  SR.fee = function (p) { return Math.floor(lawyerBaseFee(p) / 10000) * 10000; };
  SR.num = function (n) { return Math.round(n).toLocaleString('ko-KR'); };
  SR.eok = function (p) {
    var e = Math.floor(p / 100000000), m = Math.round((p % 100000000) / 10000000);
    return (e ? e + '억' : '') + (m ? (e ? ' ' : '') + m + '천만' : '') + '원';
  };

  /* 숫자를 부드럽게 바꾼다 */
  SR.tween = function (el, to, ms, fmt) {
    fmt = fmt || SR.num;
    var from = +el.dataset.val || 0;
    el.dataset.val = to;
    if (reduce || document.hidden || !ms) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    cancelAnimationFrame(el._raf);
    (function step(t) {
      var k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) el._raf = requestAnimationFrame(step);
    })(t0);
    /* 탭이 숨겨져 rAF 가 멈춰도 최종값은 남긴다 */
    setTimeout(function () { if (+el.dataset.val === to) el.textContent = fmt(to); }, ms + 400);
  };

  /* 화면에 들어오면 .in — JS 가 없거나 관찰이 안 돌면 처음부터 보인다(.js 범위에서만 숨김) */
  SR.reveal = function (sel, opt) {
    var els = [].slice.call(document.querySelectorAll(sel || '[data-rv]'));
    if (reduce || !('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        e.target.dispatchEvent(new CustomEvent('sr:in'));
        io.unobserve(e.target);
      });
    }, opt || { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    els.forEach(function (e) { io.observe(e); });
    /* 숨은 탭 등에서 관찰이 안 돌 때의 안전장치 */
    setTimeout(function () { if (document.hidden) els.forEach(function (e) { e.classList.add('in'); }); }, 1500);
  };

  /* 절약액 계산기: [data-calc] 안의 range·preset·출력을 묶는다 */
  SR.calc = function (root, onChange) {
    var range = root.querySelector('input[type=range]');
    var presets = [].slice.call(root.querySelectorAll('[data-p]'));
    var out = function (k) { return [].slice.call(root.querySelectorAll('[data-o="' + k + '"]')); };
    function render(animate) {
      var p = +range.value, f = SR.fee(p), d = Math.max(f - SR.PRICE, 0);
      out('price').forEach(function (e) { e.textContent = SR.eok(p); });
      out('fee').forEach(function (e) { SR.tween(e, f, animate ? 450 : 0); });
      out('diff').forEach(function (e) { SR.tween(e, d, animate ? 450 : 0); });
      presets.forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.p === p)); });
      var pct = (p - range.min) / (range.max - range.min) * 100;
      range.style.setProperty('--pct', pct + '%');
      range.setAttribute('aria-valuetext', '매매가 ' + SR.eok(p));
      if (onChange) onChange(p, f, d);
    }
    range.addEventListener('input', function () { render(true); });
    presets.forEach(function (b) {
      b.addEventListener('click', function () { range.value = b.dataset.p; render(true); });
    });
    render(false);
  };

  /* 잔금일 → 신청 기한(60일). 참고용 날짜 계산. */
  SR.deadline = function (root) {
    var input = root.querySelector('input[type=date]');
    var o = function (k) { return root.querySelector('[data-o="' + k + '"]'); };
    var days = ['일', '월', '화', '수', '목', '금', '토'];
    function render() {
      if (!input.value) { root.classList.remove('has'); return; }
      var d = new Date(input.value + 'T00:00:00');
      d.setDate(d.getDate() + 60);
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var left = Math.round((d - today) / 86400000);
      o('date').textContent = d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '. (' + days[d.getDay()] + ')';
      o('left').textContent = left >= 0 ? '오늘부터 ' + left + '일 남음' : '기한이 ' + (-left) + '일 지났습니다';
      root.classList.add('has');
      root.classList.toggle('late', left < 0);
    }
    input.addEventListener('input', render);
    render();
  };

  /* 제품 시연: 등기부 → 읽는 중 → 칸 채움 → 완료.
     HTML 에는 채워진 값이 들어 있고(JS 없이도 완성 상태), 여기서 비웠다가 다시 채운다. */
  SR.demo = function (root, opt) {
    opt = opt || {};
    var fields = [].slice.call(root.querySelectorAll('[data-f]'));
    fields.forEach(function (f) { f.dataset.v = f.textContent; });
    var timers = [];
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function set(state) { root.dataset.state = state; }
    function run() {
      timers.forEach(clearTimeout); timers = [];
      if (reduce) { set('done'); return; }
      fields.forEach(function (f) { f.textContent = '—'; f.classList.remove('on'); });
      set('idle');
      later(function () { set('reading'); }, opt.manual ? 50 : 700);
      fields.forEach(function (f, i) {
        later(function () { f.textContent = f.dataset.v; f.classList.add('on'); }, (opt.manual ? 900 : 1900) + i * 260);
      });
      var end = (opt.manual ? 900 : 1900) + fields.length * 260 + 250;
      later(function () { set('done'); root.dispatchEvent(new CustomEvent('sr:done')); }, end);
      if (opt.loop) later(run, end + 4200);
    }
    if (opt.manual) { set('done'); root.addEventListener('sr:play', run); }
    else run();
    return run;
  };

})();
