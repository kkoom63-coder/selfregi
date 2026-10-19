/* 취득세 납부확인서 PDF 판독(2026-10-19) — 이용자 브라우저 안에서만 읽는다(서버 전송 없음).
   위택스·서울 ETAX에서 받은 PDF는 글자가 들어 있어 사진 판독보다 정확하다.
   규칙은 docs/ops/research/ocr_samples_2026-10-19 시험(가짜 샘플 + 실제 서류 값 비출력 대조)과 같다:
   - 라벨과 같은 높이(±6pt)에서 오른쪽으로 가장 가까운 숫자 = 값(PDF 안 글자 순서에 기대지 않는다)
   - 납부서(영수증)는 「등기ㆍ등록 … 용도로 사용하실 수 없습니다」 문구로 걸러 낸다 → 등기에는 납부확인서만 쓴다
   사용: SRReceipt.parse(file).then(r => r.kind === 'receipt' ? r.tax … : r.msg) */
(function(){
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var NOT_FOR_REGISTRY = /등기\s*[ㆍ·.]?\s*등록\s*또는\s*면허발급\s*용도로\s*사용하실\s*수\s*없습니다/;

  function loadPdfjs(){
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function(ok, fail){
      var s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = function(){
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; } catch(e) {}
        ok(window.pdfjsLib);
      };
      s.onerror = function(){ fail(new Error('PDF 판독 모듈을 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    });
  }

  /* 첫 쪽 글자 조각을 (x, 위쪽 기준 y, 글자)로. pdf.js의 y는 아래에서 위로 재므로 뒤집는다. */
  function itemsOf(lib, buf){
    return lib.getDocument({ data: buf }).promise.then(function(doc){
      return doc.getPage(1);
    }).then(function(page){
      var h = page.getViewport({ scale: 1 }).height;
      return page.getTextContent().then(function(tc){
        return tc.items.filter(function(it){ return it.str && it.str.trim(); })
          .map(function(it){ return { x: it.transform[4], y: h - it.transform[5], t: it.str.trim() }; });
      });
    });
  }

  function norm(s){ return String(s).replace(/[\s:：]/g, ''); }
  function digits(s){ return String(s || '').replace(/[^\d]/g, ''); }

  function rightOf(items, label, numeric){
    var L = norm(label);
    var labs = items.filter(function(i){ return norm(i.t) === L; });
    for (var k = 0; k < labs.length; k++){
      var lab = labs[k];
      var c = items.filter(function(i){
        return Math.abs(i.y - lab.y) <= 6 && i.x > lab.x && norm(i.t) !== L && (!numeric || /\d/.test(i.t));
      }).sort(function(a, b){ return a.x - b.x; });
      if (c.length) return c[0].t;
    }
    return '';
  }
  function first(items, labels, numeric){
    for (var i = 0; i < labels.length; i++){ var v = rightOf(items, labels[i], numeric); if (v) return v; }
    return '';
  }

  function parseItems(items){
    var text = items.map(function(i){ return i.t; }).join(' ');
    if (NOT_FOR_REGISTRY.test(text)) {
      return { kind: 'not_receipt', msg: '올리신 파일은 납부서(영수증)입니다. 등기에는 「납부확인서」가 필요합니다. 위택스·이택스 납부내역에서 납부확인서를 출력해 올려 주세요.' };
    }
    if (!/납부확인서/.test(text.replace(/\s/g, ''))) {
      return { kind: 'unknown', msg: '취득세 납부확인서가 아닌 것 같습니다. 위택스·이택스에서 받은 납부확인서 PDF를 올려 주세요.' };
    }
    var r = {
      kind: 'receipt',
      tax:   digits(first(items, ['취득세'], true)),
      edu:   digits(first(items, ['지방교육세'], true)),
      rural: digits(first(items, ['농특세', '농어촌특별세'], true)),
      total: digits(first(items, ['계', '합계'], true)),
      siga:  digits(first(items, ['시가표준액합계', '시가표준액'], true)),
      epay:  first(items, ['전자납부번호'], true)
    };
    var m = text.match(/\d{4}\.\d{2}\.\d{2}/);
    r.paid = m ? m[0] : '';
    var sum = (+r.tax || 0) + (+r.edu || 0) + (+r.rural || 0);
    r.sumOk = !!(r.tax && r.total && sum === +r.total);
    if (!r.tax) { r.kind = 'partial'; r.msg = '납부확인서의 세액을 읽지 못했습니다. 아래 칸에 직접 넣어 주세요.'; }
    return r;
  }

  function parse(file){
    if (!file || !/pdf$/i.test(file.type || file.name || '')) {
      return Promise.resolve({ kind: 'unknown', msg: 'PDF 파일을 올려 주세요. 사진은 아래 칸에 직접 넣어 주세요.' });
    }
    return Promise.all([loadPdfjs(), file.arrayBuffer()]).then(function(a){
      return itemsOf(a[0], a[1]);
    }).then(parseItems).catch(function(){
      return { kind: 'fail', msg: 'PDF를 읽지 못했습니다. 아래 칸에 직접 넣어 주세요.' };
    });
  }

  window.SRReceipt = { parse: parse, parseItems: parseItems };
})();
