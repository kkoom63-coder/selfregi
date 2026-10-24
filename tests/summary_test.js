/* 요약표 판독 회귀 시험 — node tests/summary_test.js  (2026-10-25, 리포트 D1·D2)
   한 군데 고칠 때마다 전부 통과해야 한다. */
var R = require('../regparse.js'), C = require('./summary_cases.js'), I = R._internal;
function lines(toks) { return I.tokensToLines(toks, { ocr: false }); }
var fail = 0;
function eq(tag, got, want) { var ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log('  ✗ ' + tag + '\n      got  ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want)); } else console.log('  ✓ ' + tag); }
var ENC = [['2', '압류', '2023년3월2일', '제11111호', '권리자 국민건강보험공단', '김예시'],
           ['3', '강제경매개시결정', '2024년1월5일', '제22222호', '채권자 예시캐피탈', '김예시'],
           ['4', '가압류', '2024년2월9일', '제33333호', '청구금액 금10,000,000원', '김예시']];
var LIEN = [['5', '근저당권설정', '2021년6월1일', '제44444호', '채권최고액 금360,000,000원 근저당권자 예시은행', '김예시']];
[false, true].forEach(function (merged) {
  var tag = merged ? '[한 토큰 「2 압류」]' : '[따로 된 토큰]';
  console.log(tag + ' 압류·경매·가압류 3건 + 근저당 1건');
  var s = I.parseSummary(lines(C.page({ enc: ENC, liens: LIEN, merged: merged })));
  eq('갑구 제한 순위번호', s.encumbrances.map(function (r) { return r.rank; }), ['2', '3', '4']);
  eq('갑구 제한 등기목적', s.encumbrances.map(function (r) { return r.purpose; }), ['압류', '강제경매개시결정', '가압류']);
  eq('갑구 제한 접수번호', s.encumbrances.map(function (r) { return r.receiptNo; }), ['11111', '22222', '33333']);
  eq('요약표 2번 상태', s.encStatus, 'rows');
  eq('을구 근저당 순위·목적', s.liens.map(function (r) { return r.rank + ' ' + r.purpose; }), ['5 근저당권설정']);
});
console.log('[기록사항 없음]');
var s0 = I.parseSummary(lines(C.page({ enc: [], liens: [] })));
eq('제한 0건', s0.encumbrances.length, 0); eq('요약표 2번 상태', s0.encStatus, 'none');
console.log('[표는 있는데 행을 못 읽음 → 없음이 아니라 확인 필요]');
var bad = C.page({ enc: ENC, liens: [] }).map(function (t) { return /^\d+$/.test(t.str) && t.x < 60 ? Object.assign({}, t, { str: '?' }) : t; });
var s1 = I.parseSummary(lines(bad));
eq('요약표 2번 상태', s1.encStatus, 'unread'); eq('요약표 2번 글자에서 찾은 제한', s1.encKeywords, ['압류', '경매', '가압류']);
console.log('[판독 결과 blockerStatus — 화면에 「없음」은 none일 때만]');
function st(toks) { var r = R.parseTokens(toks, { ocr: false }); return [r.blockerStatus, r.blockers ? r.blockers.map(function (b) { return b.purpose; }) : null, r.blockerWords]; }
eq('압류 등 3건', st(C.page({ enc: ENC, liens: LIEN, merged: true })), ['found', ['압류', '강제경매개시결정', '가압류'], ['압류', '경매', '가압류']]);
eq('기록사항 없음', st(C.page({ enc: [], liens: [] })), ['none', [], []]);
eq('표를 못 읽음', st(bad), ['check', [], ['압류', '경매', '가압류']]);
var GA = [['2', '소유권이전청구권가등기', '2024년4월1일', '제55555호', '가등기권자 예시', '김예시']];
eq('가등기만 있음 → found', st(C.page({ enc: GA, liens: [] })), ['found', ['소유권이전청구권가등기'], ['가등기']]);
/* 요약 페이지가 없는 등기부: 갑구 본문 글자에서 찾는다(말소된 것도 섞일 수 있어 「확인 필요」로만) */
function T(x, y, s) { return { x: x, y: y, w: s.length * 9, size: 9, str: s }; }
var body = [T(40, 700, '등기사항전부증명서(말소사항 포함)'), T(40, 680, '고유번호 1101-2010-000000'), T(40, 660, '【 갑 구 】 ( 소유권에 관한 사항 )'),
  T(20, 640, '순위번호'), T(101, 640, '등기목적'), T(35, 620, '3'), T(70, 620, '임의경매개시결정'), T(40, 580, '【 을 구 】 ( 소유권 이외의 권리에 관한 사항 )'), T(70, 560, '근저당권설정')];
var nb = st(body); eq('요약 없음 + 갑구에 경매', [nb[0], nb[2]], ['check', ['경매']]);
console.log(fail ? '\n실패 ' + fail + '건' : '\n전부 통과');
process.exit(fail ? 1 : 0);
