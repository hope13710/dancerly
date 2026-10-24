# Looproom 서비스 기획 문서

> 댄스 코치와 댄서를 위한 영상 피드백 · 프로젝트 · 성장 기록 SaaS
> 기준: 현재 랜딩페이지(`index.html`), 워크스페이스 프로토타입(`/app`), [`product-plan.md`](product-plan.md)

## 문서 목록

| # | 문서 | 내용 | 주 독자 |
|---|---|---|---|
| 0 | [product-plan.md](product-plan.md) | 제품 전략: 핵심 기능 3가지, 해자, 출시 순서 | 창업팀 |
| 1 | [01-menu-structure.md](01-menu-structure.md) | **메뉴 구조도**: 랜딩·코치 웹·댄서 모바일, URL 맵, 역할별 메뉴 | 기획·디자인 |
| 2 | [02-service-structure.md](02-service-structure.md) | **서비스 구조도**: 개념 구조, 데이터 모델, 시스템 구성, 핵심 시퀀스 | 개발·기획 |
| 3 | [03-functional-spec.md](03-functional-spec.md) | **기능 정의서**: 기능 ID, 우선순위, 인수 조건, 예외 처리 | 개발·QA |
| 4 | [04-user-flows.md](04-user-flows.md) | **사용자 플로우**: 가입·초대·리뷰 루프·리포트 | 디자인·기획 |
| 5 | [05-ux-ui-design.md](05-ux-ui-design.md) | **UX/UI 디자인 문서**: 원칙, 디자인 토큰, 컴포넌트, 화면 설계 | 디자인·프론트엔드 |
| 6 | [06-policy.md](06-policy.md) | **정책서**: 권한, 요금제 한도, 데이터·개인정보, AI 정책 | 전원 |

읽는 순서: **README(용어) → 1 메뉴 → 2 구조 → 4 플로우 → 3 기능 → 5 디자인 → 6 정책**

---

## 용어 사전

화면 문구는 영어(글로벌 기본), 문서는 한국어로 쓴다. 아래 이름을 모든 화면·문서·코드에서 똑같이 쓴다.

| 개념 | 화면 표기 (EN) | 설명 | 예시 |
|---|---|---|---|
| 워크스페이스 | Workspace | 코치 또는 스튜디오의 공간. 결제 단위 | Alex Lee Studio |
| 프로젝트 | Project | 하나의 목표 단위 (수업·쇼케이스·대회) | Showcase 2026 |
| 그룹 | Group | 함께 배우는 댄서 묶음 | Commercial Team |
| 과제 | **Assignment** | 코치가 낸 "영상 올려줘" 요청. 마감일이 있음 | Week 04 — Chorus timing |
| 제출 | Submission | 한 댄서가 한 과제에 낸 영상 묶음 | Maya의 Week 04 제출 |
| 버전 | Version | 제출 안의 영상 한 개(테이크). V1, V2… | Version 2 |
| 노트 | Note | 영상의 한 순간·구간에 남긴 피드백 | 00:18 · TIMING |
| 스케치 | Sketch | 멈춘 프레임 위에 그린 표시. 노트에 붙음 | 팔꿈치 원 + 화살표 |
| AI 레이블 | AI label | AI가 노트 본문을 읽고 자동으로 붙이는 분류. **노트 작성 화면에는 없고** 리포트·대시보드에서만 보임 | Timing · Pathway · Energy · Musicality · Technique |
| 멘션 | Mention | 노트에서 `@이름`으로 **해당 프로젝트에 초대된 사람**을 부름. 그 사람에게 알림 | @Sora Kim |
| 구간 노트 | Range note | 시작~끝 두 지점을 지정한 노트. 그 구간만 반복 재생 가능 | 00:42–00:48 |
| 카운트 | Count | 8카운트 단위 위치 표기 | Verse 3×8, count 5 |
| 카운트 시트 | Count sheet | 작품을 구간·카운트로 나눈 표 | Intro 1–4×8 |
| 리뷰 대기열 | Review queue | 코치가 봐야 할 제출 목록 (모든 프로젝트 통합) | 8 to review |
| 교정 라이브러리 | Correction library | 코치가 자주 쓰는 노트 저장소 | "Land on the beat…" |
| 리캡 | **Recap** | 댄서가 직접 만드는 AI 요약 | Your recap · This week |
| 코치 리포트 | Coach report | 코치가 검토 후 보내는 AI 요약 | Weekly digest |
| 인사이트 | Insights | 대시보드 + 리포트 메뉴 | |

### 상태 이름

| 대상 | 상태 흐름 |
|---|---|
| 노트 | `Open` → `Practicing` → `Resolved` |
| 제출 (보드 컬럼) | `To submit` → `In review` → `Practicing` → `Fixed` |
| 과제 | `Draft` → `Active` → `Closed` |
| 영상 처리 | `Uploading` → `Processing` → `Ready` / `Failed` |
| 코치 리포트 | `Draft` → `Sent` |

---

## 사용성을 위해 바꾼 점

기존 랜딩·프로토타입·기획을 그대로 따르되, 아래는 **사용자가 더 쉽게 쓰도록** 바꿨다. 각 문서에 반영되어 있다.

| # | 기존 | 변경 | 이유 |
|---|---|---|---|
| 1 | "Review"가 과제와 리뷰 행위를 동시에 뜻함 | 요청은 **Assignment**, 행위는 **Review**로 분리 | 댄서는 "과제 마감"으로, 코치는 "리뷰할 것"으로 생각함. 한 단어 두 뜻은 혼란 |
| 2 | 코치 메뉴: Home · Reviews · Groups · Inbox · Progress · Settings | **Home · Inbox · Review queue · Projects · People · Insights · Settings** | 과제는 프로젝트 안에 있고, 매일 하는 일(리뷰 대기열)은 맨 위로. 진행 상황(Progress)과 AI 리포트를 Insights 한 곳에 |
| 3 | 댄서도 코치와 같은 사이드바 | 댄서는 **모바일 하단 탭**: Today · Feedback · ＋ · Recap · Me | 댄서 90%+가 휴대폰. 코치용 메뉴를 숨겨 3탭 안에 피드백 도달 |
| 4 | 가입 방식 미정 | 코치: 이메일 매직링크·Google·Apple(비밀번호 없음). 댄서: **초대 링크 + 이름만으로 시작**, 나중에 이메일로 계정 연결 | 댄서 이탈 지점 제거 |
| 5 | 노트 상태가 Open/Resolved 2단계 | **Open → Practicing → Resolved** | 댄서가 "연습 중"을 표시할 수 있어야 연습 신호가 쌓이고 코치가 진행을 앎 |
| 6 | BPM을 사용자가 입력 | **음원에서 BPM 자동 감지**, 고급 설정에서만 수정 | "왜 BPM이 있지?"라는 혼란 제거. 사용자는 카운트 표기만 보면 됨 |
| 7 | Musicality 등 카테고리 의미 설명 없음 | AI 레이블 칩에 **한 줄 설명 툴팁** | 처음 보는 사용자의 오해(보컬 기능?) 방지 |
| 8 | 생성 버튼이 화면마다 다름 | 전역 **＋ New** 버튼 + **⌘K 명령 팔레트** | 어디서든 과제·프로젝트·노트 생성 |
| 9 | Groups 메뉴 | **People** (Dancers / Groups / Coaches 탭) + **댄서 프로필**(성장 기록) | 코치는 "그룹"보다 "사람" 단위로 생각함. 댄서 프로필이 락인의 중심 |
| 10 | 설정이 한 화면 | **내 설정(Account)** 과 **워크스페이스 설정** 분리 | 댄서는 워크스페이스 설정을 볼 일이 없음 |
| 11 | 노트를 쓸 때 카테고리(Timing 등)를 직접 고름 | **레이블 없이 글만 쓰고, AI가 나중에 분류**해 리포트·대시보드에서만 표시. 틀리면 그 화면에서 고칠 수 있음 | 리뷰 중 가장 귀찮은 단계 제거. 리뷰 속도가 곧 리텐션 |
