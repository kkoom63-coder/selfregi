/* 부동산거래계약 신고필증 판독(2026-10-24) — 이용자 브라우저 안에서만 읽는다(서버 전송 없음).
   매도인·매수인 성명, 총 실제거래가격, 신고관리번호, 계약체결일, 잔금지급일을 뽑는다.
   신고필증은 인쇄체라 기존 판독기로 읽힌다. 손글씨 계약서는 읽지 않는다(직접 입력 안내).
   시험: docs/ops/research/contract_samples/synthetic (실제 서류의 당사자 칸을 지어낸 값으로 바꾼 합성본)
   입력 토큰 계약은 regocr·regocr_pp와 같다: { str, x, y }, x·y는 A4 폭 595pt 기준, y는 아래에서 잰 값.
   사용: SRReport.fromTokens(tokens) / SRReport.parsePdf(file) → { kind:'report', seller, buyer, price, … } | { kind:'none' } */
(function(){
  var NAME = /^[가-힣]{2,5}$/;
  var NOT_NAME = /^(성명|법인명|생년월일|국적|주소|전화|번호|휴대|대한민국|거래|지분|비율|위탁|관리인|상호|등록|사무소|소재지|매도인|매수인|개업|공인|중개사|대표|외국인|법인)/;
  var LINE_TOL = 5;

  function norm(s){ return String(s || '').replace(/\s+/g, ''); }

  /* 토큰을 위에서 아래로 줄로 묶는다(같은 높이 ±5pt). 각 줄 안은 왼쪽부터. */
  function toLines(tokens){
    var t = tokens.filter(function(k){ return k && k.str && String(k.str).trim(); })
      .map(function(k){ return { s: String(k.str).trim(), x: +k.x || 0, top: -(+k.y || 0) }; })
      .sort(function(a, b){ return a.top - b.top || a.x - b.x; });
    var lines = [];
    t.forEach(function(k){
      var L = lines[lines.length - 1];
      if (L && Math.abs(k.top - L.top) <= LINE_TOL) L.items.push(k);
      else lines.push({ top: k.top, items: [k] });
    });
    lines.forEach(function(L){
      L.items.sort(function(a, b){ return a.x - b.x; });
      L.text = L.items.map(function(k){ return k.s; }).join(' ');
    });
    return lines;
  }

  /* 「성명(법인명)」 라벨 바로 아래 줄(또는 같은 줄 오른쪽)에서 이름 하나 */
  function nameNear(lines, li, lab){
    var cands = [];
    function scan(L, sameLine){
      L.items.forEach(function(k){
        var w = norm(k.s).replace(/[()·]/g, '');
        if (!NAME.test(w) || NOT_NAME.test(w)) return;
        if (sameLine ? (k.x > lab.x && k.x - lab.x < 160) : Math.abs(k.x - lab.x) < 70) cands.push(w);
      });
    }
    scan(lines[li], true);
    for (var j = li + 1; j < lines.length && lines[j].top - lines[li].top < 40 && !cands.length; j++) scan(lines[j], false);
    return cands[0] || '';
  }

  /* 「주소(법인소재지)」 라벨 아래 줄(또는 같은 줄 오른쪽)의 주소 — 오른쪽 「거래지분」 칸 앞까지 */
  var ADDR = /[가-힣]+(특별시|광역시|특별자치시|특별자치도|도)\s|[가-힣]+(시|군|구)\s[가-힣]/;
  function addrNear(lines, li, lab){
    function pick(L, sameLine){
      var t = L.items.filter(function(k){
        return sameLine ? (k.x > lab.x + 10 && k.x - lab.x < 280) : (k.x > lab.x - 20 && k.x - lab.x < 280);
      }).map(function(k){ return k.s; }).join(' ').replace(/^주소\S*\s*/, '').trim();
      return ADDR.test(t + ' ') ? t : '';
    }
    var v = pick(lines[li], true);
    for (var j = li + 1; !v && j < lines.length && lines[j].top - lines[li].top < 40; j++) v = pick(lines[j], false);
    return v ? spaceAddr(v) : '';
  }
  /* 판독기가 글자 사이에 빈칸을 끼운다(「대 전광 역시」) → 빈칸을 모두 지우고 주소 단위마다 다시 띄운다 */
  function spaceAddr(a){
    return a.replace(/\s+/g, '')
      .replace(/(특별시|광역시|특별자치시|특별자치도)/g, '$1 ')
      .replace(/^([가-힣]{2,4}도)(?=[가-힣]+[시군])/, '$1 ')
      .replace(/([가-힣]시)(?=[가-힣]+구)/g, '$1 ')
      .replace(/([가-힣][구군])(?=[가-힣]+(동|읍|면|로|길|가))/g, '$1 ')
      .replace(/([가-힣])(?=\d)(?!\d+가(?:\d|$))/g, '$1 ')
      .replace(/(\d)(?=[가-힣])(?![동호층번차단])(?!가(?:\d|\s|$))/g, '$1 ')
      .replace(/(\d[동가])(?=\d)/g, '$1 ')
      .replace(/,(?=\S)/g, ', ')
      .replace(/(\S)\(/g, '$1 (')
      .replace(/\s+/g, ' ').trim();
  }

  function ymd(m){ return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : ''; }
  function dateAfter(text, label){
    var re = new RegExp(label + '[^0-9]{0,12}(\\d{4})\\s*[년.\\-/]\\s*(\\d{1,2})\\s*[월.\\-/]\\s*(\\d{1,2})');
    return ymd(text.match(re));
  }
  function amount(s){ return +String(s).replace(/[^\d]/g, ''); }

  function fromTokens(tokens){
    var lines = toLines(tokens || []);
    var flat = lines.map(function(L){ return L.text; }).join('\n');
    if (!/신고필증/.test(norm(flat))) return { kind: 'none' };

    /* 성명 라벨을 위에서부터 — 위탁관리인 줄은 빼고, 앞의 두 칸이 매도인·매수인(서식 순서), 세 번째는 중개사 */
    var names = [], addrs = [];
    lines.forEach(function(L, li){
      if (/위탁관리인/.test(L.text)) return;
      L.items.forEach(function(k){
        var n = norm(k.s);
        if (/^성명/.test(n)) names.push(nameNear(lines, li, k));
        else if (/^주소/.test(n)) addrs.push(addrNear(lines, li, k));
      });
    });
    /* 칸 이름(①매도인·②매수인)이 읽혔으면 그 위아래 순서를 따른다 */
    var ys = {}; lines.forEach(function(L){ var n = norm(L.text);
      if (/매도인/.test(n) && ys.s == null) ys.s = L.top;
      if (/매수인/.test(n) && ys.b == null) ys.b = L.top; });
    var buyerFirst = ys.s != null && ys.b != null && ys.b < ys.s;

    /* 판독기가 라벨·숫자 사이에 빈칸을 끼운다(「계약 체 결 일」「38, 733,000」) → 줄마다 빈칸을 지운 글로 찾는다 */
    var tight = lines.map(function(L){ return norm(L.text); }).join('\n');
    /* 금액: 총 실제거래가격 = 표의 가장 큰 금액. 계약금+중도금+잔금과 맞으면 확인됨 */
    var amts = (tight.match(/\d{1,3}(?:[,.:]\d{3}){2,3}/g) || []).map(amount).filter(function(v){ return v >= 1e6; });
    var price = amts.length ? Math.max.apply(null, amts) : 0;
    function part(label){ var m = tight.match(new RegExp(label + '[^0-9\\n]{0,6}(\\d{1,3}(?:[,.:]\\d{3}){1,3})')); return m ? amount(m[1]) : 0; }
    var dep = part('계약금'), mid = part('중도금'), bal = part('잔금');
    var no = (tight.match(/\d{5}-\d{4}-\d{1,2}-\d{5,8}/) || [])[0] || '';

    return {
      kind: 'report',
      seller: (buyerFirst ? names[1] : names[0]) || '',
      buyer: (buyerFirst ? names[0] : names[1]) || '',
      sellerAddr: (buyerFirst ? addrs[1] : addrs[0]) || '',
      buyerAddr: (buyerFirst ? addrs[0] : addrs[1]) || '',
      price: price ? String(price) : '',
      priceOk: !!(price && dep && bal && dep + mid + bal === price),
      no: no,
      cause: dateAfter(tight, '계약체결일'),
      balance: dateAfter(tight, '잔금지급일')
    };
  }

  /* 글자 들어 있는 PDF(부동산거래관리시스템에서 받은 원본) — 첫 쪽만. 글자가 없으면 none(사진 판독으로 넘김) */
  function parsePdf(file){
    var lib = window.pdfjsLib;
    if (!lib || !file) return Promise.resolve({ kind: 'none' });
    return file.arrayBuffer().then(function(buf){ return lib.getDocument({ data: buf }).promise; })
      .then(function(doc){ return doc.getPage(1); })
      .then(function(page){
        var w = page.getViewport({ scale: 1 }).width, s = 595.28 / w;
        return page.getTextContent().then(function(tc){
          return fromTokens(tc.items.map(function(it){ return { str: it.str, x: it.transform[4] * s, y: it.transform[5] * s }; }));
        });
      }).catch(function(){ return { kind: 'none' }; });
  }

  window.SRReport = { fromTokens: fromTokens, parsePdf: parsePdf, _lines: toLines };
})();
