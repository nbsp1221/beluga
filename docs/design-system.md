---
status: current
owner: maintainers
last_reviewed: 2026-11-08
---

# 디자인 시스템

이 문서는 현재 UI 규칙과 승인된 확장의 단일 관리 위치다. [확장 결정](decisions/0002-design-system-extension-policy.md)은 이유와 대안을, [아키텍처](architecture.md)는 데이터·서비스 수명을 설명한다. 기존 구현의 존재 자체를 승인 근거로 삼지 않는다.

## 기본 요소와 테마

[설정](../packages/ui/components.json)은 shadcn `base-nova`, Base UI, CSS 변수, Lucide를 사용한다. [globals.css](../packages/ui/src/styles/globals.css)가 테마 값·모바일 target·기본 접근성 규칙을 소유한다.

[웹 스타일 진입점](../apps/web/src/index.css)은 앱과 Client의 Tailwind 소스를 등록한다. 공용 UI 스타일은 UI 컴포넌트와 Streamdown의 소스를 등록한다.

라이트와 다크 모두 Neutral 표면에 Blue primary/ring을 사용한다. primary-foreground는 해당 표면의 텍스트 역할이고 sidebar-primary/foreground/ring은 대응 토큰을 따른다. 메뉴 hover·선택과 sidebar 선택은 중립 accent 역할을 유지한다. 테마 변경은 기존 `:root`/`.dark` 선언의 의미별 값을 수정하며 기능 코드의 blue/gray 클래스나 덧붙인 테마 패치로 적용하지 않는다.

색 선언은 OKLCH로 관리한다. 과거 HEX→OKLCH hover 혼합에서 관찰된 색 틀어짐의 재발을 확인하되 모든 브라우저의 결함이라고 일반화하지 않는다. 기본 hover 공식을 바꾸는 것으로 숨기지 않는다.

현재 light primary는 blue-700/흰 글자, dark primary는 blue-400/neutral-950 글자다. light의 blue-600 후보는 공식 `primary/80` hover를 흰 배경에 합성했을 때 일반 글자 대비 4.5:1을 유지하지 못해 더 어두운 값을 선택했다. 색을 바꿀 때 기본 상태뿐 아니라 실제 배경 위 hover 대비도 다시 확인한다. 이는 기존 선택의 이유이며 이번 문서 검수에서 대비를 재측정했다는 뜻은 아니다.

선택 역할을 모두 primary로 바꾸지 않는다. line Tabs의 선택 글자·밑줄은 foreground, Select 옵션의 highlight는 accent/foreground, 표준 Select의 다크 표면은 input 역할을 쓴다. Input·Textarea·InputGroup은 버튼·탭·Select와 함께 공식 포커스 스타일을 사용한다.

일반 본문·메뉴는 `text-sm`, 보조 텍스트는 `text-xs`, 입력은 공식 `text-base md:text-sm`, 데스크톱 시작 제목은 `text-2xl/leading-8`을 사용한다. 새 글꼴 크기·간격 토큰이나 DSH 전용 namespace를 추가하지 않는다. 폰트·반경·간격의 실제 값은 소스가 기준이다.

## 컴포넌트 선택

아래 Tailwind 크기의 px 환산은 기본 16px root와 기본 spacing을 전제로 한다. `columns.ts`의 숫자처럼 CSS px로 직접 계산하는 열 정책과 rem 기반 컴포넌트 크기를 구분한다. 공통 조합은 실제 두 곳 이상의 소비가 있을 때 추출하며, 같은 flex/padding 클래스만으로 기능 상태까지 묶지 않는다.

공식 props와 조합을 먼저 사용한다. [Button](../packages/ui/src/components/button.tsx)의 default 선택기는 데스크톱에서 32px 높이, 14px 글자, 16px 아이콘, 6px 간격이다. Nova sm의 0.8rem을 14px로 강제하는 소스 수정은 하지 않는다. FieldLabel의 `leading-snug`에 따른 소수점 줄 높이는 임의 글꼴 토큰이 아니다.

데스크톱 도구의 icon-sm은 28px, 레일의 icon-lg와 새 세션 lg는 36px, PaneHeader는 min-h-10이다. 워크스페이스 FieldLabel은 공식 14px/medium/leading-snug이며 데스크톱 입력 높이 32px와 label 간격 8px 조합을 유지한다. 모바일 입력은 아래 공통 target 규칙을 적용한다.

Message/MessageContent, muted Bubble, Attachment의 xs 크기, Field/FieldLabel/FieldError, line Tabs는 공식 표현을 사용한다. Badge 기본 표현도 승인됐지만 제품의 Preview/Sample 배지는 제거됐으므로 다시 추가하지 않는다. MessageScroller는 공식 gutter/fade와 `defaultScrollPosition="end"`·`autoScroll`을 사용하고 별도 이동 버튼이나 수동 scrollTop 효과를 추가하지 않는다. 샘플은 streaming turn을 구현하지 않으므로 메시지를 새 turn anchor로 지정하지 않는다. OS별 scrollbar gutter로 본문 중심과 입력창 중심이 달라질 수 있으며 기존 Windows 관찰값 10px gutter/5px 중심 차이는 고정 토큰이 아니다.

Collapsible는 폴더 개폐, Resizable은 pointer/키보드 resize, Dialog는 워크스페이스 폼과 전역 Settings, Sheet는 문맥 패널과 모바일 대화 설정을 담당한다. 전역 Settings의 General 섹션에서 공식 Select로 Light/Dark/System을 선택한다. 수동 체크 문자나 전역 한 글자 테마 단축키를 추가하지 않는다.

native 링크, details/summary, pre/code, overflow 스크롤과 의미 있는 HTML은 그대로 쓸 수 있다. 파일 텍스트에는 CodeBlock, 단순 빈 결과에는 큰 Empty/Card를 강제로 넣지 않는다. 기능·디자인이 바뀌는 대체는 별도 판단이다. 전체 Sidebar도 독립 레일·등록형 목적지·가변 열 상태의 대체품이 아니며, 그 사실이 모든 자체 행 스타일을 자동 승인하지는 않는다.

기존 66개 목록의 당시 판정은 작업 증거로 보존한다. 영구 카탈로그를 다시 만들지 않고 실제 요구가 생기는 컴포넌트를 현재 공식 소스에 대조한다. 공식 생성 소스를 갱신할 때 CLI의 alias/icon/preset 변환과 제품 수정을 구분한다.

## 셸과 헤더

[Workbench](../packages/client/src/workbench/ui/shell.tsx)는 좌측 전역 레일 → 목적지 sidebar → 중앙 화면 → 우측 문맥 패널을 조립한다. 전역 메뉴는 레일에, 워크스페이스·세션 탐색은 Chats sidebar에 둔다. 이름은 Beluga이며 원본 로고/이미지를 가져오지 않는다.

Beluga의 브랜드 원본은 [B2 심볼 SVG](../packages/ui/src/assets/beluga-mark.svg)다. 웹 로그인과 데스크톱 시작 오류 화면은 심볼에 앱의 `primary`를 적용한다. 파비콘은 브라우저의 라이트·다크 색 구성에 맞는 `primary`를 사용한다. Windows 설치본·앱·트레이는 라이트 `primary`와 `primary-foreground` 조합의 고정 타일을 공유한다. 심볼이나 테마를 변경하면 `pnpm --filter @workspace/desktop run icons`로 파비콘과 Tauri용 ICO·PNG를 다시 생성한다.

- 데스크톱 레일은 52px, 버튼 36px, 안쪽 여백은 네 면 모두 8px이다. sidebar를 접으면 폭은 0이며 두 번째 축소 레일을 만들지 않는다. 열린 sidebar의 접기와 닫힌 sidebar의 열기는 중앙 헤더의 같은 역할을 따른다.
- sidebar는 전체 폭 기본 280px, 범위 264–420px다. Resizable의 1px 경계를 패널 계산에서 분리한다. 자동 축소가 사용자가 정한 선호 폭을 덮어쓰지 않는다. Compact/Default/Wide 메뉴는 없다.
- Workbench는 명시적인 사용자 접힘 선택이 없을 때 레일을 뺀 프레임 폭 1024px 미만에서 자동 접힘을 선택한다. [열 계산](../packages/client/src/workbench/ui/columns.ts)은 그 선택을 받아 프레임 폭 768px 미만에서 sidebar drawer 경로를 사용한다. 이는 아래 모바일의 창 너비 기준과 다르다.
- 중앙 영역과 패널에 남은 폭이 700px 미만이면 Files를 Sheet로 전환한다. 나란히 표시할 때 중앙에 400px를 남기는 계산을 유지한다. 실제 계산은 columns가 소유한다.

[Chats 사이드바](../packages/client/src/features/conversation/shell/sidebar.tsx)의 제목, 새 세션 버튼, 워크스페이스 도구줄과 목록은 같은 바깥 여백을 사용한다. 도구줄과 목록 사이는 4px, 펼친 폴더와 첫 세션 및 세션 사이에는 2px을 둔다. 검색은 일치 세션이 있는 폴더만 보여주고, 검색 중 접기 상태는 일반 목록에 영향을 주지 않는다.

[Conversation 헤더](../packages/client/src/features/conversation/shell/conversation.tsx)는 빈/진행 대화 모두 표시하고 빈 제목은 Chats다. 현재 등록된 Chat/Trajectory를 공식 line Tabs로 표시한다. 등록 뷰가 하나뿐이면 탭 행은 생략된다. 헤더는 현재 프리셋을 읽기 전용으로 표시하고 sidebar/파일 열기 버튼을 제공한다. 모바일 샘플 모드는 대화 설정 패널에서 선택한다.

데스크톱 제목 줄과 탭 줄은 헤더의 좌우 20px 여백을 공유하며 제목 텍스트는 앞쪽 sidebar 버튼 뒤에 놓인다. 긴 제목은 데스크톱에서 줄바꿈하고 모바일에서 잘림을 허용한다. 이전 단일행 검수 기준은 데스크톱 77px·모바일 109px 높이지만 고정 높이 토큰이나 긴 제목의 상한이 아니다.

메시지와 Composer의 콘텐츠 최대 폭은 `max-w-3xl`이다. 데스크톱 본문/Composer는 `px-4`, 모바일 Composer는 승인된 `px-3`과 안전 여백을 사용한다. 서로 다른 모바일 inset을 전부 동일하다고 문서화하지 않는다.

Chat과 Trajectory는 Composer 아래 가운데에 활동·토큰·컨텍스트를 같은 ghost/xs Button과 일정한 간격으로 표시한다. 모바일은 공통 44px 터치 영역을 사용하고 출력 속도·캐시 적중률을 상세에서 보여준다. 각 버튼의 호버·키보드 포커스는 위쪽 Tooltip으로 짧은 요약을 표시하고, 클릭·탭·키보드 활성화는 위쪽 Popover의 상세를 연다. 상세는 하나만 열리며 다시 누르거나 바깥 클릭·Escape로 닫힌다. [DSH StatsPills](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-chat/src/client/chat/StatsPills.tsx) · [shadcn Tooltip](https://ui.shadcn.com/docs/components/base/tooltip) · [shadcn Popover](https://ui.shadcn.com/docs/components/base/popover)

Escape로 통계 팝오버를 닫으면 버튼으로 포커스를 복귀시킨다. 이 복귀가 일으키는 Tooltip만 건너뛴다. 이후 호버와 새 키보드 진입에는 Tooltip을 표시한다.

통계 아이콘은 `size-3.5`로 맞춘다. 컨텍스트 링은 `muted-foreground/25` 트랙과 둥근 끝의 `currentColor` 호를 사용한다. 0%에서는 트랙만 그린다. 사용률은 링 옆에 퍼센트 텍스트로도 표시한다. [DSH 아이콘 크기](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-chat/src/client/chat/StatsPills.module.css) · [DSH 링 스타일](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/ContextMeter.module.css#L39-L50)

활동과 토큰은 같은 세션의 Trajectory 기록을 합산한다. 첫 출력은 Host가 관측한 첫 스트림 이벤트 기준이며 출력 속도는 첫 출력부터 종료까지 측정값과 출력 토큰이 모두 있는 요청으로 계산한다. 캐시 적중률의 분모는 비캐시 입력·캐시 읽기·캐시 쓰기의 합이다. 컨텍스트는 현재 모델의 최근 유효한 요청에서 관측한 사용량과 한도를 링과 Progress로 표시한다. 실제 압축 중에는 상태를 표시하고 유효한 측정이 없으면 사용률을 숨긴다. [DSH ContextMeter](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/ContextMeter.tsx) · [Claude Code 상태줄](https://code.claude.com/docs/en/statusline#context-window-fields) · [Pi 세션 통계](https://pi.dev/docs/latest/rpc-commands#get_session_stats)

컨텍스트 팝오버 상단의 Progress는 최근 요청의 공급자 보고 입력 토큰을 모델 한도와 비교한다. `Estimated composition` 막대는 같은 요청의 시스템 프롬프트·도구 정의·메시지 추정치끼리 비교한다. 각 구간에 이름과 추정 토큰 수를 표시한다. [shadcn Context](https://ui.shadcn.com/docs/ai-elements/base/context) · [HarnessDesk 구성 막대](https://github.com/HarnessDesk/HarnessDesk/blob/main/docs/context-usage.md)

Chat은 기존 Message 안에서 모델의 본문을 Streamdown으로 렌더링하고, 코드 펜스는 공식 Code Block으로 표시한다. 답변의 코드 블록은 세로로 끝까지 펼쳐 채팅 본문과 함께 스크롤한다. 긴 줄은 Code Block의 기본 가로 스크롤을 사용한다. 사용자 말풍선은 입력한 텍스트를 그대로 보여준다. Host가 입력을 기록한 시각부터 종료까지 턴의 경과 시간을 표시한다. 공식 Trace로 중간 설명·추론·도구 행을 발생 순서대로 묶고, 최종 답변은 그룹 밖에 둔다. 실행 중에는 그룹을 열고 성공하면 기본으로 접는다. 사용자가 직접 열거나 내부에 포커스한 그룹은 열린 상태를 유지한다. 중단과 실패는 각각 표시하며 시각이 없으면 숫자를 표시하지 않는다. 추론은 Flue가 노출한 내용만, 셸 결과는 Host가 수집한 출력을 표시한다. 상세 실행 검사는 Trajectory가 맡는다. [shadcn Message](https://ui.shadcn.com/docs/ai-elements/base/message#markdown) · [shadcn Trace Whole Turn](https://ui.shadcn.com/docs/components/base/trace#whole-turn) · [DSH 턴 요약](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx)

턴 전체를 펼쳤을 때 요약과 활동 행의 왼쪽 시작선을 맞춘다. 바깥쪽은 기본 Collapsible 패널을 쓰고, 개별 추론·도구의 상세에는 Trace의 안쪽 들여쓰기와 구분선을 사용한다.

에이전트 답변은 이 대화 폭 안에서 줄바꿈하며 내부에 별도 본문 최대 폭을 두지 않는다. 사용자 말풍선 폭은 공식 Bubble이 담당한다. [DSH 대화 폭](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css#L445-L452), [shadcn Chat](https://ui.shadcn.com/docs/ai-elements/base/chat).

메시지 아래의 공식 MessageFooter는 사용자 말풍선 오른쪽에 전송 시각·복사·편집을, 완료된 AI 답변 왼쪽에 복사·분기·완료 시각을 순서대로 둔다. 시각은 브라우저 현지 시간으로 표시하고 지난 날짜에는 로케일의 짧은 월 표기를 포함한다. 복사는 사용자 입력 또는 최종 답변의 Markdown 원문을 담는다. 데스크톱에서는 대화 끝의 완료된 AI 답변에 조작을 기본 표시한다. 나머지 행은 본문에서 조작 줄까지 호버 또는 내부 키보드 포커스를 유지하는 동안 표시하고, 숨겨져도 높이를 확보한다. 모바일과 호버를 지원하지 않는 환경에서는 계속 표시한다. 조작 줄은 본문과 말풍선의 바깥 모서리를 기준으로 정렬한다. 본문과 조작 줄 사이는 데스크톱에서 `gap-1.5`를 쓴다. 조작 줄 안에서 아이콘 버튼은 `gap-1`로 묶고, 시각과 버튼 묶음 사이는 데스크톱 `gap-2.5`, 모바일 `gap-4.5`를 적용해 시각과 아이콘 영역 사이 간격을 아이콘끼리의 간격과 맞춘다. 대화 분기는 Lucide `GitFork`로 표시한다. 메시지 조작은 공식 ghost `icon-sm` Button, 공통 터치 영역, 공식 Tooltip을 사용한다. 편집·분기는 미지원 안내를 공식 Toast로 표시한다. [DSH 메시지 액션](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-chat/src/client/chat/MessageIconActions.tsx) · [shadcn Message](https://ui.shadcn.com/docs/ai-elements/base/message#actions)

코드 블록 복사는 공식 버튼과 성공 피드백을 사용한다. 브라우저가 복사를 거부하면 Chat의 공통 Toast에 실패를 한 번 표시한다. [Clipboard API](https://www.w3.org/TR/clipboard-apis/#dom-clipboard-writetext)

### Trajectory

Trajectory 진입 시 모듈을 기다리는 동안에도 조작줄과 빈 타임라인은 실제 화면과 같은 위치와 크기를 차지한다. 조작은 모듈이 준비되면 열린다. 모듈과 최초 기록을 기다리는 상태는 타임라인 아래 목록의 첫 행에 가운데 정렬한 공식 Spinner와 상태 문구로 표시한다. 행은 기록과 같은 데스크톱 32px·모바일 52px 높이를 쓰며, 동작 줄이기 모드에서는 Spinner를 정지한다. 모듈 다운로드가 실패하면 같은 영역에서 상태를 알리고 Chat과 작성 중인 입력은 유지한다. 새로고침은 사용자가 실행한다. 이미 받은 기록은 다시 요청하는 동안 계속 표시한다. [DSH 초기 기록 로딩 행](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-trajectory/src/client/TrajectoryTable.module.css)

[Trajectory](../packages/client/src/features/trajectory/view.tsx)는 대화 패널 전폭의 검색 조작줄, Input·Model·Tools 타임라인, 턴별 기록 목록을 사용한다. 레이블과 막대는 같은 세 레인의 가운데에 정렬하고 상하에 공통 spacing 1을 둔다. 빈 플롯의 호버 기준선은 십자 커서 중심에 맞춘다. 호버 기준선과 범위 양쪽 경계는 동일한 spacing 0.5 두께와 `ring` 색을 쓴다. Table에 가시적 열 헤더를 두지 않는다. 턴은 역할과 별도의 열과 굵은 상단 경계로 구분한다. 기록 목록에는 열 사이 세로선을 두지 않으며, 레인 레이블 경계는 타임라인에만 표시한다. 턴 시작선은 기본 표면 위에 그린다. 호버 배경은 행에서 한 번만 표시하고 턴·요청 버튼은 공유 키보드 포커스를 유지한다. 좁은 목록에서는 턴을 `#N`으로 표시하면서 접근 가능한 이름은 `Turn N`을 유지한다. 타임라인의 Popover는 클릭·탭·키보드로 범위, 확대, 이동을 조작할 수 있다. 초기에는 최근 50개 턴을 표시하며, 이전 기록을 더할 때 읽던 위치를 보존한다.

기록 행은 기본 커서를 사용하고 전체 행 클릭 또는 행에 포커스한 뒤 Enter·Space로 선택한다. 기록 본문과 도구 인자·결과는 선택 가능한 셀 텍스트이며, 드래그로 범위를 선택하면 검사기가 열리지 않는다. 왼쪽의 별도 요청 점은 행 중앙에 둔다. 모바일 44px 조작 영역을 행 안에 유지하고, 호버·포커스 시 요청 번호를 표시하며, 활성화하면 모델과 프로바이더가 있는 요청 검사기를 연다. 응답 행의 본문은 응답 내용과 실행 상태만 표시한다. 선택된 행의 왼쪽에는 `ring` 표시가 붙으며, 별도 턴 버튼은 턴 상세를 연다. 검사기에 유형별 line Tabs를 표시한다. 대화 헤더와 검사기는 [PaneTabsList](../packages/ui/src/components/pane-tabs-list.tsx)에서 공식 Tabs의 밑줄과 레일 경계가 맞닿도록 조합한다. 모바일은 트리거의 터치 영역과 함께 목록 높이도 확보한다. 넓은 영역은 공식 Resizable과 클릭으로도 조작할 수 있는 폭 메뉴를 사용한다. Trajectory 폭 760px 미만에서는 타임라인 아래의 비모달 우측 패널로 전환한다. 공통 Composer를 하단에 띄우고 실제 높이만큼 기록 스크롤에 여유를 둔다. 역할색은 [Trajectory 역할 정의](../packages/client/src/features/trajectory/roles.ts) 한 곳에 한정한다. 컨트롤은 데스크톱 24px 버튼·32px 검색과 공통 모바일 44px 기준을 적용한다. [DSH Trajectory](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-trajectory/README.md)

[전역 Settings](../packages/client/src/workbench/ui/settings.tsx)는 데스크톱 레일 맨 아래의 톱니바퀴 버튼 또는 모바일 하단 탐색의 Settings 버튼에서 바로 열리는 공식 Dialog다. 모바일 버튼에는 Settings 라벨을 표시한다. General을 먼저 표시하며, 연결 모드의 Agent presets는 Conversation 플러그인이 섹션으로 등록한다. 데스크톱은 뷰포트 안에서 최대 800×800 CSS px 패널에 왼쪽 섹션 목록과 오른쪽 본문을, 모바일은 전체 화면에 가로 섹션 탐색과 그 아래 본문을 둔다. Escape 또는 닫기 버튼으로 닫으면 포커스를 Settings 버튼으로 돌려준다. 레일 하단 배치는 [VS Code Activity Bar](https://code.visualstudio.com/docs/configure/custom-layout#_activity-bar-position), 설정 패널은 [DSH 설정 패널](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-settings-general/README.md#use-this-package)을 참고했다. 테마는 [Open WebUI의 일반 설정](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Settings/General.svelte)처럼 Select로 고른다.

Settings 셸은 등록된 섹션의 이름·아이콘·설명을 읽어 탐색과 본문 머리글을 배치한다. General의 단일 값과 Providers의 기본 모델은 공식 responsive Field에서 레이블과 조작을 같은 행에 맞추고, 본문 폭이 좁으면 위아래로 배치한다. Providers·Agent presets·Connections의 편집 폼은 FieldGroup과 세로 Field를 사용한다. 진행 중인 작업은 Spinner와 상태 문구로, 오류는 FieldError로 표시한다. 저장이 끝나면 적용된 값, 연결 상태 또는 저장 결과를 보여준다. 각 기능은 기존 저장과 오류 처리 계약을 소유한다. [shadcn Field](https://ui.shadcn.com/docs/components/base/field#responsive-layout)

설정·상태 행은 같은 본문 축을 공유한다. 충분히 넓으면 제목과 설명은 시작 쪽에, 조작은 끝 쪽에 세로 중앙 정렬한다. 구분선으로 같은 그룹의 행을 나누고 편집 폼은 세로 필드와 오른쪽 작업 버튼을 사용한다. [Microsoft 앱 설정 가이드](https://learn.microsoft.com/en-us/windows/apps/design/app-settings/guidelines-for-app-settings)

Settings의 Select는 단일 옵션 그룹도 `SelectContent → SelectGroup → SelectItem`으로 조합한다. 목록은 `align="end"`와 `alignItemWithTrigger={false}`로 버튼 가장자리에서 열고 끝선을 맞춘다. 뷰포트 가장자리에서는 Base UI의 충돌 회피를 따른다. [shadcn Select](https://ui.shadcn.com/docs/components/base/select#usage) · [Base UI Positioner](https://base-ui.com/react/components/select#positioner)

General은 Appearance, Conversations, Agent defaults, Keyboard로 나눈다. 동작이 준비 중인 설정은 실제 값과 분리해 비활성 조작과 Not available yet으로 표시한다. Workspaces의 Git worktree 설정도 같은 표현을 쓴다. Built-in tools는 현재 Host가 등록한 기능을 읽기 전용으로 표시하고, 실제 프리셋에 적용하는 기능 선택은 Agent presets 편집기가 소유한다. [DSH General과 설정 패널](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-settings-general/src/client/GeneralSection.tsx)

Agent presets에서 새 대화의 기본 프리셋을 선택한다. Providers에서 공급자가 제공하는 기본 모델을 지정하거나 해제한다. 연결 모드의 Files와 첨부가 지원되기 전까지는 기존 위치의 비활성 버튼과 Tooltip을 사용한다. 데모의 샘플 파일과 첨부는 데모에서만 제공한다.

## 모바일 배치

창 너비 768 CSS px 미만은 Chats 목록과 전체 폭 대화를 분리한다. 목록에는 하단 전역 탐색, 대화에는 Back to Chats·제목·Files·Chat/Trajectory를 두고 하단 탐색을 숨긴다. 데스크톱과 같은 서비스·registry를 사용하고 모바일 목록으로 돌아갈 때 마지막 대화를 숨긴 상태로 유지한다.

하단 탐색은 Chats·Plugins·Automation·Settings다. 비활성 기능을 실제 동작처럼 만들지 않는다. model/access/mode는 하단 Sheet의 공식 Field와 표준 Select에 모으고 데스크톱과 같은 상태를 사용한다.

모바일 Enter는 줄바꿈, 전송은 Send다. 데스크톱 Enter는 전송, Shift+Enter는 줄바꿈이며 IME 조합 중에는 전송하지 않는다. 첨부는 모바일에서 공식 AttachmentGroup 한 줄 스크롤, 데스크톱에서 줄바꿈을 사용한다. 제거 버튼 크기를 줄여 Send 자리를 확보하지 않는다.

## 승인된 확장과 관리 위치

아래 승인 범위만 유지한다. 공식 API로 같은 결과를 얻을 수 있게 되면 먼저 대체를 검토하고, 눈에 보이는 차이가 생기면 비동기로 확인한다. API를 사용했다는 사실이 모든 className 조정을 기본값으로 바꾸지는 않는다.

### Composer 표면과 입력 공간

소유: [공통 Composer](../packages/client/src/features/conversation/composer/composer.tsx).

공식 Textarea와 Button을 기존 `card/card-foreground`, `rounded-3xl` 표면에 조합한다. 카드가 사방 `p-2`와 행 사이 `gap-2`를 소유하고, 편집 영역은 가로·세로에 같은 spacing 1.5를 사용한다. 첨부와 도구는 카드의 별도 행으로 배치한다. 3px 카드 포커스 링과 오류 경계는 편집기의 상태에서 파생된다. 도구의 비활성 상태는 해당 도구에 적용한다. 강제 색상에서는 정상 입력 포커스에 기존 2px Highlight 윤곽선을 표시한다. [DSH의 입력창 영역 분리](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css#L182-L193)를 참고했다.

Composer 색만 바꾸려고 전역 input을 변경하면 일반 폼의 경계·다크 배경까지 바뀐다. 기존 card 역할을 사용하며, 별도 색 토큰은 card와 독립적으로 달라져야 하는 실제 요구가 있을 때만 재검토한다.

응답 중에도 Composer의 표면과 입력 상태를 유지한다. Host에서 실행 중인 제출이 확인되면 전송 버튼 자리에 사각형 중단 버튼을 표시한다. 전송 요청을 보내거나 중단 확정을 기다릴 때는 같은 자리에 진행 표시를 두고 [Base UI의 `focusableWhenDisabled`](https://base-ui.com/react/components/button#loading-states)로 키보드 포커스를 유지한다. [DSH InputBar](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx#L355-L382), [shadcn Prompt Input](https://ui.shadcn.com/docs/ai-elements/base/prompt-input#migrating-from-ai-sdk-elements).

모바일 `max-height`는 20rem과 보이는 높이의 1/4 중 작은 값으로 계산하고 데스크톱은 `max-h-80`을 사용한다. 공통 `min-h-14`도 있으므로 실제 높이가 언제나 viewport의 1/4 이하라고 보장하지 않는다. shell은 `100dvh` fallback과 scale 1일 때 VisualViewport 높이를 제공한다. pinch zoom을 비활성화하거나 확대된 viewport에 맞춰 강제 재배치하지 않는다. safe-area 여백은 실제 화면 가장자리를 소유한 조합에서 관리한다. 실기기 검증 공백은 [로드맵](roadmap.md)에 남긴다.

### 펼침과 선택

소유: [DisclosureButton](../packages/ui/src/components/disclosure-button.tsx), 소비자는 Workspace와 Files 폴더다.

공식 ghost Button의 expanded 배경만 `aria-expanded:not-hover:bg-transparent`로 제거한다. 폴더 펼침을 선택으로 보이지 않게 하되 aria-expanded·hover·키보드 focus를 유지한다. 색 토큰이나 Button variant를 바꾸지 않는다. 세션 선택은 별도로 aria-current를 사용한다.

### 툴바 Select

소유: [ToolbarSelect](../packages/ui/src/components/toolbar-select.tsx).

Base UI Select.Trigger의 render로 공식 ghost Button을 조합하고 값·옵션·선택·키보드 동작은 공식 Select가 담당한다. 프리셋·샘플 모드·권한 선택에 사용하고 일반 폼은 공식 SelectTrigger를 유지한다.

trigger의 shrink/truncate, popup의 `w-auto/min-w-48`, `100vw-2rem` 최대 폭과 옵션 `100vw-6rem` 줄바꿈은 명시적인 제품 조정이다. 기본 anchor 폭만으로 긴 이름과 작은 trigger를 수용할 수 없어 유지한다. 전체 값은 옵션에서 읽는다. `alignItemWithTrigger=false`로 아래쪽을 선호하되 충돌 시 library가 뒤집는 것은 허용한다.

[권한 메뉴](../packages/client/src/features/conversation/composer/access-mode.tsx)는 데스크톱 입력창 왼쪽의 ToolbarSelect와 모바일 대화 설정의 공식 Select를 사용한다. 연결 모드는 선택한 프리셋의 기능에 적용할 수 있는 모드만 표시한다. Full access는 공식 Dialog에서 확인하며, 취소에 초기 포커스를 두고 닫힐 때 선택기로 복원한다. 실제 모드의 범위와 수명은 [아키텍처](architecture.md#에이전트-프리셋과-실행)를 따른다. [DSH의 권한 표면](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-permission-presets/README.md)을 참고했다.

권한별 방패 아이콘과 이름을 함께 표시한다. Full access의 메뉴 옵션과 현재값은 주황색 `warning`으로 강조한다. 메뉴의 기본 포커스 스타일은 유지하며, 위험 범위는 옵션 설명과 확인창에서도 전달한다. [DSH의 권한 아이콘](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx#L18-L28), [WCAG 색상 사용](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

연결 모드의 새 대화에서는 입력창 왼쪽 위 워크스페이스 선택기 옆의 ToolbarSelect로 프리셋을 고른다. 시작한 대화의 헤더는 Host가 세션에 저장한 프리셋을 텍스트로 표시한다. [DSH의 입력창 조립](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx#L112-L166)과 [헤더 등록](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-agent-preset/src/client/index.ts#L225-L238)을 따른다.

등록된 워크스페이스가 있으면 선택된 폴더 이름을 입력창 위에 표시하고 바로 입력할 수 있다. [워크스페이스 메뉴](../packages/client/src/features/conversation/shell/workspace-picker.tsx)는 공식 DropdownMenu에서 폴더를 RadioItem으로, 구분선 아래 Add workspace를 일반 Item으로 제공한다. 기본 선택은 [아키텍처의 클라이언트 규칙](architecture.md#데이터와-상태-소유권)을 따른다. [DSH의 워크스페이스 메뉴](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-workspace/src/client/WorkspacePicker.tsx#L105-L127)를 참고했다.

[모델 메뉴](../packages/client/src/features/conversation/composer/model-menu.tsx)는 보내기 옆에서 Model과 Effort를 각각 공식 DropdownMenu의 하위 선택 메뉴로 제공한다. 모바일은 대화 설정 Sheet에 공식 Select 두 개를 사용한다. Host가 제공하는 모델과 Effort만 표시한다. 고를 수 있는 모델이 있으면 선택기에서 미선택 상태를 표시한다. 모델 목록이 비어 선택기가 표시되지 않을 때는 Providers 설정 위치를 안내한다. [Claude의 모델 메뉴](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings)와 [DSH 모델 선택](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md#select-a-model)을 참고했다.

전역 설정 섹션은 처음 선택할 때 로드하며 같은 설정 창을 열어 둔 동안 입력 중인 초안을 유지한다. Add provider는 목록 아래에서 목록과 같은 폭을 쓰고, 열면 같은 자리에 추가 폼을 표시한다. 폼이 닫히면 Add provider 버튼으로 포커스를 돌린다. 공급자 연결·해제는 같은 행의 버튼에 포커스를 유지한다. 포커스된 동작이 사라지면 Add provider 또는 열린 추가 폼의 Name 필드로 이동한다. 전역 Settings의 [Providers 섹션](../packages/client/src/features/model-providers/settings.tsx)은 공식 Button, Field, Input, Badge, Select 조합으로 제공자 연결·해제와 새 대화의 기본 모델을 관리한다. 채팅의 모델 변경은 세션에만 적용되며 선택기는 제공자별로 모델을 묶는다. [DSH의 제공자 관리](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)와 [OpenCode의 연결 화면](https://github.com/anomalyco/opencode/pull/54101)을 참고했다.

대화 헤더의 공식 line Tabs는 트리거 간 `gap-4`를 사용한다. Chat 본문은 Flue가 수락한 요청에 답변 텍스트가 아직 없을 때 공식 Spinner와 `Responding…`을 마지막 사용자 메시지 아래에 표시한다. 동작 줄이기 모드에서는 Spinner를 정지한다. [DSH 탭 여백](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css#L226-L250) · [DSH 실행 상태](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-chat/src/client/chat/RunningStatus.tsx).

워크스페이스가 하나도 없으면 데스크톱 본문과 모바일 목록에 `Add workspace` 시작 동작을 표시한다. 공식 Button으로 기존 등록 Dialog를 열고 성공하면 그 폴더의 입력 화면으로 이동한다. [VS Code 시작 화면의 Open Folder](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts)를 참고했다.

[프리셋 편집기](../packages/client/src/features/agent-presets/editor.tsx)는 Settings 안에서 목록과 편집 화면을 전환한다. New preset은 목록 전체에, Edit은 대상 행에, Duplicate는 편집 중인 초안에 속한다. 공식 Field, Input, Textarea, Button을 조합한다. 검색 중에도 선택한 기능을 표시하고 저장 결과는 편집기에 표시한다. [DSH 프리셋 목록](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/client/ui-agent-preset/README.md)

### 터치 영역과 버튼 조합

소유: globals.css의 `touch-target`, [ShellButton](../packages/ui/src/components/shell-button.tsx)과 DisclosureButton/ToolbarSelect 및 명시적 사용처.

`max-md`에서 기존 spacing 11을 사용한다. 기본 root/spacing에서 최소 44×44 CSS px이며 px 상수로 고정한 utility는 아니다. 아이콘·글꼴·데스크톱 크기는 유지하며 primitive 소스, 전역 자손 selector, 겹치는 보이지 않는 hitbox를 수정하지 않는다. 기존 48px 세션 행과 약 58px 하단 항목을 44px로 줄이지 않는다. 하단 크기는 콘텐츠 결과이며 별도 토큰이 아니다.

터치 영역은 부모 배치에서도 자리를 확보한다. 모바일 TabsList는 `min-h-13`, trigger는 `flex-none`으로 긴 Trajectory 라벨을 동일 폭에 밀어 넣지 않는다. settings의 제목과 닫기는 같은 행에 두고 필드와 16px inset을 맞춘다. 첨부 높이 토큰이나 자체 carousel로 Send 잘림을 우회하지 않는다.

ShellButton은 접근 가능한 이름과 ref/props를 동일 경로로 전달한다. Tooltip은 opt-in이며 좌측 레일 힌트는 right, provider 지연은 500ms다. 이름이 보이는 세션/워크스페이스 행과 옆 버튼을 가리는 sidebar 도구 힌트는 추가하지 않는다.

### Sheet와 닫기

소유: Workbench의 navigation/Files 조합, Composer의 settings, ConversationSidebar의 workspace Dialog.

navigation Sheet는 `w-72`(기본 root에서 288px), Files는 작은 화면 전체 폭과 `sm:max-w-lg`(512px)를 사용한다. 이는 승인된 제품 폭이며 시장의 의무 수치가 아니다. 실제 모바일은 목록 페이지를 사용하고 navigation Sheet는 좁은 데스크톱 프레임에서 사용한다.

`showCloseButton=false`는 공개 prop이며 보이는 닫기 버튼을 하나만 두는 용도다. 모바일 settings/폼은 Close part가 ShellButton을 render한다. Workbench pane은 controlled state와 finalFocus를 사용해 모달/비모달을 함께 지원한다. 모달의 이름·포커스 제한·Escape·복원을 유지한다. 두 pane Sheet에는 한 개의 in-flow 자식뿐이므로 제거했던 `gap-0`를 다시 넣지 않는다. settings는 별도 기능 조합이지 Files 폭 정책의 소비자가 아니다.

### 탐색 상태와 전역 접근성

소유: [sidebar-link](../packages/ui/src/lib/sidebar-link.ts), globals.css, Workbench의 main landmark.

링크는 sidebar-foreground, hover/current의 sidebar-accent/foreground, focus의 sidebar-ring을 읽는다. route/aria-current는 feature/router가 소유한다. 공유 recipe에 router를 넣지 않는다.

기본 키보드 outline은 2px이며 강제 색 모드에서는 Highlight를 사용한다. route 이동 시 프로그래밍 방식으로 focus하는 비동작 main만 로컬 outline 억제를 유지하고 파일 미리보기·버튼·링크에는 확대 적용하지 않는다. skip link를 유지한다.

OS `prefers-reduced-motion` 안의 animation/transition/scroll 억제는 명시적으로 승인된 전역 override다. 일반 hover·테마 전환을 모두 중단하는 규칙으로 확대하지 않는다. 전역 스크롤바 꾸밈은 제거된 상태이며 MessageScroller 자체 스타일은 유지한다.

## 흐름별 검수 기준

라이트·다크, 데스크톱·모바일에서 실제 제품 경로를 검수한다. 320px, 767/768px 전환, 넓은 화면, 긴 제목/옵션, 짧은 viewport와 여러 첨부를 포함한다. 문서 전체 overflow뿐 아니라 카드 내부 잘림도 확인한다.

- 새 세션: 빈 editor와 헤더/탭, 기존 세션 draft 보존, 모바일 목록/대화 전환과 논리적인 route focus.
- 검색: 일치/없음, Clear search 후 살아 있는 입력으로 focus, Escape 후 Search 버튼으로 focus. Escape는 검색만 닫고 이를 담은 navigation Sheet까지 닫지 않는다. 닫기와 지우기를 구분한다.
- 워크스페이스: FieldLabel/오류 연결, 수정 시 오류 해제, 취소 후 trigger와 미완료 입력 복원. 연결 모드에서는 경로 입력·폴더/상위 폴더 탐색·등록을 Dialog에서 확인한다. 짧은 화면에서도 Dialog 경계가 화면 안에 있고 내부 스크롤로 등록 버튼에 도달하는지 확인한다. 터치로 열거나 폴더를 탐색할 때 입력란을 강제로 활성화하지 않는다. 샘플은 이름으로 추가한다. 생성 후 route focus를 유지하고 늦은 모달 복원이 가로채지 않게 한다.
- 대화: 빈 전송 오류, IME/Enter, 첫 전송과 Chat/Trajectory 왕복의 draft·Composer 보존, 읽던 메시지 위치 보존. 전송·첨부 제거 후 editor focus. 두 탭에 각각 직접 진입해 같은 입력창 아래에 같은 세션 요약이 표시되고 빈 초안에는 표시되지 않는지 확인한다.
- Trajectory: 네이티브 스크롤바가 보이는 환경에서 대화·검사기의 탭 밑줄 전체를 확인한다. 좁은 검사기는 가로 스크롤바 없이 넘친 탭까지 이동할 수 있어야 하며, 키보드 포커스를 받은 탭을 화면 안으로 가져온다. 턴 경계에는 일반 행 구분선을 중복해서 그리지 않는다. 경계 앞뒤 행에 각각 호버해 왼쪽·가운데·오른쪽의 실제 색과 2px 두께를 비교한다. Duration을 켜면 검사기의 기록 소요 시간에 비례하고 유휴 구간을 압축하며, 끄면 기록 순서에 동일한 폭을 사용한다. 확대나 범위 선택 중 모드를 바꿔도 전체 새 축으로 돌아오는지 확인한다.
- Files: 폴더 접힘·선택 유지, 미리보기에서 뒤로 갈 때 해당 파일 focus, 닫을 때 opener 복원. 데스크톱 비모달은 일반 tab 순서, Sheet는 focus trap을 사용한다.
- 설정: 동일 세션의 mode·샘플 access·model 값 보존, Select 안의 Escape는 옵션만 닫고 다음 Escape는 Sheet를 닫음. 권한 확인의 Escape는 확인만 닫고 선택기로 포커스를 돌림. Close → Agent mode → Access mode → Model 순환과 opener 복원.
- 테마/상태: 버튼 hover/focus와 합성 후 글자 대비, Select의 선택 체크와 현재 highlight 구분, 탭 방향키 focus/Enter 선택, sidebar current/hover/focus, Disclosure hover 유지. Appearance 선택, Settings 닫기 후 opener focus와 System의 OS 추종을 확인한다. 전환 중간 프레임을 안정 색상으로 판단하지 않는다.
- 셸 전환: sidebar 접기/열기 후 중앙의 해당 버튼 focus, 사용자가 바꾼 폭의 접기/반응형 왕복 보존. sidebar와 Files의 반환 대상을 각각 유지한다. 모바일 목록에는 선택된 세션 표시를 만들지 않는다.

이 목록은 지속되는 회귀 기준이며 이번 문서 정리에서 화면을 다시 검증했다는 보고가 아니다. 인증·실기기·자동 감사의 미확인 범위는 로드맵을 따른다.

## 출처와 적용 한계

DSH 레이아웃/원본 실행 비교는 [0.2.2-rc.1 소스](https://github.com/deepseek-ai/deepseek-harness/tree/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db)를 기준으로 했다. 원본 280px sidebar 등의 구조를 참고했지만 공식 크기·항상 보이는 헤더·독립 좌측 레일·모바일 목록/대화·현재 테마는 Beluga의 선택이다. 활성 DSH 헤더 전체를 실행 측정하거나 픽셀 일치를 검증했다고 주장하지 않는다.

Codex 근거는 사용자 이미지와 설치본 26.1103.3517.0의 좌측 rail/별도 trailing pane 정적 조사다. 전체 입력 focus나 모바일 동작의 실행 검증 근거는 아니다. 구현 소스와 원본 자산은 복제하지 않는다.

- [shadcn theming](https://ui.shadcn.com/docs/theming), [monorepo](https://ui.shadcn.com/docs/monorepo), [Base UI composition](https://base-ui.com/react/handbook/composition): 의미별 토큰과 공식 동작을 재사용하되 feature orchestration은 feature에 둔다.
- [Prompt Input](https://ui.shadcn.com/docs/ai-elements/base/prompt-input), [assistant-ui Composer](https://www.assistant-ui.com/docs/primitives/composer): 내부 편집기와 외부 표면 조합의 근거다. 모든 제품이 외곽 focus를 제거한다는 근거는 아니다.
- [Atlassian border](https://atlassian.design/foundations/border), [MUI themed components](https://mui.com/material-ui/customization/theme-components/): 폭/색 역할과 공통 확장의 선례다. Beluga의 정확한 1px 값이나 무제한 override를 정당화하지 않는다.
- [Sheet](https://ui.shadcn.com/docs/components/base/sheet), [Sidebar](https://ui.shadcn.com/docs/components/base/sidebar), [MUI responsive drawer](https://mui.com/material-ui/react-drawer/#responsive-drawer), [Android list/detail](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail): 적응형 조합의 근거이며 다른 플랫폼의 단위를 그대로 가져오지 않는다.
- [WAI disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/), [keyboard focus](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/), [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced): 펼침·선택·포커스와 target을 구분한다. 44px는 승인된 제품 기준이며 모든 작은 target이 AA 실패라는 뜻은 아니다.
- [Jakub skills](https://jakub.kr/skills): layout·typography·colors·writing·accessibility 검수 관점. 프로젝트 정책을 대체하거나 자동으로 새로운 예외를 승인하지 않는다.
