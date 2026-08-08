---
paths:
  - "*.html"
  - "**/*.css"
---

# 디자인 시스템 (Flat Trust)

```
--navy(primary): #0F172A     --blue(accent, CTA/링크): #0369A1
--bg: #F8FAFC                --card: #fff
--text: #020617              --muted: #64748B
--border: #E2E8F0            success: #047857    danger: #DC2626
폰트: Noto Sans KR           radius: 12px        shadow: 플랫
```

**단일 액센트 체계.** 골드는 흡수됨. 예외는 다크섹션 뱃지 `#7DD3FC`(sky)와 체크마커 `#F0D075`뿐.

## 레이아웃

- 프레임 컨테이너 **1200px**. roadmap은 `--frame:1200px`(nav·헤더·푸터) / `--read:860px`(타임라인 본문) 2계층.
- **넓은 화면에서 억지 2열 금지.** 콘텐츠량이 다르면 높이가 어긋나고 정렬축이 이중화되어 삐뚤어져 보인다. 세로 스택 + 단일 정렬축이 안전.
- **한 페이지 안에서 섹션 본문 max-width 캡 혼용 금지.** 1200과 760을 섞으면 좌측축이 같아도 우측 여백이 들쭉날쭉해 쏠림으로 읽힌다. 블록은 컨테이너를 채우고, 행장(45~75자) 제한은 블록 내부 텍스트 요소에만 건다.

## 표현

- **이모지 최소화** — 숫자/텍스트 뱃지로 대체. 노티스 박스는 볼드 텍스트. (예외: roadmap 동선·장소 구분용 최소 이모지)
- 실제 화면 캡처 강조는 **빨간 점선 박스 + 번호 배지**로 일관.
- 정부 UI 재현물은 **"재현 이미지" 표기 필수**(저작권).
- 정부 서식·화면 이미지는 실물 캡처 우선. **미확보 시 추정 제작 금지** — SVG 상상 제작은 전량 기각된 사례가 있다. 차라리 만들지 않는다.

## 접근성

회색 텍스트 대비 상습 실패 지점은 **푸터 법적 면책 고지**.
WCAG AA 미달색(`#94A3B8` 등) 금지. `#64748B` 이상만 사용.

---

## 표준 nav (전 페이지 공통)

```html
<nav><div class="nav-inner">
  <a href="index.html" class="nav-logo">셀프등기24</a>
  <a href="guide.html" class="nav-a">셀프등기 가이드</a>
  <a href="calculator.html" class="nav-a">취득세 계산기</a>
  <a href="https://selfregi.tistory.com" class="nav-a" target="_blank" rel="noopener">블로그</a>
  <a href="[페이지별 CTA]" class="nav-a cta">[CTA 문구]</a>
</div></nav>
```

CTA만 페이지 맥락에 따라 다르다.

| 페이지 | CTA |
|---|---|
| index / calculator | `서류 작성하기` |
| normal_form | `서류 작성` (현재 위치, `aria-current="page"`, 비활성) |
| roadmap | `작성 화면으로` — **index로 보내지 말 것** (normal_form 복귀) |
| guide | 앵커형 8메뉴 유지 (페이지 특성상 예외) |

back-bar "홈으로"는 nav 로고와 역할이 분담된다(명시적 홈 탈출). nav가 있는 페이지에 중복 배치 주의.

## 용어 표준 (변형 금지)

| 개념 | 표준 표기 | 금지 변형 |
|---|---|---|
| 문서 작성 진입 | 서류 작성하기 | 서류 만들기, 시작하기 → |
| 히어로 주 CTA | 서류 작성 시작하기 → | (예외 허용) |
| 가이드 | 셀프등기 가이드 | 가이드 보기 |
| 계산기 | 취득세 계산기 | 취득세계산기 |
| 등기필정보 | 등기필정보(구 등기필증·등기권리증) | 등기권리증 / 등기필증 단독 |

---

## 기각된 방향 — 재도입 금지

디자인 개편 시 아래 방향이 다시 제안되는 일이 반복된다. 전부 검토 후 기각됐다.

- **variant-b 계열 전체**
- IBM Plex Mono
- 에디토리얼 와이드 레이아웃
- ice-tint `#edf2f7`
- 위임장 목업
- 정부 서식의 SVG 상상 제작

## 스킬 사용 순서

`frontend-design` → `ui-ux-pro-max` → `design-system`, 납품 전 `design-critique` 자체 리뷰.
범용 스킬의 기본값이 위 토큰·기각 목록과 충돌하면 **이 파일이 이긴다.**
