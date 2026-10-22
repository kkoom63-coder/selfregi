/* 「내 셀프등기」 진행 줄(2026-10-19) — 서류 작성(normal_form)과 로드맵(roadmap) 위에 같은 모양으로 붙는다.
   두 페이지가 한 흐름으로 보이게 하는 것이 목적이다(파일은 둘, 화면은 하나처럼).
   단계: ① 등기부·정보 → ② 위임장(잔금 전날 · 결제) → ③ 세금 납부(잔금 후) → ④ 신청서·등기소
   상태는 이 기기 저장값만 읽는다(쓰지 않음): selfregi_form_v1 · selfregi_pass(_gift)_v1 · selfregi_relay_v1
   사용: SRJourney.render(document.getElementById('jr'), { page: 'form' | 'roadmap' }) */
(function(){
  function read(k){ try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch(e) { return null; } }
  function has(v){ return v != null && String(v).trim() !== ''; }
  function track(n, d){ try { window.SR && SR.track(n, d); } catch(e) {} }

  function state(){
    var form = read('selfregi_form_v1');
    var relay = read('selfregi_relay_v1') || {};
    var pass = [read('selfregi_pass_v1'), read('selfregi_pass_gift_v1')].some(function(p){ return p && p.token && p.exp > Date.now(); });
    var paidKeys = ['tax', 'bond', 'fee'].filter(function(k){ return has(relay[k]); }).length;
    return { info: !!form, pass: pass, taxDone: paidKeys === 3, any: !!form || pass || paidKeys > 0 };
  }

  var SALE = [
    { n: 1, t: '등기부·정보', s: '자동으로 채우기', href: 'normal_form.html#ocr-card' },
    { n: 2, t: '위임장', s: '잔금 전날 · 결제', href: 'normal_form.html#pay-card' },
    { n: 3, t: '세금 납부', s: '잔금일 이후', href: 'normal_form.html#s=3' },
    { n: 4, t: '신청서·등기소', s: '접수 한 번', href: 'normal_form.html#s=app' }
  ];
  /* 증여에는 잔금이 없다 — 계약서·위임장 날인 → 구청 검인 → 취득세(증여) → 신청서 */
  var GIFT = [
    SALE[0],
    { n: 2, t: '증여계약서·위임장', s: '날인 전 · 결제', href: 'normal_form.html#pay-card' },
    { n: 3, t: '검인·세금 납부', s: '구청 검인 · 취득세', href: 'normal_form.html?type=gift#s=3' },
    { n: 4, t: '신청서·등기소', s: '접수 한 번', href: 'normal_form.html?type=gift#s=app' }
  ];
  function isGift(){
    var tab = document.querySelector('.deal-tab-btn.active');
    if (tab) return /증여/.test(tab.textContent);
    if (/[?&]type=gift/.test(location.search)) return true;
    var f = read('selfregi_form_v1'); return !!(f && f.dealType === 'gift');
  }
  var STEPS = SALE;

  var CSS = '.jr{background:#fff;border:1px solid #E2E8F0;border-radius:12px;box-shadow:0 1px 3px rgba(2,6,23,.06);padding:14px 16px;margin:0 0 14px}'
    + '.jr-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin-bottom:10px}.jr-h b{font-size:14px;color:#0F172A}.jr-h span{font-size:12px;color:#64748B}'
    + '.jr-ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:6px}'
    + '.jr-a{display:flex;align-items:center;gap:8px;height:100%;padding:8px 10px;border-radius:10px;border:1px solid #E2E8F0;background:#F8FAFC;color:#334155;text-decoration:none}'
    + 'a.jr-a:hover{border-color:#BAE6FD}'
    + '.jr-n{flex:none;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:#E2E8F0;color:#475569}'
    + '.jr-t{font-size:14px;font-weight:700;line-height:1.35}.jr-t small{display:block;font-size:12px;font-weight:400;color:#64748B}'
    + '.jr-i.done .jr-n{background:#047857;color:#fff}.jr-i.done .jr-a{background:#ECFDF5;border-color:#A7F3D0}'
    + '.jr-i.now .jr-a{background:#E0F2FE;border-color:#0369A1;color:#075985}.jr-i.now .jr-n{background:#0369A1;color:#fff}'
    + '.jr-doors{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:12px}'
    + '.jr-door{display:block;padding:12px 14px;border-radius:10px;border:1px solid #E2E8F0;background:#fff;color:#0F172A;text-decoration:none}'
    + '.jr-door b{display:block;font-size:14px}.jr-door small{display:block;font-size:12px;color:#64748B;margin-top:2px}'
    + '.jr-door.main{background:#0369A1;border-color:#0369A1;color:#fff}.jr-door.main small{color:#E0F2FE}.jr-door.main:hover{background:#075985}'
    + '@media(max-width:640px){.jr-ol{grid-template-columns:repeat(2,1fr)}.jr-t small{display:none}}';
  function ensureCss(){
    if (document.getElementById('jr-css')) return;
    var s = document.createElement('style'); s.id = 'jr-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function render(el, opt){
    if (!el) return;
    ensureCss();
    STEPS = isGift() ? GIFT : SALE;
    var page = (opt && opt.page) || 'form';
    var st = state(), done = [st.info, st.pass, st.taxDone, false];
    var cur = done.indexOf(false);
    var here = page === 'roadmap' ? [2, 3] : [0, 1];   // 이 페이지가 맡는 단계
    var html = '<nav class="jr" aria-label="내 셀프등기 진행"><div class="jr-h"><b>내 셀프등기</b><span>'
      + (st.any ? '이 기기에 저장된 진행 상태입니다' : '네 단계 중 지금 할 일이 강조됩니다') + '</span></div><ol class="jr-ol">';
    STEPS.forEach(function(s, i){
      var cls = done[i] ? 'done' : (i === cur ? 'now' : '');
      var label = '<span class="jr-n">' + (done[i] ? '✓' : s.n) + '</span><span class="jr-t">' + s.t + '<small>' + s.s + '</small></span>';
      html += '<li class="jr-i ' + cls + '"' + (i === cur ? ' aria-current="step"' : '') + '>'
        + (here.indexOf(i) > -1 && i !== cur ? '<span class="jr-a">' + label + '</span>'
          : '<a class="jr-a" href="' + s.href + '" data-jr="' + s.n + '">' + label + '</a>')
        + '</li>';
    });
    html += '</ol>';
    if (page === 'form' && !st.any) {
      html += '<div class="jr-doors">'
        + '<a class="jr-door main" href="#dz-reg" data-door="reg"><b>등기부 올리고 시작</b><small>부동산·매도인 정보가 자동으로 채워집니다</small></a>'
        + '<a class="jr-door" href="#ocr-card" data-door="noreg"><b>아직 등기부가 없어요</b><small>인터넷등기소에서 700원에 받는 법</small></a>'
        + '<a class="jr-door" href="guide.html#flow" data-door="guide"><b>전체 순서부터 볼게요</b><small>무엇을 언제 하는지 4단계로</small></a>'
        + '</div>';
    }
    el.innerHTML = html + '</nav>';
    el.querySelectorAll('[data-door]').forEach(function(a){
      a.addEventListener('click', function(e){
        var k = a.getAttribute('data-door');
        track('journey_door', { key: k });
        var target = k === 'reg' ? document.getElementById('dz-reg') : (k === 'noreg' ? document.querySelector('.noreg') : null);
        if (target) { e.preventDefault(); window.scrollTo(0, target.getBoundingClientRect().top + window.pageYOffset - 80); }
      });
    });
    el.querySelectorAll('[data-jr]').forEach(function(a){
      a.addEventListener('click', function(){ track('journey_step', { step: +a.getAttribute('data-jr'), from: page }); });
    });
  }

  /* 홈·가이드 맨 위 「이어서 하기」 띠 — 저장된 진행이 있을 때만(삼쩜삼 「이미 신청하셨나요?」 방식) */
  function band(el, from){
    if (!el) return;
    STEPS = isGift() ? GIFT : SALE;
    var st = state();
    if (!st.any) { el.innerHTML = ''; return; }
    var done = [st.info, st.pass, st.taxDone, false], cur = done.indexOf(false), s = STEPS[cur];
    if (!document.getElementById('jrb-css')) {
      var c = document.createElement('style'); c.id = 'jrb-css';
      c.textContent = '.jrb{display:flex;align-items:center;justify-content:space-between;gap:10px;max-width:1200px;margin:0 auto;padding:10px 16px;font-size:14px;color:#075985}'
        + '.jrb-w{background:#E0F2FE;border-bottom:1px solid #BAE6FD}.jrb b{font-weight:700}.jrb a{flex:none;color:#fff;background:#0369A1;border-radius:8px;padding:7px 12px;font-weight:700;text-decoration:none}';
      document.head.appendChild(c);
    }
    el.innerHTML = '<div class="jrb-w"><div class="jrb"><span><b>내 셀프등기</b> · 다음 할 일 ' + s.n + ' ' + s.t + '</span>'
      + '<a href="' + s.href + '" data-jrb="1">이어서 →</a></div></div>';
    el.querySelector('[data-jrb]').addEventListener('click', function(){ track('journey_band', { from: from || '', step: s.n }); });
  }

  window.SRJourney = { render: render, state: state, band: band };
})();
