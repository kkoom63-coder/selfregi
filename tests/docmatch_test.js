/* 서류 대조(초본 주소 이력 · 인감증명서 매수자) 시험 — node tests/docmatch_test.js (2026-11-12)
   값은 전부 지어낸 값. 초본 양식은 주민등록법 시행규칙 별지 제19호(주소 변동 표: 번호 · 주소 · 발생일/신고일 · 변동사유). */
var D = require('../docmatch.js'), fail = 0;
function eq(tag, got, want) { var ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log('  ✗ ' + tag + '\n      got  ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want)); } else console.log('  ✓ ' + tag); }
/* 줄 배열 → 토큰({str,x,y}, y는 아래에서 잰 값). 칸 사이는 x를 띄운다 */
function tok(rows) { var out = []; rows.forEach(function (cells, i) { cells.forEach(function (c, j) { if (c) out.push({ str: c, x: [40, 70, 360, 450, 520][j] || 40 + j * 80, y: 760 - i * 18 }); }); }); return out; }

console.log('[주소 정규화]');
eq('띄어쓰기 · 쉼표 · 괄호 동명', D.normAddr('서울특별시 견본구 견본로 12, 101동 1001호 (견본동, 견본아파트)'), '서울특별시견본구견본로12101동1001호');
eq('서울시 → 서울특별시', D.normAddr('서울시 견본구 견본로 12'), '서울특별시견본구견본로12');
eq('번지 · 제 · 하이픈', D.normAddr('경기도 견본시 견본동 123번지 제101동 제1001호'), D.normAddr('경기도 견본시 견본동 123 101동 1001호'));

console.log('[초본 주소 이력 추출]');
var chobon = tok([
  ['주민등록표', '(초본)'],
  ['번호', '주소', '발생일/신고일', '변동사유'],
  ['1', '경기도 견본시 견본동 123', '2010-03-02', '전입'],
  ['', '', '2010-03-02'],
  ['2', '서울특별시 견본구 견본로 12, 101동', '2018-07-15', '전입'],
  ['', '1001호 (견본동, 견본아파트)', '2018-07-16'],
  ['3', '서울특별시 견본구 견본로 12, 101동 1001호', '2020-01-01', '도로명주소'],
  ['4', '인천광역시 견본구 견본대로 5, 202동 303호', '2024-11-30', '전입']
]);
var r = D.parseChobon(chobon);
eq('행 수', r.rows.length, 4);
eq('줄바꿈된 주소 이어 붙임', r.rows[1].addr, '서울특별시 견본구 견본로 12, 101동 1001호 (견본동, 견본아파트)');
eq('날짜 · 사유', [r.rows[3].date, r.rows[3].reason], ['2024-11-30', '전입']);

console.log('[등기부 주소 → 초본 이력 이어짐]');
eq('등기부 주소가 이력 중간에 있음 → 이어짐', D.chain('서울특별시 견본구 견본로 12, 101동 1001호', r.rows).status, 'linked');
eq('이어진 칸 번호', D.chain('서울특별시 견본구 견본로 12, 101동 1001호', r.rows).at, 2);
eq('이력에 없는 주소 → 확인 필요', D.chain('부산광역시 견본구 견본로 9', r.rows).status, 'missing');
eq('동 · 호만 다름 → 확인 필요(단정 안 함)', D.chain('서울특별시 견본구 견본로 12, 102동 1001호', r.rows).status, 'review');
eq('이력이 비면 → 판독 실패', D.chain('서울특별시 견본구 견본로 12', []).status, 'unread');

console.log('[인감증명서 매수자 칸]');
var seal = '부동산 매수자 성명 김견본 주민등록번호 800101-1****** 주소 인천광역시 견본구 견본대로 5, 202동 303호';
eq('매수인 1명 — 이름 · 주소 있음', D.sealBuyers(seal, [{ name: '김견본', addr: '인천광역시 견본구 견본대로 5, 202동 303호' }]), [{ name: '김견본', name_ok: true, addr_ok: true }]);
eq('공동명의 — 한 명 빠짐', D.sealBuyers(seal, [{ name: '김견본' }, { name: '이견본' }]).map(function (b) { return b.name_ok; }), [true, false]);
eq('이름 사이 판독 빈칸', D.sealBuyers('매수자 성명 김 견 본', [{ name: '김견본' }])[0].name_ok, true);

console.log(fail ? '\n실패 ' + fail + '건' : '\n전부 통과'); process.exit(fail ? 1 : 0);
