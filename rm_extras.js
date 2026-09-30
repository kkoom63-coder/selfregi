/* 셀프등기24 · 로드맵(roadmap) 보조
 *
 *   이어서 하기  위임장 파일(.docx)을 올리면 신청서에 들어갈 당사자·부동산 정보를 복원한다(resume.js).
 *                다른 기기(예: 휴대폰에서 결제 → PC에서 인쇄)에서 신청서를 받을 때 쓴다.
 *   편철표      내 케이스(매도인·매수인 수, 신청서 건수)에 맞춘 제출 서류 순서·통수·날인 안내를 한 장으로.
 *               순서의 근거는 소유권이전등기신청서(매매) 양식의 「첨부서면」 기재 순서다.
 *
 * 의존(roadmap.html 전역): PARTIES, SELLERS, FILING_COUNT, loadParties, restoreRelay,
 *                         applyDynamicRouting, showToast, SRResume, SR(선택)
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function trk(n, d) { try { window.SR && SR.track(n, d || {}); } catch (e) {} }
  function form() { try { return JSON.parse(localStorage.getItem('selfregi_form_v1') || '{}') || {}; } catch (e) { return {}; } }

  /* ───────── 위임장 파일로 이어서 하기 ───────── */
  async function onResume(file, msgEl) {
    if (!file) return;
    function say(t, cls) { if (msgEl) { msgEl.innerHTML = t; msgEl.className = 'rs-msg ' + (cls || ''); } }
    if (!window.SRResume) { say('파일을 읽을 준비가 되지 않았습니다. 새로고침 후 다시 시도해 주세요.', 'err'); return; }
    say('위임장 파일을 읽는 중입니다…');
    var got = await SRResume.read(file);
    if (typeof got === 'string') { say(esc(SRResume.MSG[got] || '파일을 읽지 못했습니다.'), 'err'); trk('resume_docx', { mode: got.toLowerCase(), from: 'roadmap' }); return; }
    var r = got.d && got.d.r;
    if (!r || !r.buyerName) { say('이 위임장 파일에는 매수인 정보가 없습니다. 서류 작성 화면에서 입력을 마친 뒤 받은 위임장을 올려 주세요.', 'err'); return; }
    r.v = r.v || 3; r.ts = Date.now();
    try { localStorage.setItem('selfregi_form_v1', JSON.stringify(r)); } catch (e) {}
    var addr = String(r.jibun || '').trim();
    if (addr && r.dong && r.ho) addr += ' ' + r.dong + '동 ' + r.ho + '호';
    if (addr) {
      var miss = $('addr-missing'); if (miss) miss.style.display = 'none';
      try { applyDynamicRouting(addr); } catch (e) {}
      try { history.replaceState(null, '', location.pathname + '?addr=' + encodeURIComponent(addr) + location.hash); } catch (e) {}
    }
    try { restoreRelay(); } catch (e) {}
    say('<b>위임장 파일에서 당사자·부동산 정보를 불러왔습니다.</b> 주민등록번호는 파일에 담기지 않으므로 신청서에 직접 적어 주세요. 앞 단계의 번호(취득세액·채권번호 등)는 이 기기에서 다시 입력해 주셔야 합니다.', 'ok');
    trk('resume_docx', { mode: 'ok', from: 'roadmap' });
  }
  function bindResume() {
    document.querySelectorAll('input[data-resume]').forEach(function (fi) {
      fi.addEventListener('change', function () {
        var msg = $(fi.getAttribute('data-resume'));
        onResume(fi.files && fi.files[0], msg); fi.value = '';
      });
    });
  }

  /* ───────── 맞춤 편철표 ───────── */
  function people() {
    try { loadParties(); } catch (e) {}
    var f = form();
    var buyers = (Array.isArray(f.buyers) && f.buyers.length ? f.buyers : [{ name: f.buyerName || '' }]).filter(function (p) { return p && (p.name || p.addr); });
    var sellers = (Array.isArray(f.sellers) && f.sellers.length ? f.sellers : [{ name: f.sellerName || '' }]).filter(function (p) { return p && (p.name || p.addr); });
    if (!buyers.length) buyers = [{ name: '' }];
    if (!sellers.length) sellers = [{ name: '' }];
    var bN = f.buyerJoint ? Math.min(buyers.length, 2) : 1;
    var sN = f.sellerJoint ? Math.min(sellers.length, 2) : 1;
    var filings = (bN > 1 && sN > 1) ? bN : 1;
    var prop = [f.jibun, f.aptName, f.dong ? '제' + f.dong + '동' : '', f.ho ? '제' + f.ho + '호' : ''].filter(Boolean).join(' ');
    var court = ($('ui-deunggi') && $('ui-deunggi').textContent.trim()) || '';
    if (/관할 등기소|미확인/.test(court)) court = '';
    return { f: f, buyers: buyers.slice(0, bN), sellers: sellers.slice(0, sN), bN: bN, sN: sN, filings: filings, prop: prop, court: court, has: !!f.buyerName };
  }

  /* 한 건의 신청서에 묶을 서류. 순서 = 신청서 양식 「첨부서면」 기재 순서(신청서를 맨 위에).
     2건 이상이면 2건차부터 위임장·수수료 영수필확인서만 건별로 붙이고 나머지는 원용한다
     (등기예규 85.10.16 등기 제485호 — 동시에 신청하는 경우에만 원용 / 위임장은 원용 대상 아님,
      등기예규 제1363호 3. — 등기원인증서는 먼저 접수되는 신청서에만 첨부). */
  function rows(P, k) {
    var first = k === 0, joint2 = P.filings > 1;
    var cite = first ? null : '원용';
    var R = [];
    function add(name, cnt, note, alwaysOwn) { R.push({ name: name, cnt: (alwaysOwn || first) ? cnt : cite, note: (alwaysOwn || first) ? note : '1건차에 첨부 · 이 신청서 첨부서면란에 「전건첨부원용」 기재' }); }
    R.push({ name: '소유권이전등기신청서', cnt: '1통', note: '신청인(또는 대리인)란에 날인 · 2장 이상이면 신청인 도장으로 간인', head: true });
    add('매매계약서 (전자수입인지 첨부)', '1통', '원본 제출 · 등기를 마친 뒤 돌려받으며, 3개월 안에 찾아가지 않으면 폐기될 수 있습니다(부동산등기규칙 제66조)');
    add('취득세(등록면허세) 영수필확인서', '1통', '공동명의여도 신고 1건 · 영수필확인서 1장입니다');
    add('등기신청수수료 영수필확인서', '1통', joint2 ? '신청서마다 따로 납부 · 이 신청서 명의인의 납부번호' : '서면 방문신청 18,000원', true);
    add('등기필증(등기필정보)', P.sN + '통', '매도인' + (P.sN > 1 ? ' 각자' : '') + '의 원본 · 일련번호·비밀번호는 신청서 「등기의무자의 등기필정보」란에 적습니다');
    /* 2건차의 매매목록 처리(원용 가능 여부)는 확인하지 못했다[미확인] — 원용이라고 단정하지 않는다. */
    if (joint2) R.push(first
      ? { name: '매매목록', cnt: '1통', note: '같은 부동산을 매수인 수만큼 순번을 붙여 반복 기재(등기예규 제1804호)' }
      : { name: '매매목록', cnt: '창구 확인', note: '2건차에 따로 붙일지, 원용할지는 접수 창구에서 확인하십시오' });
    R.push({ name: '위임장', cnt: '1통', note: '건마다 따로 제출(원용 불가) · 위임인(매도인)의 인감도장 날인 · 2장 이상이면 매도인 인감으로 간인' });
    add('주민등록표초본(또는 등본)', '각 1통', '매도인 초본 ' + P.sN + '통(주소 변동 이력 전체·주민번호 뒷자리 포함) + 매수인 등본 ' + P.bN + '통');
    add('토지대장등본', '1통', '대지권등록부 포함 · 발행일부터 3개월 이내');
    add('집합건축물대장등본', '1통', '전유부 · 발행일부터 3개월 이내');
    add('부동산거래계약신고필증', '1통', '거래신고관리번호·거래가액이 신청서와 같은지 확인');
    add('인감증명서(매도용)', P.sN + '통', (P.bN > 1 ? '매수인 ' + P.bN + '명 전원' : '매수인') + '의 성명·주소·주민등록번호가 신청서 등기권리자와 한 글자까지 같은지 확인 · 발행일부터 3개월 이내');
    return R;
  }

  function sheetHtml(P) {
    var h = '<div class="bd-sheet">' +
      '<div class="bd-top"><div class="bd-t">내 등기 서류 편철표</div>' +
      '<div class="bd-m">' + (P.prop ? esc(P.prop) + '<br>' : '') +
      '매도인 ' + P.sN + '명 · 매수인 ' + P.bN + '명 · <b>신청서 ' + P.filings + '건</b>' + (P.court ? ' · 제출: ' + esc(P.court) : '') + '</div></div>';
    if (!P.has) h += '<p class="bd-warn">이 기기에 당사자 정보가 없어 1:1 매매 기준으로 만들었습니다. 서류 작성 화면을 거치거나 위임장 파일을 올리면 내 케이스에 맞춰집니다.</p>';
    for (var k = 0; k < P.filings; k++) {
      var b = P.buyers[k] || {};
      h += '<div class="bd-f"><div class="bd-fh">' + (P.filings > 1 ? '신청서 ' + (k + 1) + ' / ' + P.filings + ' — 등기권리자 ' + esc(b.name || ('매수인 ' + (k + 1))) : '위에서부터 이 순서로 겹쳐 제출') + '</div>' +
        '<table class="bd-tb"><thead><tr><th>순서</th><th>서류</th><th>통수</th><th>확인</th></tr></thead><tbody>';
      rows(P, k).forEach(function (r, i) {
        h += '<tr' + (r.cnt === '원용' ? ' class="cite"' : '') + '><td>' + (i + 1) + '</td><td><b>' + esc(r.name) + '</b><div class="bd-n">' + esc(r.note || '') + '</div></td><td class="c">' + esc(r.cnt) + '</td><td class="c">☐</td></tr>';
      });
      h += '</tbody></table></div>';
    }
    h += '<div class="bd-f"><div class="bd-fh">날인·간인 마지막 확인</div><ul class="bd-l">' +
      '<li>위임장의 매도인 도장이 <b>인감증명서의 인영과 같은 인감도장</b>인지 겹쳐 보고 확인합니다.</li>' +
      '<li>여러 장으로 된 서류는 장 사이에 간인합니다 — 위임장은 매도인 인감, 신청서는 신청인 도장.</li>' +
      '<li>신청서 「첨부서면」란의 통수를 위 표의 숫자대로 적습니다' + (P.filings > 1 ? ' — 2건차 신청서에는 「전건첨부원용」을 적습니다' : '') + '.</li>' +
      '<li>등기필정보의 일련번호·비밀번호를 신청서에 적었는지, 원본을 챙겼는지 확인합니다.</li></ul></div>' +
      '<p class="bd-foot">순서는 소유권이전등기신청서(매매) 양식의 첨부서면 기재 순서를 따랐습니다. 등기소·담당자에 따라 다를 수 있으니 접수 전 관할 등기소 안내데스크에서 확인하십시오. · 셀프등기24</p></div>';
    return h;
  }

  function ensureModal() {
    var el = $('bd-modal'); if (el) return el;
    el = document.createElement('div'); el.id = 'bd-modal'; el.className = 'bd-modal';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', '내 등기 서류 편철표');
    el.innerHTML = '<div class="bd-bg" data-close></div><div class="bd-c"><div class="bd-bar"><button type="button" class="bd-print">인쇄하기</button><button type="button" class="bd-x" data-close>닫기</button></div><div class="bd-body" id="bd-body"></div></div>';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) close();
      if (e.target.classList.contains('bd-print')) { trk('bundle_print', { mode: 'print' }); window.print(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    return el;
  }
  function close() { var el = $('bd-modal'); if (el) el.classList.remove('open'); document.documentElement.classList.remove('bd-lock'); }
  function openBundle() {
    var P = people();
    var el = ensureModal();
    $('bd-body').innerHTML = sheetHtml(P);
    el.classList.add('open'); document.documentElement.classList.add('bd-lock');
    trk('bundle_open', { mode: P.filings > 1 ? 'two' : 'one' });
  }
  window.SRBundle = { open: openBundle };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindResume); else bindResume();
})();
