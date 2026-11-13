/* 서류 대조(2026-11-12 착수) — 이용자 브라우저 안에서만 판단한다(서버 전송 없음). 아직 어느 화면에도 연결하지 않았다.
   ① 주민등록표 초본의 주소 변동 표를 줄로 뽑는다(주민등록법 시행규칙 별지 제19호: 번호 · 주소 · 발생일/신고일 · 변동사유)
   ② 등기부상 주소가 초본 이력에 이어지는지 본다 — 반려 1위(주소 이력 누락) 대비
   ③ 매도용 인감증명서 「부동산 매수자」 칸에 매수인 전원이 들어 있는지 본다 — 공동명의 각하 사유(83.3.20 등기 제118호)
   판정은 「이어짐 · 확인 필요 · 판독 실패」 셋뿐이다. 「일치합니다」로 단정하지 않는다(화면은 두 값을 나란히 보여 주고 이용자가 확인).
   입력 토큰 계약은 regocr · reportocr와 같다: { str, x, y }, x · y는 A4 폭 595pt 기준, y는 아래에서 잰 값.
   시험: node tests/docmatch_test.js (지어낸 값) */
(function (root) {
  var LINE_TOL = 5;
  var DATE = /(\d{4})[-.](\d{1,2})[-.](\d{1,2})/;

  /** @param {string} s @returns {string} 비교용 주소(빈칸 · 쉼표 · 괄호 속 동명 · 번지 · 「제」 제거) */
  function normAddr(s) {
    return String(s || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/^\s*서울시/, '서울특별시')
      .replace(/번지/g, '')
      .replace(/제(?=\s*\d)/g, '')
      .replace(/[\s,·]/g, '');
  }

  function toLines(tokens) {
    var t = (tokens || []).filter(function (k) { return k && k.str && String(k.str).trim(); })
      .map(function (k) { return { s: String(k.str).trim(), x: +k.x || 0, top: -(+k.y || 0) }; })
      .sort(function (a, b) { return a.top - b.top || a.x - b.x; });
    var lines = [];
    t.forEach(function (k) {
      var L = lines[lines.length - 1];
      if (L && Math.abs(k.top - L.top) <= LINE_TOL) L.items.push(k);
      else lines.push({ top: k.top, items: [k] });
    });
    lines.forEach(function (L) { L.items.sort(function (a, b) { return a.x - b.x; }); });
    return lines;
  }

  /* 머리줄(「주소」 · 「발생일」 · 「변동사유」)의 x로 칸 경계를 정한다 */
  function columns(lines) {
    for (var i = 0; i < lines.length; i++) {
      var items = lines[i].items;
      var get = function (re) { var k = items.filter(function (k) { return re.test(k.s.replace(/\s/g, '')); })[0]; return k ? k.x : null; };
      var a = get(/^주소$/), d = get(/^발생일/), r = get(/^변동사유/);
      if (a != null && d != null) return { head: i, addr: a - 10, date: d - 10, reason: r != null ? r - 10 : Infinity };
    }
    return null;
  }

  function ymd(m) { return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : ''; }

  /** @returns {{kind:'chobon'|'none', rows:Array<{no:number, addr:string, date:string, reason:string}>}} */
  function parseChobon(tokens) {
    var lines = toLines(tokens), col = columns(lines);
    if (!col) return { kind: 'none', rows: [] };
    var rows = [];
    lines.slice(col.head + 1).forEach(function (L) {
      var first = L.items[0];
      var isNew = first && first.x < col.addr && /^\d{1,3}$/.test(first.s);
      var addr = L.items.filter(function (k) { return k.x >= col.addr && k.x < col.date; }).map(function (k) { return k.s; }).join(' ');
      var dateTok = L.items.filter(function (k) { return k.x >= col.date && k.x < col.reason && DATE.test(k.s); })[0];
      var reason = L.items.filter(function (k) { return k.x >= col.reason; }).map(function (k) { return k.s; }).join(' ');
      if (isNew) {
        rows.push({ no: +first.s, addr: addr.replace(/\s+/g, ' ').trim(), date: ymd(dateTok && dateTok.s.match(DATE)), reason: reason.trim() });
      } else if (rows.length && addr) {
        var prev = rows[rows.length - 1];
        rows[rows.length - 1] = Object.assign({}, prev, { addr: (prev.addr + ' ' + addr).replace(/\s+/g, ' ').trim() });
      }
    });
    return { kind: rows.length ? 'chobon' : 'none', rows: rows };
  }

  function base(n) { return n.replace(/(\d+동)?\d+호$/, ''); }

  /** 등기부 주소가 초본 이력에 있는지. status: linked(이어짐) · review(비슷하나 다름 — 확인 필요) · missing(이력에 없음 — 확인 필요) · unread(판독 실패) */
  function chain(regAddr, rows) {
    if (!rows || !rows.length) return { status: 'unread' };
    var n = normAddr(regAddr);
    for (var i = 0; i < rows.length; i++) {
      if (normAddr(rows[i].addr) === n) return { status: 'linked', at: rows[i].no, path: rows.slice(i) };
    }
    for (var j = 0; j < rows.length; j++) {
      var r = normAddr(rows[j].addr);
      if (base(r) === base(n) || r.indexOf(n) >= 0 || n.indexOf(r) >= 0) return { status: 'review', at: rows[j].no, near: rows[j].addr };
    }
    return { status: 'missing' };
  }

  /** 인감증명서 판독 글자에 매수인 이름(과 주소)이 들어 있는지. 공동명의 표기 방식은 [미확인]이라 「들어 있는가」만 본다 */
  function sealBuyers(text, buyers) {
    var flat = String(text || '').replace(/\s+/g, ''), addrs = normAddr(text);
    return (buyers || []).map(function (b) {
      var out = { name: b.name, name_ok: !!b.name && flat.indexOf(String(b.name).replace(/\s+/g, '')) >= 0 };
      if (b.addr) out.addr_ok = addrs.indexOf(normAddr(b.addr)) >= 0;
      return out;
    });
  }

  var api = { normAddr: normAddr, parseChobon: parseChobon, chain: chain, sealBuyers: sealBuyers, _lines: toLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SRDocMatch = api;
})(typeof window !== 'undefined' ? window : this);
