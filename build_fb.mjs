// Firebase 빌드: build_cf.sh 와 같은 기준으로 공개 파일만 dist/ 로 모으고,
// 결제 공통 코드(lib/paycore.js · worker/pay/*)를 functions/ 로 복사한다.
// 작업 폴더가 아니라 **커밋된 HEAD** 에서 꺼낸다 — 미커밋 수정본이 운영에 섞이지 않게(Cloudflare 빌드와 같은 결과).
// Windows 에서도 돌도록 bash·tar 대신 Node 로 작성했다. firebase.json predeploy 가 실행한다.
// 제외 목록은 build_cf.sh 와 같게 유지한다(한쪽만 고치면 공개 범위가 어긋난다).
import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const EXCLUDE = /^\.|^(worker\/|lib\/|api\/|functions\/|fixtures\/|docs\/|design\/|backup\/)|(^|\/)\.[^/]+$|\.md$|\.py$|\.mjs$|^(test\.js|ppocr_test\.html|regparse-test\.html|vercel\.json|wrangler\.jsonc|firebase\.json|build_cf\.sh|package(-lock)?\.json)$/;

const fromHead = (f) => execFileSync('git', ['show', 'HEAD:' + f], { maxBuffer: 256 * 1024 * 1024 });

const files = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD'], { encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !EXCLUDE.test(f));

rmSync('dist', { recursive: true, force: true });
for (const f of files) {
  mkdirSync(dirname(join('dist', f)), { recursive: true });
  writeFileSync(join('dist', f), fromHead(f));
}
console.log('dist: ' + files.length + ' files');

// 결제 로직은 Cloudflare Worker(롤백용)와 한 벌만 유지한다. 상대 경로가 그대로 맞도록 같은 구조로 복사.
const shared = ['lib/paycore.js', 'worker/pay/create.js', 'worker/pay/confirm.js', 'worker/pay/verify.js'];
rmSync('functions/shared', { recursive: true, force: true });
for (const f of shared) {
  mkdirSync(dirname(join('functions/shared', f)), { recursive: true });
  writeFileSync(join('functions/shared', f), fromHead(f));
}
console.log('functions/shared: ' + shared.length + ' files');
