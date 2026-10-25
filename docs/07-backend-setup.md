# 07. 백엔드 설정 (Supabase)

실제 앱(`/app`)은 Supabase 프로젝트 **looproom** (`egkwjdwfzuslyrhuzkmq`, 서울 리전)을 씁니다.
DB 스키마·권한·저장소는 `supabase/migrations/`에 있고 이미 적용되어 있습니다.

## 1. 지금 만들어진 것

| 영역 | 내용 |
|---|---|
| 인증 | 이메일 매직링크(비밀번호 없음), Google 로그인 버튼 |
| 테이블 | `profiles` · `projects` · `project_members`(owner/member) · `project_invites` · `videos` · `takes` · `notes` · `note_mentions` · `note_reactions` |
| 권한 | 모든 테이블 RLS. 초대받은 프로젝트만 보임. 노트 해결은 작성자·방장만, 연습 중 표시는 누구나 |
| 저장소 | 비공개 버킷 `takes` (MP4·MOV·WebM, 파일당 50MB). 같은 프로젝트 멤버만 재생 |
| 실시간 | 노트·👍 변경이 같은 영상을 보는 사람에게 바로 반영 |
| RPC | `accept_invite`, `invite_preview`, `set_note_status` |

## 2. 대시보드에서 직접 해야 하는 설정

API로는 바꿀 수 없어서 [Supabase 대시보드](https://supabase.com/dashboard/project/egkwjdwfzuslyrhuzkmq)에서 해야 합니다.

### ① 로그인 후 돌아올 주소 (필수)
**Authentication → URL Configuration**
- **Site URL**: 배포 주소 (예: `https://looproom.vercel.app`)
- **Redirect URLs**에 추가:
  - `https://<배포 주소>/app/**`
  - `http://localhost:3000/app/**` (로컬 개발용)

이 설정이 없으면 매직링크를 눌렀을 때 Site URL 기본값(localhost)으로 이동합니다.

### ② Google 로그인 (선택)
**Authentication → Sign In / Providers → Google**을 켜고 Google Cloud의 OAuth Client ID·Secret을 넣습니다.
Google Cloud 쪽 승인된 리디렉션 URI: `https://egkwjdwfzuslyrhuzkmq.supabase.co/auth/v1/callback`
켜기 전에는 "Continue with Google"을 누르면 오류 안내가 나옵니다.

### ③ 이메일 발송 (출시 전 필수)
기본 메일 서버는 **시간당 발송 수가 아주 적고** 테스트용입니다. 출시 전에 **Authentication → Emails → SMTP Settings**에서 Resend·Postmark 같은 발송 서비스를 연결하세요.
메일 문구는 **Email Templates → Magic Link**에서 바꿀 수 있습니다.

### ④ 파일 크기 (요금제)
무료 플랜은 파일당 최대 50MB라 버킷도 50MB로 맞췄습니다. Pro 플랜으로 올리면 `storage.buckets`의 `file_size_limit`을 늘리고, 이어올리기(tus) 업로드로 바꾸는 것을 권장합니다.

## 3. 로컬 실행

```bash
npm start            # http://localhost:3000
# /         랜딩
# /app      실제 앱 (로그인 필요)
# /demo     가짜 데이터 프로토타입
```

## 4. 다음 단계

- 이어올리기 업로드(tus) + 업로드 진행률
- 영상 변환(HLS)·썸네일 — 지금은 원본 파일을 서명된 URL로 재생
- 멘션 알림(이메일·푸시), Inbox
- AI 리캡: Edge Function + LLM API 키 (서버에만 저장)
- 스케치 저장, Private take, 결제(Stripe)
