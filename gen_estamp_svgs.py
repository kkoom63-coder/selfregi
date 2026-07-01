# -*- coding: utf-8 -*-
"""전자수입인지 가이드 SVG 생성기 — 실제 전자수입인지.kr 화면 재현.
공유 헬퍼로 정부 사이트의 헤더/배지/버튼 스타일을 일관되게 유지한다.
"""

DEFS = '''<defs>
  <linearGradient id="hdrGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#1155a5"/><stop offset="1" stop-color="#1a4ca0"/>
  </linearGradient>
  <linearGradient id="bannerGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#0d3f8a"/><stop offset="1" stop-color="#1a6dc0"/>
  </linearGradient>
  <linearGradient id="btnBlue" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3d83dd"/><stop offset="1" stop-color="#2a6fc9"/>
  </linearGradient>
  <linearGradient id="btnGreen" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3eb87c"/><stop offset="1" stop-color="#2a9a65"/>
  </linearGradient>
  <linearGradient id="step2Grad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#1a6dc0"/><stop offset="1" stop-color="#2a83e0"/>
  </linearGradient>
</defs>'''

def svg_open(w, h):
    return f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" font-family="\'Malgun Gothic\',\'Noto Sans KR\',sans-serif">\n{DEFS}\n'

def svg_close():
    return '</svg>'

def gov_mark(cx, cy, r=12):
    """태극 마크 + 재정경제부 로고 마크(원)"""
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#003478"/>'
            f'<path d="M{cx-r},{cy} A{r},{r} 0 0,1 {cx+r},{cy} A{r/2},{r/2} 0 0,0 {cx},{cy} '
            f'A{r/2},{r/2} 0 0,0 {cx-r},{cy} Z" fill="#C60C30"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#ffffff50" stroke-width="1"/>')

def top_header(w, title_sub=True):
    """상단 헤더바 (전자수입인지 로고 + 재정경제부)"""
    out = f'<rect x="10" y="10" width="{w-20}" height="52" fill="url(#hdrGrad)"/>'
    out += '<text x="26" y="33" font-size="16" font-weight="900" fill="#fff" letter-spacing="-0.5">전자수입인지</text>'
    if title_sub:
        out += '<text x="26" y="50" font-size="8.5" fill="#93b8e8">전자수입인지.kr</text>'
    mx = w - 125
    out += gov_mark(mx, 36)
    out += f'<text x="{mx+17}" y="33" font-size="9.5" font-weight="700" fill="#fff">재정경제부</text>'
    return out

def nav_tabs(w):
    """상단 탭 메뉴 (구매/조회/발급내역/소인/서비스안내/고객센터)"""
    tabs = ["구매", "조회", "발급내역", "소인", "서비스안내", "고객센터"]
    out = ""
    x = 300
    for t in tabs:
        out += f'<text x="{x}" y="33" font-size="9" fill="#dbe6f5">{t}</text>'
        x += 22 + len(t) * 9
    return out

def redbox(x, y, w, h, num):
    """빨간 점선 강조박스 + 번호 배지"""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="none" '
            f'stroke="#e0392b" stroke-width="2" stroke-dasharray="5 3"/>'
            f'<circle cx="{x}" cy="{y}" r="11" fill="#e0392b"/>'
            f'<text x="{x}" y="{y+4}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">{num}</text>')

def btn(x, y, w, h, label, grad="btnBlue", fs=11):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="url(#{grad})"/>'
            f'<text x="{x+w/2}" y="{y+h/2+4}" text-anchor="middle" font-size="{fs}" '
            f'font-weight="700" fill="#fff">{label}</text>')

def caption(w, y, text="(이해를 돕기 위한 재현 이미지)"):
    return f'<text x="{w/2}" y="{y}" text-anchor="middle" font-size="8" fill="#c0c5d0">{text}</text>'

def field(x, y, w, h, val="", placeholder=False, label=None):
    stroke = "#b0bcd4" if placeholder else "#c0c8d8"
    fill = "#f5f8ff" if placeholder else "#fff"
    out = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="{fill}" stroke="{stroke}"/>'
    if val:
        out += f'<text x="{x+8}" y="{y+h/2+3.5}" font-size="8.8" fill="#333">{val}</text>'
    return out
