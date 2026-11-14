/* 전세 계약 전 등기부 점검 — selfregi24 (2026-11-14)
   regparse.js 판독 결과(parseRegistry · parseTokens)를 받아 「계약 전 확인할 것」 목록으로 바꾼다.
   판단(안전 · 위험)을 내리지 않는다. 등기부에 적힌 사실과 확인할 일만 말한다.
   브라우저 전용 계산 — 서버로 보내는 값 없음. */
(function (root) {
  'use strict';
  function won(v) { var n = Number(String(v == null ? '' : v).replace(/[^\d]/g, '')); return isFinite(n) ? n : 0; }
  function fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }

  /* level: ok(등기부에 기재 없음) · info(사실 확인) · check(계약 전 반드시 확인) · unknown(자동으로 못 읽음) */
  function analyze(r) {
    var items = [];
    if (!r || !r.ok) return { ok: false, items: items };

    /* 1. 소유자 — 계약 상대방과 같은 사람인지 */
    var owners = (r.owners || []).filter(function (o) { return o && o.name; });
    items.push(owners.length
      ? { key: 'owner', level: 'info',
          title: '소유자 ' + owners.map(function (o) { return o.name + (o.shareRaw && !/단독/.test(o.shareRaw) ? '(' + o.shareRaw + ')' : ''); }).join(', '),
          detail: owners.length > 1 ? '소유자가 여러 명입니다. 누가 계약하는지, 각 소유자의 지분을 확인하세요.' : '계약하는 임대인이 이 사람인지 신분증으로 확인하세요.' }
      : { key: 'owner', level: 'unknown', title: '소유자를 읽지 못했습니다',
          detail: '등기부 「주요 등기사항 요약」 1번(소유지분현황)에서 소유자를 직접 확인하세요.' });

    /* 2. 신탁 — 소유자가 신탁회사(수탁자)면 신탁원부를 봐야 한다 */
    var trust = !!r.isTrust || (r.blockers || []).some(function (b) { return /신탁/.test(b.purpose || ''); }) ||
      owners.some(function (o) { return o.role === '수탁자'; });
    if (trust) items.push({ key: 'trust', level: 'check', title: '신탁등기가 있습니다',
      detail: '소유자가 신탁회사(수탁자)로 되어 있습니다. 누가 임대할 권한이 있는지는 신탁원부에 적혀 있으니, 등기소에서 신탁원부를 발급받아 확인하세요.' });

    /* 3. 압류 · 가압류 · 가처분 · 경매 · 가등기 (갑구) — 신탁은 위에서 따로 말한다 */
    var bl = (r.blockers || []).filter(function (b) { return !/신탁/.test(b.purpose || ''); });
    var st = r.blockerStatus;
    if (bl.length) items.push({ key: 'block', level: 'check', title: bl.map(function (b) { return b.purpose; }).join(' · ') + ' 기재',
      detail: '소유권에 제한이 걸려 있습니다(' + bl.map(function (b) { return '갑구 ' + b.rank + '번' + (b.receiptDate ? ' ' + b.receiptDate : ''); }).join(', ') + '). 계약 전에 말소 여부와 경위를 확인하세요.' });
    else if (st === 'none' || st === 'found') items.push({ key: 'block', level: 'ok', title: '압류 · 가압류 · 가처분 · 경매 기재 없음', detail: '「주요 등기사항 요약」 2번 기준입니다.' });
    else items.push({ key: 'block', level: 'unknown', title: '압류 · 가압류 등을 자동으로 확인하지 못했습니다',
      detail: (r.blockerWords && r.blockerWords.length ? '등기부에 「' + r.blockerWords.join(' · ') + '」 글자가 있습니다. ' : '') + '등기부 갑구와 「주요 등기사항 요약」 2번을 직접 확인하세요.' });

    /* 4. 근저당 · 전세권 (을구) — 채권최고액 합계 */
    var liens = (r.activeLiens && r.activeLiens.length) ? r.activeLiens : (r.liens || []).filter(function (L) { return !L.cancelled; });
    var sum = liens.reduce(function (n, L) { return n + won(L.maxAmount); }, 0);
    if (liens.length) items.push({ key: 'lien', level: 'check', title: '근저당 등 ' + liens.length + '건 · 채권최고액 합계 ' + fmt(sum) + '원',
      detail: liens.map(function (L) { return '을구 ' + (L.rank || '?') + '번 ' + (L.purpose || '') + (L.maxAmount ? ' ' + fmt(won(L.maxAmount)) + '원' : '') + (L.creditor ? ' (' + L.creditor + ')' : ''); }).join(' / ') +
        '. 아래 계산에 보증금과 집값을 넣어 보세요.' });
    else if (r.lienStatus === 'none') items.push({ key: 'lien', level: 'ok', title: '근저당 · 전세권 기재 없음', detail: '「주요 등기사항 요약」 3번 기준입니다.' });
    else items.push({ key: 'lien', level: 'unknown', title: '근저당을 자동으로 확인하지 못했습니다', detail: '등기부 을구와 「주요 등기사항 요약」 3번을 직접 확인하세요.' });

    return { ok: true, items: items, lienSum: sum, lienCount: liens.length, owners: owners.length, trust: trust,
             address: (r.property && (r.property.roadAddress || r.property.jibunAddress)) || '' };
  }

  /* 보증금 + 앞선 채권최고액이 집값의 몇 %인지, 전세가율(보증금 ÷ 집값) — 판단 없이 숫자만 */
  function ratio(deposit, lienSum, price) {
    var d = won(deposit), p = won(price), s = d + (lienSum || 0);
    var pct = function (n) { return p > 0 ? Math.round(n / p * 1000) / 10 : null; };
    return { total: s, pct: pct(s), jeonsePct: pct(d) };
  }

  /* 등기부 주소가 서울이면 그 구의 「전세 신호」 페이지를 돌려준다(주소는 이 기기 안에서만 쓴다).
     파일 이름은 docs/ops/metrics/iros/build_gu_pages.py 의 SLUG 와 같아야 한다. */
  var GU_SLUG = { '종로구': 'jongno', '중구': 'jung', '용산구': 'yongsan', '성동구': 'seongdong', '광진구': 'gwangjin',
    '동대문구': 'dongdaemun', '중랑구': 'jungnang', '성북구': 'seongbuk', '강북구': 'gangbuk', '도봉구': 'dobong',
    '노원구': 'nowon', '은평구': 'eunpyeong', '서대문구': 'seodaemun', '마포구': 'mapo', '양천구': 'yangcheon',
    '강서구': 'gangseo', '구로구': 'guro', '금천구': 'geumcheon', '영등포구': 'yeongdeungpo', '동작구': 'dongjak',
    '관악구': 'gwanak', '서초구': 'seocho', '강남구': 'gangnam', '송파구': 'songpa', '강동구': 'gangdong' };
  function guPage(address) {
    var m = /^\s*서울(?:특별시)?\s+(\S+구)(?:\s|$)/.exec(String(address || ''));
    if (!m || !GU_SLUG[m[1]]) return null;
    return { gu: m[1], href: 'jeonse_seoul_' + GU_SLUG[m[1]] + '.html' };
  }

  var api = { analyze: analyze, ratio: ratio, guPage: guPage, _won: won };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.JeonseCheck = api;
})(typeof window !== 'undefined' ? window : null);
