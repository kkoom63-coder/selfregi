/* 요약표(주요 등기사항 요약) 합성 시험 데이터 — 2026-10-25
   실제 등기부 PDF는 개인정보라 저장소에 두지 않는다. 대신 리포트 D1에서 실측한 좌표
   (헤더 순위번호 x≈20~60, 등기목적 x≈101~141 / 데이터 순위번호 x=35, 등기목적 x=70.8)를
   그대로 옮긴 토큰을 만든다. 이름·번호는 모두 지어낸 값. */
var Y0 = 700, LH = 14;
function T(x, y, str, w) { return { x: x, y: y, w: w != null ? w : str.length * 9, size: 9, str: str }; }
/* 열 위치(헤더 가운데 정렬 · 데이터 왼쪽 정렬) */
var H = { rank: [20, '순위번호', 40], purpose: [101, '등기목적', 40], receipt: [190, '접수정보', 40], main: [300, '주요등기사항', 54], owner: [460, '대상소유자', 45] };
var D = { rank: 35, purpose: 70.8, receipt: 150, main: 245, owner: 455 };
function header(y) { return Object.keys(H).map(function (k) { return T(H[k][0], y, H[k][1], H[k][2]); }); }
/* rows: [rank, purpose, date, no, main, owner]  merged=true 이면 「2 압류」를 토큰 하나로(pdf.js가 한 덩어리로 줄 때) */
function rankTable(y, rows, merged) {
  var t = header(y); y -= LH;
  rows.forEach(function (r) {
    if (merged) t.push(T(D.rank, y, r[0] + ' ' + r[1], 50));
    else { t.push(T(D.rank, y, r[0], 8)); t.push(T(D.purpose, y, r[1])); }
    t.push(T(D.receipt, y, r[2])); t.push(T(D.main, y, r[4])); t.push(T(D.owner, y, r[5]));
    y -= LH; t.push(T(D.receipt, y, r[3])); y -= LH;
  });
  return { toks: t, y: y };
}
function page(opt) {
  var y = Y0, t = [];
  t.push(T(40, y, '주요 등기사항 요약 (참고용)', 160)); y -= LH * 2;
  t.push(T(40, y, '1. 소유지분현황 ( 갑구 )', 140)); y -= LH;
  [[30, '등기명의인', 50], [140, '(주민)등록번호', 70], [250, '최종지분', 40], [330, '주소', 20], [470, '순위번호', 40]].forEach(function (h) { t.push(T(h[0], y, h[1], h[2])); });
  y -= LH;
  (opt.owners || [['김예시 (소유자)', '800101-*******', '단독소유', '서울특별시 마포구 예시로 1', '2']]).forEach(function (o) {
    t.push(T(30, y, o[0])); t.push(T(140, y, o[1])); t.push(T(250, y, o[2])); t.push(T(330, y, o[3])); t.push(T(470, y, o[4])); y -= LH;
  });
  y -= LH;
  t.push(T(40, y, '2. 소유지분을 제외한 소유권에 관한 사항 ( 갑구 )', 260)); y -= LH;
  if (!opt.enc || !opt.enc.length) { t.push(T(40, y, '- 기록사항 없음', 80)); y -= LH; }
  else { var r = rankTable(y, opt.enc, opt.merged); t = t.concat(r.toks); y = r.y; }
  y -= LH;
  t.push(T(40, y, '3. (근)저당권 및 전세권 등 ( 을구 )', 200)); y -= LH;
  if (!opt.liens || !opt.liens.length) { t.push(T(40, y, '- 기록사항 없음', 80)); y -= LH; }
  else { var r2 = rankTable(y, opt.liens, opt.merged); t = t.concat(r2.toks); y = r2.y; }
  y -= LH; t.push(T(40, y, '[참고사항]', 60));
  return t;
}
module.exports = { page: page };
