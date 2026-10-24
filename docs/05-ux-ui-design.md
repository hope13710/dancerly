# 05. UX/UI 디자인 문서

> 기준: 현재 랜딩(`styles.css`)과 워크스페이스 프로토타입(`workspace.css`)의 실제 값.
> 두 파일에서 같은 의미인데 값이 다른 토큰(`--muted`, `--line`, `--dark`)은 아래 값으로 **통일**한다.

---

## 1. 디자인 원칙

| # | 원칙 | 뜻 | 화면에서는 |
|---|---|---|---|
| 1 | **The moment first** | 피드백은 항상 영상의 그 순간과 함께 | 노트 카드를 누르면 무조건 그 시점 재생. 시간 옆에 카운트 |
| 2 | **Three taps to feedback** | 댄서는 알림에서 피드백까지 3탭 이내 | 딥링크, 이름만으로 참여, 하단 탭 |
| 3 | **Never a blank page** | 빈 화면은 다음 행동을 알려주는 화면 | 샘플, 템플릿, 빈 상태 버튼 |
| 4 | **Coach stays the coach** | AI는 정리만, 판단은 사람 | 출처 인용, 검토 후 발송, "AI summary" 표기 |
| 5 | **Progress, not ranking** | 다른 사람과 비교하지 않음 | 지표는 "지난번 대비", 순위표 없음 |
| 6 | **Calm by default** | 알림·색·움직임은 꼭 필요할 때만 | 노트 알림 묶음 발송, 강조색은 화면당 하나 |
| 7 | **Private feels private** | 비공개임이 화면에서 느껴져야 함 | 공유 범위 항상 표시 (🔒 Only you and Alex) |

---

## 2. 보이스 & 톤 (UI 문구)

- 기본 언어 **영어**, 짧고 따뜻하게. 코치의 말투처럼: 명확하고 격려하는.
- 2인칭(you) 사용. 댄서 화면은 "you", 코치 화면에서 댄서는 이름으로.
- 버튼은 **동사로 시작**: Upload version, Pin note, Send report.
- 오류는 **무엇이 일어났고 + 무엇을 하면 되는지**.

| 상황 | ❌ 피하기 | ✅ 쓰기 |
|---|---|---|
| 업로드 실패 | Error 500 | The upload stopped. We’ll resume when you’re back online. |
| 빈 대기열 | No data | You’re all caught up. New submissions will show up here. |
| 리캡 노트 없음 | Nothing found | No notes from your coaches this week yet. |
| 한도 도달 | Limit exceeded | Your free plan includes 5 dancers. Start a free Coach trial to invite more. |
| 삭제 확인 | Are you sure? | Delete this video? Its 4 notes and 1 sketch will be deleted too. |
| 해결 축하 | Resolved | Correction landed ✓ |

---

## 3. 디자인 토큰

### 3-1. 색상

**기본**

| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#F7F8FA` | 앱·페이지 배경 |
| `--surface` | `#FFFFFF` | 카드, 패널 |
| `--ink` | `#17191C` | 본문 텍스트 |
| `--muted` | `#6B7280` | 보조 텍스트 (대비 4.8:1) |
| `--soft` | `#A5ABB5` | 비활성, 플레이스홀더 (텍스트 본문에는 사용 금지) |
| `--line` | `#E5E7EB` | 구분선, 테두리 |
| `--accent` | `#5B5CE2` | 브랜드, 주요 링크, 선택 상태 |
| `--accent-dark` | `#4546B8` | 눌림 |
| `--accent-soft` | `#EDEDFF` | 선택 배경, 배지 |
| `--dark` | `#14171D` | 주 버튼, 영상 플레이어 영역 |
| `--dark-soft` | `#1D222B` | 플레이어 패널 |

**상태**

| 토큰 | 텍스트 | 배경 | 용도 |
|---|---|---|---|
| success | `#16845B` | `#E4F7EE` | Resolved, Fixed, 개선 |
| warning | `#B66C21` | `#FFF1E3` | Needs review, 반복 교정 |
| danger | `#C2410C` | `#FFEDE5` | 실패, 삭제 |
| info / new | `#5B5CE2` | `#EDEDFF` | New activity |

**AI 레이블** (리포트·대시보드에서만 사용. 노트 작성기·노트 카드에는 쓰지 않음)

| 레이블 | 차트 색 | 칩 텍스트 | 칩 배경 | 툴팁 (한 줄 설명) |
|---|---|---|---|---|
| Timing | `#F3AE7A` | `#B2611F` | `#FFF1E3` | Landing on the right count |
| Pathway | `#8FB4F2` | `#3A6FC4` | `#E7F0FF` | Where the body travels and the lines it draws |
| Energy | `#8F90FF` | `#5B5CE2` | `#EDEDFF` | Intensity, dynamics, and intent |
| Musicality | `#59C99A` | `#16845B` | `#E4F7EE` | Hitting the music, not just the beat |
| Technique | `#E58FB0` | `#B4386A` | `#FDE8F0` | Form, alignment, and execution |
| 사용자 정의 | 8색 팔레트에서 선택 | | | 코치가 직접 입력 |

**AI 리포트** (만든 사람에 따라 구분)

| 모드 | 그라데이션 | 진한 텍스트 | 쓰는 곳 |
|---|---|---|---|
| 댄서 리캡 | `#A78BFA → #F472B6` | `#7C3AED → #DB2777` | 리캡 카드 테두리, ✦ 아이콘, 생성 버튼 |
| 코치 리포트 | `#22D3EE → #6366F1` | `#0891B2 → #4F46E5` | 리포트 카드, 발송 버튼 |

> AI 그라데이션은 **AI가 만든 결과물에만** 쓴다. 일반 버튼·배지에 쓰지 않는다 (AI임이 한눈에 보이도록).

### 3-2. 타이포그래피

| 토큰 | 글꼴 | 크기 / 행간 | 굵기 | 용도 |
|---|---|---|---|---|
| display | Inter | 46–76 / 0.98, 자간 -0.075em | 620 | 랜딩 H1 |
| display-em | Georgia Italic | 위와 동일, 자간 -0.09em | 400 | 랜딩 강조 (*Every version.*) — **앱에서는 쓰지 않음** |
| h1 | Inter | 28 / 1.1, -0.06em | 650 | 앱 페이지 제목 |
| h2 | Inter | 18 / 1.25, -0.04em | 650 | 패널 제목 |
| h3 | Inter | 14 / 1.3, -0.03em | 650 | 카드 제목 |
| body | Inter | 14 / 1.55 | 400 | 본문 (앱 최소) |
| body-sm | Inter | 12 / 1.5 | 400 | 메타 정보 |
| label | Inter | 10 / 1, 자간 0.12em, 대문자 | 750 | 섹션 라벨 (VIDEO REVIEW) |
| mono-time | Inter tabular-nums | 12 | 700 | 타임스탬프 `00:18` |

- CJK 언어: `Pretendard`(KO), `Noto Sans JP`(JA)를 Inter 뒤에 폴백으로.
- 앱 본문 최소 12px. 현재 프로토타입의 8–10px 텍스트는 **12px 이상으로 올린다** (모바일 가독성).

### 3-3. 간격·모양·그림자·움직임

| 종류 | 값 |
|---|---|
| 간격 (4px 기준) | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64 · 96 |
| 반경 | `sm 6` 칩·입력 · `md 10` 카드·버튼 · `lg 14` 패널 · `xl 20` 모달·AI 카드 · `full` 아바타·필 |
| 그림자 | `sm 0 1 2 / 6%` 카드 · `md 0 16 40 / 8%` 패널 · `lg 0 24 70 / 12%` 모달·히어로 |
| 움직임 | `fast 150ms` 호버 · `base 250ms` 열고 닫기 · `slow 400ms` 화면 전환 · easing `cubic-bezier(.65,0,.35,1)` |
| 모션 줄이기 | `prefers-reduced-motion`이면 자동 재생·반짝임·이동 애니메이션 끔 |

### 3-4. 반응형 기준점

| 이름 | 너비 | 코치 앱 | 댄서 앱 |
|---|---|---|---|
| phone | ≤ 430 | 사이드바 → 드로어 | **기본 타깃** |
| mobile | ≤ 720 | 드로어, 플레이어 위·노트 아래 | 하단 탭 |
| tablet | ≤ 1050 | 접히는 사이드바 215px | 하단 탭, 가로 시 2단 |
| desktop | > 1050 | 사이드바 244px + 본문 최대 1260px | 가운데 정렬 최대 560px |

터치 대상 최소 **44×44px**. 하단 탭은 기기 안전 영역(`safe-area-inset-bottom`) 포함.

---

## 4. 레이아웃

### 4-1. 코치 웹 앱 (데스크톱)

```
┌──────────────┬───────────────────────────────────────────────────────┐
│ ▮▮▮ looproom │  Alex Lee Studio / Review queue        ⌕ ⌘K   🔔  AL ▾ │ ← 헤더 69px, 브레드크럼
│ [AL Studio ▾]├───────────────────────────────────────────────────────┤
│ [＋ New     ]│                                                       │
│              │   페이지 제목                          [주 행동 버튼]  │
│ ⌂ Home       │   설명 한 줄                                           │
│ □ Inbox    3 │                                                       │
│ ◫ Review   8 │   ┌─────────────── 본문 (최대 1260px) ─────────────┐   │
│ ✦ Projects ▾ │   │                                               │   │
│   Showcase   │   │                                               │   │
│   Tue class  │   └───────────────────────────────────────────────┘   │
│ ○ People     │                                                       │
│ ↗ Insights   │                                                       │
│ ⚙ Settings   │                                                       │
│ ─────────    │                                                       │
│ AL Alex Lee  │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```

### 4-2. 댄서 앱 (모바일)

```
┌─────────────────────────┐
│ ← Feedback        ⋯     │ ← 상단 52px (현재 화면 이름)
├─────────────────────────┤
│                         │
│        본문 스크롤       │
│                         │
├─────────────────────────┤
│  ⌂    ◫    (＋)   ✦   ○  │ ← 하단 탭 64px + 안전 영역
│Today Feedback    Recap Me│
└─────────────────────────┘
```

---

## 5. 컴포넌트

| 컴포넌트 | 변형 | 상태 | 비고 |
|---|---|---|---|
| **Button** | primary(dark) · secondary(outline) · ghost · danger · **ai**(그라데이션) | default · hover(-1px 이동) · pressed · disabled · loading(스피너) | 높이 sm 32 · md 40 · lg 48 |
| **Icon button** | 기본 · 토글(on) | 툴팁 필수 | 거울모드 ⇋, 루프 ↻ |
| **Input / Textarea** | 기본 · 검색 · 노트 작성기 | focus 링 accent 2px · error · disabled | 레이블은 입력 위 |
| **AI label chip** | 5개 (+ 사용자 정의 P2) | 기본 · 코치가 고친 상태 | ✦ 접두, 호버·길게 누르면 툴팁. 리포트·대시보드 전용 |
| **Status pill** | Needs review · Re-submitted · Ready to close · Overdue | | 점 + 텍스트 |
| **Role chip** | Dancer(핑크) · Coach(시안) · Assistant(회색) · Owner(accent) | | 아바타 옆 |
| **Avatar** | 24 · 32 · 40, 이니셜 / 사진 | 온라인 점 없음 (차분함) | 겹침 스택 최대 3 + "+n" |
| **Note card** | 순간(▸) · 구간(⟷) · 스케치 첨부 · 그룹 공지 | Open · Practicing · Resolved · selected · looping · "from V1" | 시간 칩(누르면 이동) + 카운트 + 본문(@멘션 칩) + 작성자 + ↻ Loop 버튼. **레이블 없음** |
| **Note composer** | ▸ At 00:18 · ⟷ Range(Start/End) | typing · `@` 멘션 목록 · 라이브러리 `/` 팝업 · saving | 입력은 본문 하나. 포커스 시 영상 정지, 올린 뒤 포커스 해제. 하단 안내 "No label needed — AI sorts notes in your reports." |
| **Mention menu** | 작성기 위 팝업 | 첫 항목 선택됨 · ↑↓ 이동 | 머리글 "People on {project}", 아바타 + 이름 + 역할 |
| **Player** | 코치(풀 컨트롤) · 댄서(간단) · 비교(2분할) | loading(썸네일+스피너) · processing · error | 영상 영역은 항상 dark |
| **Timeline** | 기본 · 카운트 눈금 | 순간 노트 점 · 구간 노트 막대 · 작성 중 구간 미리보기(보라) · 반복 구간(주황) · 재생 헤드 | 클릭으로 이동, 점·막대 클릭 → 노트 선택 |
| **Loop chip** | 툴바 | 반복 중일 때만 | "↻ Looping 00:42–00:48 ✕" |
| **Sketch toolbar** | 펜 · 원 · 화살표 · 지우기 · 되돌리기 · 색 3 | 선택 도구 강조 | 영상 좌상단 플로팅 |
| **Board card** | 제출 카드 | 상태 컬럼별 | 댄서 아바타 + 버전 + Open 노트 수 |
| **Table** | 기본 · 카운트 시트 | 행 호버 · 선택 | 모바일: 카드로 전환 |
| **Tabs / Segmented** | 밑줄 탭 · 세그먼트 | | 기간 선택은 세그먼트 |
| **Toast** | info · success · error | 3.5초 자동 닫힘, 되돌리기 버튼 가능 | 우하단 / 모바일 하단 탭 위 |
| **Modal / Bottom sheet** | 데스크톱 모달 · 모바일 바텀시트 | | 파괴적 행동은 항상 확인 |
| **Empty state** | 일러스트 없음, 아이콘 + 한 줄 + 버튼 | | "Never a blank page" |
| **Skeleton** | 리스트 · 카드 · AI shimmer | | AI는 테마색 shimmer + "Reading n notes…" |
| **Upload bar** | 상단 고정 진행 | uploading · paused · processing · done · failed | 화면 이동해도 유지 |
| **AI report card** | 댄서 리캡 · 코치 리포트 | generating · ready · draft · sent | 밝은 유리 카드, 모드별 그라데이션 테두리, ✦ 26px |
| **Command palette** | ⌘K | 검색 · 명령 · 최근 | 키보드 전용 동작 |
| **Toggle** | on/off | | 설정 |
| **Checklist item** | 리캡 할 일 | unchecked · checked(→ Practicing) | 타임스탬프 칩 포함 |

### 5-1. 노트 카드 해부

```
┌────────────────────────────────────────────┐
│ ▸ 00:18 · Verse 3×8 · 5      ✎        Open  │ ← 시간 칩(탭하면 이동) · 카운트 · 스케치 · 상태
│ Land on the beat before the shoulder hits. │ ← 본문 (최대 4줄, 더보기)
│ Count “5-and-6” here.                      │
│ AL Alex Lee · 2h   💬 1    [↻ Loop ±2s]    │ ← 작성자 · 답글 · 반복 버튼 (구간 노트는 "Loop this part")
└────────────────────────────────────────────┘
 선택 시: 왼쪽 2px accent 바 + 배경 강조, 영상이 그 순간으로 이동
```

---

## 6. 화면 설계

각 화면: **목적 · 구성 · 상태(빈/로딩/오류)**

### S1. 코치 Home

```
Good morning, Alex                                   [＋ New assignment]
Monday, Oct 26 · Here’s what needs you today.

┌ Get set up ────────────── 2 of 4 ┐   (첫 주에만)
│ ✓ Workspace  ✓ First note  ○ Upload your own video  ○ Invite dancers │
└──────────────────────────────────┘

[ To review 8 ] [ Due this week 3 ] [ Resolved this week 14 ] [ Open notes 22 ]

┌ Needs your attention ─────────┐ ┌ Recent activity ───────┐
│ MC Maya · Week 04 · V2  →     │ │ ↗ Maya submitted V2    │
│ JS Jordan · Week 04 · V1 →    │ │ ↩ Jordan replied       │
│ [Start reviewing (8)]         │ │ ✓ You resolved a note  │
└───────────────────────────────┘ └────────────────────────┘
┌ Quiet this week ─────────────────────────────────────────┐ (2.5)
│ RK Riko — no practice or submission in 8 days  [Nudge]   │
└──────────────────────────────────────────────────────────┘
```
- 빈 상태: "No submissions yet. Create an assignment and share the link with your dancers." [Create assignment]

### S2. Review queue

```
Review queue                                 Filter: All groups ▾  Project ▾
[Needs review 8] [Re-submitted 3] [Overdue 1]

  DANCER          ASSIGNMENT              VERSION   WAITING   
  MC Maya Chen    Week 04 — Chorus timing  V2 ↻     12 min    →
  JS Jordan Smith Week 04 — Chorus timing  V1       2 h       →
                                         [Start reviewing →]
```
- 행 클릭 → S3. "Start reviewing"은 맨 위부터 연속 리뷰.
- 빈 상태: "You’re all caught up."

### S3. Video review (핵심 화면)

```
← Review queue   Week 04 — Chorus timing · Maya Chen          [V1] [V2●] [Compare]   Next →
┌───────────────────────────────────────────────┬─────────────────────────────┐
│                                               │ NOTES 3        All · Open   │
│  ✎ ○ ↗ ↶  (스케치 중일 때만)                  │ ┌ 00:18 · 3×8·5 TIMING ✎ ─┐ │
│              [ 영상 · dark ]                  │ │ Land on the beat…       │ │
│                                   ⇋ Mirrored  │ │ AL · from V1  Practicing│ │
│                                               │ └─────────────────────────┘ │
│                                               │ ┌ 00:42–00:48 PATHWAY ────┐ │
├───────────────────────────────────────────────┤ └─────────────────────────┘ │
│ 1×8 · 2×8 · 3×8 · 4×8 …   (카운트 눈금)        │                             │
│ ──●────◆━━━━━━──────────────────── 01:12      │ ┌ Note at 00:18.0 ────────┐ │
│ ▶  0.5×  ↻ Looping 00:42–00:48 ✕   00:18.0 ⇋ │ │ [▸ At 00:18][⟷ Range] ✎  │ │
│                         [N Note] [D Sketch]   │ │ Write… type @ to mention│ │
└───────────────────────────────────────────────┤ │            [Pin note ↵] │ │
                                                │ └─────────────────────────┘ │
                                                │ [Resolve R]  [Done reviewing]│
                                                └─────────────────────────────┘
```
- 데스크톱 2단(영상 1.5 : 노트 0.7), 태블릿·모바일은 영상 위·노트 아래.
- 로딩: 썸네일 + 노트 목록 먼저. 처리 중: "Processing your video… notes are ready below."
- 오류: "This video couldn’t be played." [Try again] [Ask dancer to re-upload]

### S4. 댄서 Today (모바일)

```
Hi Maya 👋
┌ Due Friday ─────────────────────┐
│ Week 04 — Chorus timing         │
│ 2 notes to practice · V1        │
│ [＋ Upload new version]          │
└─────────────────────────────────┘
New feedback
┌ 00:18 TIMING ✎ ──── Alex · 2h ┐
│ Land on the beat before…   ▶  │
└───────────────────────────────┘
Keep practicing
┌ 00:42–00:48 PATHWAY  ↻ 12 ────┐
└───────────────────────────────┘
```
- 빈 상태: "Nothing due right now. Your coach will send the next assignment here."

### S5. 댄서 노트 보기 + 연습 (모바일)

```
┌─────────────────────────┐
│ [   영상 (그 순간)     ] │  ← 상단 고정, 세로 영상이면 화면 60%
│ ✎ 스케치 오버레이        │
├─────────────────────────┤
│ ↻ Loop 00:16–00:20  0.5× ⇋│  ← 큰 토글 3개 (44px)
├─────────────────────────┤
│ 00:18 · TIMING · Alex   │
│ Land on the beat before │
│ the shoulder hits…      │
│ [ I’m on it ✓ ] [Reply] │  ← Practicing 표시
│ ────────────────────────│
│ ‹ Prev note   Next note ›│
│ [＋ Upload improved version]│
└─────────────────────────┘
```

### S6. 업로드 (모바일)

1. ＋ → **과제 선택** (마감 임박 순, 1개면 건너뜀)
2. 카메라 롤 → 영상 선택
3. 미리보기 + 트림(선택) + 한 줄 메모 → **Upload**
4. 상단 진행 바, "You can leave this screen." → 완료 푸시

### S7. 프로젝트 · Count sheet

```
Showcase 2026 / Count sheet          [Overview][Count sheet●][Board][Pages][Calendar]
Status In rehearsal · Show Nov 14 · Music 112 BPM (auto) · MC JS RK +9

 SECTION  COUNTS     FOCUS       REFERENCE   STATUS
 Intro    1–4 × 8    Pathway     ▶ 00:00     ✓ Clean
 Verse    5–12 × 8   Timing      ▶ 00:18     ● 2 open
 Chorus   13–20 × 8  Energy      ▶ 00:42     ◐ In review
 Bridge   21–24 × 8  Musicality  ▶ 01:03     ○ Not started
 [+ Add section]
```
- 음악 없음 상태: "Add the music to see notes in counts." [Add music] (건너뛸 수 있음)

### S8. Assignments board

`To submit 3 | In review 2 | Practicing 4 | Fixed 11` 4열. 카드는 댄서·버전·Open 노트 수. **드래그 없음** (상태는 행동으로만 변함, 카드 클릭 → S3).

### S9. Insights › Dashboard

랜딩 대시보드 목업과 동일한 구성: 상단 필터(그룹·기간·프로젝트) → KPI 4개 → 카테고리 누적 막대 + "Keeps coming up" → 댄서×주 히트맵.
- 데이터 부족(2주 미만): "Your dashboard fills in as your dancers submit. Check back after the first week." + 체크리스트.
- 동작 신호(Beta)는 별도 카드, 옵트인 전에는 설명 + [Learn more]만.

### S10. Recap (댄서) / Reports (코치)

- 랜딩 AI 리포트 카드와 동일한 컴포넌트.
- **댄서**: 상단에 기간 세그먼트 + 코치 필터 → [✦ Generate my recap] → shimmer → 결과. 결과 아래 "Share with coach".
- **코치**: Drafts · Sent · Schedule 탭. 초안 열기 → 문장 단위 편집(문장 호버 시 ✎ · 🗑) → [Send] / [Send all].
- 항상 표시: "AI summary of your coaches’ notes" + 각 문장 [n].

### S11. 댄서 프로필 (코치 화면)

```
MC Maya Chen  Dancer · Commercial Team · since Sep 2026     [✦ Generate report] [Message]
[Timeline●] [Notes] [Versions] [Reports]
Oct 22  V2 Week 04 — 2 notes resolved ✓
Oct 19  V1 Week 04 — 3 notes (Timing 2, Pathway 1)
Oct 12  …
Focus over time: Timing ▇▇▇▅▃▂  Musicality ▁▁▂▃▅
```

### S12. Settings

좌측 메뉴(Workspace · Members & roles · Notifications · Privacy & storage · AI & reports · Billing) + 우측 패널. 각 행: 제목 + 한 줄 설명 + 컨트롤. 위험 작업(삭제·해지)은 맨 아래 "Danger zone".

---

## 7. 인터랙션 & 단축키 (코치 데스크톱)

| 키 | 동작 | 키 | 동작 |
|---|---|---|---|
| `Space` | 재생/정지 | `N` | 현재 시점 노트 |
| `J` `K` `L` | 뒤로·정지·앞으로 | `D` | 스케치 |
| `←` `→` | 5초 이동 | `[` `]` | 구간 시작·끝 |
| `,` `.` | 프레임 이동 | `R` | 선택 노트 해결 |
| `M` | 거울모드 | `↑` `↓` | 이전·다음 노트 |
| `Esc` | 반복 해제 · 입력창 나가기 | `Shift+N` | 다음 제출 |
| `⌘K` | 명령 팔레트 | `?` | 단축키 도움말 |

모바일 제스처: 영상 더블탭 ±5초, 길게 누르기 0.5× 임시 재생, 노트 시트 위로 스와이프 펼치기.

---

## 8. 접근성 (WCAG 2.1 AA)

- 텍스트 대비 4.5:1 이상 (`--soft`는 본문 금지).
- 색만으로 정보 전달 금지: AI 레이블은 **색 + 글자**, 상태는 **아이콘 + 글자**, 순간·구간 노트는 **▸ · ⟷ 기호 + 시간**.
- 모든 기능 키보드로 가능, 포커스 링 항상 보임.
- 영상 컨트롤·토글에 `aria-pressed`, 탭에 `role="tab"`, 리포트 생성 결과는 `aria-live="polite"`.
- 음성 노트 자동 자막, 스케치에는 노트 본문이 대체 텍스트 역할.
- 모션 줄이기 설정 존중 (자동 재생·반짝임·shimmer 끔).
- 확대 200%에서 가로 스크롤 없음.

---

## 9. 다국어 디자인

- 영어 대비 텍스트 **+30%** 길이를 견디는 레이아웃 (독일어·스페인어). 버튼 고정 폭 금지.
- 날짜·시간은 사용자 지역 형식 (`Oct 26` / `10월 26일` / `26 oct`).
- 자동 번역된 노트에는 작은 "Translated · Show original" 표시.
- 아이콘에 문화권 의존 기호 사용 금지.

---

## 10. 현재 프로토타입에서 바꿀 것

| 항목 | 현재 | 변경 |
|---|---|---|
| 앱 글자 크기 | 8–11px 다수 | 본문 14, 메타 12 이상 |
| 사이드바 메뉴 | Home · Reviews · Groups · Inbox · Progress · Settings | Home · Inbox · Review queue · Projects · People · Insights · Settings |
| 댄서 화면 | 코치와 동일 | 하단 탭 별도 앱 (`/d`) |
| 노트 상태 | Open / Resolved | Open / Practicing / Resolved |
| 토큰 불일치 | `--muted` `#6b7280` vs `#7a818d` 등 | 3-1 표로 통일 |
| "Add note" | 고정 00:18에 임시 노트 | 현재 재생 시점 + 작성기 |
