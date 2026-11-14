/* 전세 계약 전 등기부 점검 — node tests/jeonsecheck_test.js (2026-11-14)
   등기부 실물은 개인정보라 두지 않는다. summary_cases.js 의 합성 요약 페이지를 쓴다(이름 · 번호는 지어낸 값). */
var R = require('../regparse.js'), C = require('./summary_cases.js'), J = require('../jeonsecheck.js');
var fail = 0;
function eq(tag, got, want) { var ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log('  ✗ ' + tag + '\n      got  ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want)); } else console.log('  ✓ ' + tag); }
function run(opt) { return J.analyze(R.parseTokens(C.page(opt), { ocr: false })); }
function lv(a) { var o = {}; a.items.forEach(function (i) { o[i.key] = i.level; }); return o; }
var ENC = [['2', '압류', '2023년3월2일', '제11111호', '권리자 국민건강보험공단', '김예시'], ['3', '가압류', '2024년2월9일', '제33333호', '청구금액 금10,000,000원', '김예시']];
var LIEN = [['5', '근저당권설정', '2021년6월1일', '제44444호', '채권최고액 금360,000,000원 근저당권자 예시은행', '김예시'],
            ['6', '근저당권설정', '2022년6월1일', '제55555호', '채권최고액 금120,000,000원 근저당권자 예시캐피탈', '김예시']];
console.log('[깨끗한 등기부]');
var a0 = run({ enc: [], liens: [] });
eq('단계', lv(a0), { owner: 'info', block: 'ok', lien: 'ok' }); eq('합계 0', a0.lienSum, 0);
console.log('[압류 2 · 근저당 2]');
var a1 = run({ enc: ENC, liens: LIEN });
eq('단계', lv(a1), { owner: 'info', block: 'check', lien: 'check' }); eq('채권최고액 합계', a1.lienSum, 480000000); eq('근저당 건수', a1.lienCount, 2);
console.log('[공유 2명]');
var a2 = run({ enc: [], liens: [], owners: [['김예시 (공유자)', '800101-*******', '2분의 1', '서울 예시로 1', '2'], ['이예시 (공유자)', '820202-*******', '2분의 1', '서울 예시로 1', '2']] });
eq('소유자 2명', a2.owners, 2); eq('공유 안내', /여러 명/.test(a2.items[0].detail), true);
console.log('[신탁]');
var a3 = run({ enc: [['3', '신탁', '2024년1월1일', '제66666호', '수탁자 예시자산신탁', '예시자산신탁']], liens: [], owners: [['예시자산신탁 (수탁자)', '110111-*******', '단독소유', '서울 예시로 2', '3']] });
eq('신탁 표시', a3.trust, true); eq('신탁이 압류 칸에 섞이지 않음', lv(a3).block, 'ok');
console.log('[계산]');
eq('보증금 3억 + 4.8억 / 집값 10억', J.ratio('300,000,000', 480000000, '1000000000'), { total: 780000000, pct: 78, jeonsePct: 30 });
eq('집값 없음', J.ratio('100', 0, '').pct, null);
eq('전세가율만 (근저당 0)', J.ratio('270,000,000', 0, '300,000,000').jeonsePct, 90);
eq('집값 없으면 전세가율도 없음', J.ratio('100', 0, '').jeonsePct, null);
console.log('[주소 → 서울 구 페이지]');
eq('서울 강서구', J.guPage('서울특별시 강서구 화곡동 123-4 예시빌라 201호'), { gu: '강서구', href: 'jeonse_seoul_gangseo.html' });
eq('서울 중구(줄임 표기)', J.guPage('서울 중구 예시로 1'), { gu: '중구', href: 'jeonse_seoul_jung.html' });
eq('부산 중구는 아님', J.guPage('부산광역시 중구 예시로 1'), null);
eq('경기도는 아님', J.guPage('경기도 성남시 분당구 예시로 1'), null);
eq('강동구 · 강남구 구분', J.guPage('서울특별시 강동구 예시동 1').href, 'jeonse_seoul_gangdong.html');
eq('주소 없음', J.guPage(''), null);
(function () { /* 생성기(build_gu_pages.py)의 SLUG 와 같은 파일 이름인지 — 어긋나면 404 링크가 된다 */
  var py = require('fs').readFileSync(require('path').join(__dirname, '../docs/ops/metrics/iros/build_gu_pages.py'), 'utf8');
  var pairs = py.match(/'([가-힣]+구)': '([a-z]+)'/g) || [], bad = 0;
  pairs.forEach(function (p) { var m = /'([가-힣]+구)': '([a-z]+)'/.exec(p); var g = J.guPage('서울특별시 ' + m[1] + ' 예시동'); if (!g || g.href !== 'jeonse_seoul_' + m[2] + '.html') bad++; });
  eq('생성기 25개 구와 이름 일치', [pairs.length, bad], [25, 0]);
})();
console.log('[판독 실패]');
eq('ok:false', J.analyze({ ok: false }).ok, false);
console.log(fail ? '\n실패 ' + fail + '건' : '\n전부 통과'); process.exit(fail ? 1 : 0);
