/* regfields.js — 등기사항전부증명서 라벨 앵커 추출기  v1 (2026.08.21)
 *
 * 왜 이걸 따로 만드는가
 *   regparse.js 의 표 판정(splitByBands)은 '토큰의 x좌표'로 열을 가른다.
 *   텍스트 레이어 PDF에서는 좌표가 진짜라 잘 맞지만, 사진·스캔 경로에서는
 *   OCR 이 한 페이지를 여러 벌로 묶어 내놓기 때문에 좌표가 겹치고 값이 반복된다
 *   (실측: 주소 5회 반복, '고다영고다영', 대지권비율 실종).
 *
 *   등기부는 대법원이 정한 고정 서식이라 라벨이 바뀌지 않는다.
 *   그래서 좌표를 버리고 라벨 옆의 값을 집는다.
 *   전부 '첫 일치만' 취하므로 결과가 몇 벌이 들어오든 값이 늘어날 수 없다.
 *
 * 쓰는 곳: 사진·스캔(OCR) 경로 전용.
 *   텍스트 레이어 PDF는 regparse.js 를 그대로 쓴다(5/5 검증된 자산).
 *
 * 반환 형태는 regparse.parseRegistry/parseTokens 와 같다 → normal_form 무수정.
 */
(function (root) {
  'use strict';

  // ---------- 문자 정리 ----------
  /* OCR 이 어느 엔진이든 똑같이 틀리는 것만 고친다. 내용 추정은 하지 않는다. */
  function fix(s) {
    return String(s == null ? '' : s)
      .replace(/[\u00A0\u2007\u202F]/g, ' ')
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[㎡]/g, 'm2').replace(/m²/g, 'm2').replace(/m'/g, 'm2')
      .replace(/[ㅣ｜|丨︱]/g, ' ')      // 표 세로 괘선이 글자로 읽힌 것
      .replace(/[，､]/g, ',');
  }
  function sq(s) { return fix(s).replace(/\s+/g, ''); }        // 공백 제거본 — 라벨 매칭 전용
  /* 값 추출용. 한글끼리 벌어진 공백만 붙이고 숫자 앞뒤 공백은 남긴다.
     전부 지우면 '55분의 1 1986년…'이 '55분의11986년'이 되어 분자가 11986이 된다. */
  function sqk(s) {
    var t = fix(s).replace(/\s{2,}/g, ' ').trim();
    for (var i = 0; i < 4; i++) t = t.replace(/([가-힣])\s+([가-힣])/g, '$1$2');
    return t.replace(/\s{2,}/g, ' ').trim();
  }
  function tidy(s) { return fix(s).replace(/\s{2,}/g, ' ').trim(); }

  // ---------- 닫힌 집합 스냅 ----------
  /* 구조·지목은 종류가 정해져 있다. 한두 글자 틀린 것은 되돌린다.
     (실측: 철근콘크리트조 → '철근콩크리트조'로 읽힘) */
  var STRUCT = ['철근콘크리트조', '철근콘크리트구조', '철골철근콘크리트조', '철골철근콘크리트구조',
    '철골조', '철골구조', '연와조', '벽돌조', '블록조', '목조', '석조', '경량철골조'];
  var JIMOK = ['전', '답', '과수원', '목장용지', '임야', '광천지', '염전', '대', '공장용지', '학교용지',
    '주차장', '주유소용지', '창고용지', '도로', '철도용지', '제방', '하천', '구거', '유지', '양어장',
    '수도용지', '공원', '체육용지', '유원지', '종교용지', '사적지', '묘지', '잡종지'];

  function dist(a, b) {                                   // 편집거리(짧은 문자열 전용)
    var m = a.length, n = b.length, i, j, prev = [], cur = [];
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur.slice();
    }
    return prev[n];
  }
  function snap(v, set, maxD) {
    if (!v) return v;
    var best = null, bd = 1e9;
    set.forEach(function (c) { var d = dist(v, c); if (d < bd) { bd = d; best = c; } });
    return (bd <= (maxD == null ? 2 : maxD)) ? best : v;
  }

  // ---------- 시·도 이름 ----------
  /* 주소가 어디서 시작하는지 잡는 유일한 단서. 행정구역 개편으로 새 이름이
     생길 수 있으므로(실측: '전남광주통합특별시') 목록이 아니라 어미로 판정한다. */
  var SIDO = '[가-힣]{2,8}(?:특별자치시|특별자치도|특별시|광역시|[가-힣]?도(?![로면])|시)';

  // ---------- 본체 ----------
  function extract(input, opt) {
    opt = opt || {};
    var text = Array.isArray(input) ? input.join('\n') : String(input || '');
    var lines = text.split(/\r?\n/).map(fix).filter(function (t) { return t.trim(); });
    var S = lines.map(sq);                     // 공백 제거본(라벨 매칭)
    var T = lines.map(tidy);                   // 공백 보존본(주소 등 값 추출)
    var K = lines.map(sqk);                    // 값 추출본(숫자 경계 보존)
    var ALL = S.join('\u0001');                // 라벨 찾기용
    var ALLK = K.join('\u0001');               // 값 읽기용

    var out = {
      ok: false, docType: '', scope: '', uid: '',
      property: {}, owners: [], confidence: {}, warnings: [],
      isJointOwnership: false, ownerCount: 0, hasBlocker: false, isTrust: false,
      _engine: 'regfields'
    };
    var P = out.property;

    /* 라벨 뒤의 값을 집는다. 줄이 넘어가도 되도록 전체 문자열에서 찾는다.
       always 첫 일치만 쓴다 — 결과가 여러 벌 들어와도 값이 늘지 않는 이유. */
    function first(re) { var m = ALL.match(re); return m ? m : null; }

    // (1) 문서 종류 · 발급 범위
    if (/집합건물/.test(ALL)) out.docType = '집합건물';
    else if (/\[토지\]|-토지-|토지의표시/.test(ALL)) out.docType = '토지';
    else if (/\[건물\]|-건물-/.test(ALL)) out.docType = '건물';
    out.scope = /말소사항포함/.test(ALL) ? '말소사항포함' : '현재유효사항';
    if (out.scope === '말소사항포함') {
      out.warnings.push('「말소사항 포함」 발급본입니다. 취소선이 그어진 옛 기재사항도 글자로는 그대로 읽힙니다. 소유자·주소가 옛 값일 수 있으니 반드시 원본과 대조하세요.');
    }

    // (2) 부동산고유번호 — 형식이 고정이라 라벨 없이도 안전하다
    var mu = first(/(\d{4})-?(\d{4})-?(\d{6})/);
    if (mu) P.uid = out.uid = mu[1] + '-' + mu[2] + '-' + mu[3];

    // (3) 머리글 식별줄 — 소재지번 · 건물명 · 동 · 층 · 호가 한 줄에 있다
    /*  [집합건물] 서울특별시 중구 신당동 372-13 제2층 제207호
        표 안의 표제부보다 이 줄이 훨씬 안정적이다. 페이지마다 반복되므로
        OCR 이 한 곳에서 틀려도 다른 곳에서 건진다. */
    var head = null;
    for (var i = 0; i < S.length; i++) {
      var mh = S[i].match(/^\[?(집합건물|토지|건물)\]?(.+)$/);
      if (!mh) continue;
      var body = mh[2];
      /* 머리글 뒤에 표 제목이 붙어 읽히는 경우가 있다(실측: '…제207호1.소유지분현황').
         식별자까지만 자른다. */
      var cut = body.match(/제\d+층제[0-9가-힣]+호/);
      if (cut) body = body.slice(0, cut.index + cut[0].length);
      if (!/\d/.test(body)) continue;
      if (!head || body.length > head.length) head = body;
    }
    if (head) {
      var mex = head.match(/제(\d+)층제([0-9가-힣]+)호/);
      if (mex) P.exclusiveNo = '제' + mex[1] + '층 제' + mex[2] + '호';
      var addr = mex ? head.slice(0, mex.index) : head;
      /* 공백이 지워진 상태이므로 되살린다. 지번(숫자[-숫자])까지가 주소,
         그 뒤는 건물명·동이다. */
      P.jibunAddress = respaceAddr(addr);
    }

    // (4) 도로명주소
    /* 표에서는 라벨과 값이 다른 줄·다른 칸에 있다. 라벨 뒤를 읽으면 옆 칸의
       층별 면적이 딸려온다. 그래서 '시도…로/길 번호' 꼴인 줄을 직접 찾는다. */
    for (var ri = 0; ri < K.length; ri++) {
      var mrd = K[ri].match(new RegExp('(' + SIDO + '.*?(?:로|길)\\s*\\d+(?:-\\d+)?)(?![\\d-])'));
      if (mrd && !/층|m2/.test(mrd[1])) { P.roadAddress = respaceAddr(mrd[1]); break; }
    }

    // (5) 전유부분 — 구조 · 전유면적
    /*  전유부분의 건물의 표시 … 철근콘크리트조 52.69m2
        1동 건물내역에도 면적이 잔뜩 있으므로 반드시 이 라벨 뒤에서만 찾는다. */
    var exIdx = ALLK.indexOf('전유부분의건물의표시');
    if (exIdx >= 0) {
      var tail = ALLK.slice(exIdx, exIdx + 400);
      var ms = tail.match(/([가-힣]{2,10}(?:조|구조))/);
      if (ms) P.exclusiveStruct = snap(ms[1], STRUCT, 2);
      var ma = tail.match(/(\d{1,4}\.\d{1,4})\s*m2/);
      if (ma) P.exclusiveArea = ma[1];
    }

    // (6) 대지권의 비율
    /*  「55분의 1」 「63527.1분의 2025」 — 형태를 분류하지 않고 적힌 그대로 옮긴다. */
    var lrIdx = ALLK.indexOf('대지권비율');
    if (lrIdx < 0) lrIdx = ALLK.indexOf('대지권의표시');
    if (lrIdx >= 0) {
      var mlr = ALLK.slice(lrIdx, lrIdx + 300).match(/([\d,]+(?:\.\d+)?)\s*분의\s*([\d,]+(?:\.\d+)?)/);
      if (mlr) P.landRightRatio = { denom: mlr[1].replace(/,/g, ''), num: mlr[2].replace(/,/g, '') };
    }

    // (7) 토지 — 지목 · 면적
    /* 라벨('지 목  면 적')과 값이 다른 줄에 있어 라벨 뒤를 읽으면 '면적'이 지목으로 잡힌다.
       지목은 28종 닫힌 집합이므로, '지목단어 + 숫자m2' 꼴을 직접 찾는다. */
    for (var ji = 0; ji < K.length; ji++) {
      var mj = K[ji].match(/(?:^|[\s\d.])([가-힣]{1,4})\s*([\d,]+(?:\.\d+)?)\s*m2/);
      if (mj && JIMOK.indexOf(mj[1]) >= 0) {
        P.landCategory = mj[1];
        P.landArea = mj[2].replace(/,/g, '');
        break;
      }
    }

    // (8) 1동 건물내역 — 부동산 종류 판정용
    P.buildingDetail = [];
    S.forEach(function (t) {
      if (/(공동주택|아파트|오피스텔|업무시설|근린생활시설|점포|다세대주택|연립주택|주상복합|단독주택)/.test(t)) {
        P.buildingDetail.push(t);
      }
    });

    // (9) 별도등기 · 압류 등 · 신탁
    if (/별도등기/.test(ALL)) P.separateReg = { value: true };
    if (/(가압류|가처분|압류|경매개시결정|임의경매|강제경매)/.test(ALL)) out.hasBlocker = true;
    if (/신탁(?:등기|재산|원부)/.test(ALL)) out.isTrust = true;

    // (10) 소유자
    out.owners = extractOwners(S, K);
    out.ownerCount = out.owners.length;
    out.isJointOwnership = out.ownerCount > 1;

    // (11) 교차검증 — 그럴싸하게 틀린 값을 잡는다
    crossCheck(out, S);

    out.ok = !!(P.uid || P.jibunAddress);
    if (!out.ok) out.reason = 'NOT_REGISTRY';
    if (!P.landRightRatio && out.docType === '집합건물') {
      out.warnings.push('대지권비율을 읽지 못했습니다.');
    }
    return out;
  }

  // ---------- 주소 공백 복원 ----------
  /* 라벨 매칭을 위해 공백을 지웠으므로 읽을 수 있게 되돌린다.
     행정구역 어미와 지번 앞에서만 띄운다. 과하게 띄우면 오히려 읽기 나쁘다. */
  function respaceAddr(s) {
    return String(s || '')
      .replace(/(특별자치시|특별자치도|특별시|광역시|통합특별시)/g, '$1 ')
      .replace(/([가-힣])(시|군|구|읍|면|동|리|가|로|길)(?=[가-힣\d])/g, '$1$2 ')
      .replace(/([가-힣])(도)(?=[가-힣])(?!로|길)/g, '$1$2 ')
      .replace(/([가-힣])(제\d)/g, '$1 $2')
      /* 숫자 뒤 한글은 원칙적으로 띄우되, 단위(호·층·동…)는 붙여 둔다.
         무조건 띄우면 '207호'가 '207 호'가 되고, 무조건 붙이면
         '1393상무센트럴자이'처럼 지번과 건물명이 뭉친다. */
      .replace(/(\d)(?![호층동가리길번세대])([가-힣])/g, '$1 $2')
      .replace(/([가-힣])(\d)/g, function (all, a, b) {
        return a === '제' ? all : (a + ' ' + b);      // '제101동'은 붙여 둔다
      })
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ---------- 소유자 ----------
  /* 요약표 「1. 소유지분현황(갑구)」이 가장 깨끗하다.
       허민(소유자)단독소유901029-*******서울특별시중구동호로173,207호(신당동)
       고다영(공유자)2분의1...
     못 찾으면 갑구 본문 「소유자 홍길동 901029-***…」로 되돌아간다.
     이름으로 중복을 제거하므로 같은 소유자가 여러 벌 들어와도 한 번만 남는다. */
  function extractOwners(S, K) {
    var owners = [], byName = Object.create(null);
    /* 지분·주민번호·주소는 숫자 경계가 살아 있어야 갈린다.
       공백을 다 지운 문자열에서 읽으면 '2분의 1 850101' 이 '2분의1850101' 이 된다.
       다만 괄호 앞뒤 공백은 남아 있어 '(공유자 )' 가 되므로 그것만 붙인다. */
    S = K.map(function (t) { return t.replace(/\s*([()])\s*/g, '$1'); });
    /* 서식 라벨이 이름 앞에 붙어 읽힌다(실측: '등기명의인허민(소유자)' → 이름을 '기명의인허민'으로).
       라벨은 고정 문구이므로 먼저 떼어낸다. */
    var LABEL = /(등기명의인|주민등록번호|최종지분|순위번호|대상소유자|주요등기사항|소유지분현황|권리자및기타사항|등기목적|접수정보)/g;
    S = S.map(function (t) { return t.replace(LABEL, ' '); });

    function push(name, shareRaw, addr) {
      name = String(name || '').replace(/[^가-힣A-Za-z0-9()주식회사]/g, '').trim();
      if (!name || name.length > 20) return;
      if (byName[name]) {                       // 같은 사람이 또 나오면 정보만 보강
        var o0 = byName[name];
        if (!o0.shareRaw && shareRaw) o0.shareRaw = shareRaw;
        if (!o0.registryAddress && addr) o0.registryAddress = addr;
        return;
      }
      var o = { name: name, shareRaw: shareRaw || null, share: null,
                address: null, registryAddress: addr || null };
      byName[name] = o; owners.push(o);
    }

    /* (a) 요약표 */
    S.forEach(function (t) {
      var m = t.match(/([가-힣]{2,6}|주식회사[가-힣]{2,12})\((?:소유자|공유자)\)/);
      if (!m) return;
      var rest = t.slice(m.index + m[0].length);
      var share = null;
      /* '2분의 1' 처럼 띄어 읽히므로 공백을 허용한다. */
      var msh = rest.match(/(단독소유|(\d+)\s*분의\s*(\d+))/);
      if (msh) share = msh[1] === '단독소유' ? '단독소유' : (msh[2] + '분의 ' + msh[3]);
      var addr = pickAddr(rest);
      push(m[1], share, addr);
    });

    /* (b) 갑구 본문 — 요약표를 못 읽었을 때만 */
    if (!owners.length) {
      S.forEach(function (t) {
        var m = t.match(/(?:소유자|공유자)([가-힣]{2,6}|주식회사[가-힣]{2,12})/);
        if (!m) return;
        var rest = t.slice(m.index + m[0].length);
        var msh = rest.match(/(\d+)\s*분의\s*(\d+)/);
        push(m[1], msh ? (msh[1] + '분의 ' + msh[2]) : null, pickAddr(rest));
      });
    }
    return owners;
  }

  /* 주소는 시·도 이름에서 시작해 줄 끝까지다.
     뒤에 붙는 표 라벨(고유번호·순위번호 등)은 잘라낸다 — 이게 안 되면
     '…207호(신당동)고유번호1103-1996-279658순위번호' 같은 꼬리가 남는다. */
  function pickAddr(s) {
    var m = String(s || '').match(new RegExp('(' + SIDO + '.*)$'));
    if (!m) return null;
    var a = m[1]
      .replace(/(고유번호|순위번호|최종지분|등기명의인|주요등기사항|대상소유자|접수정보|출력일시|열람일시).*$/, '')
      .replace(/\d{6}-\*+/g, '')
      .replace(/[\u0001].*$/, '');
    a = respaceAddr(a).replace(/\s*,\s*/g, ', ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')');
    return a.length >= 8 ? a.trim() : null;
  }

  // ---------- 교차검증 ----------
  /* 가장 위험한 실패는 빈 칸이 아니라 그럴싸하게 틀린 값이다. */
  function crossCheck(out, S) {
    var P = out.property, c = out.confidence;

    // 호수 앞자리는 층이다. 「제23층 제207호」는 207이 2층을 가리켜 어긋난다.
    var em = String(P.exclusiveNo || '').match(/제\s*(\d+)\s*층\s*제\s*(\d+)\s*호/);
    if (em && em[2].length >= 3) {
      var pre = em[2].slice(0, em[2].length - 2);
      if (pre !== em[1]) {
        c.exclusiveNo = 'low';
        out.warnings.push('「제' + em[1] + '층 제' + em[2] + '호」로 읽었는데 호수 앞자리(' + pre +
          ')와 층이 맞지 않습니다. 원본을 확인해 주세요.');
      }
    }

    // 전유면적은 그 건물 한 층의 면적을 넘을 수 없다.
    if (P.exclusiveArea) {
      var mx = 0;
      S.forEach(function (t) {
        var re = /(?:지?\d{1,2})층([\d,]+\.\d+)m2/g, m2;
        while ((m2 = re.exec(t))) { var v = parseFloat(m2[1].replace(/,/g, '')); if (v > mx) mx = v; }
      });
      var ea = parseFloat(P.exclusiveArea);
      if (mx > 0 && isFinite(ea) && ea > mx) {
        c.exclusiveArea = 'low';
        out.warnings.push('전유면적이 표제부의 한 층 면적보다 큽니다. m2 기호가 숫자로 읽혔을 수 있습니다.');
      }
    }

    // 지분 합이 1이 아니면 한 사람을 놓쳤거나 잘못 읽은 것이다.
    if (out.owners.length > 1) {
      var sum = 0, allNum = true;
      out.owners.forEach(function (o) {
        var m = String(o.shareRaw || '').match(/(\d+)분의\s*(\d+)/);
        if (!m) { allNum = false; return; }
        sum += parseInt(m[2], 10) / parseInt(m[1], 10);
      });
      if (allNum && Math.abs(sum - 1) > 0.01) {
        out.warnings.push('소유자 지분 합계가 1이 아닙니다(' + sum.toFixed(4) + '). 원본 확인이 필요합니다.');
      }
    }
  }

  var RegFields = { extract: extract, _internal: { respaceAddr: respaceAddr, pickAddr: pickAddr, snap: snap, extractOwners: extractOwners, sq: sq } };
  if (typeof module !== 'undefined' && module.exports) module.exports = RegFields;
  if (root) root.RegFields = RegFields;
})(typeof window !== 'undefined' ? window : this);
