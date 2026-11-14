/* 구별 전세 신호 페이지 — SVG 그리기 · 움직임 (2026-11-15)
   숫자 · 문장은 HTML 에 미리 적혀 있다(검색용). 이 파일은 그래프와 움직임만 맡는다.
   window.GU_DATA = {months, seoulRate, me:{gu, lease[], auc[], rate}, rows:[{gu, rate}]} — build_gu_pages.py 가 페이지마다 넣는다 */
(function () {
  var D = window.GU_DATA;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';
  var G = {};

  G.data = D;
  G.pick = function () { return D.me; };
  G.mlabel = function (m, i, n) { var mm = +m.slice(5); return (i === 0 || mm === 1 || i === n - 1) ? m.slice(2, 4) + '.' + mm : String(mm); };
  G.ym = function (m) { return m.slice(0, 4) + '년 ' + (+m.slice(5)) + '월'; };
  G.eok = function (w) { return (Math.round(w / 1e6) / 100).toFixed(2) + '억'; };
  G.el = function (tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  };

  /* 막대: 마지막 달만 진하게. 화면에 들어오면 왼쪽부터 자란다 */
  /* 그래프는 실제 폭(px) 기준으로 그린다 — viewBox 축소로 글자가 14px 아래로 작아지지 않게 */
  G.w = function (svg) { return Math.max(280, Math.round(svg.getBoundingClientRect().width) || 640); };

  G.bars = function (svg, vals, months) {
    var W = G.w(svg), H = 220, pb = 28, pt = 24, n = vals.length, max = Math.max.apply(null, vals) * 1.15;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var bw = W / n * 0.56;
    G.el('line', { x1: 0, x2: W, y1: H - pb, y2: H - pb, class: 'ax' }, svg);
    vals.forEach(function (v, i) {
      var h = (H - pb - pt) * v / max, x = W / n * i + (W / n - bw) / 2;
      var r = G.el('rect', { x: x, y: H - pb - h, width: bw, height: h, rx: 6, class: i === n - 1 ? 'vbar now' : 'vbar' }, svg);
      r.style.setProperty('--i', i);
      /* 이번 달 + 가장 많았던 달에 값을 단다(구역 제목이 최고 달을 말하므로 — R7-A10) */
      if (i === n - 1 || (v === Math.max.apply(null, vals) && vals.indexOf(v) === i)) { var t = G.el('text', { x: x + bw / 2, y: H - pb - h - 8, class: 'blab' }, svg); t.textContent = v; }
      if (W < 560 && i % 3 && i !== n - 1) return; /* 좁은 화면은 3달마다 + 마지막 달만 */
      var l = G.el('text', { x: x + bw / 2, y: H - 8, class: 'xlab' }, svg); l.textContent = G.mlabel(months[i], i, n);
    });
  };

  /* 선: 그려지듯 나타난다 */
  G.line = function (svg, vals, months) {
    var W = G.w(svg), H = 240, pb = 28, pt = 32, n = vals.length, max = Math.max.apply(null, vals) * 1.15;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var px = function (i) { return 16 + (W - 32) * i / (n - 1); }, py = function (v) { return H - pb - (H - pb - pt) * v / max; };
    G.el('line', { x1: 0, x2: W, y1: H - pb, y2: H - pb, class: 'ax' }, svg);
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + px(i).toFixed(1) + ' ' + py(v).toFixed(1); }).join(' ');
    G.el('path', { d: d + ' L' + px(n - 1) + ' ' + (H - pb) + ' L' + px(0) + ' ' + (H - pb) + ' Z', class: 'area' }, svg);
    var p = G.el('path', { d: d, class: 'ln' }, svg);
    p.style.setProperty('--len', p.getTotalLength ? p.getTotalLength() : 1200);
    var peak = vals.indexOf(Math.max.apply(null, vals));
    [peak, n - 1].forEach(function (i, k) {
      G.el('circle', { cx: px(i), cy: py(vals[i]), r: 6, class: k ? 'dot now' : 'dot' }, svg);
      var t = G.el('text', { x: px(i), y: py(vals[i]) - 14, class: 'blab' }, svg); t.textContent = (k ? '이번 달 ' : '최고 ') + vals[i];
    });
    months.forEach(function (m, i) { if (i % 3 === 0 || i === n - 1) { var l = G.el('text', { x: px(i), y: H - 8, class: 'xlab' }, svg); l.textContent = G.mlabel(m, i, n); } });
  };

  /* 점 줄: 25개 구가 한 줄 위에. 내 구만 파랑 + 이름 */
  G.strip = function (svg, me) {
    var W = G.w(svg), H = 96, rows = D.rows.filter(function (r) { return r.rate != null; });
    var max = Math.ceil(Math.max.apply(null, rows.map(function (r) { return r.rate; })) / 2) * 2;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var x = function (v) { return 16 + (W - 32) * v / max; };
    G.el('line', { x1: 16, x2: W - 16, y1: 56, y2: 56, class: 'ax' }, svg);
    G.el('line', { x1: x(D.seoulRate), x2: x(D.seoulRate), y1: 36, y2: 76, class: 'avg' }, svg);
    var at = G.el('text', { x: x(D.seoulRate), y: 92, class: 'xlab' }, svg); at.textContent = '서울 평균 ' + D.seoulRate;
    rows.forEach(function (r, i) {
      var c = G.el('circle', { cx: x(r.rate), cy: 56, r: r.gu === me.gu ? 10 : 7, class: r.gu === me.gu ? 'sd me' : 'sd' }, svg);
      c.style.setProperty('--i', i);
      var tt = G.el('title', {}, c); tt.textContent = r.gu + ' ' + r.rate;
    });
    var mt = G.el('text', { x: x(me.rate), y: 28, class: 'blab' }, svg); mt.textContent = me.gu + ' ' + me.rate;
    var z = G.el('text', { x: 16, y: 92, class: 'xlab', 'text-anchor': 'start' }, svg); z.textContent = '0';
    var m = G.el('text', { x: W - 16, y: 92, class: 'xlab', 'text-anchor': 'end' }, svg); m.textContent = max;
  };

  /* 순위 막대 25줄 */
  G.rank = function (box, me) {
    var rows = D.rows.filter(function (r) { return r.rate != null; }).sort(function (a, b) { return a.rank - b.rank; });
    var max = rows[0].rate;
    box.innerHTML = rows.map(function (r, i) {
      return '<a class="rk' + (r.gu === me.gu ? ' me' : '') + '" href="?gu=' + encodeURIComponent(r.gu) + '" style="--i:' + i + ';--w:' + (r.rate / max * 100).toFixed(1) + '%">' +
        '<span class="rk-n">' + r.rank + '</span><span class="rk-g">' + r.gu + '</span><span class="rk-b"><i></i></span><span class="rk-v">' + r.rate + '</span></a>';
    }).join('');
  };

  /* 숫자 올라가기 */
  G.count = function (el, to, ms, dec) {
    var fmt = function (v) { return dec ? v.toFixed(dec) : Math.round(v).toLocaleString('ko-KR'); };
    if (reduce || !ms) { el.textContent = fmt(to); return; }
    var t0 = performance.now();
    (function step(t) { var k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 4); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(step); })(t0);
    setTimeout(function () { el.textContent = fmt(to); }, ms + 400);
  };

  /* 화면에 들어오면 .in + 콜백 한 번 */
  G.reveal = function (sel, cb) {
    var els = [].slice.call(document.querySelectorAll(sel));
    var fire = function (e) { if (e.classList.contains('in')) return; e.classList.add('in'); if (cb) cb(e); };
    if (reduce || !('IntersectionObserver' in window)) { els.forEach(fire); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { fire(x.target); io.unobserve(x.target); } }); }, { threshold: 0.25 });
    els.forEach(function (e) { io.observe(e); });
    setTimeout(function () { if (document.hidden) els.forEach(fire); }, 1500);
  };

  window.GU = G;
})();
