// IndexNow 알림 — 배포가 끝난 뒤 실행한다. sitemap.xml의 주소를 Bing·네이버 등 IndexNow 참여 검색엔진에 알린다.
// 사용: node indexnow.mjs            (sitemap 전체)
//       node indexnow.mjs guide.html  (특정 페이지만)
// 키 파일(4473d25934260c185e927cee2e555e4f.txt)이 사이트 루트에 배포되어 있어야 한다. 키는 공개값이라 노출되어도 문제없다.
import { readFileSync } from 'node:fs';

const HOST = 'www.selfregi24.com';
const KEY = '4473d25934260c185e927cee2e555e4f';

const args = process.argv.slice(2);
const urls = args.length
  ? args.map(p => 'https://' + HOST + '/' + p.replace(/^\//, ''))
  : [...readFileSync(new URL('./sitemap.xml', import.meta.url), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: 'https://' + HOST + '/' + KEY + '.txt', urlList: urls }),
});
console.log(res.status, res.statusText, '—', urls.length + '건');
urls.forEach(u => console.log('  ' + u));
// 200/202 = 접수. 403 = 키 파일을 못 찾음(배포 전이거나 경로 오류). 422 = 주소가 HOST와 다름.
