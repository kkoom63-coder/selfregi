/* 셀프등기24 · 서류 생성 공용 모듈 (2026-10-20 분리)
 *
 * 위임장 · 소유권이전등기신청서 · 매매목록(.docx)을 만든다.
 * 쓰는 곳: normal_form(위임장), roadmap(신청서·매매목록), my.html(허브 — 셋 다).
 * 템플릿: tpl_wimi.js(WIMI_B64), tpl_apply.js(SINCHUNGSEO_B64 · GIFT_APPLY_B64), tpl_gift.js(GIFT_CONTRACT_B64 — 증여계약서). 의존: JSZip(전역).
 *
 * ⚠ 산출물이 바뀌면 안 된다. 분리 전 두 페이지의 코드를 그대로 옮겼고, 페이지 전역값(dealType·RELAY·
 *   SELFREGI_COURT_NAME)만 인자로 바꿨다. 같은 입력의 word/document.xml 해시를 분리 전후로 대조했다.
 *   fill()은 두 페이지 fillTemplate의 합집합이다 — 「동 없는 건물」 처리는 DONG 키가 있을 때만(위임장),
 *   줄바꿈 센티널은 값에 U+0001이 있을 때만(신청서) 작동해 서로의 산출물에 영향이 없다.
 */
(function (root) {
  'use strict';

  /* 한 칸에 여러 사람을 적기 위한 줄바꿈 센티널(신청서 등기의무자·등기권리자 칸). U+0001은 이용자 입력에 나올 수 없다. */
  var NL = '\u0001';
  function joinLines(arr) { return (arr || []).filter(function (v) { return String(v || '').trim(); }).join(NL); }

  function b64ToBytes(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function xe(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function fmtWon(v) {
    var n = Number(String(v || '').replace(/[^\d]/g, ''));
    return n ? n.toLocaleString('ko-KR') : '';
  }

  /* Word run-split 대응: 토큰이 여러 run으로 쪼개진 경우 하나로 병합.
     (?!<w:t) 가드로 run 경계를 딱 한 번만 넘게 제한한다 — 없으면 멀리 떨어진 중괄호끼리 오매칭된다. */
  var RUN_GAP = '(?:</w:t>(?:(?!<w:t)[\\s\\S])*?<w:t(?:\\s[^>]*)?>)?';
  var TOKEN_DEFRAG = new RegExp(
    '\\{' + RUN_GAP + '\\{([A-Z0-9_]{2,30})' + RUN_GAP + '\\}' + RUN_GAP + '\\}', 'g');
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /* base64 템플릿 + 치환 dict → Blob. beforeSave(zip)은 저장 직전 훅(이어서 하기 데이터 심기·문단 삭제). */
  async function fill(b64, replacements, beforeSave) {
    var zip = await JSZip.loadAsync(b64ToBytes(b64));
    var xml = await zip.file('word/document.xml').async('string');
    xml = xml.replace(TOKEN_DEFRAG, '{{$1}}');
    /* 동이 없는 건물(2026-10-11): 「{{DONG}}동」이 「 동」으로 남지 않게 통째로 지운다 — 없는 동이 찍히면 등기부 표시와 달라진다 */
    if ('DONG' in replacements && !String(replacements.DONG || '').trim()) xml = xml.replace(/ ?\{\{DONG\}\}동/g, '');
    for (var k in replacements) {
      xml = xml.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), xe(replacements[k]));
    }
    // 센티널 → Word 줄바꿈. 치환이 모두 끝난 뒤 한 번만 처리한다.
    xml = xml.split(NL).join('</w:t><w:br/><w:t xml:space="preserve">');
    zip.file('word/document.xml', xml);
    if (beforeSave) await beforeSave(zip);
    return await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
  }

  /* =========================================================
     위임장 인원 계획 (2026.8.16 확정 · 2026.9.18 건별)
       대리인(수임인) = 매수인 중 등기소에 가는 1인 = buyers[agentIdx]
       위임인          = 매도인 전원 + 등기소에 가지 않는 매수인
     매도인·매수인이 모두 2인이면 신청서가 2건(등기예규 제1363호)이고 위임장도 그 건수만큼 나온다.
     onlyBuyerIdx 가 주어지면 '그 매수인 명의의 신청서 1건'에 붙는 위임장을 만든다.
     d.dealType: 'sale' | 'gift' | (신탁) — 위임인 표기와 등기원인 문구를 가른다.
     ========================================================= */
  var SLOT_MAX = 3;
  function wimiPlan(d, onlyBuyerIdx) {
    var sellers = (d.sellers || []).filter(function (p) { return p && p.name; });
    var buyers = (d.buyers || []).filter(function (p) { return p && p.name; });
    var ai = Math.min(Math.max(+d.agentIdx || 0, 0), Math.max(buyers.length - 1, 0));
    var scoped = (typeof onlyBuyerIdx === 'number')
      ? buyers.filter(function (p, i) { return i === onlyBuyerIdx; })
      : buyers;
    var scopedAgentIdx = (typeof onlyBuyerIdx === 'number') ? (onlyBuyerIdx === ai ? 0 : -1) : ai;
    var _g = d.dealType === 'gift';
    var slots = sellers.map(function (p) { return { role: _g ? '증여인' : '매도인', name: p.name, addr: p.addr }; })
      .concat(scoped.filter(function (p, i) { return i !== scopedAgentIdx; })
        .map(function (p) { return { role: _g ? '수증인' : '매수인', name: p.name, addr: p.addr }; }));
    var n = slots.length;
    var tpl = (typeof WIMI_B64 !== 'undefined') ? WIMI_B64 : null;
    var overflow = slots.slice(SLOT_MAX);
    var agent = buyers[ai] || buyers[0] || {};
    var tokens = {
      CAUSE: _g ? '증여' : (d.dealType === 'sale') ? '매매' : '전유부분의 취득',   /* 신탁 케이스 등기원인 문구 [미확인] */
      TRANSFER_SHARE: d.transferShare || '',
      AGENT_NAME: agent.name || '',
      AGENT_ADDR: agent.addr || ''
    };
    for (var i = 0; i < SLOT_MAX; i++) {
      var p = slots[i] || {};
      tokens['P' + (i + 1) + '_ROLE'] = p.role || '';
      tokens['P' + (i + 1) + '_NAME'] = p.name || '';
      tokens['P' + (i + 1) + '_ADDR'] = p.addr || '';
    }
    return { tpl: tpl, count: n, tokens: tokens, overflow: overflow };
  }

  /* 위임장 공통 치환값(부동산 표시·등기원인일·작성 연월). 빈 날짜는 손으로 적을 자리만큼 공백. */
  function wimiReps(d) {
    var t = function (v) { return String(v == null ? '' : v).trim(); };
    return {
      PROPERTY_UID: d.propertyUid,
      JIBUN_ADDR: d.jibun,
      APT_NAME: d.aptName,
      DONG: d.dong,
      ROAD_ADDR: d.propRoadAddr,
      FLOOR: d.floor,
      HO: d.ho,
      STRUCT: d.propStruct,
      AREA: d.propArea,
      TOTAL: d.total,
      UNIT: d.unit,
      YEAR: t(d.yr) ? d.yr : '    ',
      MONTH: t(d.mo) ? d.mo : '  ',
      DAY: t(d.dy) ? d.dy : '  ',
      TRANSFER_SHARE: d.transferShare,
      SETTLE_YEAR: t(d.settleYear) ? d.settleYear : '    ',
      SETTLE_MONTH: t(d.settleMonth) ? d.settleMonth : '  '
    };
  }

  /* 위임장 파일을 만든다(저장하지 않음). beforeSave(zip)로 이어서 하기 데이터를 심는다.
     반환: { files:[{blob,name}], filings, jointBoth, overflow:[이름…] } */
  async function wimiFiles(d, beforeSave) {
    var _sN = (d.sellers || []).filter(function (p) { return p && p.name; }).length;
    var _bN = (d.buyers || []).filter(function (p) { return p && p.name; }).length;
    var jointBoth = (_sN > 1 && _bN > 1);
    var filings = jointBoth ? _bN : 1;
    var files = [], overflow = [];
    var dh = (d.dong ? d.dong + '동' : '') + d.ho + '호';
    for (var k = 0; k < filings; k++) {
      var _wimi = wimiPlan(d, jointBoth ? k : undefined);
      if (!_wimi.tpl || _wimi.tpl === 'PLACEHOLDER') throw new Error('위임장 템플릿이 아직 등록되지 않았습니다');
      _wimi.overflow.forEach(function (p) { if (overflow.indexOf(p.name) < 0) overflow.push(p.name); });
      var blob = await fill(_wimi.tpl, Object.assign(wimiReps(d), _wimi.tokens), beforeSave || null);
      var name;
      if (jointBoth) {
        var bn = (d.buyers[k] && d.buyers[k].name) || ('매수인' + (k + 1));
        name = '위임장_' + (k + 1) + 'of' + filings + '_' + bn + '_' + dh + '.docx';
      } else {
        name = '위임장_' + d.ownerName + '_' + dh + '.docx';
      }
      files.push({ blob: blob, name: name });
    }
    return { files: files, filings: filings, jointBoth: jointBoth, overflow: overflow };
  }

  /* selfregi_form_v1(relayForm 스키마 v3) → 위임장 생성용 값(서류 작성 화면 getData()와 같은 모양). 허브가 쓴다. */
  function formData(f) {
    f = f || {};
    var s = function (v) { return v == null ? '' : String(v); };
    var buyers = (f.buyerJoint && Array.isArray(f.buyers) && f.buyers.length > 1) ? f.buyers
      : [{ name: s(f.buyerName), addr: s(f.buyerAddr), rrn: s(f.buyerRrn) }];
    var sellers = (f.sellerJoint && Array.isArray(f.sellers) && f.sellers.length > 1) ? f.sellers
      : [{ name: s(f.sellerName), addr: s(f.sellerAddr), rrn: '' }];
    return {
      ownerName: s(f.buyerName), ownerAddr: s(f.buyerAddr), ownerRrn: s(f.buyerRrn),
      jibun: s(f.jibun), dong: s(f.dong), ho: s(f.ho),
      yr: s(f.causeYr), mo: s(f.causeMo), dy: s(f.causeDy),
      total: s(f.total), unit: s(f.unit), aptName: s(f.aptName), propKind: s(f.propKind),
      propStruct: s(f.propStruct), propArea: s(f.propArea), floor: s(f.floor), propRoadAddr: s(f.propRoadAddr),
      propertyUid: s(f.propertyUid), dealReportNo: s(f.dealReportNo), dealPrice: s(f.dealPrice),
      transferShare: s(f.transferShare) || '전부', transferMode: f.transferMode === 'part' ? 'part' : 'all',
      settleYear: s(f.settleYear), settleMonth: s(f.settleMonth),
      dealType: f.dealType === 'gift' ? 'gift' : 'sale',
      buyerJoint: buyers.length > 1, sellerJoint: sellers.length > 1,
      buyers: buyers, sellers: sellers, agentIdx: +f.agentIdx || 0
    };
  }

  /* 신청서 당사자 — 매도인·매수인이 모두 2인일 때만 2건(등기예규 제1363호). 1:2도 2:1도 1건. */
  function partiesOf(f) {
    var buyerArr = (f.buyerJoint && Array.isArray(f.buyers) && f.buyers.length > 1)
      ? f.buyers.slice(0, 2)
      : [{ name: f.buyerName || '', addr: f.buyerAddr || '', rrn: f.buyerRrn || '' }];
    var sellerArr = (f.sellerJoint && Array.isArray(f.sellers) && f.sellers.length > 1)
      ? f.sellers.slice(0, 2)
      : [{ name: f.sellerName || '', addr: f.sellerAddr || '', rrn: '' }];
    return { buyerArr: buyerArr, sellerArr: sellerArr, jointBoth: sellerArr.length > 1 && buyerArr.length > 1 };
  }

  /* =========================================================
     소유권이전등기신청서 — f = selfregi_form_v1, relay = 번호 보관함
       relay: { siga:[], bondamt:[], bond:[], fee:[], tax, edu, rural } (로드맵 RELAY와 같은 모양)
       opt:   { gift: 증여 신청서 템플릿, court: 관할 등기소 이름 }
     반환: { files:[{blob,name}], jointBoth, purposeGap }
     ========================================================= */
  async function applyFiles(f, relay, opt) {
    opt = opt || {};
    var RELAY = relay || {};
    var _arr = function (k) { return Array.isArray(RELAY[k]) ? RELAY[k] : [RELAY[k] || '']; };
    var relayNum = function (v) { return Number(String(v == null ? '' : v).replace(/[^\d]/g, '')) || 0; };
    var relaySum = function (key) {
      var a = RELAY[key];
      return Array.isArray(a) ? a.reduce(function (s, v) { return s + relayNum(v); }, 0) : relayNum(a);
    };
    var n = function (v) { return Number(String(v || '0').replace(/[^\d]/g, '')) || 0; };
    var total = n(RELAY.tax) + n(RELAY.edu) + n(RELAY.rural);
    var sigaArr = _arr('siga'), bondAmtArr = _arr('bondamt'), bondNoArr = _arr('bond');

    // ── 부동산의 표시(집합건물) 조립 — 등기부 표제부 구조에 맞춰 한 줄씩 완성 ──
    var _jibun = f.jibun || '', _apt = f.aptName || '', _dong = f.dong || '', _ho = f.ho || '';
    var _floor = f.floor || '', _struct = f.propStruct || '', _area = f.propArea || '';
    var _total = f.total || '', _unit = f.unit || '', _road = f.propRoadAddr || '', _kind = f.propKind || '';
    var bldgTitle = _jibun;
    if (_apt) bldgTitle += ' ' + _apt;
    if (_dong) bldgTitle += ' 제' + _dong + '동';
    var exclNo = '';
    if (_floor) exclNo += '제' + _floor + '층 ';
    if (_ho) exclNo += '제' + _ho + '호';
    var landDesc = _jibun;
    if (_total) landDesc += ' 대 ' + _total + '㎡';
    var landRatio = (_total && _unit) ? (_total + '분의 ' + _unit) : '';

    // ── 공동명의 당사자 조립 (selfregi_form_v1 v3 스키마) ──
    var _shareOf = function (p) { return (p && p.shareDenom && p.shareNum) ? (p.shareDenom + '분의 ' + p.shareNum) : ''; };
    var pt = partiesOf(f), buyerArr = pt.buyerArr, sellerArr = pt.sellerArr;

    /* 1:1, 1:2 → 1건 · '소유권이전' / 2:1 → 1건 · '공유자전원지분전부이전' / 2:2 → 2건 · 예규 제1363호 문구(매수인별 분해) */
    var jointBoth = pt.jointBoth;
    var filings = jointBoth ? 2 : 1;

    // 지분 분수 유틸 — '이전할 지분 = 매도인 지분 × 매수인 지분'을 기약분수로 만든다.
    var _gcd = function (a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a || 1; };
    var _frac = function (p) {
      var d = Number(String((p && p.shareDenom) || '').replace(/[^\d]/g, ''));
      var nn = Number(String((p && p.shareNum) || '').replace(/[^\d]/g, ''));
      return (d > 0 && nn > 0) ? { n: nn, d: d } : null;
    };
    var _mulFrac = function (a, b) { var nn = a.n * b.n, d = a.d * b.d, g = _gcd(nn, d); return { n: nn / g, d: d / g }; };
    var _fracTxt = function (fr) { return fr.d + '분의 ' + fr.n; };

    /* 2:2 등기권리자별 신청서 1건의 등기의 목적. 지분이 하나라도 비어 있으면 빈 문자열 — 추정해서 찍으면 안 되는 칸이다. */
    function purposeForBuyer(bi) {
      var fb = _frac(buyerArr[bi]);
      if (!fb) return '';
      var parts = [];
      for (var i = 0; i < sellerArr.length; i++) {
        var fs = _frac(sellerArr[i]);
        if (!fs) return '';
        var nm = sellerArr[i].name || '';
        parts.push(nm + ' 지분 ' + _fracTxt(fs) + ' 중 일부(' + _fracTxt(_mulFrac(fs, fb)) + ')');
      }
      return parts.join(' 및 ') + ' 이전';
    }
    var purposeGap = false;
    function regPurposeFor(bi) {
      if (!jointBoth) return (sellerArr.length > 1) ? '공유자전원지분전부이전' : '소유권이전';
      var s = purposeForBuyer(bi);
      if (!s) purposeGap = true;
      return s;
    }

    // 국민주택채권 발행번호: 종이 신청서의 단일 칸 구조상 병합 표기
    var bondNoAll = bondNoArr.filter(Boolean).join(' / ');
    var feeArr = _arr('fee');

    /* 신청서 건수와 무관하게 동일한 값 (부동산·계약·매도인·취득세) */
    var common = {
      DEAL_REPORT_NO: f.dealReportNo || '',
      DEAL_PRICE: fmtWon(f.dealPrice),
      CAUSE_Y: f.causeYr || '', CAUSE_M: f.causeMo || '', CAUSE_D: f.causeDy || '',
      CAUSE_DATE: '', // 등기소 접수(신청)일자 — 방문 당일 확정되므로 의도적으로 공란
      SELLER_NAME: joinLines(sellerArr.map(function (p) { return p.name; })),
      SELLER_ADDR: joinLines(sellerArr.map(function (p) { return p.addr; })),
      APPL_SELLER: sellerArr.map(function (p) { return p.name; }).filter(Boolean).join(', '),
      SELLER_SHARE: joinLines(sellerArr.map(function (p) { return _shareOf(p); })),
      /* 취득세는 공동명의라도 신고 1건·고지서 1장이므로 양쪽 신청서에 같은 금액을 적는다. */
      TAX: fmtWon(RELAY.tax), EDU_TAX: fmtWon(RELAY.edu), RURAL_TAX: fmtWon(RELAY.rural), TAX_TOTAL: fmtWon(total),
      FEE_AMT: '18,000',
      PROPERTY_UID: f.propertyUid || '',
      COURT_NAME: opt.court || '',
      PROP_BLDG_TITLE: bldgTitle,
      PROP_ROAD_ADDR: _road,
      PROP_EXCL_NO: exclNo,
      PROP_STRUCT: _struct,
      PROP_AREA: _area,
      PROP_LAND_DESC: landDesc,
      LAND_RATIO: landRatio,
      PROP_KIND: _kind
    };

    var suffix = (f.dong ? f.dong + '동' : '') + (f.ho || '') + '호';
    var files = [];
    for (var k = 0; k < filings; k++) {
      var perFiling = jointBoth ? {
        // 2:2 — 이 신청서의 등기권리자는 1명뿐이다.
        BUYER_NAME: buyerArr[k].name || '', BUYER_RRN: buyerArr[k].rrn || '',
        BUYER_ADDR: buyerArr[k].addr || '', BUYER_SHARE: _shareOf(buyerArr[k]),
        REG_PURPOSE: regPurposeFor(k),
        TRANSFER_SHARE: _shareOf(buyerArr[k]),
        SIGA: fmtWon(sigaArr[k]), BOND_AMT: fmtWon(bondAmtArr[k]),
        BOND_TOTAL: fmtWon(bondAmtArr[k]), BOND_NO: bondNoArr[k] || '',
        FEE_NO: feeArr[k] || ''   // 수수료도 신청서 단위(등기예규 제1861호 2.나)
      } : {
        // 1건짜리(1:1 / 1:2 / 2:1) — 매수인 전원이 한 신청서에 들어간다.
        BUYER_NAME: joinLines(buyerArr.map(function (p) { return p.name; })),
        BUYER_RRN: joinLines(buyerArr.map(function (p) { return p.rrn; })),
        BUYER_ADDR: joinLines(buyerArr.map(function (p) { return p.addr; })),
        BUYER_SHARE: joinLines(buyerArr.map(function (p) { return _shareOf(p); })),
        REG_PURPOSE: regPurposeFor(0),
        TRANSFER_SHARE: '전 부',
        /* 신청서가 1건이면 이 부동산 전체가 대상 — 지분별로 나눠 적은 시가표준액·채권은 합계가 된다. */
        SIGA: fmtWon(relaySum('siga')), BOND_AMT: fmtWon(relaySum('bondamt')),
        BOND_TOTAL: fmtWon(relaySum('bondamt')),
        BOND_NO: bondNoAll,
        FEE_NO: feeArr[0] || ''
      };
      var blob = await fill(opt.gift ? GIFT_APPLY_B64 : SINCHUNGSEO_B64, Object.assign({}, common, perFiling));
      var nm = jointBoth ? (buyerArr[k].name || ('매수인' + (k + 1))) : (f.buyerName || '');
      var seq = jointBoth ? '_' + (k + 1) + 'of2' : '';
      files.push({ blob: blob, name: '소유권이전등기신청서' + (opt.gift ? '(증여)' : '') + seq + '_' + nm + '_' + suffix + '.docx' });
    }
    return { files: files, jointBoth: jointBoth, purposeGap: purposeGap };
  }

  /* =========================================================
     매매목록 — 템플릿 없이 JSZip으로 최소 docx를 조립한다.
     근거: 등기예규 제1804호 2.나. (1)② 수인과 수인 사이의 매매 / (2) 매수인별로 신청하면 같은 부동산 표시를 매수인 수만큼 순번 반복.
     ========================================================= */
  function mmPara(text, opts) {
    var o = opts || {};
    var jc = o.align ? '<w:jc w:val="' + o.align + '"/>' : '';
    var sz = o.size ? '<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>' : '';
    var b = o.bold ? '<w:b/>' : '';
    var sp = '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after || 60) + '"/>';
    return '<w:p><w:pPr>' + sp + jc + '<w:rPr>' + b + sz + '</w:rPr></w:pPr>'
      + '<w:r><w:rPr>' + b + sz + '</w:rPr><w:t xml:space="preserve">' + xe(text) + '</w:t></w:r></w:p>';
  }
  function mmCell(text, widthDxa, opts) {
    var o = opts || {};
    return '<w:tc><w:tcPr><w:tcW w:w="' + widthDxa + '" w:type="dxa"/>'
      + '<w:vAlign w:val="center"/></w:tcPr>'
      + mmPara(text, Object.assign({ after: 0, size: 20 }, o))
      + '</w:tc>';
  }
  function mmRow(cells) { return '<w:tr>' + cells + '</w:tr>'; }

  /* items = [{ no: 1, desc: '부동산의 표시 여러 줄' }, ...] */
  async function buildMaemaeMokrok(dealPrice, items) {
    var W1 = 1100, W2 = 7900;
    var header = mmRow(mmCell('일련번호', W1, { align: 'center', bold: true }) + mmCell('부동산의 표시', W2, { bold: true }));
    var body = items.map(function (it) {
      var lines = String(it.desc || '').split('\n').filter(function (s) { return s.trim(); });
      var cellXml = '<w:tc><w:tcPr><w:tcW w:w="' + W2 + '" w:type="dxa"/></w:tcPr>'
        + (lines.length ? lines.map(function (l) { return mmPara(l, { after: 0, size: 20 }); }).join('') : mmPara('', { after: 0, size: 20 }))
        + '</w:tc>';
      return mmRow(mmCell(String(it.no), W1, { align: 'center' }) + cellXml);
    }).join('');
    var tbl = '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>'
      + '<w:jc w:val="center"/>'
      + '<w:tblBorders>'
      + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map(function (s) { return '<w:' + s + ' w:val="single" w:sz="6" w:space="0" w:color="000000"/>'; }).join('')
      + '</w:tblBorders></w:tblPr>'
      + '<w:tblGrid><w:gridCol w:w="' + W1 + '"/><w:gridCol w:w="' + W2 + '"/></w:tblGrid>'
      + header + body + '</w:tbl>';
    var bodyXml =
      mmPara('매 매 목 록', { align: 'center', bold: true, size: 32, after: 240 })
      + mmPara('거래가액   ' + (dealPrice ? dealPrice + '원' : ''), { after: 160 })
      + tbl
      + mmPara('', { before: 200 });
    var documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body>' + bodyXml
      + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
      + '<w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1134" w:header="851" w:footer="992" w:gutter="0"/>'
      + '</w:sectPr></w:body></w:document>';
    var zip = new JSZip();
    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>');
    zip.folder('_rels').file('.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>');
    zip.folder('word').file('document.xml', documentXml);
    /* 일부 Word 버전이 이 파트의 부재를 문제 삼아 빈 Relationships 를 넣는다. */
    zip.folder('word').folder('_rels').file('document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    return await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
  }

  /* 매매목록이 필요한가 — 매도인·매수인이 모두 2인 이상일 때만. 반환: 반복할 매수인 수(불요면 0) */
  function mokrokNeeded(f) {
    var sellersN = (f.sellerJoint && Array.isArray(f.sellers)) ? f.sellers.filter(function (s) { return s && s.name; }).length : 1;
    var buyersN = (f.buyerJoint && Array.isArray(f.buyers)) ? f.buyers.filter(function (b) { return b && b.name; }).length : 1;
    return (sellersN > 1 && buyersN > 1) ? buyersN : 0;
  }
  /* 매매목록 파일. 필요 없는 구성이면 null */
  async function mokrokFile(f) {
    var buyersN = mokrokNeeded(f);
    if (!buyersN) return null;
    // 부동산의 표시 — 신청서와 같은 조립 규칙(등기부 표제부 순서)
    var lines = [];
    var t1 = f.jibun || '';
    if (f.aptName) t1 += ' ' + f.aptName;
    if (f.dong) t1 += ' 제' + f.dong + '동';
    if (t1.trim()) lines.push('1동의 건물의 표시: ' + t1.trim());
    var t2 = '';
    if (f.floor) t2 += '제' + f.floor + '층 ';
    if (f.ho) t2 += '제' + f.ho + '호';
    if (t2.trim()) lines.push('전유부분의 건물의 표시: ' + t2.trim()
      + (f.propStruct ? ' / ' + f.propStruct : '') + (f.propArea ? ' / ' + f.propArea + '㎡' : ''));
    if (f.jibun) lines.push('토지의 표시: ' + f.jibun + (f.total ? ' 대 ' + f.total + '㎡' : ''));
    if (f.total && f.unit) lines.push('대지권의 비율: ' + f.total + '분의 ' + f.unit);
    var desc = lines.join('\n');
    var items = [];
    for (var i = 0; i < buyersN; i++) items.push({ no: i + 1, desc: desc });
    var blob = await buildMaemaeMokrok(fmtWon(f.dealPrice), items);
    return { blob: blob, name: '매매목록_' + (f.dong ? f.dong + '동' : '') + (f.ho || '') + '호.docx' };
  }

  /* 증여계약서(2026-10-22, form_classic buildGiftContract 이식) — selfregi_form_v1(v3) 값으로 채운다.
     증여인 1명 · 수증인 최대 2명(단순 증여만). 금액·주민번호(증여인)·연락처는 비워 둔다. 템플릿: tpl_gift.js */
  function _m2(v) { v = String(v || '').trim(); return v && /^[\d.,]+$/.test(v) ? v + '㎡' : v; }
  async function dropSecondDonee(zip) {
    var xml = await zip.file('word/document.xml').async('string');
    var re = /<w:p[ >][\s\S]*?<\/w:p>/g, paras = [], m;
    while ((m = re.exec(xml))) paras.push({ s: m.index, e: m.index + m[0].length, x: m[0] });
    function txt(p) { return (p.x.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join(''); }
    var idx = paras.map(function (p, i) { return txt(p).indexOf('■ 수증인') === 0 ? i : -1; }).filter(function (i) { return i >= 0; });
    if (idx.length < 2) return;
    var cut = paras.slice(idx[1], idx[1] + 6);   // 같은 내용의 문단이 앞에도 있으므로 위치로 잘라 낸다
    zip.file('word/document.xml', xml.slice(0, cut[0].s) + xml.slice(cut[cut.length - 1].e));
  }
  async function giftContract(f) {
    var donor = (f.sellers || [])[0] || {};
    var donees = (f.buyers || []).filter(function (p) { return p && p.name; });
    var b1 = donees[0] || {}, b2 = donees[1] || {};
    var reps = {
      PROP_BLDG_TITLE: [f.jibun, f.aptName, f.dong ? '제' + f.dong + '동' : ''].filter(Boolean).join(' '),
      PROP_EXCL_NO: [f.floor ? '제' + String(f.floor).replace(/층$/, '') + '층' : '', f.ho ? '제' + f.ho + '호' : ''].filter(Boolean).join(' '),
      PROP_STRUCT: f.propStruct || '', PROP_AREA: _m2(f.propArea),
      PROP_LAND_DESC: f.jibun ? '1. ' + f.jibun + (f.total ? '  ' + _m2(f.total) : '') : '',
      LAND_RATIO: (f.total && f.unit) ? f.total + '분의 ' + f.unit : '',
      GIFT_SHARE: f.transferMode === 'part' ? (f.transferShare || '') : '전부',
      DONOR_NAME: donor.name || '', DONOR_RRN: '', DONOR_ADDR: donor.addr || '', DONOR_TEL: '',
      DONEE_NAMES: donees.map(function (p) { return p.name; }).join(', '),
      DONEE_NAME: b1.name || '', DONEE_RRN: b1.rrn || '', DONEE_ADDR: b1.addr || '', DONEE_TEL: '',
      DONEE2_NAME: b2.name || '', DONEE2_RRN: b2.rrn || '', DONEE2_ADDR: b2.addr || '', DONEE2_TEL: '',
      CONTRACT_Y: String(f.causeYr || '').trim() || '    ', CONTRACT_M: String(f.causeMo || '').trim() || '  ', CONTRACT_D: String(f.causeDy || '').trim() || '  '
    };
    var blob = await fill(GIFT_CONTRACT_B64, reps, donees.length < 2 ? dropSecondDonee : null);
    return { blob: blob, name: '증여계약서_' + (donor.name || '') + '_' + (f.dong ? f.dong + '동' : '') + (f.ho || '') + '호.docx' };
  }

  root.SRDoc = {
    NL: NL, joinLines: joinLines, xe: xe, fmtWon: fmtWon, b64ToBytes: b64ToBytes,
    fill: fill, wimiPlan: wimiPlan, wimiReps: wimiReps, wimiFiles: wimiFiles, formData: formData,
    partiesOf: partiesOf, applyFiles: applyFiles, buildMaemaeMokrok: buildMaemaeMokrok,
    mokrokNeeded: mokrokNeeded, mokrokFile: mokrokFile, giftContract: giftContract, SLOT_MAX: SLOT_MAX
  };
})(window);
