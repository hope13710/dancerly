# 04. 사용자 플로우

## 1. 페르소나

| | **Alex Lee** · 코치 | **Maya Chen** · 댄서 | **Jin Park** · 스튜디오 원장 |
|---|---|---|---|
| 상황 | 온라인·오프라인 코칭, 그룹 3개, 댄서 30명 | 17세, 커머셜 팀 소속, 코치 2명에게 배움 | 강사 5명, 수강생 120명 |
| 기기 | 노트북으로 리뷰, 휴대폰으로 확인 | **휴대폰만** | 노트북 |
| 지금 쓰는 것 | 단톡방 + 구글 드라이브 + 음성 메시지 | 단톡방, 카메라 롤 | 단톡방, 엑셀 출석부 |
| 불편 | 같은 말 반복, 어느 8카운트인지 설명 어려움 | 피드백이 채팅에 묻힘, 어디를 고치라는지 모름 | 강사별 피드백 품질 차이, 학부모에게 성장 보여주기 어려움 |
| Looproom에서 원하는 것 | 리뷰 시간 단축, 고쳐졌는지 확인 | 정확히 어디를 어떻게, 수업 전 정리 | 스튜디오 전체 현황, 학부모 리포트 |
| 결제 | Coach 플랜 | 무료 (코치 플랜에 포함) | Studio 플랜 |

## 2. 활성화 기준 (Aha moment)

| 사용자 | 활성화 정의 | 목표 시간 |
|---|---|---|
| 코치 | **첫 노트를 남기고 댄서 1명 이상 초대** | 가입 후 10분 이내 |
| 댄서 | **노트를 눌러 그 순간을 재생** | 초대 링크 클릭 후 30초 이내 |
| 리텐션 신호 | 2주 연속 과제 1개 이상 + 해결 노트 1개 이상 | 가입 후 14일 |

---

## F1. 방문자 → 코치 가입 → 첫 노트

```mermaid
flowchart TD
  A[랜딩 방문] --> B{CTA 클릭}
  B -->|Review your first video free| C[이메일 입력]
  B -->|Watch the demo| A
  C --> D[매직링크 메일]
  D --> E[링크 클릭 → 로그인]
  E --> F[웰컴 3문항<br/>코칭 형태 · 댄서 수 · 장르]
  F --> G[샘플 리허설 리뷰가 열린 상태]
  G --> H[코치마크: 영상 멈추고 N]
  H --> I[첫 노트 작성<br/>글만 쓰면 됨 · 레이블 없음]
  I --> J[🎉 Your first note is pinned]
  J --> K{다음 단계}
  K -->|Upload your own video| L[업로드]
  K -->|Invite your dancers| M[초대 링크 복사·공유]
  L --> N[Home · 시작 체크리스트]
  M --> N
```

| 단계 | 화면 | 핵심 문구 | 이탈 방지 |
|---|---|---|---|
| C | 가입 폼 | "Review your first video free" | 이메일 1칸, 카드 없음 |
| D | 메일 대기 | "Check your inbox — the link works for 15 minutes." | 메일 재전송, Google로 계속 |
| F | 웰컴 | "Tell us how you coach" | 건너뛰기 가능 |
| G | 샘플 리뷰 | "This is a sample rehearsal. Try pinning a note." | 빈 화면 없음 |
| J | 축하 | "That’s the loop: pin it, they practice it, you check the next take." | 다음 행동 2개만 |

---

## F2. 댄서 초대 수락 → 첫 피드백

```mermaid
flowchart TD
  A[코치가 보낸 링크<br/>메신저·문자] --> B["/join/:code"]
  B --> C{이 기기에서 처음?}
  C -->|예| D[이름 입력<br/>연령 확인]
  D --> E{보호자 동의 필요?}
  E -->|예| F[보호자 이메일 → 동의 대기<br/>그동안 과제 설명만 보기]
  E -->|아니오| G
  C -->|아니오| G[Today]
  F -->|동의 완료| G
  G --> H{노트가 있나?}
  H -->|있음| I[노트 카드 탭 → 그 순간 재생]
  H -->|없음| J[마감 과제 → ＋ 영상 올리기]
  I --> K[코치마크: 루프 · 거울모드 · Practicing]
  K --> L[알림 허용 요청<br/>'새 피드백이 오면 알려드릴까요?']
```

**설계 포인트**
- 이메일·비밀번호를 처음에 묻지 않는다. 다른 기기에서 쓰고 싶을 때 "Save your progress"로 이메일을 연결한다.
- 알림 권한은 **가치를 경험한 뒤**(첫 노트 열람 후)에 묻는다.

---

## F3. 과제 → 제출 → 리뷰 (코치 루프)

```mermaid
flowchart TD
  A[＋ New → Assignment] --> B[제목 · 대상 그룹 · 마감 · 기준 영상]
  B --> C[Publish → 댄서에게 알림]
  C --> D[댄서 제출]
  D --> E[Review queue에 추가]
  E --> F[리뷰 화면 열기]
  F --> G[재생 · 멈춤 N · 노트 · D 스케치]
  G --> H{더 볼 것?}
  H -->|예| G
  H -->|아니오| I[Done reviewing]
  I --> J[댄서에게 노트 묶음 알림 1회]
  J --> K[Next submission →]
  K --> F
```

- 노트를 하나 남길 때마다 알림을 보내지 않는다. **"Done reviewing"을 누르거나 10분간 입력이 없으면** 한 번에 보낸다.
- 대기열에서 열었으면 리뷰를 마친 뒤 바로 다음 제출로 넘어간다.

---

## F4. 댄서 연습 루프

```mermaid
flowchart TD
  A[알림: New feedback from Alex] --> B[노트의 그 순간으로 열림]
  B --> C[구간 자동 루프 · 0.5×]
  C --> D{거울모드?}
  D -->|M / ⇋| E[좌우 반전]
  D --> F[따라 연습]
  E --> F
  F --> G[Practicing 표시 · 답글 'Got it']
  G --> H[다시 촬영]
  H --> I[Upload improved version]
  I --> J[V2 업로드 → 코치 대기열]
```

---

## F5. 해결과 보드 상태 (자동)

```mermaid
stateDiagram-v2
  [*] --> ToSubmit: 과제 배정
  ToSubmit --> InReview: 댄서가 영상 제출
  InReview --> Practicing: 코치가 노트 남김 (Done reviewing)
  InReview --> Fixed: 노트 없이 승인
  Practicing --> InReview: 새 버전 제출
  Practicing --> Fixed: 모든 노트 Resolved
  Fixed --> [*]
```

| 노트 상태 | 누가 바꾸나 | 계기 |
|---|---|---|
| Open | 시스템 | 노트 작성 |
| Practicing | 댄서 | "I’m on it" 버튼, 또는 리캡 체크리스트 체크 |
| Resolved | 코치 | 새 버전에서 확인 후 Resolve (`R`) |

---

## F6. 댄서 리캡 생성

```mermaid
flowchart TD
  A[Recap 탭] --> B[기간: Last class · This week · This month · Custom]
  B --> C[필터: 모든 코치 / 특정 코치·프로젝트]
  C --> D{기간 내 노트 있음?}
  D -->|없음| E['No notes from your coaches in this period yet.']
  D -->|있음| F{이전 결과가 최신?}
  F -->|예| G[저장된 리캡 즉시 표시]
  F -->|아니오| H[✦ Reading 9 notes… shimmer]
  H --> I[스트리밍으로 문장 표시]
  I --> G
  G --> J[문장의 n 탭 → 노트 카드 → 그 순간 재생]
  G --> K[할 일 체크 → 노트 Practicing]
  G --> L[Share with coach]
```

---

## F7. 코치 주간 리포트 (검토 후 발송)

```mermaid
flowchart TD
  A[매주 일요일 18:00 현지 시간<br/>예약 생성] --> B[Insights › Reports › Drafts]
  B --> C[Inbox 알림: 12 weekly reports ready to review]
  C --> D[리포트 열기]
  D --> E{수정?}
  E -->|문장 편집·삭제| F[저장]
  E -->|그대로| G
  F --> G[Send / Send all]
  G --> H[댄서 언어로 번역 → 푸시·이메일]
  H --> I[열람·체크리스트 완료 → 대시보드]
```

옵션: 4주 연속 수정 없이 보냈다면 "Send automatically from now on?" 제안.

---

## F8. 프로젝트 만들기

```mermaid
flowchart TD
  A[Projects → ＋ New from template] --> B[템플릿 선택<br/>Showcase · Weekly class · Competition · Audition · 1:1]
  B --> C[제목 · 공연일 · 그룹]
  C --> D{음악이 있나?}
  D -->|음원·기준 영상 업로드| E[BPM·첫 박 자동 감지]
  E --> F[Count sheet 초안: 구간 자동 분할 제안]
  D -->|나중에| G
  F --> G[프로젝트 Overview]
  G --> H[첫 과제 만들기 제안]
```

---

## F9. 업그레이드 (한도 도달)

```mermaid
flowchart TD
  A[Free: 6번째 댄서 초대 시도] --> B[안내 시트<br/>'Your free plan includes 5 dancers.']
  B --> C{선택}
  C -->|Start 14-day Coach trial| D[카드 없이 체험 시작]
  C -->|Upgrade| E[Stripe Checkout]
  C -->|Not now| F[초대 보류 · 기존 데이터 유지]
  D --> G[초대 완료]
  E --> G
```

원칙: 한도는 **새로 만드는 것만** 막는다. 이미 있는 영상·노트·리포트는 절대 막지 않는다.

---

## F10. 내 데이터 내보내기·삭제

```mermaid
flowchart TD
  A[Account / Settings › Privacy] --> B{무엇을?}
  B -->|Export| C[ZIP 생성 요청 → 메일로 링크 · 7일 유효]
  B -->|Delete a video| D[확인 모달: 노트·스케치도 삭제됨]
  B -->|Delete account| E[확인 문구 입력 → 30일 유예 → 완전 삭제]
  D --> F[즉시 재생 불가 · 30일 내 저장소에서 삭제]
```

---

## 3. 감정 곡선 (코치 첫 2주)

| 시점 | 행동 | 감정 | 설계 대응 |
|---|---|---|---|
| 가입 직후 | 샘플 리뷰에 노트 | 😮 "이거 빠르네" | 샘플·코치마크 |
| 첫날 | 댄서 초대 | 😟 "애들이 가입할까?" | 이름만으로 참여, 초대 문구 템플릿 |
| 2~3일 | 첫 제출 리뷰 | 🙂 | 대기열 + Next submission |
| 1주 | 첫 해결 | 😊 "진짜 고쳤네" | 해결 축하, 대시보드 첫 데이터 |
| 2주 | 첫 주간 리포트 | 😍 "이걸 내가 안 썼는데" | 출처 인용으로 신뢰 |
