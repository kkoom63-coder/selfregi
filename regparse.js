/* 등기사항전부증명서 텍스트 파서 — selfregi24 (2026-08-16 이식)
   원본: form.html 인라인 블록. 외부 파일로 분리해 normal_form.html에서 로드한다. */
/* ============================================================
 * regparse.js — 부동산등기사항증명서(텍스트 PDF) 파서
 * 셀프등기24 / 1단계: 텍스트 레이어 전용, 취소선 검출 미포함
 *
 * 의존: pdf.js (pdfjsLib) — 호출측에서 주입
 * 출력: 정규화 객체 (폼 배선 없음)
 *
 * 설계 근거(실측 4건 + 제출용 1건):
 *  R1 워터마크 = fontSize >= 30  → 제거 (열람용 52pt / 제출용 없음)
 *  R2 취소선(말소) = 빨간 수평선 → 1단계 미구현.
 *     대신 (a) 요약페이지 우선   (b) 표제부 최대 표시번호 규칙 으로 우회
 *  R3 행 재구성 = y 그룹핑 + x 정렬 + 간격 공백
 *  R4 열 분해   = 헤더 라벨 x좌표로 컬럼 밴드 생성
 * ============================================================ */
(function (root) {
  'use strict';

  // ---------- 상수 ----------
  var WATERMARK_MIN_SIZE = 30;   // 이 크기 이상은 워터마크
  var Y_TOL = 2.2;               // 같은 행으로 볼 y 오차(pt)
  var GAP_SPACE = 2.5;           // 이 간격 초과 시 공백 삽입(pt)

  var SUB = {
    BLDG_WHOLE: '1동의 건물의 표시',
    LAND_OF_RIGHT: '대지권의 목적인 토지의 표시',
    EXCLUSIVE: '전유부분의 건물의 표시',
    LAND_RIGHT: '대지권의 표시',
    LAND: '토지의 표시',
    BLDG: '건물의 표시',
    GAP: '소유권에 관한 사항',
    EUL: '소유권 이외의 권리에 관한 사항'
  };

  // ---------- 유틸 ----------
  function nz(s) { return (s == null ? '' : String(s)); }
  function squash(s) { return nz(s).replace(/\s+/g, ''); }
  function tidy(s) { return nz(s).replace(/\s+/g, ' ').trim(); }

  // "63527.1분의 75.809" / "55분의 1" → {denom, num}
  function parseRatio(s) {
    var m = squash(s).match(/([\d.,]+)분의([\d.,]+)/);
    if (!m) return null;
    var d = m[1].replace(/,/g, ''), n = m[2].replace(/,/g, '');
    if (!isFinite(+d) || !isFinite(+n) || +d <= 0) return null;
    return { denom: d, num: n, raw: m[0] };
  }

  // "2분의 1" / "단독소유" → 표준 지분
  function parseShare(s) {
    var t = squash(s);
    if (/단독소유/.test(t)) return { denom: '1', num: '1', raw: '단독소유', sole: true };
    var r = parseRatio(t);
    if (r) { r.sole = false; return r; }
    return null;
  }

  /* ㎡ 는 OCR이 2·nf·rrf 등으로 흔히 오인한다(실측: 2301㎡ → 23012).
     면적 칸은 숫자만 담긴 칸이라 단위를 요구하지 않고 선행 숫자를 취한다. */
  function parseArea(s) {
    var t = squash(s);
    var m = t.match(/([\d.,]+)\s*(?:㎡|m2|m²|nf|rrf|㎥)/);
    if (!m) m = t.match(/(\d[\d,]*(?:\.\d+)?)/);
    return m ? m[1].replace(/,/g, '') : null;
  }

  // ---------- 1) 텍스트 → 행 ----------
  function itemsToLines(items) {
    var toks = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.str || !it.str.trim()) continue;
      var size = it.height || Math.abs(it.transform[3]) || 0;
      if (size >= WATERMARK_MIN_SIZE) continue;          // R1 워터마크 제거
      toks.push({
        x: it.transform[4],
        y: it.transform[5],
        w: it.width || 0,
        size: size,
        str: it.str
      });
    }
    toks.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });

    var lines = [], cur = null;
    for (var j = 0; j < toks.length; j++) {
      var t = toks[j];
      if (!cur || Math.abs(cur.y - t.y) > Y_TOL) {
        cur = { y: t.y, toks: [] };
        lines.push(cur);
      }
      cur.toks.push(t);
    }
    lines.forEach(function (L) {
      L.toks.sort(function (a, b) { return a.x - b.x; });
      var s = '', prevEnd = null;
      L.toks.forEach(function (t) {
        if (prevEnd !== null && t.x - prevEnd > GAP_SPACE) s += ' ';
        s += t.str;
        prevEnd = t.x + t.w;
      });
      L.text = tidy(s);
      L.x0 = L.toks[0].x;
    });
    return lines.filter(function (L) { return L.text; });
  }

  // 외부(OCR)에서 만든 토큰 배열을 행으로 묶는다. 좌표계는 PDF 포인트로 정규화되어 있어야 한다.
  function tokensToLines(toks, opt) {
    opt = opt || {};
    /* pdf.js 텍스트 레이어는 「철근콘크리트구조」가 토큰 하나로 오지만
       tesseract 는 한글을 글자 단위로 쪼개 준다. 글자 간 bbox 간격이
       고정 임계 2.5pt 를 쉽게 넘어 「콘 크 리 트 구」처럼 공백이 끼고,
       그 뒤 라벨 매칭·정규식이 전부 무너진다.
       → OCR 경로에서는 글자 크기에 비례한 임계를 쓴다. */
    var ocr = !!opt.ocr;
    /* 계수는 실측으로 조정한다. 실제 등기부 OCR(200dpi, psm4) 측정값:
       글자높이 중앙 9.36pt · 글자폭 중앙 8.64pt · 토큰간격 중앙 3.60pt(75% 7.20). */
    var GK = (typeof opt.gapK === 'number') ? opt.gapK : 0.75;
    var YK = (typeof opt.ytolK === 'number') ? opt.ytolK : 0.70;
    var t2 = toks.filter(function (t) { return t.str && t.str.trim(); }).slice();
    t2.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });
    var lines = [], cur = null;
    for (var j = 0; j < t2.length; j++) {
      var t = t2[j];
      var ytol = ocr ? Math.max(Y_TOL, (t.size || 10) * YK) : Y_TOL;
      if (!cur || Math.abs(cur.y - t.y) > ytol) { cur = { y: t.y, toks: [] }; lines.push(cur); }
      cur.toks.push(t);
    }
    lines.forEach(function (L) {
      L.toks.sort(function (a, b) { return a.x - b.x; });
      var s2 = '', pe = null;
      L.toks.forEach(function (t) {
        /* 실제 공백은 글자폭의 절반쯤 벌어진다. 글자 사이 자연 간격은 그보다 훨씬 좁다. */
        var gap = ocr ? Math.max(GAP_SPACE, (t.size || 10) * GK) : GAP_SPACE;
        if (pe !== null && t.x - pe > gap) s2 += ' ';
        s2 += t.str; pe = t.x + (t.w || 0);
      });
      L.text = tidy(s2); L.x0 = L.toks[0].x;
    });
    return lines.filter(function (L) { return L.text; });
  }

  // ---------- 2) 헤더 기반 컬럼 밴드 ----------
  // 헤더는 가운데 정렬 / 데이터는 왼쪽 정렬이므로
  // 헤더 라벨의 "중심점" 사이 중간값을 경계로 삼는다.
  function headerBands(headerLine, labels) {
    var flat = headerLine.toks, marks = [], cursor = 0;
    for (var i = 0; i < labels.length; i++) {
      var target = squash(labels[i]), acc = '', sx = null, ex = null, found = false;
      for (var k = cursor; k < flat.length; k++) {
        if (sx === null) { sx = flat[k].x; }
        acc += squash(flat[k].str);
        ex = flat[k].x + flat[k].w;
        if (acc.indexOf(target) >= 0) { cursor = k + 1; found = true; break; }
        if (target.indexOf(acc) !== 0) { acc = ''; sx = null; }
      }
      if (!found || sx === null || ex === null ||
          !isFinite(sx) || !isFinite(ex)) return null;
      marks.push({ label: labels[i], sx: sx, ex: ex });
    }
    // 경계 = 앞 라벨의 끝 ~ 뒤 라벨의 시작 사이 중간값
    // (헤더는 가운데 정렬, 데이터는 왼쪽 정렬이라 중심점 기준은 한 칸씩 밀린다)
    var bands = marks.map(function (m) { return { label: m.label, sx: m.sx, ex: m.ex, x0: 0, x1: 0 }; });
    for (var b = 0; b < bands.length; b++) {
      bands[b].x0 = (b === 0) ? -Infinity : (marks[b - 1].ex + marks[b].sx) / 2;
      bands[b].x1 = (b === bands.length - 1) ? Infinity : (marks[b].ex + marks[b + 1].sx) / 2;
    }
    /* 경계가 하나라도 NaN이면 밴드 전체가 무의미하다.
       NaN은 비교식이 항상 false라 if(!bands) 검사를 통과해버리므로 여기서 막는다. */
    for (var v = 0; v < bands.length; v++) {
      if (isNaN(bands[v].x0) || isNaN(bands[v].x1)) return null;
    }
    return bands;
  }

  function splitByBands(line, bands) {
    var cells = bands.map(function () { return []; });
    line.toks.forEach(function (t) {
      var idx = bands.length - 1;
      for (var b = 0; b < bands.length; b++) {
        if (t.x >= bands[b].x0 && t.x < bands[b].x1) { idx = b; break; }
      }
      cells[idx].push(t);
    });
    return cells.map(function (ts) { return joinRow(ts); });
  }

  /* 표의 세로 괘선이 ㅣ | ｜ 등으로 읽혀 값에 섞인다(실측: 주식회사하나자ㅣ산신탁). */
  function stripRule(t) {
    return String(t == null ? '' : t).replace(/[ㅣ｜|丨︱]/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  function joinRow(toks, ocr, GK) {
    var s = '', pe = null;
    toks.sort(function (a, b) { return a.x - b.x; });
    toks.forEach(function (t) {
      var g = ocr ? Math.max(GAP_SPACE, (t.size || 10) * (GK || 0.75)) : GAP_SPACE;
      if (pe !== null && t.x - pe > g) s += ' ';
      s += t.str; pe = t.x + t.w;
    });
    return tidy(s);
  }

  // 레코드 시작 행: 첫 토큰이 순수 번호 + 최좌측 컬럼에 위치
  // (x 조건이 없으면 "372-13" 같은 들여쓴 이어짐 줄을 레코드로 오인한다)
  function makeIsNumberLed(dataLines) {
    var minX = Infinity;
    dataLines.forEach(function (L) {
      if (!L.toks.length) return;
      if (!/^\d+(-\d+)?$/.test(squash(L.toks[0].str))) return;   // "(전 2)" 등 부기행 제외
      if (L.toks[0].x < minX) minX = L.toks[0].x;
    });
    if (minX === Infinity) return function () { return false; };
    return function (L) {
      return L.toks.length >= 1 &&
             /^\d+(-\d+)?$/.test(squash(L.toks[0].str)) &&
             Math.abs(L.toks[0].x - minX) <= 6;
    };
  }

  // 2패스 밴드 보정: 레코드 시작 행들의 실제 토큰 x를 클러스터링해
  // 각 헤더 라벨의 컬럼 시작 좌표를 확정한다(데이터=좌측정렬, 헤더=가운데정렬 대응).
  function refineBands(dataLines, bands, isStart) {
    function cluster(pred) {
      var xs = [];
      dataLines.forEach(function (L) {
        if (!pred(L)) return;
        L.toks.forEach(function (t) { xs.push(t.x); });
      });
      xs.sort(function (a, b) { return a - b; });
      var c = [];
      xs.forEach(function (x) { if (!c.length || x - c[c.length - 1] > 4) c.push(x); });
      return c;
    }
    var primary = cluster(function (L) { return isStart(L, bands); });
    var secondary = cluster(function () { return true; });
    if (!primary.length && !secondary.length) return bands;

    var starts = [], prev = -Infinity;
    for (var i = 0; i < bands.length; i++) {
      var hs = bands[i].sx, he = bands[i].ex, best = null, c, x;
      // 1차: 레코드 시작행의 x 클러스터 중 헤더에 가장 가까운 것
      for (c = 0; c < primary.length; c++) {
        x = primary[c];
        if (x <= prev + 5 || x > he + 6) continue;
        if (best === null || Math.abs(x - hs) < Math.abs(best - hs)) best = x;
      }
      // 2차: 전체 데이터행 — 들여쓴 이어짐을 피해 "가장 왼쪽" 후보 채택
      if (best === null) {
        for (c = 0; c < secondary.length; c++) {
          x = secondary[c];
          if (x <= prev + 5 || x > he + 6 || x < hs - 90) continue;
          if (best === null || x < best) best = x;
        }
      }
      if (best === null) best = (i === 0) ? -Infinity : (bands[i - 1].ex + hs) / 2;
      starts.push(best);
      prev = (best === -Infinity) ? -Infinity : best;
    }
    var out = bands.map(function (b, i) {
      return { label: b.label, sx: b.sx, ex: b.ex,
               x0: (i === 0) ? -Infinity : starts[i] - 3,
               x1: (i === bands.length - 1) ? Infinity : starts[i + 1] - 3 };
    });
    return out;
  }

  // 섹션(헤더행 + 데이터행)을 표시번호 단위 레코드로 분해
  function parseSection(sec, labels) {
    if (!sec || sec.length < 2) return null;
    var bands = headerBands(sec[0], labels);
    if (!bands) return null;
    var data = sec.slice(1);
    bands = refineBands(data, bands, makeIsNumberLed(data));
    var recs = [], cur = null;
    for (var i = 1; i < sec.length; i++) {
      var cells = splitByBands(sec[i], bands);
      var no = squash(cells[0]).match(/^(\d+)(?:-\d+)?$/);
      if (no) {
        cur = { no: parseInt(no[1], 10), cells: cells.slice() };
        recs.push(cur);
      } else if (cur) {
        // "(전 N)" 부기행에도 셀 이어짐이 실려 있으므로 버리지 않고 1번 셀부터 병합
        for (var c = 1; c < cells.length; c++) {
          if (cells[c]) cur.cells[c] += '\n' + cells[c];
        }
      }
    }
    return { bands: bands, recs: recs };
  }

  function latestOf(parsed) {
    if (!parsed || !parsed.recs.length) return null;
    return parsed.recs.slice().sort(function (a, b) { return b.no - a.no; })[0];
  }

  /* OCR은 섹션 이름을 흔히 깨뜨린다. 실측 사례:
       소유권에 관한 사항  →  수유퀸 에 관한 사항
       표 제 부            →  퓨 제 부
     라벨을 정확히 요구하면 섹션 마크가 잡히지 않고, 그러면 앞 섹션이
     문서 끝까지 늘어나 밴드 계산이 붕괴한다(실측: LAND 섹션 100줄, bands NaN).
     → 괄호 안 문자열을 편집거리로 최근접 SUB 키에 붙인다. */
  function editDist(a, b) {
    var m = a.length, n = b.length, prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                          prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }
  function nearestSub(text) {
    var best = null, bestD = Infinity;
    Object.keys(SUB).forEach(function (k) {
      var t = squash(SUB[k]), d = editDist(text, t);
      var lim = Math.max(1, Math.floor(t.length * 0.3));
      if (d <= lim && d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  /* 지목은 28종으로 닫힌 집합이다. OCR 오인식(답 -> 담)을 사전 최근접으로 확정한다. */
  var JIMOK = ['전','답','과수원','목장용지','임야','광천지','염전','대','공장용지',
    '학교용지','주차장','주유소용지','창고용지','도로','철도용지','제방','하천','구거',
    '유지','양어장','수도용지','공원','체육용지','유원지','종교용지','사적지','묘지','잡종지'];
  /* 한 글자 지목(전·답·대·묘지…)에 편집거리를 그대로 적용하면 아무 한 글자나
     걸린다(실측: 「제」가 「전」으로 스냅되어 지목이 오탐). 1글자는 실측된
     오인식만 허용하고 나머지는 포기한다. */
  var JIMOK1 = { '담': '답', '닫': '답', '댸': '대', '데': '대' };
  function snapJimok(v) {
    var t = squash(v || '');
    if (!t) return null;
    if (JIMOK.indexOf(t) >= 0) return t;
    if (t.length === 1) return JIMOK1[t] || null;
    var best = null, bd = Infinity;
    JIMOK.forEach(function (j) {
      var d = editDist(t, j);
      if (d < bd && d <= Math.max(1, Math.floor(j.length * 0.5))) { bd = d; best = j; }
    });
    return best || t;
  }

  /* 구조도 실질적으로 닫힌 집합이다. 실측: 「콘 크 리 트 구」로 잘려 읽힘. */
  var STRUCT = ['철근콘크리트구조','철근콘크리트조','철골철근콘크리트구조','철골철근콘크리트조',
    '철골구조','철골조','연와조','벽돌조','시멘트블럭조','목조','석조','철파이프조'];
  function snapStruct(v) {
    /* 실측 오인식: 「콩크리트」(콘->콩), 「콘크리트구」(조가 잘림).
       콩->콘만 정규화해도 대부분 정확 멤버가 되고, 남는 절단은 임계 0.5로 흡수한다.
       후보가 이미 콘크리트 계열로 좁혀진 뒤라 임계를 넓혀도 오탐 여지가 없다. */
    var t = squash(v || '').replace(/콩/g, '콘');
    if (!t) return null;
    if (STRUCT.indexOf(t) >= 0) return t;
    var best = null, bd = Infinity;
    STRUCT.forEach(function (x) {
      var d = editDist(t, x);
      if (d < bd && d <= Math.max(2, Math.floor(x.length * 0.5))) { bd = d; best = x; }
    });
    return best || t;
  }
  function isStruct(v) { return STRUCT.indexOf(squash(v || '')) >= 0; }

  // ---------- 3) 섹션 분할 ----------
  function sliceSections(lines) {
    var marks = [];
    lines.forEach(function (L, i) {
      var t = squash(L.text);
      /* 1차: 정확일치(텍스트 PDF 경로는 이 줄에서 끝난다) */
      var hit = null;
      Object.keys(SUB).forEach(function (k) {
        if (t.indexOf('(' + squash(SUB[k]) + ')') >= 0 || t === squash(SUB[k])) hit = k;
      });
      /* 2차: 괄호 안 문자열을 편집거리로 근사(OCR 경로) */
      if (!hit) {
        var mm = /\(([^()]{3,30})\)/.exec(t);
        if (mm) hit = nearestSub(mm[1]);
      }
      if (hit) marks.push({ key: hit, i: i });
    });
    var out = {};
    marks.forEach(function (m, idx) {
      var end = (idx + 1 < marks.length) ? marks[idx + 1].i : lines.length;
      out[m.key] = (out[m.key] || []).concat(lines.slice(m.i + 1, end));
    });
    return out;
  }

  // ---------- 4) 섹션 라벨 정의 ----------
  var COLS = {
    BLDG_WHOLE:    ['표시번호','접수','소재지번,건물명칭 및 번호','건물내역','등기원인 및 기타사항'],
    LAND_OF_RIGHT: ['표시번호','소재지번','지목','면적','등기원인 및 기타사항'],
    EXCLUSIVE:     ['표시번호','접수','건물번호','건물내역','등기원인 및 기타사항'],
    LAND_RIGHT:    ['표시번호','대지권종류','대지권비율','등기원인 및 기타사항'],
    LAND:          ['표시번호','접수','소재지번','지목','면적','등기원인 및 기타사항'],
    BLDG:          ['표시번호','접수','소재지번,건물명칭 및 번호','건물내역','등기원인 및 기타사항']
  };

  function cellLines(v) { return nz(v).split('\n').map(tidy).filter(Boolean); }

  // 페이지 머리말/꼬리말 — 표 셀에 섞이면 오염되므로 섹션 파싱 전에 제거
  var NOISE = [
    /^\d+\s*\/\s*\d+$/, /^(열람일시|출력일시|발행번호|발급확인번호|수수료)/,
    /^\[(집합건물|토지|건물)\]/, /^\[인터넷\s*발급\]/, /^\*/,
    /^--+\s*이\s*하\s*여\s*백\s*--+$/, /^고유번호/, /^관할등기소/,
    /^이\s*증명서는/, /^법원행정처/, /^서기\s*\d{4}년/
  ];
  function denoise(lines) {
    return lines.filter(function (L) {
      var t = tidy(L.text);
      for (var i = 0; i < NOISE.length; i++) if (NOISE[i].test(t)) return false;
      return true;
    });
  }


  // 요약 페이지의 "순위번호 | 등기목적 | 접수정보 | 주요등기사항 | 대상소유자" 표 공통 파서
  function parseRankTable(body, startRe, endRe) {
    var i0 = -1;
    for (var i = 0; i < body.length; i++) { if (startRe.test(squash(body[i].text))) { i0 = i; break; } }
    if (i0 < 0) return [];
    if (/기록사항없음/.test(squash(body[i0 + 1] ? body[i0 + 1].text : ''))) return [];
    var h = -1;
    for (var e = i0; e < Math.min(i0 + 4, body.length); e++) {
      if (squash(body[e].text).indexOf('순위번호') === 0) { h = e; break; }
    }
    if (h < 0) return [];
    var bands = headerBands(body[h], ['순위번호', '등기목적', '접수정보', '주요등기사항', '대상소유자']);
    if (!bands) return [];
    var data = body.slice(h + 1, h + 40);
    bands = refineBands(data, bands, makeIsNumberLed(data));
    var rows = [], cur = null;
    for (var f = h + 1; f < body.length; f++) {
      if (endRe.test(squash(body[f].text))) break;
      var c = splitByBands(body[f], bands);
      if (/^\d+(-\d+)?$/.test(squash(c[0]))) {
        cur = { rank: c[0], purpose: c[1], rest: tidy(c[2] + ' ' + c[3]), owner: c[4] };
        rows.push(cur);
      } else if (cur) {
        if (c[1]) cur.purpose += c[1];
        if (c[2] || c[3]) cur.rest = tidy(cur.rest + ' ' + c[2] + ' ' + c[3]);
        if (c[4]) cur.owner += c[4];
      }
    }
    rows.forEach(function (r) {
      var q = squash(r.rest);
      r.purpose = squash(r.purpose);
      r.owner = squash(r.owner);
      r.receiptNo = (q.match(/제([\d]+)호/) || [])[1] || null;
      r.receiptDate = (q.match(/(\d{4}년\d{1,2}월\d{1,2}일)/) || [])[1] || null;
    });
    return rows;
  }

  // ---------- 5) 요약 페이지 ----------
  function parseSummary(lines) {
    var res = { owners: [], liens: [], encumbrances: [], present: false };
    var startIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (squash(lines[i].text).indexOf('주요등기사항요약') >= 0) { startIdx = i; break; }
    }
    if (startIdx < 0) return res;
    res.present = true;
    var body = lines.slice(startIdx);

    // --- 1. 소유지분현황 (갑구) ---
    var hIdx = -1;
    for (var a = 0; a < body.length; a++) {
      /* 「등기명의인」이 「능기명의인」으로 읽히는 실측 사례가 있다. 앞 5글자 편집거리 1까지 허용. */
      var ht0 = squash(body[a].text);
      if (ht0.indexOf('등기명의인') === 0 ||
          (ht0.length >= 5 && editDist(ht0.slice(0, 5), '등기명의인') <= 1)) { hIdx = a; break; }
    }
    if (hIdx >= 0) {
      var bands = headerBands(body[hIdx], ['등기명의인','(주민)등록번호','최종지분','주소','순위번호']);
      if (bands) {
        bands = refineBands(body.slice(hIdx + 1, hIdx + 20), bands, function (L) {
          return L.toks.some(function (t) { return /\d{6}\s*-\s*[0-9*※＊#%$&8xX·ㅁ□■oO○●\\s]{4,14}/.test(squash(t.str)); });
        });
        var cur = null;
        for (var k = hIdx + 1; k < body.length; k++) {
          var tx = squash(body[k].text);
          if (/^2\.소유지분을제외한/.test(tx) || /^3\.\(근\)저당권/.test(tx) || /^\[참고사항\]/.test(tx)) break;
          var c = splitByBands(body[k], bands);
          if (/\d{6}\s*-\s*[0-9*※＊#%$&8xX·ㅁ□■oO○●\\s]{4,14}/.test(squash(c[1]))) {
            cur = { name: stripRule(c[0]), regNo: stripRule(tidy(c[1])), shareRaw: c[2],
                    share: parseShare(c[2]), address: stripRule(c[3]), rank: c[4], role: null };
            res.owners.push(cur);
          } else if (cur) {
            if (c[0] && !/단독소유|분의|소유권대지권|^\d+$/.test(squash(c[0]))) cur.name += c[0];
            if (c[2] && !cur.share) { cur.shareRaw = tidy(cur.shareRaw + ' ' + c[2]); cur.share = parseShare(cur.shareRaw); }
            if (c[3]) cur.address += ' ' + c[3];
            if (c[4] && !cur.rank) cur.rank = c[4];
          }
        }
        res.owners.forEach(function (o) {
          var m = o.name.match(/\((소유자|공유자|수탁자)\)/);
          o.role = m ? m[1] : null;
          o.name = squash(o.name.replace(/\((소유자|공유자|수탁자)\)/, ''));
          o.address = tidy(o.address);
          o.shareRaw = tidy(o.shareRaw);
        });
      }
    }

    // --- 2. 소유지분을 제외한 소유권에 관한 사항 (갑구): 압류·가압류·가처분 등 ---
    res.encumbrances = parseRankTable(body, /^2\.소유지분을제외한/, /^3\.\(근\)저당권|^\[참고사항\]/);

    // --- 3. (근)저당권 및 전세권 등 (을구) ---
    var lIdx = -1;
    for (var d = 0; d < body.length; d++) {
      if (/^3\.\(근\)저당권/.test(squash(body[d].text))) { lIdx = d; break; }
    }
    if (lIdx >= 0 && !/기록사항없음/.test(squash(body[lIdx + 1] ? body[lIdx + 1].text : ''))) {
      var lh = -1;
      for (var e = lIdx; e < Math.min(lIdx + 4, body.length); e++) {
        if (squash(body[e].text).indexOf('순위번호') === 0) { lh = e; break; }
      }
      if (lh >= 0) {
        var lb = headerBands(body[lh], ['순위번호','등기목적','접수정보','주요등기사항','대상소유자']);
        if (lb) {
          lb = refineBands(body.slice(lh + 1, lh + 20), lb, makeIsNumberLed(body.slice(lh + 1, lh + 20)));
          var cl = null;
          for (var f = lh + 1; f < body.length; f++) {
            if (/^\[참고사항\]/.test(squash(body[f].text))) break;
            var cc = splitByBands(body[f], lb);
            if (/^\d+(-\d+)?$/.test(squash(cc[0]))) {
              cl = { rank: cc[0], purpose: cc[1], rest: tidy(cc[2] + ' ' + cc[3]), owner: cc[4] };
              res.liens.push(cl);
            } else if (cl) {
              if (cc[1]) cl.purpose += cc[1];
              if (cc[2] || cc[3]) cl.rest = tidy(cl.rest + ' ' + cc[2] + ' ' + cc[3]);
              if (cc[4]) cl.owner += cc[4];
            }
          }
          res.liens.forEach(function (L) {
            var q = squash(L.rest);
            L.receiptNo   = (q.match(/제([\d]+)호/) || [])[1] || null;
            L.receiptDate = (q.match(/(\d{4}년\d{1,2}월\d{1,2}일)/) || [])[1] || null;
            L.maxAmount   = (q.match(/(?:채권최고액|전세금)금?([\d,]+)원/) || [])[1] || null;
            L.creditor    = (q.match(/(?:근저당권자|전세권자|채권자)([가-힣A-Za-z0-9()]+?)(?:제\d+호|$)/) || [])[1] || null;
            L.purpose = squash(L.purpose); L.owner = squash(L.owner);
          });
        }
      }
    }
    return res;
  }

  // ---------- 5-2) 을구 본문 (근)저당권 추출 ----------
  /* 요약표(3.(근)저당권 및 전세권 등)는 "지금 살아 있는 권리"만 싣지만,
     채권최고액·채무자·근저당권자 주소·지점은 을구 본문에만 있다.
     그래서 본문에서 읽고, 요약표는 말소 여부 판정용 대조표로만 쓴다.

     OCR 경로(regfields.js)와 달리 텍스트 레이어에는 x좌표가 있어
     「접수」와 「등기원인」이 별도 칸으로 잡힌다.
     따라서 OCR 경로에서 쓰던 "이른 날짜=원인일, 늦은 날짜=접수일" 도메인 규칙은
     여기서 쓰지 않는다. 칸이 곧 정답이므로 추정할 이유가 없다. */
  var EUL_COLS = ['순위번호', '등기목적', '접수', '등기원인', '권리자 및 기타사항'];

  function eulPickAmount(q) {
    var m = q.match(/(?:채권최고액|전세금|채권액)금?([\d,]+)원/);
    return m ? m[1] : null;
  }

  /* 「권리자 및 기타사항」 칸은 라벨이 붙은 줄들의 묶음이다.
       채권최고액 금240,000,000원
       채무자 김ㅇㅇ  서울특별시 ...
       근저당권자 주식회사ㅇㅇ은행 110111-...
                 서울특별시 ... (ㅇㅇ지점)
     라벨 줄을 찾고 "다음 라벨 전까지"를 그 사람의 구간으로 본다.
     구간을 제한하지 않으면 채무자 주소를 근저당권자 주소로 집는다. */
  function eulParty(cellLinesArr, label) {
    var LABELS = /^(채권최고액|채무자|근저당권자|저당권자|전세권자|채권자|공동담보|공동담보목록|존속기간|범위|이자|위약금|지연배상|비고)/;
    var start = -1;
    for (var i = 0; i < cellLinesArr.length; i++) {
      if (squash(cellLinesArr[i]).indexOf(label) === 0) { start = i; break; }
    }
    if (start < 0) return null;
    var seg = [cellLinesArr[start].replace(new RegExp('^\\s*' + label + '\\s*'), '')];
    for (var j = start + 1; j < cellLinesArr.length; j++) {
      if (LABELS.test(squash(cellLinesArr[j]))) break;
      seg.push(cellLinesArr[j]);
    }
    var joined = tidy(seg.join(' '));
    if (!joined) return null;

    /* 등록번호(법인 6-7 / 개인 6-7)를 기준으로 이름과 주소를 가른다.
       번호가 없으면 첫 토큰을 이름으로 보고 나머지를 주소 후보로 남긴다. */
    var out = { name: null, regNo: null, address: null, branch: null, raw: joined };
    var rn = joined.match(/(\d{6}\s*-\s*\d{7})/);
    if (rn) {
      out.regNo = squash(rn[1]);
      out.name = tidy(joined.slice(0, rn.index));
      out.address = tidy(joined.slice(rn.index + rn[0].length));
    } else {
      var sp = joined.match(/^(\S+)\s+([\s\S]+)$/);
      if (sp) { out.name = tidy(sp[1]); out.address = tidy(sp[2]); }
      else out.name = joined;
    }
    /* 지점 표기는 주소 끝 괄호에 붙는다: "서울특별시 ... (중앙로지점)".
       주소에 섞어 두면 신청서 주소칸이 오염되므로 별도 필드로 뺀다. */
    if (out.address) {
      var br = out.address.match(/\(([^()]*(?:지점|본점|출장소|지사|영업부|센터))\)\s*$/);
      if (br) {
        out.branch = tidy(br[1]);
        out.address = tidy(out.address.slice(0, br.index));
      }
    }
    if (out.address && !out.address.trim()) out.address = null;
    return out;
  }

  function parseEul(secEul) {
    var res = { liens: [], cancelledRanks: [], present: false };
    if (!secEul || secEul.length < 2) return res;

    /* 페이지가 넘어가면 머리글 행이 반복된다. 숫자로 시작하지 않아
       parseSection에서 직전 레코드에 합쳐지므로 미리 걷어낸다. */
    var body = secEul.filter(function (L) {
      return squash(L.text).indexOf('순위번호') !== 0;
    });
    if (!body.length) return res;
    var sec = [secEul[0]].concat(body);

    var parsed = parseSection(sec, EUL_COLS);
    if (!parsed || !parsed.recs.length) return res;
    res.present = true;

    parsed.recs.forEach(function (r) {
      var purpose = squash(r.cells[1]);
      if (!purpose) return;

      /* 말소등기 자체는 권리가 아니다. 다만 "1번근저당권설정등기말소"에서
         대상 순위번호를 뽑아 두면 요약표가 없어도 말소를 잡을 수 있다. */
      if (/말소/.test(purpose)) {
        var tgt = purpose.match(/(\d+)번/);
        if (tgt) res.cancelledRanks.push(parseInt(tgt[1], 10));
        return;
      }
      if (!/(근)?저당권설정|전세권설정/.test(purpose)) return;

      var recvCell = cellLines(r.cells[2]).join(' ');
      var causeCell = cellLines(r.cells[3]).join(' ');
      var infoLines = cellLines(r.cells[4]);
      var infoFlat = squash(infoLines.join(''));

      var creditor = eulParty(infoLines, '근저당권자') ||
                     eulParty(infoLines, '저당권자') ||
                     eulParty(infoLines, '전세권자');
      var debtor = eulParty(infoLines, '채무자');

      res.liens.push({
        rank: squash(r.cells[0]) || null,
        /* 순위번호는 칸 위치로 잡은 값이라 라벨 근거가 없다. 항상 확인 대상. */
        rankNeedsCheck: true,
        purpose: purpose,
        /* "갑구 2번 김ㅇㅇ지분전부근저당권설정"이면 공유물 전부가 아니라 지분 근저당이다.
           보존행위 법리(공유자 1인 단독 신청)가 적용되지 않으므로 반드시 구분한다. */
        isPartialShare: /지분/.test(purpose),
        receiptDate: (recvCell.match(/(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/) || [])[1] || null,
        receiptNo: (squash(recvCell).match(/제(\d+)호/) || [])[1] || null,
        causeDate: (causeCell.match(/(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/) || [])[1] || null,
        causeType: tidy(causeCell.replace(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/, '')) || null,
        maxAmount: eulPickAmount(infoFlat),
        creditor: creditor ? creditor.name : null,
        creditorRegNo: creditor ? creditor.regNo : null,
        creditorAddress: creditor ? creditor.address : null,
        creditorBranch: creditor ? creditor.branch : null,
        /* 채무자는 읽기만 하고 신청서 어디에도 쓰지 않는다.
           말소등기의 등기권리자는 소유자(근저당권설정자)이지 채무자가 아니다.
           물상보증(부모 집 담보로 자녀 대출)에서 채무자 ≠ 소유자인 경우가 실제로 있다. */
        debtorName: debtor ? debtor.name : null,
        inSummary: null,
        cancelled: false,
        source: 'eul'
      });
    });
    return res;
  }

  /* ---------- 을구 텍스트 폴백 ----------
     parseEul 은 표 머리글(순위번호|등기목적|접수|등기원인|권리자및기타사항)을
     찾아 열 밴드를 만든다. 그런데 실물 등기부는 섹션 제목과 머리글의 줄 구성이
     발급본마다 달라, 머리글을 못 잡으면 파서 전체가 죽고 요약표로 폴백해 버린다
     (실측 2026-08-23 신당·쌍촌: 채권최고액·근저당권자 주소·지점이 통째로 누락).

     그래서 좌표를 쓰지 않는 두 번째 경로를 둔다. 라벨 앵커 방식이며
     regfields.js(사진 경로)의 extractLiens 와 같은 도메인 규칙을 쓴다.
     한 행에 「순위번호 등기목적 접수일 원인일 채권최고액」이 다 들어오는
     텍스트 레이어 구조를 그대로 받아들인다. */
  var EUL_STOP_T = /^(관할\s*등기소|열람일시|출력일시|--?\s*이?하여백|열람용|제출용|등기사항전부증명서|\[집합건물\]|\[토지\]|\[건물\]|\*|\d+\s*\/\s*\d+$|주요등기사항요약|\[?주의사항|\[?참고사항|1\.소유지분현황|2\.소유지분을제외한|3\.\(근\)저당권)/;
  var EUL_LABEL_T = /^(채권최고액|채무자|근저당권자|저당권자|전세권자|채권자|전세금|공동담보|존속기간|범위|이자|위약금|지연배상|비고|목적)/;

  function eulTextRange(L) {
    var start = -1, end = L.length;
    for (var i = 0; i < L.length; i++) {
      var t = squash(L[i]);
      if (start < 0) {
        if (/소유권이외의권리에관한사항/.test(t) || /^【?을\s*구】?$/.test(t)) start = i;
        continue;
      }
      if (EUL_STOP_T.test(t)) { end = i; break; }
    }
    return start < 0 ? null : { start: start + 1, end: end };
  }

  /* 라벨 줄을 찾고 「다음 라벨 전까지」를 그 사람의 구간으로 본다.
     구간을 안 자르면 채무자 주소를 근저당권자 주소로 집는다. */
  function eulPartyText(block, label) {
    var st = -1;
    for (var i = 0; i < block.length; i++) {
      if (squash(block[i]).indexOf(label) === 0) { st = i; break; }
    }
    if (st < 0) {
      /* 첫 행처럼 라벨이 줄 중간에 있는 경우도 있다. */
      for (var k = 0; k < block.length; k++) {
        if (squash(block[k]).indexOf(label) > 0) { st = k; break; }
      }
      if (st < 0) return null;
    }
    var head = block[st];
    var pos = head.replace(/\s+/g, '').indexOf(label);
    /* 공백이 섞인 라벨('근 저 당권자')도 자를 수 있도록 squash 기준 위치를 되짚는다. */
    var seen = 0, cut = 0;
    for (var c = 0; c < head.length; c++) {
      if (!/\s/.test(head[c])) { if (seen === pos + label.length) { cut = c; break; } seen++; }
      if (seen === pos + label.length) { cut = c + 1; break; }
    }
    var seg = [tidy(head.slice(cut))];
    for (var j = st + 1; j < block.length; j++) {
      if (EUL_LABEL_T.test(squash(block[j]))) break;
      seg.push(block[j]);
    }
    var joined = tidy(seg.join(' '));
    if (!joined) return null;

    var out = { name: null, regNo: null, address: null, branch: null, raw: joined };
    var rn = joined.match(/(\d{6})\s*[-—–]\s*(\d{7})/);
    if (rn) {
      out.regNo = rn[1] + '-' + rn[2];
      out.name = squash(joined.slice(0, rn.index));
      out.address = tidy(joined.slice(rn.index + rn[0].length));
    } else {
      var sp = joined.match(/^(\S+)\s+([\s\S]+)$/);
      if (sp) { out.name = sp[1]; out.address = tidy(sp[2]); }
      else out.name = squash(joined);
    }
    if (out.address) {
      /* OCR·PDF 모두 괄호 안쪽에 공백이 들어간다('( 본점 )', '( 중앙로지점 )'). */
      out.address = out.address.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
      var br = out.address.match(/\(([^()]{0,20}?(?:지점|본점|출장소|지사|영업부|센터))\)\s*$/);
      if (br) { out.branch = tidy(br[1]); out.address = tidy(out.address.slice(0, br.index)); }
      out.address = tidy(out.address.replace(/\s+,/g, ',')) || null;
    }
    return out;
  }

  function parseEulText(lines) {
    var res = { liens: [], cancelledRanks: [], present: false };
    var L = lines.map(function (x) { return typeof x === 'string' ? x : x.text; });
    var rg = eulTextRange(L);
    if (!rg) return res;

    /* 앵커는 「순위번호로 시작하는 행」. 텍스트 레이어에서는 그 한 행에
       등기목적·접수일·원인일·채권최고액이 함께 실려 온다. */
    var heads = [];
    for (var i = rg.start; i < rg.end; i++) {
      if (/^\s*\d{1,3}(-\d{1,3})?(\s|$)/.test(L[i]) && !/^순위번호/.test(squash(L[i]))) heads.push(i);
    }
    if (!heads.length) return res;
    res.present = true;

    heads.forEach(function (h, n) {
      var stop = (n + 1 < heads.length) ? heads[n + 1] : rg.end;
      var block = L.slice(h, stop);
      var flat = squash(block.join(''));
      var body = squash(block.join('').replace(/^\s*\d{1,3}(-\d{1,3})?/, ''));

      var mCancel = body.match(/(\d+)번[^\s]{0,12}?(?:근)?저당권설정등기말소/)
                 || body.match(/^(?:(\d+)번)?[^\s]{0,12}?말소/);
      if (mCancel) { if (mCancel[1]) res.cancelledRanks.push(mCancel[1]); return; }

      var purpose = (body.match(/((?:갑구\d+번)?[^\s]{0,24}?(?:근)?저당권설정|전세권설정)/) || [])[1] || '';
      var inferred = false;
      if (!purpose) {
        if (/채권최고액|근저당권자|저당권자/.test(body)) { purpose = '근저당권설정'; inferred = true; }
        else if (/전세금|전세권자/.test(body)) { purpose = '전세권설정'; inferred = true; }
        else return;
      }

      /* 날짜 두 개. 설정계약이 접수보다 앞설 수밖에 없다는 도메인 규칙으로 가른다. */
      var ds = [], re = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, m;
      var joined = block.join('\u0001');
      while ((m = re.exec(joined))) ds.push({ raw: m[0].replace(/\s/g, ''), k: +m[1] * 10000 + (+m[2]) * 100 + (+m[3]) });
      ds.sort(function (a, b) { return a.k - b.k; });

      var cred = eulPartyText(block, '근저당권자') || eulPartyText(block, '저당권자') || eulPartyText(block, '전세권자');
      var debt = eulPartyText(block, '채무자');

      res.liens.push({
        rank: (L[h].match(/^\s*(\d{1,3}(?:-\d{1,3})?)/) || [])[1] || null,
        rankNeedsCheck: true,
        purpose: purpose,
        purposeInferred: inferred,
        isPartialShare: /지분/.test(purpose),
        receiptDate: ds.length ? ds[ds.length - 1].raw : null,
        receiptNo: (flat.match(/제(\d+)호/) || [])[1] || null,
        causeDate: ds.length > 1 ? ds[0].raw : null,
        causeType: /설정계약/.test(body) ? '설정계약' : null,
        maxAmount: (flat.match(/(?:채권최고액|전세금|채권액)금?([\d,]+)원/) || [])[1] || null,
        creditor: cred ? cred.name : null,
        creditorRegNo: cred ? cred.regNo : null,
        creditorAddress: cred ? cred.address : null,
        creditorBranch: cred ? cred.branch : null,
        debtorName: debt ? debt.name : null,
        inSummary: null,
        cancelled: false,
        source: 'eul-text'
      });
    });
    return res;
  }

  /* 본문에서 읽은 근저당을 요약표와 대조한다.
     요약표에 없으면 이미 말소된 등기일 가능성이 높다.
     (열람용 "말소사항 포함" 등기부에는 말소된 근저당도 본문에 그대로 남는다.) */
  function markCancelled(eul, summaryLiens) {
    var set = {};
    (summaryLiens || []).forEach(function (s) { if (s.receiptNo) set[String(s.receiptNo)] = true; });
    var haveSummary = Object.keys(set).length > 0;
    eul.liens.forEach(function (L) {
      if (eul.cancelledRanks.indexOf(parseInt(L.rank, 10)) >= 0) { L.cancelled = true; }
      if (!haveSummary) { L.inSummary = null; return; }
      L.inSummary = !!(L.receiptNo && set[String(L.receiptNo)]);
      if (!L.inSummary) L.cancelled = true;
    });
    return eul;
  }


  function buildResult(lines, opt) {
    var all = lines.map(function (L) { return L.text; }).join('\n');
    var out = {
      ok: true, warnings: [], confidence: {},
      docType: null, scope: null, issueType: null,
      uid: null, court: null, property: {}, owners: [], liens: [], encumbrances: [], summaryUsed: false
    };

    var title = squash(all.slice(0, 400));
    var whole = squash(all);
    /* OCR 경로에서는 제목 자체가 오인식된다(실측: 「등기사항전부중명서」).
       제목 정규식 하나로 막으면 멀쩡한 등기부가 통째로 거부되므로,
       문서 전체의 구조 표지를 세어 판정한다. */
    var MARKS = ['등기사항','표제부','갑구','을구','대지권','소유지분현황','고유번호',
                 '관할등기소','등기명의인','순위번호','표시번호','등기원인'];
    var score = 0;
    MARKS.forEach(function (m) { if (whole.indexOf(m) >= 0) score++; });
    if (score < 3) {
      return { ok: false, reason: 'NOT_REGISTRY', score: score,
               warnings: ['등기사항증명서로 보이지 않습니다.'] };
    }
    out.markerScore = score;
    out.scope = /말소사항포함/.test(title) ? '말소사항포함'
              : (/현재유효사항/.test(title) ? '현재유효사항' : null);
    out.issueType = /\[제출용\]/.test(title) ? '제출용' : '열람용';
    if (/-집합건물-/.test(title)) out.docType = '집합건물';
    else if (/-토지/.test(title)) out.docType = '토지';
    else if (/-건물/.test(title)) out.docType = '건물';
    if (!out.docType) {
      // 제목이 깨진 경우 구조로 추론한다
      if (/대지권의표시|전유부분의건물의표시/.test(whole)) out.docType = '집합건물';
      else if (/토지의표시/.test(whole)) out.docType = '토지';
      else if (/건물의표시/.test(whole)) out.docType = '건물';
      if (out.docType) out.warnings.push('문서 종류를 제목이 아닌 구조로 추정했습니다(' + out.docType + ').');
    }

    var uidM = all.match(/고\s*유\s*번\s*호\s*([\d]{4}\s*-\s*[\d]{4}\s*-\s*[\d]{6})/);
    if (uidM) out.uid = squash(uidM[1]);
    /* 「소」가 「수」로 읽히는 사례가 흔하다(실측: 관할등기수). 마지막 글자는 폭넓게 허용. */
    var courtM = all.match(/관\s*할\s*등\s*기\s*[소수쇼]\s*([^\n\/]+)/);
    if (courtM) out.court = tidy(courtM[1]);
    var hdrM = all.match(/^\[(집합건물|토지|건물)\]\s*(.+)$/m);
    if (hdrM) { out.property.header = tidy(hdrM[2]); if (!out.docType) out.docType = hdrM[1]; }

    var sec = sliceSections(denoise(lines));
    var P = out.property;

    if (out.docType === '집합건물') {
      var w = latestOf(parseSection(sec.BLDG_WHOLE, COLS.BLDG_WHOLE));
      if (w) {
        var addrLines = cellLines(w.cells[2]);
        var ri = addrLines.findIndex(function (x) { return /\[도로명주소\]/.test(x); });
        P.jibunAddress = (ri >= 0 ? addrLines.slice(0, ri) : addrLines).join(' ');
        P.roadAddress  = ri >= 0 ? addrLines.slice(ri + 1).join(' ') : null;
        P.buildingDetail = cellLines(w.cells[3]);
      }
      var lo = latestOf(parseSection(sec.LAND_OF_RIGHT, COLS.LAND_OF_RIGHT));
      if (lo) {
        P.landJibun = cellLines(lo.cells[1]).join(' ').replace(/^\d+\s*\.\s*/, '');
        P.landCategory = squash(lo.cells[2]) || null;
        P.landArea = parseArea(lo.cells[3]);
      }
      var ex = latestOf(parseSection(sec.EXCLUSIVE, COLS.EXCLUSIVE));
      if (ex) {
        P.exclusiveNo = tidy(cellLines(ex.cells[2]).join(' '));
        var dt = cellLines(ex.cells[3]);
        P.exclusiveStruct = dt.length ? snapStruct(dt[0]) : null;
        P.exclusiveArea = parseArea(dt.join(' '));
      }
      var lrP = parseSection(sec.LAND_RIGHT, COLS.LAND_RIGHT);
      if (lrP) {
        var hit = lrP.recs.filter(function (r) { return /소유권대지권/.test(squash(r.cells[1])); }).pop();
        if (hit) {
          P.landRightType = '소유권대지권';
          P.landRightRatio = parseRatio(cellLines(hit.cells[2]).join(''));
        }
      }
      P.separateReg = judgeSeparateReg((sec.LAND_RIGHT || []).map(function (L) { return L.text; }).join('\n'));
    } else if (out.docType === '토지') {
      var lr2 = latestOf(parseSection(sec.LAND, COLS.LAND));
      if (lr2) {
        P.jibunAddress = stripRule(cellLines(lr2.cells[2]).join(' '));
        P.landCategory = squash(lr2.cells[3]) || null;
        P.landArea = parseArea(lr2.cells[4]);
        /* 표제부가 1행뿐이면 2패스 밴드 보정이 클러스터를 만들 수 없어
           경계가 왼쪽으로 밀린다(실측: 지목 칸에 "답 23012"가 함께 들어옴).
           지목은 한글 1~3자, 면적은 숫자이므로 섞인 칸을 갈라낼 수 있다. */
        if (!P.landArea && P.landCategory) {
          var mm = /^([가-힣]{1,4})[^\d]*(\d[\d,]*(?:\.\d+)?)/.exec(P.landCategory);
          if (mm) { P.landCategory = mm[1]; P.landArea = mm[2].replace(/,/g, ''); }
        }
        if (P.landCategory) {
          P.landCategory = (/^([가-힣]{1,4})/.exec(P.landCategory) || [])[1] || P.landCategory;
          P.landCategory = snapJimok(P.landCategory) || P.landCategory;
        }
      }
    } else if (out.docType === '건물') {
      var bw = latestOf(parseSection(sec.BLDG, COLS.BLDG));
      if (bw) {
        var bl = cellLines(bw.cells[2]);
        var bi = bl.findIndex(function (x) { return /\[도로명주소\]/.test(x); });
        P.jibunAddress = (bi >= 0 ? bl.slice(0, bi) : bl).join(' ');
        P.roadAddress  = bi >= 0 ? bl.slice(bi + 1).join(' ') : null;
        P.buildingDetail = cellLines(bw.cells[3]);
      }
    }

    var sum = parseSummary(denoise(lines));
    if (sum.present) {
      out.summaryUsed = true; out.owners = sum.owners; out.liens = sum.liens;
      out.encumbrances = sum.encumbrances || [];
      /* 위임장 {{TRUST_ADDR}}(매도인 주소)에는 주민등록초본상 현주소가 들어간다.
         등기부 주소는 등기 당시 주소이므로 자동입력하면 안 되고, 대조용으로만 보관한다. */
      out.owners.forEach(function (o) {
        o.registryAddress = o.address;   // 대조용
        o.address = null;                // 자동입력 금지
        o.addressNote = '등기부상 주소입니다. 위임장에는 주민등록초본상 현주소를 사용하세요.';
      });
    }
    else out.warnings.push('요약 페이지가 없어 소유자·근저당 정보를 추출하지 못했습니다.');

    /* 을구 본문 — 채권최고액·근저당권자 주소·지점은 여기에만 있다.
       요약표 liens는 대조표로만 남기고, 화면·서식은 본문 결과를 쓴다. */
    /* 1차: 좌표 밴드. 실패하면 2차: 라벨 앵커 텍스트.
       실물에서 머리글 줄 구성이 발급본마다 달라 1차가 통째로 죽는 사례가 있다
       (실측 2026-08-23 신당·쌍촌: 요약표로 폴백돼 근저당권자 주소·지점이 누락). */
    var eulRaw = parseEul(sec.EUL);
    if (!eulRaw.present || !eulRaw.liens.length) {
      var alt = parseEulText(denoise(lines));
      if (alt.present && alt.liens.length) eulRaw = alt;
    }
    var eul = markCancelled(eulRaw, out.liens);
    out.summaryLiens = out.liens;
    if (eul.present) {
      out.eulPresent = true;
      out.liens = eul.liens;
      out.cancelledRanks = eul.cancelledRanks;
      eul.liens.forEach(function (L) {
        if (L.cancelled) {
          out.warnings.push('을구 ' + (L.rank || '?') + '번 근저당권은 이미 말소된 등기일 수 있습니다. 요약표(3.(근)저당권 및 전세권 등)에서 확인하세요.');
        }
        if (L.isPartialShare) {
          out.warnings.push('을구 ' + (L.rank || '?') + '번은 공유지분에 설정된 근저당권입니다(' + L.purpose + '). 해당 지분권자만 말소를 신청할 수 있습니다.');
        }
      });
    } else if (sum.present && (out.liens || []).length) {
      out.eulPresent = false;
      /* 화면 경고는 render() 의 eulPresent 분기에서 한 번만 낸다. 여기서 또 밀면 같은 말이 두 줄로 뜬다. */
    }

    if (opt && opt.ocr) ocrFill(out, lines);
    validate(out);
    if (opt && opt.ocr) { ocrConfidence(out); crossCheck(out, lines); }
    return out;
  }

  // 별도등기 판정 (R2 우회 — 텍스트 논리)
  function judgeSeparateReg(lrText) {
    var t = squash(lrText);
    var has = /별도등기있음/.test(t);
    var cancelled = /\d+번별도등기말소/.test(t);
    if (!has) return { value: false, basis: '대지권의 표시에 "별도등기 있음" 기재 없음', confidence: 'high' };
    if (has && cancelled) return { value: false, basis: '"별도등기 있음"이 있으나 "N번 별도등기 말소"로 해소됨', confidence: 'medium' };
    return { value: true, basis: '대지권의 표시에 "별도등기 있음" 기재', confidence: 'medium' };
  }

  /* ---------- 6.5) OCR 전용 보충 추출 ----------
     OCR 경로에서는 괘선 좌표가 2~4pt 흔들려 표 컬럼 경계 추정(headerBands)이 어긋나고,
     값이 옆 칸으로 넘어간다(실측: 「2분의 1」의 2가 옆 칸에 먹힘).
     등기부는 서식이 고정이라 ○분의○ / 제N층 제M호 / 철근콘크리트… 패턴이 문서 안에서
     유일하므로, 컬럼 경계를 맞추지 않고 줄 단위 정규식으로 직접 집는다.
     validate() 앞에서 돈다 — 여기서 채운 값에 대해서는 경고가 애초에 생기지 않는다.
     텍스트 PDF 경로에서는 호출되지 않는다(현재 정확도 100%, 손대지 않음). */
  /* OCR 경로 전용 유틸.
     핵심: squash() 로 공백을 지운 뒤 정규식을 걸면 옆 값이 붙는다.
     실측 「568.3 분 의 3.6  2017 년」 -> 「568.3분의3.62017」 -> 분자 3.62017.
     공백이 값 경계를 알려주므로 OCR 경로에서는 공백을 남긴 채 매칭한다. */
  function fixDigit(v) {
    return nz(v).replace(/[ㅣlI|｜丨]/g, '1').replace(/[oO○]/g, '0').replace(/[,\.]+$/, '');
  }
  function looseRatio(spaced) {
    var m = nz(spaced).match(/([\d][\d.,]*)\s*분\s*의\s*([\d][\d.,]*|[ㅣlI|｜丨])/);
    if (!m) return null;
    var d = fixDigit(m[1]).replace(/,/g, ''), n = fixDigit(m[2]).replace(/,/g, '');
    if (!isFinite(+d) || !isFinite(+n) || +d <= 0) return null;
    return { denom: d, num: n, raw: d + '분의 ' + n, sole: false };
  }
  function looseShare(spaced) {
    if (/단\s*독\s*소\s*유/.test(nz(spaced))) return { denom: '1', num: '1', raw: '단독소유', sole: true };
    return looseRatio(spaced);
  }

  /* 주소는 접미사가 닫힌 집합이라 붙은 문자열을 되돌릴 수 있다.
     「서울특별시서초구서초동1338-8」 -> 「서울특별시 서초구 서초동 1338-8」 */
  var ADDR_SUF = /^(.{1,12}?(?:특별자치시|특별자치도|특별시|광역시|[가-힣]도|시|군|구|읍|면|동|리|가|로|길))/;
  function respace(v) {
    var t = squash(v), out = [], m, g = 0;
    while (t && g++ < 12) {
      m = t.match(ADDR_SUF);
      if (!m) break;
      out.push(m[1]); t = t.slice(m[1].length);
    }
    if (t) out.push(t);
    /* 「대구」가 구(區)로 먼저 끊겨 「대구 광역시」가 된다. 뒤 조각이 광역단위면 도로 붙인다. */
    for (var q = out.length - 1; q > 0; q--) {
      if (/^(특별시|광역시|특별자치시|특별자치도|도)$/.test(out[q])) {
        out[q - 1] += out[q]; out.splice(q, 1);
      }
    }
    return out.join(' ').replace(/,(?=\S)/g, ', ').replace(/\s+/g, ' ').trim();
  }

  /* 모든 페이지 상단에 있는 「[집합건물] 소재지번 건물명 제N동 제N층 제N호」 줄.
     표가 아니라 한 줄이므로 밴드 오차와 무관하다. 표제부 표보다 훨씬 안전하다. */
  function headerIdent(L) {
    var best = null, all0 = [], o0 = {};
    L.forEach(function (t) {
      var mk = t.match(/\[([^\]]{1,14})\]/);
      if (!mk) return;
      var kind = squash(mk[1]);
      if (kind !== '집합건물' && kind !== '토지' && kind !== '건물') return;
      var rest = squash(t.slice(t.indexOf(mk[0]) + mk[0].length));
      rest = rest.split(/[【\[]/)[0].replace(/(표제부|갑구|을구|고유번호|열람).*$/, '');
      if (rest.length < 6) return;
      all0.push({ kind: kind, text: rest });
      if (!best || rest.length > best.text.length) best = { kind: kind, text: rest };
    });
    if (!best) return null;
    /* 머리글은 페이지마다 반복되는데 OCR이 서로 다르게 읽는다
       (실측: 「상계리 395」 / 「상계리 295」, 「제3층 제307호」 / 「제23층 제207호」).
       다수결로 자동확정하지 않고 불일치 사실만 올린다. 판단은 사람이 한다. */
    /* 머리글 뒤에 표 제목 같은 군더더기가 붙어 읽히면(실측: '…제207호1.소유지분현황()')
       같은 물건인데도 페이지마다 다른 값으로 잡혀 「확인 필요」가 헛뜬다.
       식별자(제N층 제N호)까지만 잘라 비교한다. 295/395 같은 진짜 차이는 그대로 남는다. */
    function identKey(t) {
      var s = squash(t), m = s.match(/제\d+층제\d+(?:-\d+)?호/);
      return m ? s.slice(0, m.index + m[0].length) : s;
    }
    o0.variants = [];
    all0.forEach(function (c) {
      var k0 = identKey(c.text);
      if (o0.variants.indexOf(k0) < 0) o0.variants.push(k0);
    });
    var raw = best.text, o = { kind: best.kind, variants: o0.variants };
    var ex = raw.match(/제(\d+)층제(\d+(?:-\d+)?)호/);
    var head = ex ? raw.slice(0, ex.index) : raw;
    if (ex) o.exclusiveNo = '제' + ex[1] + '층 제' + ex[2] + '호';
    var dm = head.match(/제([0-9가-힣]{1,4})동$/);
    if (dm) { o.dong = dm[1]; head = head.slice(0, dm.index); }
    var am = head.match(/^(.*?\d+(?:-\d+)?)(.*)$/);
    if (!am) return o;
    o.address = respace(am[1]);
    o.name = tidy(am[2]);
    return o;
  }

  function ocrFill(out, lines) {
    var P = out.property || (out.property = {});
    var L  = lines.map(function (x) { return squash(x.text); });
    var SP = lines.map(function (x) { return tidy(x.text); });   // 공백 보존
    var i, m;
    var filled = [];

    // (0) 페이지 머리글 줄 — 소재지번·건물명·동·층·호. 밴드값보다 신뢰도가 높아 덮어쓴다.
    var hd = headerIdent(SP);
    if (hd) {
      if (!out.docType) out.docType = hd.kind;
      if (hd.address) {
        if (P.jibunAddress) P.jibunAddressTable = P.jibunAddress;   // 표제부 원본은 보관
        if (hd.kind === '토지' || out.docType === '토지') hd.name = '';
        P.jibunAddress = hd.address + (hd.name ? ' ' + hd.name : '') +
                         (hd.dong ? ' 제' + hd.dong + '동' : '');
        filled.push('jibunAddress');
      }
      if (hd.exclusiveNo) { P.exclusiveNo = hd.exclusiveNo; filled.push('exclusiveNo'); }
      if (hd.variants && hd.variants.length > 1) {
        out.warnings.push('페이지마다 소재지번·호수가 다르게 읽혔습니다(' +
          hd.variants.slice(0, 3).join(' / ') + '). 원본과 대조해 주세요.');
        out.confidence.jibunAddress = 'low';
        if (hd.exclusiveNo) {
          out.confidence.exclusiveNo = 'low';
          /* 원인을 남긴다. 같은 'low'라도 '페이지마다 다름'과 '층↔호 불일치'는
             사용자가 확인해야 할 지점이 다르다. */
          (out.confidenceWhy || (out.confidenceWhy = {})).exclusiveNo = 'pagediff';
        }
      }
    }

    // (1) 대지권비율 — 공백 보존 줄에서. 「대지권」이 있는 줄 우선.
    if (out.docType === '집합건물') {
      var got = null;
      for (i = 0; i < SP.length && !got; i++) {
        if (L[i].indexOf('대지권') < 0) continue;
        var r1 = looseRatio(SP[i]);
        if (r1 && parseFloat(r1.denom) >= parseFloat(r1.num)) got = r1;
      }
      for (i = 0; i < SP.length && !got; i++) {
        var r2 = looseRatio(SP[i]);
        if (!r2) continue;
        if (!/\./.test(r2.denom + r2.num)) continue;   // 정수:정수는 지분일 가능성이 커 제외
        if (parseFloat(r2.denom) < parseFloat(r2.num)) continue;
        got = r2;
      }
      /* 밴드가 뽑은 값은 옆 칸이 붙어 분자가 늘어나 있을 수 있다(3.6 -> 3.62017).
         공백 기준으로 다시 읽은 값이 더 짧으면 그쪽을 채택한다. */
      if (got && (!P.landRightRatio ||
                  String(got.num).length < String(P.landRightRatio.num).length)) {
        P.landRightRatio = got; filled.push('landRightRatio');
      }
    }

    // (2) 전유부분 번호 / 구조 / 전유면적
    if (out.docType === '집합건물') {
      /* 「제N층 제M호」는 페이지 머리글에도 있어 첫 매치가 표가 아닐 수 있다. 전부 모은다. */
      var exAt = [];
      for (i = 0; i < L.length; i++) {
        m = L[i].match(/제(\d+)층제(\d+(?:-\d+)?)호/);
        if (!m) continue;
        exAt.push(i);
        if (!P.exclusiveNo) { P.exclusiveNo = '제' + m[1] + '층 제' + m[2] + '호'; filled.push('exclusiveNo'); }
      }
      if (!isStruct(P.exclusiveStruct)) {
        for (i = 0; i < L.length; i++) {
          /* 「[가-힣]*」로 감싸면 앞뒤 문장이 통째로 딸려온다(실측:
             「일서울특별시서초구서초동철근콘크리트구조업무시설」). 구조 어휘만 집는다. */
          m = L[i].match(/(?:철골철근|철근|철골)?(?:콘|콩)크리트(?:구조|조|구)?|(?:벽돌|연와|시멘트블럭|목|석|철파이프)조/);
          if (!m) continue;
          var sc = snapStruct(m[0]);
          /* 밴드값(「근콩크리트조도면편철장」)보다 나은 경우에만 덮는다. */
          if (isStruct(sc)) { P.exclusiveStruct = sc; filled.push('exclusiveStruct'); break; }
        }
      }
      if (!P.exclusiveArea) {
        var scan = [];
        exAt.forEach(function (ix) {
          for (var q = ix; q < Math.min(ix + 3, L.length); q++) scan.push(L[q]);
        });
        for (i = 0; i < scan.length && !P.exclusiveArea; i++) {
          m = scan[i].match(/(\d{1,4}(?:\.\d{1,3})?)(?:㎡|m2|m²|nf|rrf|㎥)/);   // 단위가 살아 있으면 최우선
          if (m) P.exclusiveArea = m[1];
        }
        for (i = 0; i < scan.length && !P.exclusiveArea; i++) {
          if (scan[i].indexOf('분의') >= 0) continue;                          // 대지권비율 줄 배제
          m = scan[i].match(/(\d{1,4}\.\d{1,3})/);
          if (m) P.exclusiveArea = m[1];
        }
        if (P.exclusiveArea) filled.push('exclusiveArea');
      }
    }

    /* (3.5) 지목·면적 — 표제부 밴드가 무너지면 통째로 빈다.
       「담 2301」「대 568.3㎡」처럼 지목 한 글자 뒤에 숫자가 오는 형태가 고정이다.
       지목은 28종 닫힌 집합이라 오인식(담->답)을 스냅으로 확정할 수 있다.
       「(전 2)」(종전 표시번호)를 지목으로 잡지 않도록 여는 괄호와 한 자리 수를 배제한다. */
    if (!P.landCategory || !P.landArea) {
      var CAND = /([^\s(（])\s*([가-힣]{1,4})\s+(\d{2,}(?:[.,]\d+)?|\d+\.\d+)/;
      for (i = 0; i < SP.length; i++) {
        var mj = SP[i].match(CAND);
        if (!mj) continue;
        var jm = snapJimok(mj[2]);
        if (!jm || JIMOK.indexOf(jm) < 0) continue;
        if (!P.landCategory) { P.landCategory = jm; filled.push('landCategory'); }
        if (!P.landArea) { P.landArea = mj[3].replace(/,/g, ''); filled.push('landArea'); }
        break;
      }
    }

    /* (4) 요약 밴드가 통째로 무너져 소유자가 하나도 안 잡히는 경우.
       실측: 헤더가 「등 기 명의인 주 민 ) 능 록 번 호」로 읽혀 라벨 매칭이 실패한다.
       「소유지분현황」 구간 안에서만 주민번호 패턴으로 직접 복원한다.
       구간을 한정하지 않으면 갑구의 과거 소유자까지 소유자로 올라온다. */
    if (!(out.owners || []).length) {
      var sStart = -1, sEnd = L.length;
      for (i = 0; i < L.length; i++) { if (L[i].indexOf('소유지분현황') >= 0) { sStart = i; break; } }
      if (sStart >= 0) {
        for (i = sStart + 1; i < L.length; i++) {
          if (/소유지분을제외한|저당권및전세권|참고사항/.test(L[i])) { sEnd = i; break; }
        }
        var RE4 = /(\d{6})\s*[-–—]\s*[0-9*※＊#%$&8xX·ㅁ□■oO○●\s]{4,14}/;
        var acc = [];
        for (i = sStart; i < sEnd; i++) {
          var m4 = SP[i].match(RE4);
          if (!m4) continue;
          var h4 = squash(SP[i].slice(0, m4.index)).replace(/[_|｜ㅣ]/g, '');
          var r4 = h4.match(/([가-힣]{2,30}?)\(?(공유자|소유자|수탁자|위탁자)\)?$/);
          var nm = r4 ? r4[1] : (h4.match(/[가-힣]{2,30}$/) || [])[0];
          if (!nm) continue;
          acc.push({ name: nm, role: r4 ? r4[2] : null, regNo: tidy(m4[0]),
                     share: null, shareRaw: null, address: null, registryAddress: null,
                     addressNote: '등기부상 주소입니다. 위임장에는 주민등록초본상 현주소를 사용하세요.' });
        }
        if (acc.length) { out.owners = acc; out.summaryUsed = true; filled.push('owners:' + acc.length); }
      }
    }

    /* (3) 소유자 지분·등기부상 주소 — 요약 줄에서 다시 집는다.
       실측: 밴드가 「2 분 의 1」의 2를 옆 칸에 먹고, 주소는 「대구광역시 북구 대」에서 잘렸다.
       요약 줄은 「이름 (자격) | 주민번호 | 지분 | 주소 | 순위번호」 순서가 고정이므로
       지분 표기 뒤부터 끝까지를 주소로 보면 컬럼 경계가 필요 없다. */
    (out.owners || []).forEach(function (o) {
      if (!o.name) return;
      /* 밴드가 「변 용 운 ( 공 유 자)」를 자르면 이름에 여는 괄호가 남는다. */
      o.name = squash(o.name).replace(/[（(].*$/, '').replace(/[_|｜ㅣ]/g, '');
      var key = o.name.replace(/[()（）]/g, '');
      if (key.length < 2) return;
      for (var k = 0; k < SP.length; k++) {
        if (L[k].replace(/[()（）]/g, '').indexOf(key) < 0) continue;
        var mm = SP[k].match(/(단\s*독\s*소\s*유|[\d][\d.,]*\s*분\s*의\s*(?:[\d][\d.,]*|[ㅣlI|｜丨]))/);
        if (!mm) continue;
        var sh = looseShare(mm[0]);
        if (sh && (!o.share || !o.share.denom)) { o.share = sh; o.shareRaw = sh.raw; filled.push('share:' + o.name); }
        var tail = SP[k].slice(mm.index + mm[0].length).replace(/^[\s|｜ㅣ]+/, '');

        /* 요약표 한 칸이 두 줄로 접히는 경우가 있다. 실측 두 종류:
             이름 접힘  「주식회사하나자」 + 다음 줄 「산신탁 (수탁자) 15층 (역삼동…)」
             주소 접힘  「…808호 (동천동,」 + 다음 줄 「화성센트럴파크)」
           다음 한 줄만 본다. 주민번호가 있으면 다른 소유자 줄이므로 건드리지 않는다. */
        /* 줄 끝의 1~2자리 숫자는 순위번호 칸이다(실측: 「테헤란로 197, 6」의 6).
           다만 「약사로 15」처럼 번지로 끝나는 주소를 깎으면 안 되므로,
           앞쪽에 이미 숫자가 있을 때만 지운다. */
        var cut = tail.replace(/[\s,|｜ㅣ]*\d{1,2}\s*$/, '');
        if (/\d/.test(cut)) tail = cut;
        var nx = SP[k + 1] || '';
        if (nx && !/\d{6}\s*[-–—]/.test(nx) && !/소유지분|참고사항|저당권/.test(squash(nx))) {
          var rq = nx.match(/[（(]\s*(공유자|소유자|수탁자|위탁자)\s*[）)]/);
          if (rq && rq.index > 0) {
            var frag = squash(nx.slice(0, rq.index)).replace(/[_|｜ㅣ]/g, '');
            if (/^[가-힣]{1,10}$/.test(frag)) { o.name += frag; }
            /* 순위번호를 떼어낸 자리에 다음 줄이 붙으므로 쉼표로 이어야
               「197 15층」이 「19715층」으로 뭉치지 않는다. */
            tail += ', ' + nx.slice(rq.index + rq[0].length);
          } else if (tail.split('(').length > tail.split(')').length) {
            tail += ' ' + nx.split(')')[0] + ')';      // 미완결 괄호만 이어붙인다
          }
        }
        tail = tail.replace(/\s*\d{1,2}\s*$/, '');            // 끝의 순위번호 제거
        var addr = respace(tail).replace(/,\s*\d{1,2}\s+/g, ', ')
                     .replace(/\s+([)）,])/g, '$1').replace(/([(（])\s+/g, '$1');
        if (addr.length >= 6 &&
            (!o.registryAddress || addr.length > squash(o.registryAddress).length)) {
          o.registryAddress = addr; filled.push('addr:' + o.name);
        }
        break;
      }
    });

    out.ocrFilled = filled;
  }

  /* 면적·비율 숫자는 ㎡ 기호가 숫자로 읽히면 자릿수가 늘어난다(실측: 2301㎡ → 23012,
     20.16㎡ → 2220.16). 닫힌 집합이 없어 사전으로 막을 수 없으므로 값은 채우되
     반드시 원본 대조를 요구한다 — §13-4의 「인식」 태그·노란칸이 이 역할을 한다. */
  function ocrConfidence(out) {
    var P = out.property || {}, c = out.confidence || (out.confidence = {});
    var need = [];
    if (P.landArea)       { c.landArea = 'medium';       need.push('면적'); }
    if (P.exclusiveArea)  { c.exclusiveArea = 'medium';  need.push('전유면적'); }
    if (P.landRightRatio) { c.landRightRatio = (c.landRightRatio === 'low' ? 'low' : 'medium'); need.push('대지권비율'); }
    out.needsReview = need;
  }

  /* 등기부 안에는 서로를 검증하는 값이 있다. 숫자 오인식은 사전으로 못 고치지만
     아래 두 가지는 「틀렸을 가능성이 높다」까지는 판정할 수 있다.
     고쳐 넣지 않는다 — 어느 쪽이 틀렸는지 알 수 없기 때문이다. 대조만 요구한다. */
  function crossCheck(out, lines) {
    var P = out.property || {}, c = out.confidence || (out.confidence = {});
    var L = lines.map(function (x) { return squash(x.text); });

    // (1) 호수 앞자리는 층이다. 「제23층 제207호」는 207이 2층을 가리켜 어긋난다.
    var em = nz(P.exclusiveNo).match(/제\s*(\d+)\s*층\s*제\s*(\d+)\s*호/);
    if (em && em[2].length >= 3) {
      var pre = em[2].slice(0, em[2].length - 2);
      if (pre !== em[1]) {
        c.exclusiveNo = 'low';
        out.warnings.push('「제' + em[1] + '층 제' + em[2] + '호」로 읽었는데 호수 앞자리(' +
          pre + ')와 층이 맞지 않습니다. 둘 중 하나가 잘못 읽혔을 수 있으니 원본을 확인해 주세요.');
      }
    }

    // (2) 전유면적은 그 건물 한 층의 면적을 넘을 수 없다.
    if (P.exclusiveArea) {
      var mx = 0;
      L.forEach(function (t) {
        var re = /(?:지?\d{1,2})층([\d,]+\.\d+)/g, m2;
        while ((m2 = re.exec(t))) { var v = parseFloat(m2[1].replace(/,/g, '')); if (v > mx) mx = v; }
      });
      var ea = parseFloat(P.exclusiveArea);
      if (mx > 0 && isFinite(ea) && ea > mx) {
        c.exclusiveArea = 'low';
        out.warnings.push('전유면적을 ' + P.exclusiveArea + '로 읽었는데, 표제부의 한 층 면적(' +
          mx + ')보다 큽니다. ㎡ 기호가 숫자로 읽혔을 수 있으니 원본을 확인해 주세요.');
      }
    }
  }

  // ---------- 7) 검증 게이트 ----------
  function validate(out) {
    var w = out.warnings, c = out.confidence;
    c.uid = /^\d{4}-\d{4}-\d{6}$/.test(nz(out.uid)) ? 'high' : 'low';
    if (c.uid === 'low') w.push('고유번호 형식이 4-4-6이 아닙니다.');

    c.court = out.court ? 'high' : 'low';
    if (!out.court) w.push('관할등기소를 찾지 못했습니다.');

    if (out.docType === '집합건물') {
      var r = out.property.landRightRatio;
      if (!r) { c.landRightRatio = 'low'; w.push('대지권비율을 읽지 못했습니다.'); }
      else if (parseFloat(r.num) > parseFloat(r.denom)) {
        c.landRightRatio = 'low'; w.push('대지권비율의 분자가 분모보다 큽니다. 원본 확인이 필요합니다.');
      } else c.landRightRatio = 'high';
      c.exclusiveArea = out.property.exclusiveArea ? 'high' : 'low';
    }

    if (!out.owners.length) { c.owners = 'low'; w.push('소유자 정보를 추출하지 못했습니다.'); }
    else {
      var sum = 0, ok = true;
      out.owners.forEach(function (o) {
        if (!o.share) { ok = false; return; }
        sum += parseFloat(o.share.num) / parseFloat(o.share.denom);
      });
      c.owners = (ok && Math.abs(sum - 1) < 0.001) ? 'high' : 'low';
      if (c.owners === 'low') w.push('소유자 지분 합계가 1이 아닙니다(' + sum.toFixed(4) + '). 원본 확인이 필요합니다.');
    }
    out.ownerCount = out.owners.length;
    out.isJointOwnership = out.owners.length > 1;
    out.isTrust = out.owners.some(function (o) { return o.role === '수탁자'; });
    out.hasMortgage = out.liens.length > 0;

    /* ---- 근저당권 말소(Case C) 신청 가능 여부 ----
       말소등기의 등기권리자는 소유자(근저당권설정자)이지 채무자가 아니다.
       공유물 전부에 설정된 근저당권이라면 공유자 중 1인이 보존행위로
       단독 신청할 수 있다(민법 265조 단서 / 대법원 1993.5.11. 92다52870 /
       2024.9.19. 부동산등기과-2604 질의회답).
       다만 지분 근저당은 보존행위 법리가 걸리지 않으므로 해당 지분권자로 고정한다.
       소유자 3인 이상은 화면·서식 구조상 지원하지 않는다(제품 결정). */
    out.activeLiens = (out.liens || []).filter(function (L) { return !L.cancelled; });
    out.cancel = {
      supported: true,
      reasons: [],
      applicantMode: null,     // 'single' | 'choose' | 'fixed'
      applicantCandidates: [],
      partialShare: (out.liens || []).some(function (L) { return L.isPartialShare; })
    };
    if (!out.owners.length) {
      out.cancel.supported = false;
      out.cancel.reasons.push('소유자를 읽지 못했습니다.');
    } else if (out.owners.length > 2) {
      out.cancel.supported = false;
      out.cancel.reasons.push('소유자가 ' + out.owners.length + '명입니다. 공유자 3인 이상은 현재 지원하지 않습니다.');
    } else if (out.owners.length === 2) {
      out.cancel.applicantMode = 'choose';
      out.cancel.applicantCandidates = out.owners.map(function (o) { return o.name; });
    } else {
      out.cancel.applicantMode = 'single';
      out.cancel.applicantCandidates = [out.owners[0].name];
    }
    if (out.cancel.supported && out.cancel.partialShare) {
      out.cancel.applicantMode = 'fixed';
      out.cancel.reasons.push('지분에 설정된 근저당권이므로 해당 지분권자만 신청할 수 있습니다. 등기목적의 지분권자와 신청인이 같은지 확인하세요.');
    }
    if (out.cancel.supported && !out.activeLiens.length && out.hasMortgage) {
      out.cancel.supported = false;
      out.cancel.reasons.push('현재 유효한 근저당권이 확인되지 않습니다. 이미 말소되었을 수 있습니다.');
    }
    var BLOCKERS = /압류|가압류|가처분|경매|예고등기|환매|신탁/;
    out.blockers = (out.encumbrances || []).filter(function (r) { return BLOCKERS.test(r.purpose); });
    out.hasBlocker = out.blockers.length > 0;
    if (out.hasBlocker) {
      w.push('소유권에 압류·가처분 등의 제한이 기재되어 있습니다(' +
             out.blockers.map(function (r) { return r.purpose; }).join(', ') +
             '). 셀프등기 진행 전 확인이 필요합니다.');
    }
    if (out.isTrust) w.push('현재 소유자가 수탁자(신탁)입니다. 일반 매매 케이스와 절차가 다릅니다.');
  }

  // 사용자가 입력한 매도인 주소와 등기부 주소를 대조한다.
  // 절차(등기명의인표시변경 등)는 단정하지 않는다.
  function compareSellerAddress(result, inputAddress) {
    var out = [];
    (result.owners || []).forEach(function (o) {
      if (!o.registryAddress || !inputAddress) return;
      var a = squash(o.registryAddress), b = squash(inputAddress);
      if (a === b) { out.push({ name: o.name, match: true }); return; }
      out.push({
        name: o.name, match: false,
        registryAddress: o.registryAddress, inputAddress: inputAddress,
        message: '등기부상 주소와 입력하신 주소가 다릅니다. 매도인이 이사한 경우 추가 절차가 필요할 수 있으니 확인하세요.'
      });
    });
    return out;
  }

  // ---------- 공개 API ----------
  async function parseRegistry(pdfjsLib, data) {
    var doc;
    try {
      doc = await pdfjsLib.getDocument({ data: data, useSystemFonts: true }).promise;
    } catch (e) {
      return { ok: false, reason: 'PDF_OPEN_FAILED', warnings: ['PDF를 열 수 없습니다.'] };
    }
    var lines = [], textChars = 0;
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      tc.items.forEach(function (i) { textChars += nz(i.str).trim().length; });
      var pl = itemsToLines(tc.items);
      pl.forEach(function (L) { L.page = p; });
      lines = lines.concat(pl);
    }
    if (textChars < 200) {
      return {
        ok: false, reason: 'NO_TEXT_LAYER', pages: doc.numPages,
        warnings: ['텍스트 레이어가 없는 이미지 PDF입니다. 현재 단계에서는 처리할 수 없습니다.']
      };
    }
    var res = buildResult(lines);
    res.pages = doc.numPages;
    return res;
  }

  // OCR 등 외부 소스가 만든 토큰으로 직접 파싱 (좌표는 PDF 포인트 단위)
  function parseTokens(tokens, opt) {
    var lines = tokensToLines(tokens, opt);
    if (!lines.length) return { ok: false, reason: 'NO_TOKENS', warnings: ['인식된 글자가 없습니다.'] };
    return buildResult(lines, { ocr: !!(opt && opt.ocr) });
  }

  var RegParse = {
    parseRegistry: parseRegistry,
    parseTokens: parseTokens,
    compareSellerAddress: compareSellerAddress,
    _internal: { itemsToLines: itemsToLines, tokensToLines: tokensToLines, sliceSections: sliceSections, parseSection: parseSection, headerBands: headerBands, COLS: COLS, SUB: SUB, splitByBands: splitByBands, parseSummary: parseSummary, parseEul: parseEul, parseEulText: parseEulText, eulPartyText: eulPartyText, eulParty: eulParty, markCancelled: markCancelled, headerIdent: headerIdent, looseRatio: looseRatio, respace: respace, judgeSeparateReg: judgeSeparateReg, parseRatio: parseRatio }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RegParse;
  if (root) root.RegParse = RegParse;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));

