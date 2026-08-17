/* 등기부 이미지·촬영본 판독 — selfregi24 (2026-08-16 이식)
   원본: form.html 인라인 블록. 외부 파일로 분리해 normal_form.html에서 로드한다. */
/* ============================================================
 * regocr.js — 등기부 이미지·촬영본 판독 (셀프등기24)
 *
 * 의존: regparse.js (먼저 로드) / tesseract.js / pdf.js(이미지PDF일 때)
 *
 * 실측 근거 (2026-08-15, 신당동 등기부 촬영본 3장 · 정답 30항목)
 *   원본 3000px 그대로            0/30 ( 0%)   ← 모아레가 한글 획과 간섭
 *   1000px 축소                  25/30 (83%)
 *   blur1.0 + 1600px             25/30 (83%)
 *   1500px                        5/30 (17%)   ← 절벽
 *   1600px 이상                   0/30 ( 0%)
 *   3조합 합집합                  29/30 (97%)
 *
 * 그러나 "정답이 어딘가 있다"와 "어느 것이 정답인지 안다"는 다르다.
 *   1000px      → 신당동 372-18  제8 07호      ✗
 *   blur1+1600  → 신당동 372-13  제2층 제207호  ✓
 * 둘 다 형식 검증을 통과한다. 그래서
 *   (1) 단어 신뢰도로 고르고  (2) 진 후보도 남기고  (3) 불일치는 사용자에게 묻는다.
 * ============================================================ */
(function (root) {
  'use strict';

  // ---------- 프리셋 (실측 순위대로) ----------
  var PRESETS = [
    { name: 'blur1+1600', blur: 1.0, width: 1600 },
    { name: '1000px', blur: 0, width: 1000 },
    { name: 'blur1+1200', blur: 1.0, width: 1200 }
  ];

  /* 소스 크기에 맞춰 프리셋을 만든다.
     실측(3000px 촬영본): 1000px 83% / blur1+1600 83% / 1500px 17% / 1600px+ 0%
     축소가 모아레를 걷어내는 저역통과로 작동하므로 '줄일 여유'가 있어야 이득이다.
     이미 작은 사진(카톡 압축본 1050px)에 같은 프리셋을 쓰면 블러만 얹혀 악화된다. */
  function buildPresets(srcWidth) {
    var big = [
      { name: 'blur1+1600', blur: 1.0, width: 1600 },
      { name: '1000px', blur: 0, width: 1000 },
      { name: 'blur1+1200', blur: 1.0, width: 1200 }
    ];
    var usable = big.filter(function (p) { return p.width <= srcWidth * 0.92; }); // 확대는 무익(실측 0/12)
    if (!usable.length) {
      return [{ name: '원본', blur: 0, width: srcWidth },
              { name: '약블러0.5', blur: 0.5, width: srcWidth }];
    }
    if (srcWidth < 2000) usable.unshift({ name: '원본', blur: 0, width: srcWidth });
    return usable;
  }

  /* A4 기준 해상도 진단. 막지 않고 이유를 알려주기 위한 것. */
  function assessSource(w, h) {
    var shortSide = Math.min(w, h);
    var dpi = Math.round(shortSide / 8.27);      // A4 폭 210mm = 8.27in
    var level = dpi >= 260 ? 'good' : (dpi >= 170 ? 'fair' : 'poor');
    var msg = null;
    if (level === 'poor') {
      msg = '이 사진은 ' + w + '×' + h + ' (약 ' + dpi + 'dpi)입니다. 카카오톡 등으로 받으신 사진은 ' +
            '압축된 사본일 수 있습니다. 같은 등기부로 실측했을 때 압축본은 19%, 원본 화질은 97%였습니다. ' +
            '보내신 분께 「원본 전송」 또는 「파일로 전송」으로 다시 요청하시면 정확도가 크게 올라갑니다.';
    } else if (level === 'fair') {
      msg = '이 사진은 약 ' + dpi + 'dpi입니다. 판독은 되지만 숫자 오인식 가능성이 있으니 ' +
            '층·호와 지번은 반드시 원본과 대조하세요.';
    }
    return { width: w, height: h, dpi: dpi, level: level, message: msg };
  }

  var A4_PT_WIDTH = 595.28;   // 좌표를 PDF 포인트로 정규화 → regparse의 허용오차 재사용
  var CONF_MIN = 45;          // 단어 하나를 저신뢰로 볼 기준 (재보정 대상)
  var LOW_MAX = 0.25;         // 값 전체를 '확인 필요'로 볼 저신뢰 글자 비율
  var INIT_TIMEOUT = 90000;
  var RECOG_TIMEOUT = 240000;

  function sq(s) { return String(s == null ? '' : s).replace(/\s+/g, ''); }

  // ---------- 닫힌 집합 스냅 ----------
  // 후보가 유한한 필드는 OCR 오인식을 사전으로 되돌릴 수 있다.
  var JIMOK = ['전','답','과수원','목장용지','임야','광천지','염전','대','공장용지','학교용지',
    '주차장','주유소용지','창고용지','도로','철도용지','제방','하천','구거','유지','양어장',
    '수도용지','공원','체육용지','유원지','종교용지','사적지','묘지','잡종지'];
  var STRUCT = ['철근콘크리트조','철근콩크리트조','철골철근콘크리트조','철골조','연와조','시멘트블록조',
    '목조','벽돌조','석조','조적조','일반철골구조','철근콘크리트구조','철골철근콘크리트구조'];

  // 글자 단위 교정 — 실측에서 반복 관찰된 것만
  var CHAR_FIX = [
    [/[ㅁ모묘믐]\s*(?=$|\s)/g, '㎡'],      // ㎡ 오인식
    [/(\d)\s*[ㅁ모묘0"']\s*(?=\s|$)/g, '$1㎡'],
    [/충/g, '층'],
    [/계(?=\s*\d+\s*층)/g, '제']
  ];

  function fixChars(s) {
    var t = String(s || '');
    CHAR_FIX.forEach(function (r) { t = t.replace(r[0], r[1]); });
    return t;
  }

  // 편집거리 (짧은 문자열 전용)
  function dist(a, b) {
    var m = a.length, n = b.length, i, j, prev, cur = [], tmp;
    for (j = 0; j <= n; j++) cur[j] = j;
    for (i = 1; i <= m; i++) {
      prev = cur[0]; cur[0] = i;
      for (j = 1; j <= n; j++) {
        tmp = cur[j];
        cur[j] = Math.min(cur[j] + 1, cur[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return cur[n];
  }

  // 닫힌 집합에 스냅. 유일 후보(거리<=maxD)만 교정하고, 애매하면 원본 유지.
  function snap(value, set, maxD) {
    var v = sq(value); if (!v) return { value: value, snapped: false };
    if (set.indexOf(v) >= 0) return { value: v, snapped: false, exact: true };
    var best = null, bestD = 1e9, ties = 0;
    set.forEach(function (c) {
      var d = dist(v, c);
      if (d < bestD) { bestD = d; best = c; ties = 1; }
      else if (d === bestD) ties++;
    });
    if (best && bestD <= (maxD == null ? 1 : maxD) && ties === 1) {
      return { value: best, snapped: true, from: value, distance: bestD };
    }
    return { value: value, snapped: false, ambiguous: bestD <= 2 };
  }

  // ---------- 전처리 ----------
  // 흑백화 + 히스토그램 상하위 0.5% 자동대비. 이진화·노이즈제거는 하지 않는다.
  // (신탁 도구 실측: 고정임계 이진화 + 노이즈제거는 한글 획을 뭉개 36/63으로 붕괴)
  function toGrayAutoContrast(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var im = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var d = im.data, N = canvas.width * canvas.height;
    var g = new Uint8Array(N), hist = new Uint32Array(256), i, p;
    for (i = 0; i < N; i++) {
      p = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0;
      g[i] = p; hist[p]++;
    }
    var lo = 0, hi = 255, acc = 0, cut = N * 0.005;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cut) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cut) { hi = i; break; } }
    if (hi <= lo) { lo = 0; hi = 255; }
    var sc = 255 / (hi - lo), o;
    for (i = 0; i < N; i++) {
      p = (g[i] - lo) * sc; p = p < 0 ? 0 : (p > 255 ? 255 : p);
      o = i * 4; d[o] = d[o + 1] = d[o + 2] = p; d[o + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return canvas;
  }

  // 소스(Image | Canvas)를 프리셋 크기로 그린다.
  // 블러는 모아레(촬영본 간섭무늬) 제거용. 축소 자체가 저역통과로 작동한다.
  function renderPreset(src, preset) {
    var sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    var w = Math.min(preset.width, sw), h = Math.round(sh * w / sw);

    /* 파이썬 검증 파이프라인과 순서를 정확히 맞춘다:
       ① 원본 해상도에서 블러(모아레 제거) → ② 목표 크기로 축소.
       캔버스 filter 의 blur 반경이 어느 좌표계인지 모호하므로 두 단계로 분리한다. */
    var stage = src;
    if (preset.blur > 0) {
      var off = document.createElement('canvas');
      off.width = sw; off.height = sh;
      var octx = off.getContext('2d', { willReadFrequently: true });
      if (typeof octx.filter === 'string') octx.filter = 'blur(' + preset.blur.toFixed(2) + 'px)';
      octx.drawImage(src, 0, 0);
      octx.filter = 'none';
      stage = off;
    }

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    /* 축소에는 보간이 필요하다. imageSmoothingEnabled=false 는 확대할 때의 규칙이고,
       축소에 끄면 최근접 표본화가 되어 획이 끊긴다. */
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(stage, 0, 0, w, h);
    return toGrayAutoContrast(cv);
  }

  // ---------- tesseract 결과 → 토큰 ----------
  function collectWords(dat, into) {
    into = into || [];
    if (!dat) return into;
    if (dat.words && dat.words.length) {
      dat.words.forEach(function (w) { if (w && w.text) into.push(w); });
      return into;
    }
    (dat.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (l) {
          (l.words || []).forEach(function (w) { if (w && w.text) into.push(w); });
        });
      });
    });
    return into;
  }

  // 좌표를 PDF 포인트로 정규화해 regparse의 밴드/행 로직을 그대로 쓴다.
  function wordsToTokens(words, imgWidth, imgHeight) {
    var k = A4_PT_WIDTH / imgWidth;
    return words.map(function (w) {
      var b = w.bbox || {};
      return {
        str: fixChars(w.text),
        x: (b.x0 || 0) * k,
        y: (imgHeight - (b.y1 || 0)) * k,   // tesseract는 위에서, PDF는 아래에서 잰다
        w: ((b.x1 || 0) - (b.x0 || 0)) * k,
        size: (((b.y1 || 0) - (b.y0 || 0)) * k) || 10,
        conf: typeof w.confidence === 'number' ? w.confidence : -1
      };
    });
  }

  /* 여러 장의 이미지를 한 문서로 합친다.
     페이지마다 따로 파싱하면 제목·요약이 흩어져 판정이 깨진다. */
  function combinePages(tokenArrays) {
    var out = [], PAGE_GAP = 1000;
    tokenArrays.forEach(function (toks, i) {
      toks.forEach(function (t) {
        out.push({ str: t.str, x: t.x, y: t.y - i * PAGE_GAP, w: t.w, size: t.size, conf: t.conf, page: i + 1 });
      });
    });
    return out;
  }

  // ---------- 신뢰도 ----------
  // 값을 구성하는 '군더더기가 가장 적은 연속 단어 구간'의 통계.
  // 최초 구간을 쓰면 앞선 라벨 단어가 끌려들어와 값을 부당하게 깎는다.
  function confStat(value, words) {
    var n = sq(value);
    if (!n || !words || !words.length) return { mean: -1, min: -1, ratio: 0, ok: false };
    var best = null, waste = 1e9, i, j, acc, seg;
    for (i = 0; i < words.length; i++) {
      acc = ''; seg = [];
      for (j = i; j < words.length && acc.length < n.length + 24; j++) {
        acc += sq(words[j].str); seg.push(words[j]);
        if (acc.indexOf(n) >= 0) {
          if (acc.length - n.length < waste) { waste = acc.length - n.length; best = seg.slice(); }
          break;
        }
      }
    }
    if (!best) return { mean: -1, min: -1, ratio: 0, ok: false };
    var cs = best.map(function (w) { return w.conf; }).filter(function (c) { return c >= 0; });
    if (!cs.length) return { mean: -1, min: -1, ratio: 0, ok: false };
    var low = cs.filter(function (c) { return c < CONF_MIN; }).length;
    var mean = cs.reduce(function (a, b) { return a + b; }, 0) / cs.length;
    var ratio = low / cs.length;
    return { mean: mean, min: Math.min.apply(null, cs), ratio: ratio, ok: ratio <= LOW_MAX };
  }

  /* ---------- 라벨 앵커 추출기 ----------
     실측 결론: 촬영본 OCR 에서는 표 헤더가 두 줄로 쪼개지고 소제목도 글자가 빠진다
     (「( 전 유 부 분 의 건 물 의 표 )」 — 시 누락). 그래서 regparse 의 좌표·밴드 파서가
     동작하지 않는다. 이미지 경로는 라벨/패턴 앵커로 뽑고, 검증 게이트만 공유한다. */
  function extractByLabel(rawText) {
    var t = fixChars(rawText || '').replace(/\s+/g, '');
    var f = {}, g;

    g = t.match(/고유번호[:：]?(\d{4})-?(\d{4})-?(\d{6})/);
    if (g) f.uid = g[1] + '-' + g[2] + '-' + g[3];

    /* 대지권비율. 뒤에 다른 숫자가 이어붙으면(「55분의11986」) 분자를 탐욕적으로 먹어
       분자>분모가 되어 버린다. 분자를 짧은 쪽부터 시도해 분자<=분모인 해석을 채택한다. */
    var ratios = [], re = /([\d]{1,7}(?:\.\d+)?)분의([\d]{1,9}(?:\.\d+)?)/g, mm;
    while ((mm = re.exec(t))) {
      var dn = parseFloat(mm[1]), tail = mm[2], picked = null, bestScore = -1;
      for (var L = 1; L <= tail.length; L++) {
        var cand = tail.slice(0, L);
        if (!/^\d+(\.\d+)?$/.test(cand)) continue;
        var nu = parseFloat(cand);
        if (!(nu > 0 && nu <= dn)) continue;
        /* 「55분의11986」 은 55분의1 + 1986(연도) 인지 55분의11 + 986 인지 모호하다.
           남은 꼬리가 연도로 시작하면 그 해석을 우선한다. */
        var rest = tail.slice(L);
        var sc = /^(19|20)\d{2}/.test(rest) ? 2 : (rest === '' ? 1 : 0);
        if (sc > bestScore) { bestScore = sc; picked = cand; }
      }
      if (dn > 0 && picked) {
        ratios.push({ denom: mm[1], num: picked, raw: mm[1] + '분의' + picked,
                      ambiguous: tail.length > picked.length });
      }
    }
    if (ratios.length) f.landRightRatio = ratios[0];
    if (ratios.length > 1) f.landRightRatioCands = ratios;

    // 층·호 — 여러 곳에 나오므로 전부 모아 최빈값
    var hos = {}, re2 = /제(\d{1,3})[층칭]제(\d{1,5})[호흐]/g;
    while ((mm = re2.exec(t))) { var kk = '제' + mm[1] + '층 제' + mm[2] + '호'; hos[kk] = (hos[kk] || 0) + 1; }
    var hoList = Object.keys(hos).sort(function (a, b) { return hos[b] - hos[a]; });
    if (hoList.length) { f.exclusiveNo = hoList[0]; f.exclusiveNoCands = hoList; }

    // 소재지번 — [집합건물]/[토지]/[건물] 표시 뒤
    g = t.match(/\[(?:집합건[물둘울]|토지|건[물둘울])\](.{4,60}?)(?:제\d{1,3}[층칭]|【|고유번호|$)/);
    if (g) f.header = g[1];

    g = t.match(/관할등기소([가-힣]{2,20}(?:등기소|등기국|등기계))/);
    if (g) f.court = g[1];

    // 면적 후보 (숫자+㎡)
    var areas = [], re3 = /([\d]{1,6}(?:\.\d{1,2})?)㎡/g;
    while ((mm = re3.exec(t))) areas.push(mm[1]);
    f.areas = areas;

    // 소유자 — 요약 소유지분현황이 가장 깨끗하다
    var owners = [], re4 = /(주식회사[가-힣]{2,12}|[가-힣]{2,5})[（(]?(소유자|공유자|수탁자)[)）]?[^\d]{0,3}(\d{6})[-–—]?([\d*]{0,7})(단독소유|\d+분의\d+)?/g;
    while ((mm = re4.exec(t))) {
      owners.push({ name: mm[1], role: mm[2], regNo: mm[3] + '-' + (mm[4] || '*******'), shareRaw: mm[5] || null });
    }
    if (owners.length) f.owners = owners;

    // 근저당 — 라벨이 깨져도 금액 패턴 자체가 특징적이다
    var amts = [], re5 = /([\d]{1,3}(?:[,.\s][\d]{3}){2,})/g;
    while ((mm = re5.exec(t))) amts.push(mm[1].replace(/[.\s]/g, ','));
    if (amts.length) { f.maxAmount = amts[0]; f.amountCands = amts; }
    g = t.match(/채권최고액금?([\d,]{5,20})원/);
    if (g) f.maxAmount = g[1];

    g = t.match(/근저당권자(주식회사[가-힣]{2,14}|[가-힣]{2,16}(?:은행|협동조합|금고|캐피탈|보험))/);
    if (g) f.creditor = g[1];

    // 접수번호 — 후보 전체를 남긴다(어느 것이 근저당 접수번호인지 OCR로는 확정 못 함)
    var recs = [], re6 = /제([\d]{3,8})호/g;
    while ((mm = re6.exec(t))) if (recs.indexOf(mm[1]) < 0) recs.push(mm[1]);
    if (recs.length) f.receiptNoCands = recs;
    var near = t.match(/근저당권설정.{0,30}?제([\d]{3,8})호/);
    if (near) f.lienReceiptNo = near[1];

    return f;
  }

  // ---------- 필드 비교 ----------
  // 반려로 직결되는 순서. 실측에서 실제로 틀린 것부터.
  var FIELDS = [
    { key: 'property.exclusiveNo', label: '전유부분(층·호)', risk: 'critical' },
    { key: 'property.jibunAddress', label: '소재지번', risk: 'critical' },
    { key: 'property.landRightRatio.raw', label: '대지권비율', risk: 'high' },
    { key: 'property.exclusiveArea', label: '전유면적', risk: 'high' },
    { key: 'property.landArea', label: '대지면적', risk: 'high' },
    { key: 'uid', label: '고유번호', risk: 'high' },
    { key: 'property.roadAddress', label: '도로명주소', risk: 'mid' },
    { key: 'court', label: '관할등기소', risk: 'low' },
    { key: 'property.landCategory', label: '지목', risk: 'low' },
    { key: 'property.exclusiveStruct', label: '구조', risk: 'low' }
  ];

  function dig(o, path) {
    var p = path.split('.'), v = o, i;
    for (i = 0; i < p.length; i++) { if (v == null) return null; v = v[p[i]]; }
    return v == null ? null : String(v);
  }

  /* 여러 패스의 결과를 합친다.
     조용히 하나만 고르는 것이 가장 위험하므로, 진 후보를 반드시 남긴다. */
  function mergePasses(passes) {
    var fields = {}, conflicts = [];
    FIELDS.forEach(function (f) {
      var cands = [];
      passes.forEach(function (ps) {
        if (!ps.result || !ps.result.ok) return;
        var v = dig(ps.result, f.key);
        if (!v) return;
        var st = confStat(v, ps.words);
        var hit = cands.filter(function (c) { return sq(c.value) === sq(v); })[0];
        if (hit) { hit.passes.push(ps.name); if (st.mean > hit.conf) { hit.conf = st.mean; hit.ratio = st.ratio; } }
        else cands.push({ value: v, conf: st.mean, ratio: st.ratio, passes: [ps.name] });
      });
      if (!cands.length) { fields[f.key] = null; return; }
      // 저신뢰 글자 비율이 낮은 쪽 → 같으면 평균 높은 쪽 → 같으면 더 많은 패스가 동의한 쪽
      cands.sort(function (a, b) {
        return (a.ratio - b.ratio) || (b.conf - a.conf) || (b.passes.length - a.passes.length);
      });
      var winner = cands[0];
      fields[f.key] = {
        label: f.label, risk: f.risk, value: winner.value,
        conf: winner.conf, ratio: winner.ratio, agreedBy: winner.passes,
        alternatives: cands.slice(1)
      };
      var needsCheck = cands.length > 1 || f.risk === 'critical' || winner.ratio > LOW_MAX || winner.conf < 0;
      fields[f.key].needsConfirm = needsCheck;
      if (cands.length > 1) {
        conflicts.push({
          label: f.label, risk: f.risk,
          values: cands.map(function (c) { return { value: c.value, passes: c.passes, conf: c.conf }; })
        });
      }
    });
    return { fields: fields, conflicts: conflicts };
  }

  // ---------- 실행 ----------
  function withTimeout(p, ms, label) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error(label || ('시간 초과(' + ms + 'ms)'))); }, ms);
    })]);
  }

  /* tesseract.js 워커.
     langs 는 반드시 배열. 객체 하나로 주면 내부 langsArr.map() 오류가
     createWorker 의 .catch(()=>{}) 에 삼켜져 오류 없이 영구 대기한다. */
  async function makeWorker(Tesseract, opts) {
    opts = opts || {};
    var w = await withTimeout(
      Tesseract.createWorker(opts.langs || 'kor', 1, {
        logger: opts.logger,
        errorHandler: opts.errorHandler
      }),
      INIT_TIMEOUT, 'OCR 엔진 준비가 90초 안에 끝나지 않았습니다.'
    );
    await w.setParameters({ tessedit_pageseg_mode: '4' });   // PSM 3 자동은 붕괴한다
    return w;
  }

  /* 단계적 실행: 1차 프리셋으로 시작하고, 검증을 통과하지 못할 때만 다음 프리셋을 돌린다.
     항상 3패스를 돌리면 시간이 3배가 된다. */
  async function recognize(src, Tesseract, opts) {
    opts = opts || {};
    var sw0 = src.naturalWidth || src.width || 0;
    var presets = opts.presets || (sw0 ? buildPresets(sw0) : PRESETS);
    var maxPasses = opts.maxPasses || presets.length;
    var onProgress = opts.onProgress || function () {};
    var worker = opts.worker || await makeWorker(Tesseract, opts);
    var ownWorker = !opts.worker;
    var passes = [];

    try {
      for (var i = 0; i < presets.length && passes.length < maxPasses; i++) {
        var ps = presets[i];
        onProgress({ phase: 'render', pass: ps.name, index: i, total: maxPasses });
        var cv = renderPreset(src, ps);
        onProgress({ phase: 'ocr', pass: ps.name, index: i, total: maxPasses });
        var res = await withTimeout(
          worker.recognize(cv, { rotateAuto: true }, { text: true, blocks: true }),
          RECOG_TIMEOUT, 'OCR 인식이 240초 안에 끝나지 않았습니다.'
        );
        var data = res.data || {};
        var words = collectWords(data, []);
        var tokens = wordsToTokens(words, cv.width, cv.height);
        var parsed = root.RegParse ? root.RegParse.parseTokens(tokens) : null;
        passes.push({
          name: ps.name, preset: ps, canvas: cv,
          words: tokens, text: data.text || '', result: parsed
        });
        // 1차가 깨끗하면 여기서 멈춘다
        if (i === 0 && parsed && parsed.ok && !parsed.warnings.length && !opts.forceAllPasses) {
          var quick = mergePasses(passes);
          var risky = Object.keys(quick.fields).filter(function (k) {
            var f = quick.fields[k];
            return f && f.risk !== 'low' && (f.conf < 0 || f.ratio > LOW_MAX);
          });
          if (!risky.length) break;
        }
      }
    } finally {
      if (ownWorker && worker && worker.terminate) { try { await worker.terminate(); } catch (e) {} }
    }

    var m = mergePasses(passes);
    var best = null;
    passes.forEach(function (p) {
      if (!p.result || !p.result.ok) return;
      if (!best || p.result.warnings.length < best.result.warnings.length) best = p;
    });

    return {
      ok: !!best,
      reason: best ? null : (passes.length ? 'PARSE_FAILED' : 'OCR_FAILED'),
      /* 여러 페이지를 합쳐 파싱하려면 호출측이 토큰을 받아야 한다.
         (요약 페이지가 뒤에 있어 페이지별 파싱만으로는 소유자를 놓친다) */
      tokens: best ? best.words : (passes.length ? passes[0].words : []),
      passCount: passes.length,
      /* 토큰을 반환하지 않으면 호출측이 결과를 꺼낼 수 없다.
         (2026.8.17 실사용에서 out.tokens 가 undefined 라 판독은 성공했는데
          "글자를 찾지 못했습니다"로 잘못 표시되는 버그가 있었다) */
      tokens: (passes[0] && passes[0].words) || [],
      text: passes.map(function (p) { return p.text || ''; }).join('\n'),
      passes: passes.map(function (p) {
        return {
          name: p.name, width: p.canvas.width, ok: !!(p.result && p.result.ok),
          warnings: p.result ? p.result.warnings : ['파싱 실패'],
          canvas: p.canvas, tokens: p.words || [], text: p.text || ''
        };
      }),
      result: best ? best.result : null,
      fields: m.fields,
      conflicts: m.conflicts,
      confirmList: Object.keys(m.fields).filter(function (k) {
        return m.fields[k] && m.fields[k].needsConfirm;
      }).map(function (k) { return m.fields[k]; }),
      snapDicts: { jimok: JIMOK, struct: STRUCT }
    };
  }

  // ---------- 원본 대조용 crop ----------
  // 값이 있던 자리를 원본에서 잘라 사용자에게 나란히 보여준다.
  // 이미지 경로에서는 이미 캔버스가 있으므로 비용이 없다.
  function cropAround(canvas, tokens, value, pad) {
    var n = sq(value); if (!n) return null;
    var acc = '', seg = [], i, j;
    for (i = 0; i < tokens.length; i++) {
      acc = ''; seg = [];
      for (j = i; j < tokens.length && acc.length < n.length + 24; j++) {
        acc += sq(tokens[j].str); seg.push(tokens[j]);
        if (acc.indexOf(n) >= 0) break;
      }
      if (acc.indexOf(n) >= 0) break;
    }
    if (!seg.length) return null;
    var k = canvas.width / A4_PT_WIDTH;
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    seg.forEach(function (t) {
      x0 = Math.min(x0, t.x * k); x1 = Math.max(x1, (t.x + t.w) * k);
      var top = canvas.height - (t.y + t.size) * k, bot = canvas.height - t.y * k;
      y0 = Math.min(y0, top); y1 = Math.max(y1, bot);
    });
    pad = pad == null ? 12 : pad;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(canvas.width, x1 + pad); y1 = Math.min(canvas.height, y1 + pad);
    var out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(x1 - x0));
    out.height = Math.max(1, Math.round(y1 - y0));
    out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  var RegOCR = {
    PRESETS: PRESETS,
    buildPresets: buildPresets,
    assessSource: assessSource,
    recognize: recognize,
    combinePages: combinePages,
    extractByLabel: extractByLabel,
    makeWorker: makeWorker,
    renderPreset: renderPreset,
    cropAround: cropAround,
    snap: snap,
    _internal: {
      toGrayAutoContrast: toGrayAutoContrast, wordsToTokens: wordsToTokens, combinePages: combinePages,
      confStat: confStat, mergePasses: mergePasses, fixChars: fixChars, extractByLabel: extractByLabel,
      dist: dist, collectWords: collectWords, FIELDS: FIELDS
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RegOCR;
  if (root) root.RegOCR = RegOCR;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));

