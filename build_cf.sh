#!/usr/bin/env bash
# Cloudflare 빌드: 사이트에 공개할 파일만 dist/ 로 모은다.
# (Vercel 의 .vercelignore 와 같은 역할 — 개발 자산·서버 코드가 공개 URL로 노출되지 않게 한다)
# Workers Builds 설정: Build command = bash build_cf.sh · Deploy command = npx wrangler deploy
#   (wrangler.jsonc 가 dist 를 정적 자산으로 올린다)
# git 에 커밋된 파일만 대상으로 한다 — 로컬에만 있는 파일·캐시는 절대 섞이지 않는다.
set -euo pipefail
mkdir -p dist
find dist -mindepth 1 -delete
git ls-files -z \
  | grep -zvE '^(worker/|lib/|api/|fixtures/|docs/|design/|backup/)|(^|/)\.[^/]+$|\.md$|\.py$|^(test\.js|ppocr_test\.html|regparse-test\.html|vercel\.json|wrangler\.jsonc|build_cf\.sh|package(-lock)?\.json)$' \
  | grep -zvE '^\.' \
  | tar --null -T - -cf - \
  | tar -xf - -C dist
echo "dist: $(find dist -type f | wc -l) files"
