# 01. 메뉴 구조도 (Information Architecture)

> 용어는 [README 용어 사전](README.md#용어-사전)을 따른다.

## 1. 전체 서비스 맵

```mermaid
flowchart LR
  V([방문자]) --> L[랜딩페이지 /]
  L -->|Start free| SU[가입 /signup]
  L -->|Log in| LI[로그인 /login]
  SU --> OB[팀 만들기 /welcome]
  OB --> APP[웹 앱 /app]
  LI --> APP

  INV([초대받은 팀원·코치]) -->|초대 링크 /join/:code| JN[이름 입력]
  JN --> APP

  APP --> DESK[데스크톱: 사이드바]
  APP --> MOB[휴대폰: 하단 탭]

  APP -. 노트·멘션·새 테이크 알림 .-> EM[(이메일·푸시)]
  EM -. 딥링크: 노트의 그 순간 .-> APP

  APP -->|공유 링크| SH[게스트 보기 /s/:token]
  G([학부모·심사위원]) --> SH
```

| 영역 | 사용자 | 기기 | 형태 |
|---|---|---|---|
| 랜딩페이지 | 방문자 | 전체 | 정적 사이트 |
| 웹 앱 (데스크톱) | **모든 사람** (Owner · Member) | 노트북 | 사이드바. 리허설 영상을 크게 보며 노트 작성 |
| 웹 앱 (모바일) | **모든 역할** | 휴대폰 | 하단 탭 (PWA, 앱 설치 불필요). 멤버 대부분이 여기서 사용 |
| 게스트 보기 | Guest | 전체 | 읽기 전용 단일 화면 |

> 코치 앱과 댄서 앱을 나누지 않는다. **팀원 모두가 같은 앱**에서 피드백을 주고받고, 역할에 따라 관리 메뉴만 더 보인다.
> 한 사람이 여러 역할일 수 있다. 예: 코치이면서 다른 코치에게 배우는 댄서.
> 상단 계정 메뉴의 **역할·워크스페이스 전환**으로 이동한다.

---

## 2. 랜딩페이지 구조 (`/`)

### 2-1. 헤더

| 메뉴 | 이동 | 비고 |
|---|---|---|
| 로고 | `#top` | |
| How it works | `#workflow` | |
| Platform | `#projects` | 프로젝트·대시보드·AI 리포트 묶음의 시작 |
| Why Looproom | `#compare` | |
| Pricing | `#pricing` | |
| FAQ | `#faq` | |
| Log in | `/login` | 현재는 `/app` 데모로 연결 |
| **Start free** | `#signup` | 주 CTA |

모바일: 햄버거 메뉴 + **스크롤해도 고정되는 헤더** + 히어로를 지나면 하단 고정 CTA.

### 2-2. 섹션 순서

```mermaid
flowchart TB
  H[Hero · 25초 제품 데모] --> S[For the people behind the performance]
  S --> P[Problem · Chat messages lose the moment]
  P --> W[How it works · 4단계 루프]
  W --> C[Why switch · 비교표]
  C --> F[For coaches · 스케치 피드백]
  F --> PR[Platform ① Projects]
  PR --> D[Platform ② Progress dashboard]
  D --> AI[Platform ③ AI reports · 댄서/코치 전환]
  AI --> M[Gets better the longer you coach]
  M --> T[Private by default]
  T --> PC[Pricing]
  PC --> FS[What happens after you sign up]
  FS --> Q[FAQ]
  Q --> SG[Sign up]
  SG --> FT[Footer]
```

| # | 섹션 | 앵커 | 목적 | CTA |
|---|---|---|---|---|
| 1 | Hero | `#top` | 3초 안에 가치 전달, 데모로 사용 장면 보여주기 | Review your first video free / Watch the demo |
| 2 | Audience strip | — | 대상 고객 명시 | — |
| 3 | Problem | `#problem` | 공감 | — |
| 4 | How it works | `#workflow` | 핵심 루프 이해 | — |
| 5 | Why switch | `#compare` | 기존 도구와 비교 | — |
| 6 | For coaches | `#features` | 스케치·노트 | Explore the coach workspace |
| 7 | Projects | `#projects` | 시즌 단위 관리 | — |
| 8 | Progress dashboard | `#dashboard` | 데이터 가치 | — |
| 9 | AI recaps | `#ai-reports` | Just me / Whole project 리캡 | — |
| 10 | Memory | `#memory` | 쓸수록 좋아지는 이유 (락인) | — |
| 11 | Trust | — | 개인정보·보안 | — |
| 12 | Pricing | `#pricing` | Free · Team · Studio 대기 | Start free |
| 13 | First session | `#first-session` | 가입 후 4단계 안내 (마찰 감소) | — |
| 14 | FAQ | `#faq` | 반론 처리 | — |
| 15 | Sign up | `#signup` | 이메일 가입 | Review your first video free |

### 2-3. 추가로 필요한 페이지

| 페이지 | URL | 상태 |
|---|---|---|
| 개인정보처리방침 | `/privacy` | **필요** (현재 푸터 링크가 `#signup`으로 연결됨) |
| 이용약관 | `/terms` | **필요** |
| 보안·데이터 안내 | `/security` | Phase 2 |
| 도움말 센터 | `/help` | Phase 2 |
| 언어 선택 | `/ko`, `/ja`, `/es` | Phase 3 |

---

## 3. 웹 앱 — 데스크톱 (`/app`)

### 3-1. 메뉴 트리

```mermaid
flowchart LR
  APP((웹 앱 데스크톱)) --> HOME[Home]
  APP --> INBOX[Inbox]
  APP --> RQ[Review queue]
  APP --> PJ[Projects]
  APP --> PP[People]
  APP --> IN[Insights]
  APP --> ST[Settings]

  HOME --> H0[✦ 최근 리캡 카드]
  HOME --> H1[오늘 할 일]
  HOME --> H2[시작 체크리스트]
  HOME --> H3[최근 활동]

  INBOX --> I1[All]
  INBOX --> I2[Mentions]
  INBOX --> I3[Submissions]

  RQ --> R1[Needs review]
  RQ --> R2[Re-submitted]
  RQ --> R3[Overdue]
  RQ --> RV[[Video review 화면]]

  PJ --> PX[프로젝트 목록]
  PX --> P1[Overview]
  PX --> P2[Count sheet]
  PX --> P3[Assignments board]
  PX --> P6[✦ Recaps]
  PX --> P4[Pages]
  PX --> P5[Calendar]
  P6 --> RL[[Shared · Mine · 📌 Pinned]]
  P3 --> AS[Assignment 상세]
  AS --> RV

  PP --> D1[Members]
  PP --> D2[Groups]
  D1 --> DP[멤버 프로필]

  IN --> N1[Dashboard]
  ME2[내 프로필] --> MR[My recaps<br/>모든 프로젝트]
  APP --> ME2
  IN --> N3[Note library]

  ST --> S1[Workspace]
  ST --> S2[Members & roles]
  ST --> S3[Notifications]
  ST --> S4[Privacy & storage]
  ST --> S5[AI & recaps]
  ST --> S6[Billing]
```

### 3-2. 메뉴 상세

| 1단계 | 2단계 | 3단계 / 탭 | 설명 |
|---|---|---|---|
| **Home** | 오늘 할 일 | | 아직 안 본 새 테이크, 나에게 온·멘션된 노트, 마감 과제 |
| | 시작 체크리스트 | | 첫 주에만 표시: 팀 공간 · 첫 리허설 영상 · 첫 노트 · 팀원 초대 |
| | 최근 활동 | | 제출·답글·해결 기록 |
| **Inbox** | All · Mentions · Submissions | | 알림 모음. 읽음/안 읽음 |
| **Review queue** | New takes · Mentions me · Overdue | | 내가 속한 프로젝트의 새 테이크를 한 줄로. 여기서 바로 리뷰 화면으로 |
| | → **Video review** | Notes · Versions · Compare | 플레이어 + 노트·스케치 + 버전 비교 |
| **Projects** | 프로젝트 목록 | | 카드 목록, ＋ New from template |
| | 프로젝트 상세 | Overview | 목표, 일정, 참여 멤버, 음악 |
| | | Count sheet | 구간 × 카운트 × 포커스 × 기준 영상 × 상태 |
| | | Assignments board | To submit → In review → Practicing → Fixed |
| | | Pages | 자유 문서 (블록 에디터, @링크) |
| | | **Recaps** | ✦ 이 프로젝트의 AI 리캡 **본거지**. 새 리캡 만들기, Shared · Mine · 📌 Pinned 필터, 기간별 목록, 이전 버전 펼치기 |
| | | Calendar | 리허설·마감 |
| | → Assignment 상세 | Submissions · Brief · Settings | 과제 설명, 제출 현황 |
| **People** | Members | | 멤버 목록 → **멤버 프로필**(테이크·받은 노트·해결 기록, 리캡 생성) |
| | Groups | | 그룹 목록, 초대 링크 |
| **Insights** | Dashboard | Project · Member · AI label | 연습 신호 · 피드백 신호 · 동작 신호(Beta) |
| | Note library | | 팀이 자주 쓰는 노트, AI 레이블 이름 관리 |
| **Settings** | Workspace | | 이름, 로고, 언어, 시간대 |
| | Members | | 초대·내보내기, Owner 넘기기 (Owner만) |
| | Notifications | | 워크스페이스 기본 알림 |
| | Privacy & storage | | 보관 기간, 공유 링크 허용, 동작 분석(Beta) 허용 |
| | AI & recaps | | 주간 자동 리캡, 자동 번역, AI 학습 옵트인 (Owner만) |
| | Billing | | 플랜, 결제 수단, 영수증 |

### 3-3. 전역 요소 (모든 화면)

| 요소 | 위치 | 기능 |
|---|---|---|
| 워크스페이스 전환 | 사이드바 상단 | 여러 워크스페이스·역할 이동 |
| **＋ New** | 사이드바 상단 | Assignment · Project · Note · Invite |
| 검색 / **⌘K** | 헤더 | 사람·프로젝트·과제·노트 검색, 명령 실행 |
| 알림 벨 | 헤더 | Inbox 미리보기 |
| 계정 메뉴 | 사이드바 하단 | Account settings, 언어, 도움말, 로그아웃 |

---

## 4. 웹 앱 — 모바일 하단 탭 (`/app`, 휴대폰)

### 4-1. 메뉴 트리

```mermaid
flowchart LR
  DA((웹 앱 모바일)) --> T[Today]
  DA --> FB[Feedback]
  DA --> UP[＋ Upload]
  DA --> PJ[Projects]
  DA --> ME[Me]

  T --> T0[✦ 최근 리캡 · Generate for next rehearsal]
  T --> T1[할 일 · 마감 과제]
  T --> T2[새 피드백]
  FB --> F1[For me · 나에게 온 노트]
  FB --> F2[By me · 내가 쓴 노트]
  FB --> F3[Team · 프로젝트 전체 노트]
  FB --> PV[[노트 보기 · 루프 · 거울모드]]
  UP --> U1[과제 선택]
  U1 --> U2[영상 선택 · 업로드]
  PJ --> P1m[프로젝트 → Takes · Notes · ✦ Recaps]
  ME --> M1[내 성장 기록]
  ME --> M2[My recaps · 📌 고정 포함]
  ME --> M3[Account settings]
```

### 4-2. 하단 탭

| 탭 | 아이콘 | 내용 | 배지 |
|---|---|---|---|
| **Today** | ⌂ | **✦ 최근 리캡 카드**(없으면 "Generate for next rehearsal"), 새 테이크, 나에게 온 노트, 마감 과제 | — |
| **Feedback** | ◫ | For me(나에게 온·멘션된 노트) · By me(내가 쓴 노트, 해결 처리) · Team(프로젝트 전체) | 새 노트 수 |
| **＋** | 가운데 큰 버튼 | 영상 올리기 (프로젝트·과제 선택 → 카메라 롤) | — |
| **Projects** | ◇ | 내 프로젝트 → 테이크·노트·**Recaps 탭** | — |
| **Me** | ○ | 성장 기록, **My recaps**(모든 프로젝트, 📌 고정 먼저), 계정 | — |

> 원칙: 알림·초대 링크를 누르면 **해당 노트의 그 순간**으로 바로 열린다 (3탭 이내 규칙).

---

## 5. 게스트 보기 (`/s/:token`)

| 화면 | 내용 | 권한 |
|---|---|---|
| 공유된 영상 | 영상 + 코치가 공개를 허용한 노트 | 보기만, 다운로드 불가 |
| 공유된 리포트 | 월간 성장 리포트 (학부모용) | 보기만, PDF 저장 |

링크는 만료일이 있고 코치가 언제든 해제할 수 있다.

---

## 6. URL 맵

| URL | 화면 | 접근 |
|---|---|---|
| `/` | 랜딩 | 전체 |
| `/signup`, `/login` | 가입·로그인 | 전체 |
| `/welcome` | 코치 온보딩 | 신규 코치 |
| `/join/:inviteCode` | 초대 수락 | 초대받은 사람 |
| `/app` | Home (데스크톱) · Today (모바일) | 모든 멤버 |
| `/app/inbox` | Inbox | 〃 |
| `/app/queue` | Review queue | 〃 |
| `/app/review/:submissionId?v=2&t=18.0&note=:id` | Video review | 〃 |
| `/app/projects` | 프로젝트 목록 | 〃 |
| `/app/projects/:id/(overview\|counts\|board\|pages\|calendar)` | 프로젝트 상세 | 〃 |
| `/app/assignments/:id` | 과제 상세 | 〃 |
| `/app/people/(dancers\|groups\|coaches)` | People | 〃 |
| `/app/people/dancers/:id` | 댄서 프로필 | 〃 |
| `/app/insights/(dashboard\|library)` | Insights | 모든 멤버 |
| `/app/projects/:id/recaps` | 프로젝트 Recaps 탭 | 프로젝트 멤버 |
| `/app/recaps/:recapId` | 리캡 한 장 (공유·딥링크용) | 볼 권한이 있는 사람 |
| `/app/settings/:section` | 팀 공간·프로젝트 설정 | Owner |
| `/app/feedback/:noteId` | 노트의 그 순간 (모바일·데스크톱 공통) | 프로젝트 멤버 |
| `/app/upload?project=:id` | 업로드 | 프로젝트 멤버 |
| `/app/me/recaps` | My recaps (모든 프로젝트) | 본인 |
| `/account` | 내 계정 설정 (공통) | 로그인 사용자 |
| `/s/:token` | 게스트 보기 | 링크 소지자 |

> 영상 URL에는 항상 `t`(초)와 `note`를 넣을 수 있어 **그 순간을 공유**할 수 있다.

---

## 7. 역할별 메뉴 노출

역할은 Owner(방장)와 Member 둘뿐이다. **메뉴는 똑같고, Owner에게만 관리 항목이 더 보인다.**

| 메뉴 | Owner | Member | Guest |
|---|---|---|---|
| Home / Today | ✓ | ✓ | — |
| Inbox | ✓ | ✓ (모바일은 Today에 통합) | — |
| Review queue | ✓ | ✓ | — |
| Projects | ✓ + 설정·보관·삭제 | ✓ 초대받은 프로젝트 | — |
| People | ✓ + 내보내기·Owner 넘기기 | ✓ 보기 | — |
| Insights › Dashboard | ✓ | ✓ | — |
| Project › Recaps | ✓ | ✓ | 공유 링크로 받은 리캡만 |
| Me › My recaps | ✓ | ✓ | — |
| Note library | ✓ | ✓ | — |
| Settings › Team·Members·Billing·AI | ✓ | — | — |
| Account settings | ✓ | ✓ | — |

---

## 8. AI 리캡이 보이는 곳

리캡은 **프로젝트에 저장**되고, 입구만 세 곳이다. 세 곳 모두 같은 카드·같은 데이터.

| 입구 | 보이는 것 | 목적 |
|---|---|---|
| Home / Today 맨 위 카드 | 가장 최근 리캡 1장, 없으면 [✦ Generate for next rehearsal] | 리허설 직전, 메뉴를 찾지 않고 바로 |
| 프로젝트 › **Recaps** 탭 (본거지) | 그 프로젝트의 모든 리캡: Shared · Mine · 📌 Pinned, 기간별 | 만들기·모아 보기·공유 |
| Me › **My recaps** | 내가 만든 리캡 전체 (모든 프로젝트) | 여러 팀에 속한 사람의 개인 기록 |

별도 Insights › Recaps 메뉴는 두지 않는다.

## 9. 내비게이션 규칙

1. **최대 깊이 3단계**. 4단계가 필요하면 탭으로 푼다. (Projects › Showcase 2026 › Board)
2. **브레드크럼**은 데스크톱 헤더에 항상 표시. 모바일은 ← 뒤로 + 현재 화면 이름.
3. **뒤로 가기**는 이전 화면 상태(필터, 스크롤 위치, 재생 위치)를 보존한다.
4. **딥링크 우선**: 알림·이메일·공유 링크는 목록이 아니라 **해당 노트의 해당 순간**으로 연다.
5. **빈 화면 금지**: 모든 목록의 첫 상태에는 다음 행동 버튼과 샘플이 있다. (05 문서 참고)
6. 리뷰 화면은 **어디서 들어왔는지에 따라 다음 항목**으로 넘어간다. (대기열에서 열면 "다음 제출 →")
