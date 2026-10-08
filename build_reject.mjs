// reject.html 본문 생성기 — rejectkb.js(반려·각하 지식베이스)를 정적 HTML로 굳힌다.
// 왜 정적인가: AI 크롤러·검색 수집기는 스크립트를 실행하지 않는 경우가 많아, 화면에서 kb를 읽어 그리면 본문이 비어 보인다.
// 사용: node build_reject.mjs   (rejectkb.js를 고친 뒤 다시 실행하고 reject.html을 함께 커밋)
// reject.html의 <!-- KB:BEGIN -->~<!-- KB:END --> 와 <!-- KBLD:BEGIN -->~<!-- KBLD:END --> 사이만 바꾼다. 나머지(메뉴·스타일·푸터)는 손으로 관리.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const KB = require('./rejectkb.js');
const CASE = 'A';                      // 소유권이전(매매)만 싣는다
const SEV = { high: '각하로 이어지기 쉬움', mid: '보정 대상이 되기 쉬움', low: '지연 요인' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const checks = KB.byCase(CASE);

/* 화면 FAQ = JSON-LD. 답은 kb의 why·fix와 같은 사실만 쓴다(kb를 고치면 여기도 확인). */
const FAQ = [
  ['소유권이전등기 각하 사유는 몇 가지인가요?',
   '부동산등기법 제29조에 11가지로 정해져 있습니다. 관할이 아닌 경우, 등기할 것이 아닌 경우, 신청 권한이 없는 경우, 출석하지 않은 경우, 신청정보 방식 위반, 부동산·권리 표시 불일치, 등기의무자 표시 불일치, 등기원인 불일치, 첨부정보 누락, 세금·수수료 미납, 대장과의 불일치입니다.'],
  ['보정명령을 받으면 언제까지 고쳐야 하나요?',
   '등기관이 보정을 명한 날의 다음 날까지 보정하면 각하하지 않습니다(부동산등기법 제29조 단서). 기한이 짧아 먼 등기소라면 다시 가기 어려울 수 있으니, 접수 전에 서류를 대조해 두는 것이 좋습니다.'],
  ['매도인 주소가 등기부와 다르면 각하되나요?',
   '주민등록번호가 등기기록과 같고, 주민등록초본으로 등기부상 주소가 현재 주소로 바뀐 사실이 확인되면 각하하지 않습니다(부동산등기규칙 제52조의2). 초본은 최근 5년이 아니라 주소 변동 사항 전체가 나오도록 발급받으세요.'],
  ['초본·등본의 주민등록번호 뒷자리가 가려져 있어도 되나요?',
   '가려져 있으면 등기기록·신청정보와 대조할 수 없어 첨부정보로 쓰기 어렵습니다. 정부24에서 발급할 때 주민등록번호 뒷자리 포함을 선택하세요. 매도인 초본과 매수인 등본 모두 해당합니다.'],
  ['등기원인일자는 잔금일인가요, 계약일인가요?',
   '매매를 원인으로 하는 소유권이전등기의 등기원인일자는 매매계약 체결일입니다. 잔금일은 취득세의 취득일 기준이라 혼동하기 쉬우니 계약서와 대조하세요.'],
];

const groundsUsed = KB.GROUNDS.map(g => ({ g, items: checks.filter(c => c.ground === g.id) }));
/* 그룹 제목용 짧은 이름 — 제7호처럼 단서가 붙은 긴 문언은 본문(02)에 전문이 있으므로 첫 문장만 쓴다 */
const shortText = t => t.split('. 다만')[0];

let h = '';
h += `<main id="main">
<div class="page-header">
  <div class="page-header-inner">
    <div class="page-eyebrow">부동산등기법 제29조 · 지식베이스 v${esc(KB.VERSION)} (${esc(KB.UPDATED)})</div>
    <h1>소유권이전등기 반려·각하, 사유는 법에 11가지로 정해져 있습니다</h1>
    <p>등기관이 신청을 각하할 수 있는 사유는 부동산등기법 제29조에 11가지로 정해져 있습니다. 보정명령을 받았다면 보정을 명한 날의 다음 날까지 고치면 각하되지 않습니다.</p>
  </div>
</div>

<div class="wrap">
  <section class="card" id="cure" aria-labelledby="r1-h">
    <div class="ch">
      <div class="step-num">01</div>
      <div><h2 class="ct" id="r1-h">보정명령을 받았을 때</h2><div class="cs">고칠 수 있는 잘못이면 기한 안에 보정합니다</div></div>
    </div>
    <p class="ans"><b>보정을 명한 날의 다음 날까지 보정하면 각하하지 않습니다.</b> ${esc(KB.CURE.text)}</p>
    <div class="note">${esc(KB.CURE.caution)}</div>
    <p class="src">근거: ${esc(KB.CURE.basis)}</p>
  </section>

  <section class="card" id="grounds" aria-labelledby="r2-h">
    <div class="ch">
      <div class="step-num">02</div>
      <div><h2 class="ct" id="r2-h">각하 사유 11가지</h2><div class="cs">부동산등기법 제29조 각 호 문언 그대로입니다</div></div>
    </div>
    <ol class="grounds">
`;
for (const { g, items } of groundsUsed) {
  h += `      <li><span class="gno">제${g.no}호</span><span class="gtx">${esc(g.text)}`;
  h += items.length ? ` <a class="gcnt" href="#${g.id}">점검항목 ${items.length}개</a>` : '';
  h += `</span></li>\n`;
}
h += `    </ol>
    <p class="src">근거: 부동산등기법 제29조. 등기관은 신청정보·첨부정보·등기기록만으로 판단하므로(형식적 심사, 대법원 2017마6419), 각하는 대개 서류끼리 서로 맞지 않을 때 생깁니다.</p>
  </section>

  <section class="card" id="checks" aria-labelledby="r3-h">
    <div class="ch">
      <div class="step-num">03</div>
      <div><h2 class="ct" id="r3-h">소유권이전(매매) 접수 전 점검항목 ${checks.length}개</h2><div class="cs">각 항목은 위 11가지 사유 중 하나에 속하고, 근거 조문·예규를 함께 적었습니다</div></div>
    </div>
`;
for (const { g, items } of groundsUsed) {
  if (!items.length) continue;
  h += `    <div class="grp" id="${g.id}"><h3 class="grp-h">제${g.no}호 · ${esc(shortText(g.text))}</h3>\n`;
  for (const c of items) {
    h += `      <div class="chk">
        <h4 class="chk-t">${esc(c.title)} <span class="sev ${c.severity}">${SEV[c.severity]}</span></h4>
        <p><b>자주 생기는 일</b> ${esc(c.symptom)}</p>
        <p><b>왜 문제인가</b> ${esc(c.why)}</p>
        <p><b>확인할 점</b> ${esc(c.fix)}</p>
        <p class="src">근거: ${c.basis.map(esc).join(' · ')}</p>
      </div>
`;
  }
  h += `    </div>\n`;
}
h += `  </section>

  <section class="card" id="faq" aria-labelledby="r4-h">
    <div class="ch">
      <div class="step-num">Q</div>
      <div><h2 class="ct" id="r4-h">자주 묻는 질문</h2><div class="cs">위 내용을 질문별로 다시 정리했습니다</div></div>
    </div>
    <div class="faq">
`;
for (const [q, a] of FAQ) h += `      <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>\n`;
h += `    </div>
  </section>

  <div class="finish">
    <h3>접수 전에 서류끼리 맞는지 대조하세요</h3>
    <p>셀프등기24는 등기사항전부증명서를 읽어 부동산의 표시를 그대로 옮기고, 공동명의면 신청서·위임장을 규정에 맞게 나눠 Word 파일로 만듭니다. 최종 확인은 관할 등기소 안내를 따라 주세요.</p>
    <div class="finish-btns">
      <a href="normal_form.html" class="p" data-cta="reject">서류 작성하기</a>
      <a href="guide.html" class="g">셀프등기 가이드</a>
    </div>
  </div>
</div>
</main>`;

const ld = { '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };

const P = new URL('./reject.html', import.meta.url);
let s = readFileSync(P, 'utf8');
const put = (b, e, body) => {
  const i = s.indexOf(b), j = s.indexOf(e);
  if (i < 0 || j < i) throw new Error('marker missing: ' + b);
  s = s.slice(0, i + b.length) + '\n' + body + '\n' + s.slice(j);
};
put('<!-- KB:BEGIN -->', '<!-- KB:END -->', h);
put('<!-- KBLD:BEGIN -->', '<!-- KBLD:END -->', '<script type="application/ld+json">\n' + JSON.stringify(ld, null, 1) + '\n</script>');
writeFileSync(P, s);
console.log('reject.html:', checks.length, 'checks,', FAQ.length, 'faq');
