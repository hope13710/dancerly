# 07. 백엔드 설정 (Supabase)

실제 앱(`/app`)은 Supabase 프로젝트 **looproom** (`egkwjdwfzuslyrhuzkmq`, 서울 리전)을 씁니다.
DB 스키마·권한·저장소는 `supabase/migrations/`에 있고 이미 적용되어 있습니다.

## 1. 지금 만들어진 것

| 영역 | 내용 |
|---|---|
| 인증 | 이메일 + 비밀번호. 가입 때 한 번만 이메일 인증(코드 또는 링크). 비밀번호 재설정. Google 버튼은 `GOOGLE_ENABLED`로 숨김 |
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

이 설정이 없으면 인증·재설정 링크를 눌렀을 때 Site URL 기본값(localhost)으로 이동합니다.

### ② Google 로그인 (선택)
**Authentication → Sign In / Providers → Google**을 켜고 Google Cloud의 OAuth Client ID·Secret을 넣습니다.
Google Cloud 쪽 승인된 리디렉션 URI: `https://egkwjdwfzuslyrhuzkmq.supabase.co/auth/v1/callback`
켠 뒤 `app/client.js`의 `GOOGLE_ENABLED`를 `true`로 바꾸면 버튼이 보입니다.

### ③ 이메일 발송 (출시 전 필수)
기본 메일 서버는 **시간당 발송 수가 아주 적고** 테스트용입니다. 출시 전에 **Authentication → Emails → SMTP Settings**에서 Resend·Postmark 같은 발송 서비스를 연결하세요.
**Email Templates**에서 아래 두 템플릿 본문에 코드 `{{ .Token }}`을 넣어야 앱 화면에서 코드로 인증할 수 있습니다(링크만 있으면 메일 앱 브라우저에서만 로그인되는 문제가 생김).
- **Confirm signup**: `<p>인증 코드: <b>{{ .Token }}</b></p>` + 기존 `{{ .ConfirmationURL }}` 링크
- **Reset Password**: `<p>재설정 코드: <b>{{ .Token }}</b></p>` + 기존 링크

**Sign In / Providers → Email**에서 *Confirm email*은 켜 둡니다(가입 시 1회 인증). 최소 비밀번호 길이는 8자로 맞추는 것을 권장합니다.

### ⑤ AI 리캡 켜기
리캡은 Edge Function `generate-recap`(이미 배포됨)이 Claude API(`claude-opus-5-5`)를 불러 만듭니다. 키를 넣어야 동작합니다.
1. https://console.anthropic.com 에서 API 키를 만듭니다.
2. Supabase → **Edge Functions → Secrets**(또는 Project Settings → Edge Functions)에 `ANTHROPIC_API_KEY` 이름으로 저장합니다.
3. 키가 없으면 앱에 "AI recaps aren’t switched on yet"이 나옵니다.

동작 방식: 요청한 사람의 권한으로 노트를 읽으므로(RLS) **볼 수 있는 노트만** 들어갑니다. 모든 문장은 노트를 인용해야 하고, 입력에 없는 노트를 인용한 문장은 서버에서 지웁니다. 새 노트가 없으면 이전 리캡을 다시 돌려줘 비용이 들지 않습니다. 안전 분류기가 거절하면 서버 측 fallback(`fallbacks: "default"`)이 다른 모델로 다시 시도합니다.

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
