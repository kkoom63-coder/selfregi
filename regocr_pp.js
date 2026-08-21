/* regocr_pp.js — PP-OCRv5(한국어) 어댑터  v1 (2026.08.21)
 *
 * 목적: regparse.js / normal_form.html 을 고치지 않고 OCR 엔진만 갈아끼운다.
 * 노출 표면은 normal_form 이 실제로 쓰는 3개뿐이다.
 *   RegOCRPP.makeWorker(_, opts)  → terminate() 가 있는 핸들
 *   RegOCRPP.recognize(src, _, opts) → { tokens, confirmList, text, ... }
 *   RegOCRPP.combinePages(tokenArrays)
 *
 * 토큰 계약(regocr.js 205~217행과 동일):
 *   { str, x, y, w, size, conf }   x·y·w·size 는 A4 폭(595.28pt) 기준 정규화,
 *   y 는 '아래에서' 잰 값(pdf.js 좌표계). 이 계약이 어긋나면 regparse 의
 *   줄묶기(Y_TOL)와 열판정(splitByBands)이 통째로 무너진다.
 *
 * 의존: onnxruntime-web, opencv.js, esearch-ocr@5.1.5 — 전부 이 파일이 직접 싣는다.
 *       normal_form 은 Tesseract 를 안 실어도 된다.
 */
(function (root) {
  'use strict';

  var A4_PT_WIDTH = 595.28;
  var PAGE_GAP = 1000;      // regocr.js 와 동일해야 페이지 병합 좌표가 맞는다

  /* 모델 경로. 전부 Apache 2.0.
     det 는 server 판을 기본으로 둔다 — 4/4 판정을 낸 쪽이 이것이고
     mobile(5MB)로 같은 점수가 나오는지는 아직 미검증이다.
     실서비스 전환 시 HF 직접 fetch 대신 Vercel 미러 + 캐시 헤더로 바꾼다. */
  var MODELS = {
    /* 기본은 mobile det. 실측(2026.08.21, 신당동 집합건물)에서 server det 와
       판정값이 동일했고 체감 20~25초가 줄었다. 84MB → 4.83MB.
       ※ 종전 PT-Perkasa 경로는 401(Unauthorized)로 죽었다. 재도입 금지. */
    det: 'https://huggingface.co/ilaylow/PP_OCRv5_mobile_onnx/resolve/main/ppocrv5_det.onnx',
    detMobile: 'https://huggingface.co/ilaylow/PP_OCRv5_mobile_onnx/resolve/main/ppocrv5_det.onnx',
    detServer: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/detection/v5/det.onnx',
    rec: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/rec.onnx',
    dic: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/dict.txt'
  };
  var LIBS = {
    ort: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js',
    cv: 'https://docs.opencv.org/4.8.0/opencv.js',
    esearch: 'https://cdn.jsdelivr.net/npm/esearch-ocr@5.1.5/dist/esearch-ocr.js'
  };

  // ---------- 의존 라이브러리 적재 ----------
  function loadScript(src, isAsync) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; if (isAsync) s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('내려받지 못했습니다: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function waitFor(test, label, ms) {
    return new Promise(function (res, rej) {
      var t0 = Date.now();
      (function tick() {
        if (test()) return res();
        if (Date.now() - t0 > (ms || 90000)) return rej(new Error(label + ' 준비가 끝나지 않았습니다.'));
        setTimeout(tick, 200);
      })();
    });
  }

  /* 한 번만 돈다. 두 번째 업로드부터는 즉시 통과한다. */
  var _enginePromise = null;
  function ensureEngine(opts) {
    if (_enginePromise) return _enginePromise;
    var say = (opts && opts.logger) || function () {};
    _enginePromise = (async function () {
      say({ status: '판독 엔진 준비', progress: 0.05 });
      if (!root.ort) await loadScript(LIBS.ort, false);

      if (!(root.cv && root.cv.Mat)) {
        /* opencv.js 는 async 로딩 후 내부 초기화가 더 걸린다. 스크립트 onload 만
           믿으면 cv.Mat 이 아직 없는 상태로 init 에 들어가 조용히 실패한다. */
        loadScript(LIBS.cv, true).catch(function () {});
        say({ status: '영상처리 모듈 준비', progress: 0.12 });
        await waitFor(function () { return root.cv && root.cv.Mat; }, 'opencv.js', 120000);
      }

      say({ status: '판독 라이브러리 준비', progress: 0.2 });
      /* esearch-ocr 은 ESM 이라 <script src> 로 못 싣는다. 동적 import 를 쓴다. */
      var Paddle = root.Paddle;
      if (!Paddle || typeof Paddle.init !== 'function') {
        Paddle = await import(/* webpackIgnore: true */ LIBS.esearch);
        root.Paddle = Paddle;
      }

      say({ status: '한국어 사전 내려받는 중', progress: 0.28 });
      var dic = await (await fetch(MODELS.dic)).text();

      say({ status: '모델 내려받는 중(처음 한 번만 오래 걸립니다)', progress: 0.35 });
      await Paddle.init({
        detPath: (opts && opts.detPath) || MODELS.det,
        recPath: (opts && opts.recPath) || MODELS.rec,
        dic: dic,
        ort: root.ort,
        node: false,
        cv: root.cv
      });
      say({ status: '준비 완료', progress: 0.5 });
      return Paddle;
    })().catch(function (e) {
      _enginePromise = null;   // 실패는 캐시하지 않는다 — 다시 시도할 수 있어야 한다
      throw e;
    });
    return _enginePromise;
  }

  // ---------- 박스 좌표 정규화 ----------
  /* esearch-ocr 이 어떤 형식으로 주는지 확정하지 않는다.
     실측 없이 한 형식만 가정하면 좌표가 통째로 어긋나는데, 그 증상은
     "글자는 다 읽혔는데 표가 깨진다"라서 원인 추적이 오래 걸린다.
     그래서 그럴듯한 형식 전부를 받아 {x0,y0,x1,y1} 로 되돌린다. */
  function boxToRect(box) {
    if (!box) return null;
    var xs = [], ys = [], i;

    if (Array.isArray(box)) {
      if (box.length && Array.isArray(box[0])) {              // [[x,y] × 4]
        for (i = 0; i < box.length; i++) {
          if (box[i].length >= 2) { xs.push(+box[i][0]); ys.push(+box[i][1]); }
        }
      } else if (box.length && typeof box[0] === 'object' && box[0] !== null) {
        for (i = 0; i < box.length; i++) {                     // [{x,y} × 4]
          if (box[i].x != null) { xs.push(+box[i].x); ys.push(+box[i].y); }
        }
      } else if (box.length === 4) {                           // [x0,y0,x1,y1]
        xs = [+box[0], +box[2]]; ys = [+box[1], +box[3]];
      } else if (box.length === 8) {                           // [x0,y0,...,x3,y3]
        for (i = 0; i < 8; i += 2) { xs.push(+box[i]); ys.push(+box[i + 1]); }
      }
    } else if (typeof box === 'object') {
      if (box.x0 != null && box.x1 != null) { xs = [+box.x0, +box.x1]; ys = [+box.y0, +box.y1]; }
      else if (box.left != null && box.right != null) { xs = [+box.left, +box.right]; ys = [+box.top, +box.bottom]; }
      else if (box.x != null && box.width != null) { xs = [+box.x, +box.x + (+box.width)]; ys = [+box.y, +box.y + (+box.height)]; }
      else if (box.points) return boxToRect(box.points);
    }

    if (!xs.length || !ys.length) return null;
    for (i = 0; i < xs.length; i++) if (!isFinite(xs[i]) || !isFinite(ys[i])) return null;
    return {
      x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
      y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys)
    };
  }

  // ---------- 결과 평탄화 ----------
  /* 라이브러리 결과 구조를 가정하지 않는다(하네스에서 검증된 방식).
     최상위 text(페이지 전체 문자열)는 건너뛰고 줄 단위 노드를 모은다. */
  function collect(node, out, isRoot, seen, path) {
    if (node == null) return;
    if (typeof node === 'object') {
      if (!seen) seen = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
      if (seen) { if (seen.has(node)) return; seen.add(node); }
    }
    if (Array.isArray(node)) {
      node.forEach(function (n) { collect(n, out, false, seen, path); });
      return;
    }
    if (typeof node !== 'object') return;
    var t = null;
    if (typeof node.text === 'string') t = node.text;
    else if (typeof node.rawText === 'string') t = node.rawText;
    else if (typeof node.label === 'string') t = node.label;
    if (!isRoot && t !== null && t.trim() !== '') {
      out.push({
        text: t,
        score: (node.mean != null ? node.mean : (node.score != null ? node.score : null)),
        box: node.box || node.points || node.bbox || null,
        group: path || '(root)'
      });
      return;
    }
    Object.keys(node).forEach(function (k) {
      if (k === 'canvas' || k === 'image' || k === 'img') return;
      collect(node[k], out, false, seen, path ? path + '.' + k : k);
    });
  }

  /* 한 페이지에 대해 여러 벌의 결과가 동시에 들어온다(실측 2026.08.21):
     줄 단위로 제대로 읽은 한 벌 + 같은 내용을 다르게 묶은 판이 두 벌 더.
     전부 합치면 '고다영고다영', 주소 5회 반복이 되고, 묶음이 다르므로
     중복 제거로는 잡히지 않는다. 가장 충실한 한 벌만 남긴다. */
  function pickBestGroup(rows) {
    var g = Object.create(null);
    rows.forEach(function (r) {
      var k = r.group;
      (g[k] || (g[k] = { rows: [], chars: 0 }));
      g[k].rows.push(r); g[k].chars += r.text.length;
    });
    var keys = Object.keys(g);
    if (keys.length <= 1) return rows;
    keys.sort(function (a, b) { return g[b].chars - g[a].chars; });
    try {
      console.log('[ppocr:묶음] ' + keys.map(function (k) {
        return k + '=' + g[k].rows.length + '줄/' + g[k].chars + '자';
      }).join(' · ') + ' → ' + keys[0] + ' 채택');
    } catch (e) {}
    return g[keys[0]].rows;
  }

  /* 표 괘선이 글자로 읽히는 것은 regparse 의 stripRule 이 처리하므로 여기선 안 건드린다.
     여기서 고치는 것은 '어느 엔진이든 똑같이 틀리는' 문자뿐이다. */
  function fixChars(s) {
    return String(s == null ? '' : s)
      .replace(/[\u00A0\u2007\u202F]/g, ' ')
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[，､]/g, ',')
      .replace(/[㎡㎡]/g, 'm2')
      .trim();
  }

  // ---------- 줄 박스 → 토큰 ----------
  /* 기본은 '박스 하나 = 토큰 하나'다.
     등기부 표에서 PP-OCR 박스는 칸 경계를 대체로 지키므로 이쪽이 자연스럽고,
     splitByBands 는 토큰의 시작 x 만 보기 때문에 칸=박스면 정확히 들어맞는다.
     한 박스가 두 칸을 먹는 경우에만 splitWords 로 쪼갠다(실측 후 판단). */
  function rowsToTokens(rows, imgW, imgH, opt) {
    var k = A4_PT_WIDTH / imgW, out = [];
    var splitWords = !!(opt && opt.splitWords);

    rows.forEach(function (r) {
      var str = fixChars(r.text);
      if (!str) return;
      var rect = boxToRect(r.box);

      /* 박스가 없으면 좌표 기반 판정을 아예 할 수 없다. 위치를 지어내면
         엉뚱한 칸에 값이 들어가므로, 순서만 유지한 채 세로로 흘려 둔다. */
      if (!rect) {
        out.push({ str: str, x: 0, y: -(out.length + 1) * 12, w: str.length * 6, size: 10, conf: -1, _nobox: true });
        return;
      }

      var conf = (r.score == null) ? -1 : (r.score <= 1 ? r.score * 100 : r.score);
      var x = rect.x0 * k;
      var w = (rect.x1 - rect.x0) * k;
      var y = (imgH - rect.y1) * k;          // 아래 기준으로 뒤집는다
      var size = ((rect.y1 - rect.y0) * k) || 10;

      if (!splitWords || str.indexOf(' ') < 0) {
        out.push({ str: str, x: x, y: y, w: w, size: size, conf: conf });
        return;
      }

      /* 글자 수 비례 분할. 등기부는 거의 고정폭이라 비례 배분이 잘 든다.
         정확한 글자 폭이 아니라 '어느 밴드에 속하는가'만 맞으면 되는 용도다. */
      var parts = str.split(/\s+/), total = str.length, cur = 0;
      parts.forEach(function (p) {
        var px = x + (cur / total) * w;
        var pw = (p.length / total) * w;
        out.push({ str: p, x: px, y: y, w: pw, size: size, conf: conf });
        cur += p.length + 1;
      });
    });
    return out;
  }

  // ---------- 입력 정규화 ----------
  function toCanvas(src, maxWidth) {
    var w = src.naturalWidth || src.width || 0;
    var h = src.naturalHeight || src.height || 0;
    if (!w || !h) throw new Error('이미지 크기를 읽지 못했습니다.');

    /* 휴대폰 사진은 4000px 을 넘기도 한다. 그대로 넣으면 메모리와 시간이
       급격히 늘어난다. det 가 내부에서 어차피 줄이므로 상한만 건다.
       ※ 과거 tesseract 의 '축소가 저역통과 역할' 실측은 여기 적용하지 않는다 —
         엔진이 달라 그대로 옮기면 근거 없는 축소가 된다. */
    var cap = maxWidth || 2400;
    var scale = w > cap ? cap / w : 1;
    var cw = Math.round(w * scale), ch = Math.round(h * scale);

    if (src.tagName === 'CANVAS' && scale === 1) return src;
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    cv.getContext('2d').drawImage(src, 0, 0, cw, ch);
    return cv;
  }

  // ---------- 공개 API ----------
  /* 시그니처를 RegOCR 과 맞춘다(2번째 인자는 Tesseract 자리, 여기선 무시).
     normal_form 은 worker.terminate() 를 finally 에서 부르므로 그 표면만 있으면 된다.
     PP-OCR 은 모델이 전역에 상주하는 편이 이득이라(다음 업로드 즉시 시작)
     terminate 는 실제로 해제하지 않는다. */
  async function makeWorker(_ignored, opts) {
    opts = opts || {};
    await ensureEngine(opts);
    return {
      engine: 'ppocr',
      terminate: function () { return Promise.resolve(); }
    };
  }

  async function recognize(src, _ignored, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var Paddle = await ensureEngine(opts);

    var t0 = Date.now();
    var canvas = toCanvas(src, opts.maxWidth);
    onProgress({ phase: 'ocr', progress: 0.1 });

    var raw = await Paddle.ocr(canvas.toDataURL('image/png'));
    onProgress({ phase: 'ocr', progress: 0.9 });

    var rows = [];
    collect(raw, rows, true);
    if (!rows.length && raw && typeof raw.text === 'string') {
      raw.text.split('\n').forEach(function (t) { rows.push({ text: t, score: null, box: null }); });
    }

    /* collect() 는 결과 객체를 훑어 text 를 가진 노드를 모으므로, 라이브러리가
       같은 줄을 두 군데에 담아 두면 같은 값이 두 번 들어온다. 그대로 두면
       주소 같은 긴 값이 반복 연결되어 나온다(실측 증상).
       같은 문자열이 같은 자리에 있으면 한 번만 남긴다. */
    var before = rows.length;
    if (opts.allGroups !== true) rows = pickBestGroup(rows);

    /* 같은 벌 안에서도 완전히 같은 줄이 남을 수 있다. 글자와 상자가 모두 같을 때만 지운다. */
    var seenK = Object.create(null), dup = 0;
    rows = rows.filter(function (r) {
      var rc = boxToRect(r.box);
      var key = r.text + '@' + (rc ? [Math.round(rc.x0), Math.round(rc.y0),
                                      Math.round(rc.x1), Math.round(rc.y1)].join(',') : '-');
      if (seenK[key]) { dup++; return false; }
      seenK[key] = 1; return true;
    });
    try {
      console.log('[ppocr] ' + canvas.width + 'px · ' + (Date.now() - t0) + 'ms · 줄 ' +
                  before + ' → ' + rows.length + ' (동일줄 ' + dup + ')');
    } catch (e) {}

    var tokens = rowsToTokens(rows, canvas.width, canvas.height, opts);
    var noBox = tokens.filter(function (t) { return t._nobox; }).length;

    return {
      engine: 'ppocr',
      tokens: tokens,
      /* 라벨앵커 추출(extractByLabel)은 tesseract 전용이었다.
         교차검증 「확인 필요」 뱃지는 regparse 쪽에서 나오므로 비워도 무방하다. */
      confirmList: [],
      text: rows.map(function (r) { return r.text; }).join('\n'),
      canvas: canvas,
      warnings: noBox ? ['좌표를 못 받은 줄이 ' + noBox + '개 있습니다(표 판정 정확도가 떨어집니다).'] : [],
      _rows: rows
    };
  }

  /* 여러 장을 한 문서로 합친다. regocr.js 와 동일 규칙(PAGE_GAP 1000). */
  function combinePages(tokenArrays) {
    var out = [];
    tokenArrays.forEach(function (toks, i) {
      toks.forEach(function (t) {
        out.push({ str: t.str, x: t.x, y: t.y - i * PAGE_GAP, w: t.w, size: t.size, conf: t.conf, page: i + 1 });
      });
    });
    return out;
  }

  var RegOCRPP = {
    MODELS: MODELS,
    LIBS: LIBS,
    makeWorker: makeWorker,
    recognize: recognize,
    combinePages: combinePages,
    preload: function (opts) { return ensureEngine(opts || {}); },
    useMobileDet: function () { MODELS.det = MODELS.detMobile; _enginePromise = null; },
    useServerDet: function () { MODELS.det = MODELS.detServer; _enginePromise = null; },
    _internal: { boxToRect: boxToRect, rowsToTokens: rowsToTokens, collect: collect, pickBestGroup: pickBestGroup, fixChars: fixChars, toCanvas: toCanvas }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RegOCRPP;
  if (root) root.RegOCRPP = RegOCRPP;
})(typeof window !== 'undefined' ? window : this);
