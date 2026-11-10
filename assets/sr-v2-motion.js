/* 셀프등기24 v2 — 기존 구조 페이지용 움직임 도우미. 문구 · 계산 없음.
   <script src="assets/sr-v2-motion.js" data-rv="선택자" data-pop="선택자" defer>
   data-rv : 화면에 들어올 때 한 번 나타나는 것(처음부터 보이는 것은 건드리지 않는다)
   data-pop: 글자가 바뀌면 한 번 튀는 것(계산 결과) */
(function () {
  var d = document, s = d.currentScript;
  if (!s || !('IntersectionObserver' in window)) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  var q = function (sel) { try { return sel ? [].slice.call(d.querySelectorAll(sel)) : []; } catch (e) { return []; } };

  function done(el) {
    el.classList.add('in');
    setTimeout(function () { el.classList.remove('srv-rv', 'in'); }, 900);
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); done(e.target); } });
  }, { rootMargin: '0px 0px -6% 0px' });
  var pending = [];
  function arm() {
    var vh = window.innerHeight;
    q(s.getAttribute('data-rv')).forEach(function (el) {
      var b = el.getBoundingClientRect();
      if (!b.height || b.top < vh * 0.92) return;      // 숨은 것 · 이미 보이는 것은 그대로
      el.classList.add('srv-rv'); pending.push(el); io.observe(el);
    });
  }
  function flush() { pending.forEach(function (el) { io.unobserve(el); el.classList.remove('srv-rv', 'in'); }); pending = []; }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', arm); else arm();
  window.addEventListener('beforeprint', flush);
  setTimeout(function () { if (d.hidden) flush(); }, 4000);   // 창이 숨겨져 관찰이 안 돌 때의 안전장치

  var popSel = s.getAttribute('data-pop');
  if (popSel && 'MutationObserver' in window) {
    var ready = false;
    setTimeout(function () { ready = true; }, 1200);   // 첫 그리기 때는 튀지 않는다
    var mo = new MutationObserver(function (ms) {
      if (!ready) return;
      var seen = [];
      ms.forEach(function (m) {
        var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        el = el && el.closest(popSel);
        if (el && seen.indexOf(el) < 0) seen.push(el);
      });
      seen.forEach(function (el) {
        el.classList.remove('srv-pop'); void el.offsetWidth; el.classList.add('srv-pop');
      });
    });
    var watch = function () { q(popSel).forEach(function (el) { mo.observe(el, { childList: true, characterData: true, subtree: true }); }); };
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', watch); else watch();
  }
})();
