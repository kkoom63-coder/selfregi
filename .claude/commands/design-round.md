---
description: brief.md + references + 직전 verdict 기반으로 다음 라운드 시안 5개(variant-a~e) + gallery.html 생성
allowed-tools: Read, Write, Glob, Bash
---

# /design-round — 셀프등기24 랜딩 리디자인 시안 생성 루프

이 커맨드는 **매 라운드 아래 세 가지만**을 입력으로 삼는다.
이 입력과 충돌하는 트렌드·취향 판단은 모두 `brief.md`가 이긴다.

## 입력 (이것 외 금지)

1. `design/brief.md` — **단일 기준**. 먼저 전체를 읽는다.
2. `design/references/`의 이미지 — **타이포·레이아웃 문법만** 참고한다. 화면 통째 클론 금지 (저작권).
3. `design/verdict.md` — 있으면 직전 라운드 판정.

## 실행 절차

### 1. 기준 로드
- `design/brief.md`를 처음부터 끝까지 읽는다.
- `design/references/`의 이미지를 훑어 타이포·레이아웃 문법을 추출한다 (클론 금지).

### 2. 라운드 번호 N 결정
- `design/rounds/` 아래 `round-*` 폴더를 확인한다.
- 가장 큰 번호가 K면 이번 라운드 N = K+1. 폴더가 없으면 N = 1.

### 3. verdict 게이트 (무한 노이즈 방지 — brief §9)
- `design/verdict.md`가 **없고** `design/rounds/`가 **비어있지 않으면**:
  → 아무것도 생성하지 말고 정확히 **`verdict 대기 중`** 한 줄만 출력하고 종료한다.
- `design/verdict.md`가 **있으면**:
  → `keep` 시안을 씨앗으로 삼고, `remix` 지시를 반영하며, `kill`된 변주 조합은 **재등장시키지 않는다**.
- `design/rounds/`가 비어있으면 (첫 라운드): 그대로 진행한다.

### 4. 변주 조합 선택 (brief §8)
- brief §8의 변주 축(A~F)에서 **서로 뚜렷이 다른 조합 5개**를 고른다.
- 각 시안은 §8 축의 **이름 붙은 조합**만 다르게 탐색한다.
- verdict가 있으면 kill된 조합은 제외하고, keep/remix 방향을 우선한다.

### 5. 시안 생성 — `design/rounds/round-N/variant-{a,b,c,d,e}.html`
전 시안 **공통 고정**(변주 대상 아님):
- **§3 섹션 순서** (S0~S10) — 라운드 간 변경 금지
- **§4 카피 규칙** — 단정·과장 금지, 근거 각주, 가짜 증거 금지, "직접하면 무료" 금지, 문장형 헤드라인
- **§5 타이포 강제 조항** — Pretendard 단일 패밀리, 웨이트 이원화(800~900 / 400, 중간웨이트 금지), 극단적 크기 점프, 타이트 자간·행간, 헤드라인당 악센트 1곳, 통계=타이포, eyebrow 라벨, 본문 컬럼 폭 제한
- **§6 기술 제약** — 단일 HTML, 인라인 CSS/JS, 프레임워크 금지, 모바일 퍼스트, Pretendard CDN, 접근성 바닥선(포커스 가시화·AA)
- **§5 안티패턴** 발견 즉시 회피 (everything-is-a-card, 균일 웨이트, 이모지 등)

### 6. `design/rounds/round-N/notes.md`
- 각 시안(a~e)이 §8 축에서 **어떤 조합을 선택했는지** 표/목록으로 기록한다.
- 그 조합으로 무슨 디자인 결정을 탐색했는지 한두 줄 근거를 남긴다.

### 7. `design/rounds/round-N/gallery.html`
- 전 시안을 `<iframe>`으로 한 페이지에 나열한다.
- 각 시안 위에 **시안명 + 탐색한 축**을 표기한다.

### 8. 커밋 (push 금지)
- `git add design/rounds/round-N` (+ 필요한 변경분)
- `git commit -m "design: round-N 시안 5종 + gallery"`
- **push 하지 않는다.** (프로젝트 규칙: 원격 반영은 사람이 직접)

## 하드 룰 (위반 즉시 폐기)
- brief와 충돌하는 트렌드/취향 우선 → 금지
- references 화면 통째 클론 → 금지
- kill된 변주 조합 재등장 → 금지
- 시안 수는 **5개(a~e) 고정** (brief §7)
- verdict 없고 rounds 비어있지 않으면 → 생성 금지, `verdict 대기 중`만 출력
