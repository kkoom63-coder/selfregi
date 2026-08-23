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
    extractLiens(S, T, out);
    judgeCancel(out);

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
  /* ---------- 주소 재분절 (2026.08.23 재작성) ----------
     종전에는 정규식 체인으로 「한글+시/군/구/동…」을 무조건 갈랐다.
     그러면 도로명 안의 글자가 행정구역 어미로 오인된다.
       실측: 부산광역시해운대구마린시티1로30 → '마린시 티 1 로'
     한국 주소는 시도 → 시·군·구 → 읍·면·동·리 → 도로명 → 번호 순서가 고정이므로
     왼쪽부터 단계별로 한 토큰씩 떼어낸다. 단계를 지나면 그 어미는 더 찾지 않는다.
     수량자는 반드시 lazy 다 — greedy 면 '해운대구마린시'가 한 덩어리로 잡힌다. */
  /* 시·도는 17개로 닫힌 집합이다. 패턴으로 추정하면 '경상북도'가 빠지거나
     도로명 첫 글자를 도(道)로 오인한다. 목록으로 못 박고 긴 것부터 맞춘다. */
  var SIDO_LIST = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시',
    '세종특별자치시','강원특별자치도','전북특별자치도','제주특별자치도',
    '충청북도','충청남도','전라북도','전라남도','경상북도','경상남도','경기도','강원도','제주도'];
  var RE_SIDO_HEAD = new RegExp('^(?:' +
    SIDO_LIST.slice().sort(function (a, b) { return b.length - a.length; }).join('|') + ')');

  function respaceTail(t) {
    /* 도로명·지번 뒤의 번호와 건물명만 다룬다.
       단위(호·층·동·가·리·길·로·번·세대)는 앞 숫자에 붙여 둔다.
       무조건 띄우면 '207호'가 '207 호'가 되고,
       무조건 붙이면 '1393상무센트럴자이'처럼 지번과 건물명이 뭉친다. */
    return String(t || '')
      .replace(/(\d)(?![호층동가리길번세대로])([가-힣])/g, '$1 $2')
      .replace(/([가-힣])(\d)/g, function (all, a, b) {
        return a === '제' ? all : (a + ' ' + b);      // '제101동'은 붙여 둔다
      })
      .replace(/(로|길)\s+(\d+번(?:길|가))/g, '$1$2')  // '상무민주로 32번길' → '상무민주로32번길'
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function respaceAddr(s) {
    var t = fix(s).replace(/\s+/g, '');
    if (!t) return '';
    var parts = [], m;

    // 1단계 — 시·도
    m = t.match(RE_SIDO_HEAD);
    if (!m) {
      /* 시도로 시작하지 않으면 단계를 신뢰할 수 없다. 번호 분절만 하고 돌려준다. */
      return respaceTail(t);
    }
    parts.push(m[0]); t = t.slice(m[0].length);

    /* 2단계 — 시·군·구. '성남시 분당구'처럼 두 번까지 온다.
       구·군 다음에는 다시 시·군·구가 올 수 없으므로 거기서 멈춘다. */
    for (var i = 0; i < 2 && t; i++) {
      m = t.match(/^[가-힣]{1,7}?(시|군|구)(?=[가-힣\d])/);
      if (!m) break;
      parts.push(m[0]); t = t.slice(m[0].length);
      if (m[1] !== '시') break;
    }

    // 3단계 — 읍·면·동·리·가. '양남면 상계리'처럼 두 번까지 온다.
    for (var j = 0; j < 2 && t; j++) {
      m = t.match(/^[가-힣]{1,8}?(?:읍|면|동|리|가)(?=[가-힣\d(,])/);
      if (!m) break;
      parts.push(m[0]); t = t.slice(m[0].length);
    }

    /* 4단계 — 도로명. 이름 안에 숫자가 들어가는 도로가 있다(마린시티1로).
       \d* 를 이름과 어미 사이에 둬야 통째로 잡힌다. */
    if (t) {
      m = t.match(/^[가-힣]+?\d*(?:로|길)(?:\d+번(?:길|가))?(?=[\d(,]|$)/);
      if (m) { parts.push(m[0]); t = t.slice(m[0].length); }
    }

    if (t) parts.push(respaceTail(t));
    return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  }

  /* ---------- 을구 (근)저당권 ----------
     사진 경로에는 좌표가 없다. 표의 칸을 x좌표로 가를 수 없으므로
     「단독으로 놓인 순위번호 줄」을 블록의 선두로 삼는다.

     앵커를 이것으로 정한 경위(다시 바꾸지 말 것):
       ① 「근저당권설정」(등기목적)을 앵커로 했더니 쌍촌 실물에서 그 셀 자체가
          OCR 로 안 읽혀 블록을 못 찾았다.
       ② 「채권최고액」으로 바꿨더니 접수일·원인일이 앞줄에 있어 블록 밖으로 밀렸다.
       ③ 순위번호 칸을 선두로 잡아야 날짜까지 한 블록에 들어온다. */
  var LIEN_LABEL = /^(채권최고액|채무자|근저당권자|저당권자|전세권자|채권자|전세금|공동담보|공동담보목록|존속기간|범위|이자|위약금|지연배상|비고|목적)/;

  function eulRange(S) {
    /* 을구 본문의 시작·끝. 요약표(3.(근)저당권…)에도 순위번호가 있어
       범위를 안 자르면 요약표 줄이 본문 블록으로 섞인다. */
    var start = -1, end = S.length;
    for (var i = 0; i < S.length; i++) {
      if (start < 0 && /(소유권이외의권리에관한사항|^【?을\s*구】?$|^을구$)/.test(S[i])) start = i;
      if (start >= 0 && /^(\[?참고사항|1\.소유지분현황|2\.소유지분을제외한|3\.\(근\)저당권|주요등기사항요약)/.test(S[i])) { end = i; break; }
    }
    return start < 0 ? null : { start: start + 1, end: end };
  }

  function summaryReceiptNos(S) {
    /* 요약표 「3.(근)저당권 및 전세권 등」은 지금 살아 있는 권리만 싣는다.
       본문에서 읽은 근저당이 여기 없으면 이미 말소된 등기일 가능성이 높다. */
    var set = Object.create(null), on = false, found = false;
    for (var i = 0; i < S.length; i++) {
      if (/^3\.\(근\)저당권/.test(S[i])) { on = true; found = true; continue; }
      if (!on) continue;
      if (/^\[?참고사항/.test(S[i])) break;
      var re = /제(\d+)호/g, m;
      while ((m = re.exec(S[i]))) set[m[1]] = true;
    }
    return found ? set : null;
  }

  function pickDates(block) {
    /* 접수일과 원인일 두 개가 잡힌다. 서식으로는 구분할 수 없다.
       설정계약이 접수보다 앞설 수밖에 없다는 도메인 규칙으로 가른다.
       (텍스트 레이어 경로인 regparse 는 칸이 나뉘므로 이 추정을 쓰지 않는다.) */
    var ds = [], re = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, m;
    var joined = block.join('\u0001');
    while ((m = re.exec(joined))) {
      ds.push({ raw: m[0].replace(/\s/g, ''), key: +m[1] * 10000 + (+m[2]) * 100 + (+m[3]) });
    }
    if (!ds.length) return { receiptDate: null, causeDate: null };
    if (ds.length === 1) return { receiptDate: ds[0].raw, causeDate: null };
    ds.sort(function (a, b) { return a.key - b.key; });
    return { causeDate: ds[0].raw, receiptDate: ds[ds.length - 1].raw };
  }

  function partyIn(block, label) {
    /* 라벨 줄을 찾고 「다음 라벨 전까지」를 그 사람의 구간으로 본다.
       라벨 줄 자체를 주소 탐색에 포함하면 '근저당권자광주광역시…'가
       시도 패턴에 걸려 라벨이 주소에 섞인다. 그래서 라벨은 떼고 시작한다.
       구간을 안 자르면 채무자 주소를 근저당권자 주소로 집는다. */
    var st = -1;
    for (var i = 0; i < block.length; i++) {
      if (block[i].replace(/\s/g, '').indexOf(label) === 0) { st = i; break; }
    }
    if (st < 0) return null;
    var seg = [block[st].replace(new RegExp('^\\s*' + label + '\\s*'), '')];
    for (var j = st + 1; j < block.length; j++) {
      if (LIEN_LABEL.test(block[j].replace(/\s/g, ''))) break;
      seg.push(block[j]);
    }
    var joined = tidy(seg.join(' '));
    if (!joined) return null;

    var out = { name: null, regNo: null, address: null, branch: null, raw: joined };
    var rn = joined.match(/(\d{6})\s*[-—–]\s*(\d{7})/);
    if (rn) {
      out.regNo = rn[1] + '-' + rn[2];
      out.name = tidy(joined.slice(0, rn.index)).replace(/\s/g, '');
      out.address = tidy(joined.slice(rn.index + rn[0].length));
    } else {
      var sp = joined.match(/^(\S+)\s+([\s\S]+)$/);
      if (sp) { out.name = sp[1]; out.address = tidy(sp[2]); }
      else out.name = joined.replace(/\s/g, '');
    }
    /* 지점 표기는 주소 끝 괄호에 붙는다: '서울특별시 … (중앙로지점)'.
       주소에 섞어 두면 신청서의 본점 소재지 칸이 오염되므로 별도 필드로 뺀다. */
    if (out.address) {
      var br = out.address.match(/\(([^()]*(?:지점|본점|출장소|지사|영업부|센터))\)\s*$/);
      if (br) { out.branch = tidy(br[1]); out.address = tidy(out.address.slice(0, br.index)); }
      out.address = respaceAddr(out.address) || null;
    }
    return out;
  }

  function extractLiens(S, T, out) {
    var rg = eulRange(S);
    if (!rg) return;
    out.eulPresent = true;

    // 순위번호만 홀로 놓인 줄을 블록 선두로 본다. 부기등기는 '1-1' 꼴.
    var heads = [];
    for (var i = rg.start; i < rg.end; i++) {
      if (/^\d{1,3}(-\d{1,3})?$/.test(S[i])) heads.push(i);
    }
    if (!heads.length) return;

    var cancelledRanks = [], liens = [];
    heads.forEach(function (h, n) {
      var stop = (n + 1 < heads.length) ? heads[n + 1] : rg.end;
      var blockS = S.slice(h, stop), blockT = T.slice(h, stop);
      var flat = blockS.join('');
      /* 등기목적은 순위번호 바로 다음부터다. 순위번호를 포함한 채로 정규식을 돌리면
         '2' + '1번근저당권설정등기말소' 가 '21번근저당권설정' 으로 잘려 말소를 놓친다.
         실측으로 확인한 사고라 선두 한 줄은 반드시 떼고 본다. */
      var body = blockS.slice(1).join('');

      var mCancel = body.match(/(\d+)번[^\s]{0,12}?(?:근)?저당권설정등기말소/)
                 || body.match(/^(?:(\d+)번)?[^\s]{0,12}?말소/);
      if (mCancel) {
        if (mCancel[1]) cancelledRanks.push(mCancel[1]);
        return;
      }

      var purpose = (body.match(/((?:갑구\d+번)?[^\s]{0,24}?(?:근)?저당권설정|전세권설정)/) || [])[1] || '';
      if (!purpose) return;

      var d = pickDates(blockT);
      var cred = partyIn(blockT, '근저당권자') || partyIn(blockT, '저당권자') || partyIn(blockT, '전세권자');
      var debt = partyIn(blockT, '채무자');
      var amt = (flat.match(/(?:채권최고액|전세금|채권액)금?([\d,]+)원/) || [])[1] || null;

      liens.push({
        rank: S[h],
        /* 순위번호는 라벨이 아니라 칸 위치로 추정한 값이다. 항상 확인 대상. */
        rankNeedsCheck: true,
        purpose: purpose,
        /* '갑구2번 ㅇㅇㅇ지분전부근저당권설정'이면 공유물 전부가 아니라 지분 근저당이다.
           공유자 1인의 보존행위 법리가 적용되지 않으므로 반드시 구분한다. */
        isPartialShare: /지분/.test(purpose),
        receiptDate: d.receiptDate,
        receiptNo: (flat.match(/제(\d+)호/) || [])[1] || null,
        causeDate: d.causeDate,
        causeType: /설정계약/.test(flat) ? '설정계약' : null,
        maxAmount: amt,
        creditor: cred ? cred.name : null,
        creditorRegNo: cred ? cred.regNo : null,
        creditorAddress: cred ? cred.address : null,
        creditorBranch: cred ? cred.branch : null,
        /* 채무자는 읽기만 하고 신청서 어디에도 쓰지 않는다.
           말소등기의 등기권리자는 소유자(근저당권설정자)이지 채무자가 아니다.
           물상보증(부모 집 담보로 자녀 대출)에서 채무자 ≠ 소유자인 경우가 있다. */
        debtorName: debt ? debt.name : null,
        inSummary: null,
        cancelled: false,
        source: 'eul'
      });
    });

    var set = summaryReceiptNos(S);
    liens.forEach(function (L) {
      if (cancelledRanks.indexOf(String(L.rank)) >= 0) L.cancelled = true;
      if (!set) { L.inSummary = null; return; }
      L.inSummary = !!(L.receiptNo && set[L.receiptNo]);
      if (!L.inSummary) L.cancelled = true;
    });

    out.liens = liens;
    out.cancelledRanks = cancelledRanks;
    out.activeLiens = liens.filter(function (L) { return !L.cancelled; });
    out.hasMortgage = liens.length > 0;
    liens.forEach(function (L) {
      if (L.cancelled) out.warnings.push('을구 ' + (L.rank || '?') + '번 근저당권은 이미 말소된 등기일 수 있습니다. 요약표(3.(근)저당권 및 전세권 등)에서 확인하세요.');
      if (L.isPartialShare) out.warnings.push('을구 ' + (L.rank || '?') + '번은 공유지분에 설정된 근저당권입니다. 해당 지분권자만 말소를 신청할 수 있습니다.');
    });
  }

  /* ---------- 근저당권 말소(Case C) 신청 가능 여부 ----------
     regparse.js 의 validate() 와 같은 규약을 만든다. 화면 코드를 한 벌로 쓰기 위함이다.
     근거: 민법 265조 단서 / 대법원 1993.5.11. 92다52870 /
           2024.9.19. 부동산등기과-2604 질의회답.
     소유자 3인 이상은 화면·서식 구조상 지원하지 않는다(제품 결정). */
  function judgeCancel(out) {
    out.activeLiens = out.activeLiens || [];
    var C = {
      supported: true, reasons: [], applicantMode: null, applicantCandidates: [],
      partialShare: (out.liens || []).some(function (L) { return L.isPartialShare; })
    };
    var ow = out.owners || [];
    if (!ow.length) {
      C.supported = false; C.reasons.push('소유자를 읽지 못했습니다.');
    } else if (ow.length > 2) {
      C.supported = false;
      C.reasons.push('소유자가 ' + ow.length + '명입니다. 공유자 3인 이상은 현재 지원하지 않습니다.');
    } else if (ow.length === 2) {
      C.applicantMode = 'choose';
      C.applicantCandidates = ow.map(function (o) { return o.name; });
    } else {
      C.applicantMode = 'single';
      C.applicantCandidates = [ow[0].name];
    }
    if (C.supported && C.partialShare) {
      C.applicantMode = 'fixed';
      C.reasons.push('지분에 설정된 근저당권이므로 해당 지분권자만 신청할 수 있습니다. 등기목적의 지분권자와 신청인이 같은지 확인하세요.');
    }
    if (C.supported && out.hasMortgage && !out.activeLiens.length) {
      C.supported = false;
      C.reasons.push('현재 유효한 근저당권이 확인되지 않습니다. 이미 말소되었을 수 있습니다.');
    }
    out.cancel = C;
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

  var RegFields = { extract: extract, _internal: { respaceAddr: respaceAddr, extractLiens: extractLiens, partyIn: partyIn, pickDates: pickDates, judgeCancel: judgeCancel, eulRange: eulRange, snap: snap, extractOwners: extractOwners, sq: sq } };
  if (typeof module !== 'undefined' && module.exports) module.exports = RegFields;
  if (root) root.RegFields = RegFields;
})(typeof window !== 'undefined' ? window : this);