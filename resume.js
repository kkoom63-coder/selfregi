/* 셀프등기24 · 위임장 파일로 이어서 하기
 *
 * 왜: 입력값은 기기(브라우저)에만 저장되고 서버에는 저장하지 않는다.
 *     그래서 휴대폰에서 결제하고 PC에서 인쇄하려면 처음부터 다시 입력해야 했다.
 *     이용자는 이미 위임장 파일을 받아 두었다. 그 파일을 진행 파일로 쓴다.
 *
 * 어떻게: 위임장 .docx 의 「사용자 지정 문서 속성」(docProps/custom.xml)에
 *     입력값을 base64 조각(SR_1, SR_2 …)으로 나눠 담는다.
 *     - 이 영역은 Word 로 열어 저장해도 유지된다(본문을 고쳐도 사라지지 않는다).
 *     - 값 하나는 240자 이하로 자른다. Word 가 긴 속성값을 255자에서 자르기 때문이다.
 *     - 주민등록번호·이메일은 담지 않는다. 파일이 메신저·메일로 오가기 때문이다.
 *     - 결제 이용권(k)도 함께 담는다(2026-10-10). 다른 기기에서 이 파일만 올리면 결제까지 이어진다.
 *       이용권은 서버가 서명·만료·취소·부동산(bind)을 확인하므로 파일만으로 다른 집 서류를 계속 받을 수는 없다.
 *
 * 쓰는 곳: normal_form(위임장 생성·복원), roadmap(신청서 화면 복원).
 * 의존: JSZip(전역).
 */
(function (root) {
  'use strict';

  var VERSION = 1;
  var CHUNK = 240;
  var FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}';
  var CT_CUSTOM = 'application/vnd.openxmlformats-officedocument.custom-properties+xml';
  var REL_CUSTOM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties';

  /* 주민등록번호가 들어갈 수 있는 키는 이름으로 걸러낸다(rrn). 값 모양으로도 한 번 더 막는다. */
  var RRN_KEY = /rrn/i;
  var RRN_VAL = /\d{6}\s*-?\s*[1-8]\d{6}/;

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function xe(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 객체 안의 주민등록번호를 지운다(깊이 우선). 원본은 건드리지 않는다. */
  function scrub(v, key) {
    if (key && RRN_KEY.test(key)) return undefined;
    if (Array.isArray(v)) return v.map(function (x) { return scrub(x); });
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) {
        var x = scrub(v[k], k);
        if (x !== undefined && x !== '') o[k] = x;
      });
      return o;
    }
    if (typeof v === 'string' && RRN_VAL.test(v)) return '';
    return v;
  }

  /* zip(JSZip 인스턴스)에 입력값을 심는다. payload 는 { f: 폼값, r: 신청서 릴레이값 } */
  async function embed(zip, payload, passToken) {
    var o = { v: VERSION, ts: Date.now(), d: scrub(payload) };
    if (passToken && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(passToken)) o.k = passToken;
    var json = JSON.stringify(o);
    var b64 = b64encode(json), parts = [];
    for (var i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));

    var props = '<property fmtid="' + FMTID + '" pid="2" name="SR_N"><vt:lpwstr>' + parts.length + '</vt:lpwstr></property>';
    parts.forEach(function (p, k) {
      props += '<property fmtid="' + FMTID + '" pid="' + (k + 3) + '" name="SR_' + (k + 1) + '"><vt:lpwstr>' + xe(p) + '</vt:lpwstr></property>';
    });
    zip.file('docProps/custom.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' + props + '</Properties>');

    var ct = await zip.file('[Content_Types].xml').async('string');
    if (ct.indexOf('/docProps/custom.xml') < 0) {
      ct = ct.replace('</Types>', '<Override PartName="/docProps/custom.xml" ContentType="' + CT_CUSTOM + '"/></Types>');
      zip.file('[Content_Types].xml', ct);
    }
    var rels = await zip.file('_rels/.rels').async('string');
    if (rels.indexOf('docProps/custom.xml') < 0) {
      rels = rels.replace('</Relationships>', '<Relationship Id="rIdSelfregi1" Type="' + REL_CUSTOM + '" Target="docProps/custom.xml"/></Relationships>');
      zip.file('_rels/.rels', rels);
    }
  }

  /* File/Blob → { d, ts } 또는 오류 코드 문자열 */
  async function read(file) {
    if (typeof JSZip === 'undefined') return 'NOLIB';
    var zip;
    try { zip = await JSZip.loadAsync(file); } catch (e) { return 'NOTDOCX'; }
    var cx = zip.file('docProps/custom.xml');
    if (!cx) return 'NODATA';
    var xml = await cx.async('string');
    var map = {}, re = /<property\b[^>]*\bname="(SR_[0-9N]+)"[^>]*>\s*<vt:lpwstr>([^<]*)<\/vt:lpwstr>/g, m;
    while ((m = re.exec(xml))) map[m[1]] = m[2];
    var n = +map.SR_N;
    if (!n) return 'NODATA';
    var b64 = '';
    for (var i = 1; i <= n; i++) {
      if (map['SR_' + i] == null) return 'BROKEN';
      b64 += map['SR_' + i];
    }
    try {
      var o = JSON.parse(b64decode(b64));
      if (!o || !o.d) return 'BROKEN';
      return { d: o.d, ts: o.ts || 0, v: o.v || 0, k: typeof o.k === 'string' ? o.k : '' };
    } catch (e) { return 'BROKEN'; }
  }

  var MSG = {
    NOLIB: '파일을 읽을 준비가 아직 되지 않았습니다. 잠시 후 다시 시도해 주세요.',
    NOTDOCX: 'Word(.docx) 파일이 아닙니다. 셀프등기24에서 받은 위임장 파일을 올려 주세요.',
    NODATA: '이 파일에는 이어서 하기 정보가 없습니다. 셀프등기24에서 받은 위임장 원본 파일(.docx)인지 확인해 주세요. 한글(HWP) 등 다른 형식으로 저장한 파일은 읽을 수 없습니다.',
    BROKEN: '파일의 이어서 하기 정보가 손상되어 읽지 못했습니다. 입력칸에 직접 입력해 주세요.'
  };

  root.SRResume = { embed: embed, read: read, scrub: scrub, MSG: MSG, VERSION: VERSION };
})(typeof self !== 'undefined' ? self : this);
