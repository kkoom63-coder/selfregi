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
      .replace(/[，､]/g, ',')
      /* OCR 은 소수점 뒤에 공백을 넣는다(실측: '20. 16 m²', '568. 3 m2', '75. 809').
         이걸 두면 전유면적·대지권비율이 통째로 안 잡힌다. */
      .replace(/(\d)\.\s+(\d)/g, '$1.$2');
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
  /* 긴 지목이 먼저 걸리도록 길이 내림차순(대|공장용지 순서면 '공장용지'가 '대'로 잘린다).
     면적 단위는 ㎡ 가 m2 · m² · m 으로 읽히는 경우가 모두 관측됐다. */
  var RE_JIMOK_AREA = new RegExp(
    '(' + JIMOK.slice().sort(function (a, b) { return b.length - a.length; }).join('|') + ')'
    + '\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:m2|m²|㎡|m)');

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
      var mh = S[i].match(/^\[(집합건물|토지|건물)\](.+)$/);
      if (!mh) continue;
      var body = mh[2];
      /* 머리글 뒤에 표 제목이 붙어 읽히는 경우가 있다(실측: '…제207호1.소유지분현황').
         식별자까지만 자른다. */
      var cut = body.match(/제\d+층제[0-9가-힣]+호/);
      if (cut) body = body.slice(0, cut.index + cut[0].length);
      /* 토지 머리글 뒤에 표 안의 지목·면적이 붙어 읽히는 경우가 있다
         (실측 2026.08.22, 경주: '[토지]경상북도경주시양남면상계리295답2301m2').
         그대로 두면 소재지번 뒤가 건물명으로 갈라져 「아파트·건물명」 칸에
         '답 2301m' 이 들어간다. 지목은 28종 닫힌 집합이므로
         '지목 + 숫자 + 면적단위' 꼴이 뒤에 붙어 있으면 잘라낸다. */
      if (!cut) {
        var mtail = body.match(RE_JIMOK_AREA);
        if (mtail && mtail.index > 0) body = body.slice(0, mtail.index);
      }
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
    /* 표에서 라벨과 값은 다른 줄이고, 값 사이에 옆 칸(층별 면적)이 끼어든다.
         [도로명주소] / 2층 313.836m² / 서울특별시 서초구 / 3층 313.836m2 / 효령로 79길 1
       그래서 라벨 아래로 내려가며 면적 줄은 건너뛰고 주소 조각만 이어 붙인다.
       라벨이 없으면 도로명주소가 없는 것이다 — 아무 줄이나 주워오면
       토지 등기부에서 옛 소유자 주소를 도로명주소로 넣게 된다(실측). */
    var lbIdx = -1;
    for (var li = 0; li < S.length; li++) { if (S[li].indexOf('도로명주소') >= 0) { lbIdx = li; break; } }
    if (lbIdx >= 0) {
      var acc = '', reSido = new RegExp('^' + SIDO);
      for (var li2 = lbIdx; li2 < Math.min(S.length, lbIdx + 12); li2++) {
        var kl = K[li2];
        if (li2 === lbIdx) kl = kl.slice(kl.indexOf('도로명주소') + 5).replace(/^[\]\s]+/, '');
        if (!kl || /층|m2|번호|표시/.test(kl)) continue;
        if (!acc && !reSido.test(kl)) continue;
        acc = acc ? (acc + ' ' + kl) : kl;
        if (/(?:로|길)\s*\d/.test(acc)) break;      // 도로명 + 번호까지 모이면 끝
      }
      if (acc) P.roadAddress = respaceAddr(acc);
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
    /* 「63527.1분의」 와 「75.809」 가 다른 줄에 있고 그 사이에 등기원인·표시번호가 끼어든다.
       한 줄 안에서만 찾으면 못 잡고, 아무 숫자나 집으면 옆 칸의 '2분의 1'(소유지분)을
       대지권비율로 넣게 된다(실측). 분모를 먼저 확정하고 분자를 아래로 찾아 내려간다. */
    var lrIdx = -1;
    for (var pi = 0; pi < K.length; pi++) {
      /* '전유부분의 건물의 표시'에도 '분의'가 들어 있다. 숫자를 요구한다.
         '지분 2분의 1'(소유지분)은 대지권비율이 아니므로 뺀다. */
      if (/\d\s*분의/.test(K[pi]) && !/지분\s*\d+\s*분의/.test(K[pi])) { lrIdx = pi; break; }
    }
    if (lrIdx >= 0) {
      var lrLine = K[lrIdx], mden = lrLine.match(/([\d,]+(?:\.\d+)?)\s*분의/);
      if (mden) {
        var denom = mden[1].replace(/,/g, ''), num = null, guessed = false;
        var after = lrLine.slice(lrLine.indexOf('분의') + 2);
        var mnum = after.match(/^\s*([\d,]+(?:\.\d+)?)/);
        if (mnum) num = mnum[1];
        else {
          /* 같은 줄에 없으면 아래로 내려간다. 날짜와 표시번호는 건너뛴다. */
          for (var ni = lrIdx + 1; ni < Math.min(K.length, lrIdx + 8); ni++) {
            var t2 = K[ni];
            if (/년|월|일|등기|별도/.test(t2)) continue;
            if (/^\d{1,2}\s*(소유권|대지권|표시)/.test(t2)) continue;
            var mn2 = t2.match(/([\d,]+\.\d+|\d+)/);
            if (mn2) { num = mn2[1]; guessed = true; break; }
          }
        }
        if (num) {
          P.landRightRatio = { denom: denom, num: num.replace(/,/g, '') };
          /* 다른 줄에서 주워 온 값은 확신할 수 없다. 「확인 필요」로 내린다. */
          if (guessed) out.confidence.landRightRatio = 'low';
        }
      }
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
    /* '1번신탁등기말소'는 신탁이 이미 풀렸다는 뜻이다. 현재 수탁자인 경우만 잡는다. */
    if (/수탁자/.test(ALL) || (/신탁등기/.test(ALL) && !/신탁등기말소/.test(ALL))) out.isTrust = true;

    // (10) 소유자
    out.owners = extractOwners(S, K, out);
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
      .replace(/(로|길)\s+(\d+번(?:길|가))/g, '$1$2')   // '상무민주로 32번길' → '상무민주로32번길'
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ---------- 소유자 ----------
  /* 요약표 「1. 소유지분현황(갑구)」이 가장 깨끗하다.
       허민(소유자)단독소유901029-*******서울특별시중구동호로173,207호(신당동)
       고다영(공유자)2분의1...
     못 찾으면 갑구 본문 「소유자 홍길동 901029-***…」로 되돌아간다.
     이름으로 중복을 제거하므로 같은 소유자가 여러 벌 들어와도 한 번만 남는다. */
  /* 요약표에서 한 소유자의 정보는 여러 줄에 흩어져 있고 순서도 일정하지 않다.
       2분의 1 / 고다영(공유자) / 광주광역시…201호 / 2 / 911029-*** / (쌍촌동, …아파트)
     그래서 이름을 기준점으로 삼아 '다음 이름 전까지'를 한 사람의 구간으로 보고,
     지분은 구간에 없으면 이름 바로 위 두 줄까지 거슬러 본다. */
  function extractOwners(S, K, out) {
    var owners = [], byName = Object.create(null);
    var reSido = new RegExp('^' + SIDO);

    /* 서식 라벨이 이름 앞에 붙어 읽힌다('등기명의인허민'). 참고사항의
       '소유자 혹은 공유자 현황' 같은 안내문도 이름으로 잡힌다. 먼저 걷어낸다. */
    var LABEL = /(등기명의인|등기명의|주민등록번호|최종지분|순위번호|대상소유자|주요등기사항|소유지분현황|권리자및기타사항|등기목적|접수정보|혹은)/g;
    var L = K.map(function (t) { return t.replace(/\s*([()])\s*/g, '$1').replace(LABEL, ' ').trim(); });

    /* 참고사항 이하는 안내문이라 소유자가 없다. */
    var stop = L.length;
    for (var si = 0; si < L.length; si++) {
      if (/^\[?참고사항/.test(L[si].replace(/\s/g, ''))) { stop = si; break; }
    }

    function addrFrom(seg) {
      var a = '';
      for (var q = 0; q < seg.length; q++) {
        var t = seg[q];
        if (/^\d{1,2}$/.test(t) || /^\d{6}\s*[-—]\s*\*+$/.test(t)) continue;   // 순위번호·주민번호
        if (!a) { if (reSido.test(t)) a = t; continue; }
        /* 괄호가 안 닫혔거나 다음 줄이 괄호로 시작하면 같은 주소의 이어짐이다. */
        var open = (a.split('(').length - a.split(')').length) > 0;
        if (open || /^\(/.test(t)) { a += (open ? ' ' : '') + t; continue; }
        break;
      }
      if (!a) return null;
      a = a.replace(/(고유번호|순위번호|열람일시|출력일시).*$/, '');
      a = respaceAddr(a).replace(/\s*,\s*/g, ', ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')');
      return a.length >= 8 ? a.trim() : null;
    }
    function shareIn(txt) {
      var m = String(txt).match(/(단독소유|(\d+)\s*분의\s*(\d+))/);
      if (!m) return null;
      return m[1] === '단독소유' ? '단독소유' : (m[2] + '분의 ' + m[3]);
    }
    function push(name, share, addr) {
      name = String(name || '').replace(/\s/g, '');
      if (!name || name.length < 2 || name.length > 20) return;
      if (byName[name]) {
        var o0 = byName[name];
        if (!o0.shareRaw && share) o0.shareRaw = share;
        if (!o0.registryAddress && addr) o0.registryAddress = addr;
        return;
      }
      var o = { name: name, shareRaw: share || null, share: null, address: null, registryAddress: addr || null };
      byName[name] = o; owners.push(o);
    }

    /* (a) 요약표 — 이름 뒤에 (소유자)/(공유자) 가 붙는다. 가장 깨끗한 출처다. */
    var marks = [];
    for (var i2 = 0; i2 < stop; i2++) {
      var mm = L[i2].match(/([가-힣]{2,6}|주식회사[가-힣]{2,14})\((?:소유자|공유자)\)/);
      if (mm) marks.push({ line: i2, name: mm[1], rest: L[i2].slice(mm.index + mm[0].length) });
    }
    marks.forEach(function (mk, n) {
      var end = (n + 1 < marks.length) ? marks[n + 1].line : Math.min(stop, mk.line + 8);
      var seg = [mk.rest].concat(L.slice(mk.line + 1, end)).filter(function (t) { return t; });
      var share = shareIn(seg.join(' '));
      if (!share) share = shareIn(L.slice(Math.max(0, mk.line - 2), mk.line).join(' '));
      push(mk.name, share, addrFrom(seg));
    });
    if (owners.length) return owners;

    /* (b) 요약표가 없을 때만 갑구 본문. 말소사항 포함 발급본에는 과거 소유자가
       전부 남아 있으므로 '마지막 소유권이전/보존' 이후만 본다.
       (실측: 토지 등기부에서 옛 소유자 5명이 매도인으로 올라왔다) */
    var last = -1;
    for (var i3 = 0; i3 < stop; i3++) {
      if (/^\d{0,2}\s*소유권(이전|보존)/.test(L[i3]) || /소유권(이전|보존)$/.test(L[i3])) last = i3;
    }
    var from = last >= 0 ? last : 0;
    for (var i4 = from; i4 < stop; i4++) {
      var mo = L[i4].match(/(?:소유자|공유자)\s*(주식회사[가-힣]{2,14}|[가-힣]{2,6})/);
      if (!mo) continue;
      var seg2 = [L[i4].slice(mo.index + mo[0].length)].concat(L.slice(i4 + 1, i4 + 6));
      push(mo[1], shareIn(seg2.join(' ')), addrFrom(seg2));
    }
    if (owners.length && out) {
      out.confidence.owners = 'low';
      out.warnings.push('요약표를 찾지 못해 갑구 본문에서 소유자를 읽었습니다. 최종 소유자가 맞는지 원본과 대조해 주세요.');
    }
    return owners;
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

  var RegFields = { extract: extract, _internal: { respaceAddr: respaceAddr, snap: snap, extractOwners: extractOwners, sq: sq } };
  if (typeof module !== 'undefined' && module.exports) module.exports = RegFields;
  if (root) root.RegFields = RegFields;
})(typeof window !== 'undefined' ? window : this);