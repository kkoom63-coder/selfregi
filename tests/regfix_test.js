/* 리포트 D2·D4 회귀 시험 — node tests/regfix_test.js (2026-10-25). 값은 리포트에 적힌 사례를 옮긴 것 */
var R = require('../regparse.js'), I = R._internal, fail = 0;
function eq(tag, got, want) { var ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log('  ✗ ' + tag + '\n      got  ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want)); } else console.log('  ✓ ' + tag); }
function ratio(s) { var r = I.parseRatio(I.ratioText(s)); return r && [r.denom, r.num]; }
console.log('[D4 대지권 비율 — 구형 등기부]');
eq('분자 자리에 등기원인 날짜', ratio('150184.6분의 1996년6월19일 (전 1) 73.593'), ['150184.6', '73.593']);
eq('최신 형식 그대로', ratio('28855.8분의 40.8844'), ['28855.8', '40.8844']);
eq('정수 비율 그대로', ratio('55분의 1'), ['55', '1']);
console.log('[D4 구조 — 등기원인 칸이 붙은 경우]');
eq('도면편철장 제거', I.structFrom('철근콘크리트조도면편철장 제2책382장'), '철근콘크리트조');
eq('콩크리트 오인식', I.structFrom('철근콩크리트구조'), '철근콘크리트구조');
eq('구조 아님', I.structFrom('도면편철장 제2책'), null);
console.log('[D4 머리 줄 — 소재지번·동·호]');
var hd = I.headerIdent(['[집합건물] 경기도 고양시 덕양구 화정동 870 은빛마을아파트 제553동 제14층 제1404호']);
eq('주소', hd && hd.address, '경기도 고양시 덕양구 화정동 870');
eq('동·호', hd && [hd.dong, hd.exclusiveNo], ['553', '제14층 제1404호']);
console.log('[D2 요약표 3번이 「기록사항 없음」 → 본문 근저당은 모두 말소]');
function eul() { return { liens: [{ rank: '18', receiptNo: '111', cancelled: false }, { rank: '3', receiptNo: '222', cancelled: false }], cancelledRanks: [] }; }
eq('기록사항 없음', I.markCancelled(eul(), [], 'none').liens.map(function (L) { return L.cancelled; }), [true, true]);
eq('요약표에 18번만', I.markCancelled(eul(), [{ receiptNo: '111' }], 'rows').liens.map(function (L) { return L.cancelled; }), [false, true]);
eq('요약표 없음 → 판단 보류(유효로 둠)', I.markCancelled(eul(), [], 'absent').liens.map(function (L) { return [L.cancelled, L.inSummary]; }), [[false, null], [false, null]]);
var C = require('./summary_cases.js');
var s = I.parseSummary(I.tokensToLines(C.page({ enc: [], liens: [], merged: true }), { ocr: false }));
eq('합성 요약표 3번 상태', s.lienStatus, 'none');
console.log(fail ? '\n실패 ' + fail + '건' : '\n전부 통과'); process.exit(fail ? 1 : 0);
