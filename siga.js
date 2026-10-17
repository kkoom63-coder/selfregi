/* 셀프등기24 공시가격 조회 (2026-10-17) — 로드맵 시가표준액 자동 입력 · 계산기 국민주택채권 계산이 함께 쓴다.
   · 브이월드 웹 인증키(도메인 www.selfregi24.com 등록, 브라우저용 공개 키). JSONP 호출이라 서버를 거치지 않는다.
   · 주소 검색(req/search, 지번) → 필지고유번호(PNU) → 공동주택가격(ned getApartHousingPriceAttr, 올해·작년 순).
   · 쿨다운: 같은 집(주소|동|호)은 이 브라우저에 30일 저장(재조회 없음), 네트워크 조회는 브라우저당 하루 5회.
   SRSiga.lookup(addr, dong, ho) → { v:'2785000000', y:2026, parcel:'서울특별시 송파구 잠실동 19' } | null | { err:'limit' } */
(function () {
  var KEY = 'B8D64799-EEB1-4F30-A20E-8F5F4CA4C29A', DOM = 'https://www.selfregi24.com', LK = 'sr_siga_v1', LIM = 5, KEEP = 30 * 864e5;
  function jsonp(url, p) {
    return new Promise(function (ok, no) {
      var cb = 'srvw' + Date.now() + Math.floor(Math.random() * 1e4), s = document.createElement('script');
      var t = setTimeout(function () { end(); no('timeout'); }, 8000);
      function end() { clearTimeout(t); try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); }
      window[cb] = function (d) { end(); ok(d); };
      var q = new URLSearchParams(Object.assign({}, p, { key: KEY, domain: DOM, format: 'json', callback: cb }));
      s.src = url + '?' + q.toString(); s.onerror = function () { end(); no('error'); };
      document.head.appendChild(s);
    });
  }
  function load() { try { return JSON.parse(localStorage.getItem(LK) || '{}') || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(LK, JSON.stringify(o)); } catch (e) {} }
  function digits(x) { return String(x || '').replace(/[^0-9]/g, ''); }
  async function lookup(addr, dong, ho) {
    addr = String(addr || '').trim(); dong = String(dong || '').replace(/동$/, '').trim(); ho = digits(ho);
    if (!addr || !ho) return null;
    var id = addr + '|' + dong + '|' + ho, S = load(), now = Date.now(), today = new Date().toISOString().slice(0, 10);
    S.c = S.c || {};
    if (S.c[id] && now - S.c[id].t < KEEP) return S.c[id];
    if (S.d !== today) { S.d = today; S.n = 0; }
    if (S.n >= LIM) return { err: 'limit' };
    S.n++; save(S);
    var r = await jsonp('https://api.vworld.kr/req/search', { service: 'search', request: 'search', version: '2.0', query: addr, type: 'address', category: 'parcel', size: '1' });
    var it = r && r.response && r.response.result && r.response.result.items && r.response.result.items[0];
    if (!it || !it.id) return null;
    var y = new Date().getFullYear(), hit = null;
    for (var yr of [y, y - 1]) {
      var p = { pnu: it.id, stdrYear: String(yr), hoNm: ho, numOfRows: '1', pageNo: '1' };
      if (dong) p.dongNm = dong;
      var d = await jsonp('https://api.vworld.kr/ned/data/getApartHousingPriceAttr', p);
      var f = d && d.apartHousingPrices && d.apartHousingPrices.field;
      if (f && f.length && digits(f[0].pblntfPc)) { hit = { v: digits(f[0].pblntfPc), y: yr, t: now, parcel: (it.address && it.address.parcel) || '' }; break; }
    }
    if (hit) { S = load(); S.c = S.c || {}; S.c[id] = hit; save(S); }
    return hit;
  }
  window.SRSiga = { lookup: lookup };
})();
