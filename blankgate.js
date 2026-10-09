/* blankgate.js — 다운로드 직전 「비어 있는 칸」 경고 팝업 (2026-10-10)
   빈칸은 서류에 공란으로 인쇄되고, 그대로 내면 등기소에서 반려된다. 페이지에 목록을 늘어놓는 대신
   내려받는 순간 한 번 보여 주고 확인을 받는다. 서류 작성 화면(위임장)과 로드맵(신청서)이 함께 쓴다.
   SRBlank.confirm({ doc:'위임장', items:[[서류, 칸 이름, 짧은 설명]] }) → Promise<boolean> (true = 내려받기) */
(function () {
  'use strict';
  var dlg = null, resolve = null, last = null;

  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function trk(n, d) { try { window.SR && SR.track(n, d || {}); } catch (e) {} }

  function build() {
    dlg = document.createElement('div');
    dlg.className = 'bg-back'; dlg.hidden = true;
    dlg.innerHTML =
      '<div class="bg" role="alertdialog" aria-modal="true" aria-labelledby="bg-h" aria-describedby="bg-w" tabindex="-1">'
      + '<div class="bg-h" id="bg-h"></div>'
      + '<p class="bg-w" id="bg-w"><b>빈칸은 서류에 공란으로 인쇄됩니다.</b> 비운 채로 제출하면 등기소에서 반려되니, 출력한 뒤 아래 칸을 반드시 손으로 적어 주세요.</p>'
      + '<ul class="bg-l"></ul>'
      + '<div class="bg-a"><button type="button" class="bg-ok"></button><button type="button" class="bg-no">돌아가서 입력하기</button></div>'
      + '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('.bg-ok').onclick = function () { finish(true); };
    dlg.querySelector('.bg-no').onclick = function () { finish(false); };
    dlg.addEventListener('click', function (e) { if (e.target === dlg) finish(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg && !dlg.hidden) finish(false); });
  }

  function finish(ok) {
    if (!dlg || dlg.hidden) return;
    dlg.hidden = true; document.documentElement.classList.remove('bg-open');
    trk(ok ? 'blank_gate_ok' : 'blank_gate_back', { doc: dlg.dataset.doc });
    if (last && last.focus) try { last.focus({ preventScroll: true }); } catch (e) {}
    var r = resolve; resolve = null; if (r) r(ok);
  }

  function confirm(opts) {
    var items = (opts && opts.items) || [], doc = (opts && opts.doc) || '서류';
    if (!items.length) return Promise.resolve(true);
    if (!dlg) build();
    if (resolve) finish(false);
    dlg.dataset.doc = doc;
    dlg.querySelector('.bg-h').innerHTML = '손으로 적어야 할 칸 <span class="bg-n">' + items.length + '개</span>';
    dlg.querySelector('.bg-ok').textContent = '확인했습니다 · ' + doc + ' 내려받기';
    dlg.querySelector('.bg-l').innerHTML = items.map(function (it) {
      return '<li><span class="bg-d">' + esc(it[0]) + '</span><b>' + esc(it[1]) + '</b>' + (it[2] ? '<small>' + esc(it[2]) + '</small>' : '') + '</li>';
    }).join('');
    last = document.activeElement;
    dlg.hidden = false; document.documentElement.classList.add('bg-open');
    dlg.querySelector('.bg-l').scrollTop = 0;
    setTimeout(function () { try { dlg.querySelector('.bg-ok').focus({ preventScroll: true }); } catch (e) {} }, 30);
    trk('blank_gate_view', { doc: doc, key: String(items.length) });
    return new Promise(function (r) { resolve = r; });
  }

  window.SRBlank = { confirm: confirm };

  var css = ''
    + '.bg-back[hidden]{display:none}'
    + '.bg-back{position:fixed;inset:0;z-index:1250;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px}'
    + 'html.bg-open,html.bg-open body{overflow:hidden}'
    + '.bg{width:100%;max-width:480px;max-height:calc(100vh - 32px);display:flex;flex-direction:column;box-sizing:border-box;padding:20px 20px 16px;border-radius:16px;background:#fff;color:#0F172A;font-size:14px;line-height:1.6;text-align:left;box-shadow:0 20px 50px rgba(15,23,42,.3);font-family:inherit}'
    + '@media(max-width:560px){.bg-back{align-items:flex-end;padding:0}.bg{max-width:none;max-height:88vh;border-radius:16px 16px 0 0;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}}'
    + '.bg-h{font-size:18px;font-weight:800;letter-spacing:-.02em;display:flex;align-items:center;gap:8px}'
    + '.bg-n{font-size:13px;font-weight:800;color:#B45309;background:#FFFBEB;border:1px solid #FDE68A;border-radius:999px;padding:1px 10px}'
    + '.bg-w{margin:10px 0 12px;padding:11px 13px;background:#FFF7ED;border:1px solid #FDBA74;border-radius:10px;font-size:13.5px;line-height:1.65;color:#9A3412;word-break:keep-all}'
    + '.bg-w b{color:#7C2D12}'
    + '.bg-l{list-style:none;margin:0;padding:0;display:grid;gap:6px;overflow-y:auto;overscroll-behavior:contain;min-height:0}'
    + '.bg-l li{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;padding:9px 12px;border:1px solid #E2E8F0;border-radius:8px;background:#F8FAFC;font-size:13.5px;word-break:keep-all}'
    + '.bg-d{flex-shrink:0;font-size:12px;font-weight:700;color:#475569;background:#fff;border:1px solid #E2E8F0;border-radius:5px;padding:0 6px}'
    + '.bg-l b{font-weight:700;color:#0F172A}'
    + '.bg-l small{flex-basis:100%;font-size:12.5px;color:#B45309}'
    + '.bg-a{display:flex;flex-direction:column;gap:8px;margin-top:14px}'
    + '.bg-ok{min-height:50px;border:0;border-radius:10px;background:#0F172A;color:#fff;font-family:inherit;font-size:15px;font-weight:800;cursor:pointer}'
    + '.bg-no{min-height:44px;border:1px solid #E2E8F0;border-radius:10px;background:#fff;font-family:inherit;font-size:14px;font-weight:700;color:#475569;cursor:pointer}'
    + '.bg:focus{outline:none}.bg :focus-visible{outline:2px solid #0369A1;outline-offset:2px}';
  var st = document.createElement('style'); st.id = 'bg-css'; st.textContent = css; document.head.appendChild(st);
})();
