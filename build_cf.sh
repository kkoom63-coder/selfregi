#!/usr/bin/env bash
# Cloudflare Pages 빌드: 사이트에 공개할 파일만 dist/ 로 모은다.
# (Vercel 의 .vercelignore 와 같은 역할 — 개발 자산·서버 코드가 공개 URL로 노출되지 않게 한다)
# Pages 설정: Build command = bash build_cf.sh · Build output directory = dist
set -euo pipefail
rm -rf dist
mkdir dist
tar -cf - \
  --exclude=./.git --exclude=./dist --exclude=./functions --exclude=./lib --exclude=./api \
  --exclude=./fixtures --exclude=./test.js --exclude='*.md' \
  --exclude=./ppocr_test.html --exclude=./regparse-test.html \
  --exclude=./vercel.json --exclude=./.vercelignore --exclude=./.gitignore \
  --exclude=./build_cf.sh --exclude=./.dev.vars --exclude='.env*' --exclude='*.py' \
  --exclude=./.claude --exclude=./.impeccable --exclude=./.playwright-mcp \
  --exclude=./backup --exclude=./design --exclude=./docs --exclude=./node_modules \
  . | tar -xf - -C dist
echo "dist: $(find dist -type f | wc -l) files"
