/* 셀프등기24 · 서류 작성 화면(normal_form) — 위임장 파일로 이어서 하기
 *
 *   받아 둔 위임장(.docx)을 올리면 문서 속성에 담긴 입력값을 복원한다(resume.js).
 *   재발급 링크(?pass=)로 들어왔는데 이 기기에 입력값이 없으면 이 기능을 안내한다(pay.js → SRRedeemMsg).
 *
 * 의존(전역): applyResume, hasFormInput, SRResume, SR(선택)
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function trk(n, d) { try { window.SR && SR.track(n, d || {}); } catch (e) {} }

  function say(t, kind) { var e = $('lg-resume'); if (!e) return; e.innerHTML = t || ''; e.className = 'plg rs-msg ' + (kind || ''); }
  async function onResumeFile(file) {
    if (!file) return;
    if (!window.SRResume) { say('파일을 읽을 준비가 되지 않았습니다. 새로고침 후 다시 시도해 주세요.', 'err'); return; }
    say('위임장 파일을 읽는 중입니다…');
    var got = await SRResume.read(file);
    if (typeof got === 'string') { say(esc(SRResume.MSG[got] || '파일을 읽지 못했습니다.'), 'err'); trk('resume_docx', { mode: got.toLowerCase() }); return; }
    var n = applyResume(got.d);
    var paid = '';
    if (got.k && window.SRPay && SRPay.redeemToken && !SRPay.has()) {
      paid = (await SRPay.redeemToken(got.k)) ? ' <b>결제도 확인되어 바로 내려받을 수 있습니다.</b>' : ' 이 파일의 결제는 기한(30일)이 지났거나 취소되어 이어받지 못했습니다.';
    }
    var when = got.ts ? new Date(got.ts) : null;
    var ds = when ? (when.getFullYear() + '. ' + (when.getMonth() + 1) + '. ' + when.getDate() + '.') : '';
    say('<b>입력 내용 ' + n + '칸을 복원했습니다</b>' + (ds ? ' (' + ds + ' 생성한 위임장)' : '') +
      '.' + paid + ' 주민등록번호는 파일에 담기지 않으므로 필요하면 다시 입력해 주세요. 내려받기 전 원본 서류와 대조하는 확인은 이 기기에서 다시 해 주셔야 합니다.', 'ok');
    trk('resume_docx', { mode: 'ok' });
  }
  function bindResume() {
    var fi = $('fi-resume');
    if (fi) fi.addEventListener('change', function () { onResumeFile(fi.files && fi.files[0]); fi.value = ''; });
    var dz = $('resume-box');
    if (dz) {
      ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
      dz.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; onResumeFile(f); });
    }
  }

  /* 재발급 링크(?pass=)로 들어왔을 때의 안내 — pay.js 가 부른다.
     이 기기에 입력값이 없으면 위임장 파일로 이어서 하라고 안내한다. */
  window.SRRedeemMsg = function () {
    if (typeof hasFormInput === 'function' && hasFormInput())
      return '재발급 링크가 확인되었습니다. 다시 결제하지 않고 서류를 받으실 수 있습니다.';
    setTimeout(function () {
      var b = $('resume-box'); if (!b) return;
      b.classList.add('hl'); b.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 600);
    return '결제가 확인되었습니다. 이 기기에는 입력 내용이 없습니다. 받아 두신 위임장 파일을 「위임장 파일로 이어서 하기」에 올리면 입력 내용이 복원됩니다.';
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindResume); else bindResume();
})();
