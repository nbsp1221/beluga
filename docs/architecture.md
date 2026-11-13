---
status: current
owner: maintainers
last_reviewed: 2026-11-11
---

# 현재 아키텍처

Beluga는 웹 Client와 Node Host가 각각 플러그인을 조립하는 모노레포다. 현재는 저장소 내부의 신뢰된 플러그인을 시작 시 정적으로 선택한다. 설치형 플러그인 플랫폼이나 보안 샌드박스는 아니다. [제품 결정](decisions/0001-independent-plugin-product.md)과 [다음 단계](roadmap.md)는 별도로 관리한다.

## 패키지 경계

- [apps/desktop](../apps/desktop/src-tauri/src/lib.rs): Windows 설치와 창·트레이·로컬 Host 수명. 동봉된 Node로 기존 Host를 시작하고 WebView2에 그 Host의 웹 화면을 연다. 앱 소스 간 import 없이 빌드 산출물로 조립한다.

- [apps/web](../apps/web/src/main.tsx): Vite/React 시작, ThemeProvider·TooltipProvider·Router, 클라이언트 조립과 React 루트 수명. [App](../apps/web/src/App.tsx)은 `main` 슬롯을 렌더링한다.
- [apps/host](../apps/host/src/main.ts): Hono 어댑터의 TCP 시작·종료. 기본 수신 주소는 loopback이다. Docker 이미지가 명시적으로 `--bind`를 지정하며, [Docker 배포 예시](hosting.md#docker)는 호스트의 loopback 포트만 게시한다. listener 종료 후 플러그인을 해제한다.
- [protocol](../packages/protocol/src/host.ts)은 HTTP 요청·응답과 검증 스키마를 공유한다. React, Node 구현, Cordis에 의존하지 않는다.
- [runtime](../packages/runtime/src/index.ts): 의존성 검증과 서비스·자원 수명. 제품 계약과 엔진을 모른다. [React 슬롯 어댑터](../packages/runtime/src/react.tsx)는 별도 `@workspace/runtime/react` 진입점이다.
- [ui](../packages/ui/components.json): 공식 shadcn 기본 요소, 테마와 재사용 표현 조합. 기능 명령·URL·ConversationClient를 소유하지 않는다.
- [client](../packages/client/package.json)은 브라우저 플러그인과 연결·샘플 조립을 갖는다. Vite가 TS/TSX 소스를 소비한다.
- [host-plugins](../packages/host-plugins/package.json)은 Node로 컴파일되는 Host 플러그인과 공급자 어댑터를 갖는다.

앱이 제품 패키지의 공개 진입점에서 플러그인을 골라 조립한다. 브라우저와 Host는 HTTP로 통신하고 제품 패키지는 protocol과 runtime을 사용할 수 있다. Client는 UI를 추가로 사용한다. 공용 패키지는 제품 구현을 참조하지 않는다. 브라우저 기능은 다른 기능 및 Workbench의 공개 계약만 사용하며 조립 모듈이 데이터 구현을 연결한다. 패키지 간 import는 선언된 의존성과 공개 진입점을 사용한다. [경계 검사](../scripts/check-boundaries.mjs)는 앱·패키지의 소스, 테스트, 최상위 설정 파일에서 정적 import, 재수출과 문자열 경로의 동적 import를 검사한다. 계산된 모듈 경로와 CSS는 검사 범위 밖이다.

[TypeScript 공용 설정](../packages/typescript-config/base.json)은 NodeNext와 브라우저용 Bundler 설정을 나눈다. [Runtime](../packages/runtime/tsconfig.json)도 공용 설정의 `verbatimModuleSyntax`와 `isolatedModules`를 적용한다. 플러그인 활성화는 Cordis 핸들의 시작 작업을 기다린 뒤 의존 서비스의 확정 상태로 확인한다.

기능 계약은 runtime의 `Services` 인터페이스를 확장한다. HTTP 계약은 protocol에, React를 사용하는 목적지·대화 뷰 계약은 그 기능에 둔다. 같은 실행 이름의 기능도 Host의 `trajectory`와 브라우저의 `trajectoryClient`처럼 서로 다른 서비스 타입을 선언한다.

## 실행 그래프와 화면 등록

[웹 조립](../apps/web/src/product.ts)은 샘플 또는 연결 초기화만 가져온다. Workbench, Connection, Conversation, Chat, Files, Trajectory의 화면 등록을 공유한다. 연결 조립은 초기 대화 카탈로그와 프리셋을 병렬 조회해 서비스에 나눠 준다. runtime이 서비스 의존성을 정렬하고, 형제 플러그인은 앱이 선언한 순서로 뷰와 설정을 등록한다.

웹 진입점은 연결 모드에서 로그인 문서에 필요한 코드부터 실행하고, 인증된 앱 진입에서 Workbench와 제품 플러그인을 가져온다. 제품 조립은 실행 모드에 맞는 대화 어댑터만 불러온다. Chat과 Trajectory는 탭을 먼저 등록하고 뷰를 처음 표시할 때 구현을 가져온다. 열린 뷰는 탭을 바꿔도 유지하며, 공통 Composer와 초안은 뷰 로딩 경계 바깥에 둔다. Chat은 답변을 표시할 때 Markdown을, 코드 펜스를 표시할 때 강조 엔진과 지원 언어의 문법을 가져온다.

Chat에 저장된 답변 본문이 있으면 뷰와 Markdown 렌더러를 같은 시점에 요청한다. 두 모듈은 각각 한 요청을 공유하며 준비되면 표시한다. Chat의 모듈 로딩은 React Suspense의 재표시 간격에 의존하지 않는다.

대화 뷰는 전환에 필요한 모듈을 준비하는 함수를 등록할 수 있다. 탭을 활성화하면 준비를 즉시 시작한다. 마우스를 올리거나 키보드로 포커스한 상태가 50 ms 이어져도 준비를 시작하고, 그전에 벗어나면 예약을 취소한다. Trajectory에 직접 진입하면 Chat 탭과 상호작용하기 전까지 Chat 모듈을 요청하지 않는다.

Workbench는 `views`와 `destinations`를 제공하고 `main`을 등록한다. 목적지 registry는 경로·탐색 항목·선택적 sidebar, 문맥 패널과 설정 섹션을 관리한다. Conversation은 Chats 목적지·sidebar를 등록하고 `conversationViews`를 제공한다. Chat과 Trajectory는 각각 자기 뷰를 등록한다. Files는 문맥 패널을, 연결 모드의 Providers와 Agent presets는 각각 자기 설정 섹션을 등록한다.

sidebar는 component와 description을 함께 등록하며 제목은 목적지 label을 사용한다. 문맥 패널도 label·description을 등록한다. Workbench는 이 정보를 화면과 모달의 접근 가능한 이름·설명에 사용하고 Chats·Files의 문구를 직접 소유하지 않는다. 기능 간 연결은 기능의 `contract.ts`에 선언한 서비스와 Workbench의 레이아웃 훅을 통해 이루어진다.

전역 Settings는 섹션 선택과 표현을 관리하며, 프리셋과 모델 공급자 상태·명령은 각각 해당 기능에 있다. 섹션은 같은 우선순위에서 등록 순서를 따르며, 기능은 필요한 경우 탐색의 우선순위를 등록할 수 있다. 브라우저는 연결 여부를 HTML의 모드 표시로 구분하고, 연결 모드에서 인증 방문 확인 후 제품을 조립한다.

[Host 조립](../apps/host/src/product.ts)은 연결 설정이 있을 때 인증, Workspace, Trajectory, 에이전트 기능 플러그인과 Flue 하네스를 추가한다. Workspace는 인증된 폴더 API와 소비자별 계약을 제공한다. 하네스는 세션·프리셋·기본 모델 카탈로그, 도구 플러그인은 세션의 경로·프리셋 기능·권한 조회, Trajectory는 세션 존재 조회를 사용한다. 필요한 서비스가 빠지면 시작을 거부한다. `/api/status`는 Host 가용성만 보고한다.

[카탈로그 모듈](../packages/host-plugins/src/workspace/catalog.ts)이 파일 경로, 현재 스키마 초기화, 세션의 모델·Effort와 기본 모델 저장을 소유한다. Host는 플러그인 수명 동안 연결을 유지한다. 기본값 변경은 새 대화에 적용되며 저장된 세션 설정은 세션의 명령으로 바꾼다.

[모델 공급자 모듈](../packages/host-plugins/src/model-providers/contract.ts)은 공급자 계약과 연결 오류를 정의한다. 공급자 어댑터와 HTTP 라우트가 이 계약을 사용하고 Harness는 공급자 등록 함수와 기본 모델 저장 계약을 연결한다.

두 runtime은 HTTP로 연결한다. Host는 인증 전 대화 경로를 로그인으로 보내고, 대화·카탈로그 API도 인증으로 보호한다. 공개 경로는 로그인 문서와 그에 필요한 빌드 자산, 상태·인증 API로 한정된다. 샘플 개발 서버는 별도 진입점이다.

[Host 웹 자산 제공](../apps/host/src/web.ts)은 정적 JS·CSS·SVG에 요청 헤더에 따른 압축을 적용한다. 내용 해시가 포함된 자산에는 장기 캐시를 적용하고, HTML은 저장하지 않도록 응답한다.

[접속 코드 플러그인](../packages/host-plugins/src/auth/host.ts)은 Host 데이터 폴더의 auth.sqlite에 세션 토큰 해시·만료 시각·접속 코드 리비전을 저장하고 HttpOnly, SameSite Strict 쿠키를 발급한다. HTTPS에서는 Secure를 붙인다. 로그인과 인증된 사이트 진입 시 만료 시각을 그 시점으로부터 24시간 뒤로 설정하고, 스트림·이력 조회는 만료를 연장하지 않는다. 로컬 운영 명령이 무작위 코드를 발급하고 데이터 폴더에는 salt와 해시만 기록한다. 같은 데이터 폴더와 사이트 주소로 Host를 재시작하면 기존 세션이 이어진다. 로그아웃, 만료, 접속 코드 교체 시 세션은 무효화된다. 모델 인증은 [공급자 어댑터](../packages/host-plugins/src/model-providers/adapter.ts)가 별도로 소유한다.

## Windows 데스크톱 수명

데스크톱은 Tauri 2와 WebView2로 창과 트레이를 관리한다. 설치본에는 공식 Node 24, Host의 운영 의존성, 웹 자산이 함께 들어간다. [Host 시작 경로](../apps/host/src/desktop.ts)는 임의의 루프백 포트를 받아 공통 Host를 초기화하고, 준비 신호와 로컬 세션을 전용 파이프로 돌려준다. [데스크톱 인증 플러그인](../packages/host-plugins/src/auth/desktop.ts)은 해당 Host 프로세스가 발급한 세션과 정확한 요청 Origin을 검사한다. 네이티브 셸이 WebView에 HttpOnly 세션 쿠키를 넣으며 제품 화면에는 Tauri 명령 권한을 주지 않는다.

창을 닫으면 화면과 Host를 트레이에 유지한다. 트레이의 **Exit**는 새 요청을 막고 이미 들어온 변경 요청을 정리한 뒤 Flue의 실행 취소를 기록한다. Windows Job Object가 앱이 시작한 Node와 그 자식 프로세스의 수명을 제한한다. 강제 종료로 취소를 기록하지 못한 경우 Flue의 기존 복구 규칙이 적용된다. 독립 실행 Host는 이 수명에 포함되지 않는다.

기존 React **Settings → Connections**에서 HTTPS Host를 선택한다. 화면과 설정은 하나의 로컬 WebView2에 남고, [데스크톱 Host의 연결 어댑터](../apps/host/src/desktop-connections.ts)가 선택된 Host의 제품 API와 Flue 스트림에 요청을 전달한다. 각 연결의 요청 경로와 인증 값은 해당 Host에만 연결된다. WebView2의 HttpOnly 쿠키에는 원격 세션 값만 저장한다. 만료와 재접속 갱신은 원격 Host의 기존 인증 정책을 따른다. 앱에서 로컬로 돌아오거나 종료해도 원격 Host의 작업은 계속된다.

## 플러그인과 등록 수명

플러그인은 `id`, 필요한 `requires`, 제공할 `provides`, 비동기 가능한 `setup`을 선언한다. setup에 전달되는 `PluginContext.get`은 선언한 의존성/자기 서비스만 읽고, `provide`는 선언한 서비스를 등록한다. 앱 조립용 `Runtime.get`은 그 선언 검사 대신 서비스 가용성과 종료 여부를 확인한다. 모든 제공 선언은 setup 종료 전에 실제 등록돼야 한다.

runtime은 setup 전 중복 ID·중복 제공자·누락 의존성·순환을 거부한다. 자원을 얻는 즉시 `onDispose`에 해제를 등록한다. 시작 실패는 등록된 자원을 정리하며, 종료는 소비자를 제공자보다 먼저 해제하고 비동기 cleanup을 기다린다. 반복 호출은 같은 종료 작업으로 처리한다. Cordis 버전은 [manifest](../packages/runtime/package.json)에 고정돼 있으므로 업그레이드 시 이 계약을 재검증한다.

화면 등록 역시 remover를 반환하고 해당 플러그인이 해제를 소유한다. [목적지](../packages/client/src/workbench/destinations.ts)는 중복 ID/경로, 패널과 설정 섹션은 중복 ID, [대화 뷰](../packages/client/src/features/conversation/view-registry.ts)는 중복 ID를 거부한다. 오래된 remover가 후속 등록을 지우지 않도록 등록 객체를 구분한다. HMR은 React 루트를 unmount한 뒤 product를 dispose한다.

대화 뷰는 Session을 받아 표시하고 composer 노출 여부를 선언한다. 선택은 URL의 `view` 파라미터이며 미등록 값이면 Chat, Chat도 없으면 첫 등록 뷰로 fallback한다. Conversation이 헤더·탭·Composer 수명을 소유한다. 기능 뷰가 Workbench 배치를 직접 변경하지 않는다.

## 데이터와 상태 소유권

[ConversationClient](../packages/client/src/features/conversation/contract.ts)는 snapshot/subscribe를 갖는 클라이언트 투영 계약이다. 세션·초안·전송을 소유한다. Workspace, Agent presets, Model providers는 각자 목록과 명령을 제공한다. Conversation은 새 세션을 처음 저장할 때 이 서비스에서 선택한 프리셋 버전과 기본 모델을 읽는다. [연결 어댑터](../packages/client/src/bootstrap/connected.ts)는 활성 세션의 Flue 관찰을 화면 메시지로 변환하고, 세션 전환 시 구독을 닫는다. 전송 응답을 받기 전에 연결이 끊긴 경우 같은 입력의 재시도에는 같은 제출 키를 사용한다.

새 대화의 워크스페이스는 현재 화면에서 지정한 폴더를 우선한다. 지정이 없으면 브라우저에 기억한 마지막 선택, 가장 최근에 생성된 저장 세션의 폴더, 가장 최근에 등록된 폴더 순으로 고른다. 기억한 폴더가 현재 Host 목록에 있을 때만 사용하며, 저장 위치는 브라우저별 로컬 환경설정이다.

[Workspace Host](../packages/host-plugins/src/workspace/host.ts)는 로그인한 사용자에게 Host 홈에서 시작하는 폴더 탐색과 절대 경로 입력을 제공한다. 별도 허용 목록은 두지 않는다. 목록은 하위 폴더만 반환하며 링크는 입력 경로로 검증할 수 있다. Host에서 확인 가능한 기존 디렉터리를 정규 경로로 등록한다. 동일 경로는 같은 ID를 반환하고 이름이 같아도 경로가 다르면 별개다. 카탈로그는 실제 폴더 경로를 필수로 저장한다. 새 대화에서 폴더를 고르기 전 상태는 웹 초안에만 존재한다. 연결된 폴더가 사라지거나 다른 경로로 바뀌면 새 세션 생성을 거절하고 이력은 보존한다.

[하네스 Host](../packages/host-plugins/src/harness/host.ts)는 카탈로그로 세션을 확인하고, Flue SQLite에 대화와 제출 기록을 저장한다. 워크스페이스 등록은 세션의 소속을 정하며, 경로·파일 내용·프로젝트 지침은 모델 입력에 주입하지 않는다. 샘플 모드 선택은 실행 설정과 별개이며 첨부를 포함한 전송은 거부한다.

### 에이전트 프리셋과 실행

**Agent preset(에이전트 프리셋)**은 여러 세션에서 재사용하는 이름, 설명, 지침, 기능 ID 목록이다. Host는 [배포 선언](../apps/host/src/initial-agent-preset.json)의 **Standard**를 카탈로그 초기화에서 한 번 등록하고 그 ID를 새 대화의 기본 선택으로 저장한다. 등록과 기본 선택은 한 트랜잭션에 들어간다. [프리셋 카탈로그](../packages/host-plugins/src/agent-presets/catalog.ts)의 SQLite가 이후 정의·버전·기본 선택을 소유한다. 기본 제공 프리셋도 웹과 개발자 도구가 공유하는 [인증 API](development.md#agent-presets-api)로 편집한다. 저장 시 새 버전을 추가하고 기존 버전을 보존한다. 새 초안과 프리셋을 생략한 API 요청은 Host의 기본 선택을 사용한다. 기본 선택이 없으면 프리셋을 지정한다.

**세션**은 프리셋 ID·버전과 워크스페이스를 연결한다. 첫 전송 또는 API 생성에서 버전을 고정하고 재시작 후에도 그 버전을 사용한다. **에이전트**는 이 세션에서 실행되는 Flue 인스턴스다. 모델·Effort는 프리셋과 별개인 세션 설정이다. Host가 제공하는 모델과 Pi 카탈로그가 보고한 Effort로 제한한다. 새 대화는 첫 전송에서 저장하고, 진행 중인 대화는 `PUT /api/conversations/:id/run-settings`로 변경해 다음 전송부터 반영한다. [Flue의 제출 단위 설정](https://flueframework.com/docs/guide/models/)을 사용한다.

[Host 제공자 어댑터](../packages/host-plugins/src/model-providers/adapter.ts)는 인증된 `/api/providers`에서 연결을 관리한다. 연결 설정과 새 대화의 기본 모델은 SQLite에 저장하며, 호환 API 키는 Host 데이터 디렉터리의 별도 파일에 저장한다. 세션은 연결 ID가 포함된 모델 ID를 보존한다. Pi와 Flue는 같은 제공자 객체를 사용한다. 연결 해제 후에는 모델이 선택기에서 빠지고 새 요청이 거부된다. 이미 시작된 요청은 완료될 수 있다. Codex 연결을 다시 켜면 같은 ID를 사용한다. 삭제한 호환 연결을 새로 추가하면 새 ID를 사용하므로 해당 모델을 쓰던 대화에서 다시 선택해야 한다.

**제품 플러그인**은 Host나 웹의 시작 시점에 서비스와 자원 수명을 연결한다. 프리셋에서 고르는 **에이전트 기능**은 제품 플러그인이 제공하는 [서비스 계약](../packages/host-plugins/src/agent-capabilities/host.ts)이다. 각 기능은 안정적인 ID, 편집기용 메타데이터, 세션에 등록할 도구 정의를 제공한다. 구현은 `agent-capabilities/<영역>/<기능>/`에 두고 Host 조립이 플러그인과 서비스 이름을 한 목록에서 선택한다.

[하네스 Host](../packages/host-plugins/src/harness/host.ts)는 세션에 고정된 프리셋과 접근 모드에 따라 도구를 골라 Flue `useTool`로 등록한다. 기능 플러그인의 `host.ts`가 모델 이름을 정하고 [공통 등록 함수](../packages/host-plugins/src/agent-capabilities/tool.ts)에서 [Pi 어댑터](../packages/host-plugins/src/pi/tool.ts)와 [세션 권한](../packages/host-plugins/src/workspace/tool-access.ts)을 연결한다. 어댑터는 Pi의 스키마·인자 준비·실행 결과를 변환하고, 등록 함수는 호출 ID와 중단 신호를 넘긴다. 현재 연결은 텍스트 결과를 지원하며 작업 경로나 프로젝트 지침을 자동 주입하지 않는다. 중복 기능 ID는 Host 시작 시 거절하고, 필요한 기능이 빠진 세션의 새 생성·전송도 거절한다. [Flue 도구 등록](https://flueframework.com/docs/guide/tools/)

모든 세션은 같은 Flue 라우터를 사용한다. 웹의 새 대화 목록은 카탈로그의 최신 프리셋을 표시한다. 새 세션의 기본 권한은 Read only다. [세션 카탈로그](../packages/host-plugins/src/workspace/catalog.ts)는 고정된 프리셋 버전과 선택한 실행 권한을 세션별로 SQLite에 저장한다. 웹에서 Full access를 선택할 때는 명시적 확인이 필요하다. 저장된 권한은 브라우저를 닫거나 같은 데이터 디렉터리로 Host를 재시작해도 유지되며, 낮은 권한으로 변경하면 그 값이 저장된다. Host는 프리셋과 실행 모드의 교집합을 모델에 노출하고, 변경·셸 호출 직전에도 권한을 확인한다.

Flue 관찰의 미완료 사용자 제출은 실행 중 상태로 투영한다. 첫 텍스트가 보이면 대기 표시를 없애고, 중단 버튼은 제출 종료까지 유지한다. [Flue의 중단 API](https://flueframework.com/docs/reference/agent-api/)는 인증된 세션 라우트를 통해 현재 실행과 그 대화의 대기열을 중단한다. 제출 종료는 Flue가 기록한 결과로 확인한다. Host는 인증과 Flue 제출에 동일한 외부 origin을 전달한다. Flue가 반환하는 스트림 주소는 프록시 내부 연결과 무관하게 이 origin을 사용한다.

Host의 [Trajectory 플러그인](../packages/host-plugins/src/trajectory/host.ts)은 Flue가 시작 중 미완료 제출을 정리하기 전에 관찰을 등록한다. 종료 시 Harness의 Flue runtime을 먼저 멈추고 관찰을 해제한 뒤 DB를 닫는다. Trajectory는 [Flue 관찰 어댑터](../packages/host-plugins/src/trajectory/flue-recorder.ts)에서 공개 실행 이벤트를 정규화하고, [Beluga SQLite 기록](../packages/host-plugins/src/trajectory/store.ts)에 전송·모델 요청·도구 호출을 보관한다. Trajectory가 이력·모델 입력·사용량 [라우트](../packages/host-plugins/src/trajectory/http.ts)를 소유하고 Harness는 인증 미들웨어 뒤, Flue 요청 위임 앞에 등록한다. 화면은 [HTTP 계약](../packages/protocol/src/host.ts)으로 기록을 읽는다. 새 실행부터 기록하고 예전 Flue 이력을 Trajectory로 변환하지 않는다. 제출 결과와 개별 도구 결과를 분리한다. 관찰 가능한 첫 출력의 시간은 공급자의 내부 첫 토큰 시각과 구분한다.

컨텍스트 구성은 사용량 표본과 같은 요청의 저장된 시스템 프롬프트·도구 정의·메시지에서 계산한다. Host는 텍스트와 JSON의 UTF-8 크기를 4바이트당 약 1토큰으로 추정하고, 추정 합계만 사용량 응답에 더한다. 공급자 보고 입력 토큰은 그대로 사용하며 상세 본문은 기존 인증된 Trajectory 입력 라우트가 제공한다.

공통 Conversation은 보이는 세션의 사용량을 관찰한다. Host는 같은 Trajectory 저장소에서 턴·스텝·토큰·캐시 읽기를 집계하며, 상세 기록은 Trajectory 서비스가 열린 저장 세션에 대해서만 관찰한다. 탭을 닫거나 세션을 바꾸면 진행 중인 조회를 취소하며, 다시 열 때 같은 세션의 마지막 기록을 표시한다.

Flue가 자동 압축과 원본 대화 저장을 맡는다. Host는 공개 관측 경계에서 압축 시작·종료와 요약 호출을 기록하고, 다음 일반 모델 요청의 실제 입력을 기존 Input 검사기에 제공한다. 하단 컨텍스트 사용률은 마지막 성공한 일반 요청의 입력과 캐시 토큰을 그 요청의 등록 모델 한도로 나눈 값이다. 누적 토큰 집계와 독립적이며, 모델 변경이나 성공한 압축 뒤에는 새 측정이 올 때까지 비워 둔다. 공급자 레지스트리의 한도가 미확인이면 비율을 제공하지 않는다.

Chat은 Flue의 보이는 메시지를 공통 계약의 텍스트·추론·도구 결과로 변환해 순서대로 렌더링한다. 턴 상태와 종료 경과 시간도 같은 관찰 계약에서 입력·종료 시각을 연결해 얻는다. 라이브·재접속·이력은 같은 변환을 사용하며, Trajectory 상세 기록을 추가로 요청할 필요가 없다. Markdown과 Trace는 이 메시지의 표현을 맡는다.
텍스트·추론 블록의 화면 식별자는 Flue 메시지 ID와 필터링 전 순서로 정한다. 빈 블록에 스트리밍 내용이 들어와도 뒤에 있던 블록의 식별자는 유지된다. 도구 호출은 Flue의 호출 ID를 사용한다.

새 모델 요청은 공급자 변환 전 Flue가 관찰한 시스템 프롬프트·순서가 보존된 메시지·도구 정의를 저장한다. 같은 내용은 SQLite에서 해시로 중복 제거하며, 입력 본문은 인증된 요청별 검사 API에서만 조회한다. 검사 API는 메시지와 같은 순서로 `messageIds`를 제공한다. 식별자는 저장된 해시와 같은 내용의 등장 순번을 조합해, 중복 메시지도 화면에서 구분한다. 공급자의 HTTP 요청 헤더나 자격증명 저장소는 읽지 않는다. 모델에 전달된 본문 자체에 민감한 값이 포함될 수 있다.

파일 읽기·검색·쓰기·편집·셸 실행의 동작은 [Pi Coding Agent SDK](https://pi.dev/docs/latest/sdk)의 공식 도구를 따른다. 상대 경로의 기본 시작점은 세션 워크스페이스다. Read only에서도 프리셋이 허용한 `read`, `glob`, `grep`으로 Host 계정이 읽을 수 있는 외부 대상을 지정할 수 있다. `glob`은 Pi의 `find`를 실행한다. Pi의 검색 도구는 `fd`와 `rg`를 사용한다. 도구 결과는 모델 입력과 대화·Trajectory 기록에 포함될 수 있다.

[일반 파일 읽기](../packages/host-plugins/src/filesystem/read.ts)는 해석된 절대 경로에서 원본 바이트를 스트리밍하며 프리셋·엔진·모델 출력 계약에 의존하지 않는다. [Pi 읽기 어댑터](../packages/host-plugins/src/pi/read.ts)는 일반 읽기를 주입하고 Pi의 경로 해석과 `offset`·`limit`에 따라 텍스트를 반환한다. 요청한 줄 하나가 Pi의 50 KiB 한도를 넘으면 두 OS에서 한도만 알리며, 일반 페이지와 이어 읽기 안내는 Pi가 처리한다.

[glob](../packages/host-plugins/src/filesystem/glob.ts), [grep](../packages/host-plugins/src/filesystem/grep.ts), [write](../packages/host-plugins/src/filesystem/write.ts), [edit](../packages/host-plugins/src/filesystem/edit.ts), [셸](../packages/host-plugins/src/process/shell.ts)의 일반 함수 계약은 Pi와 Flue를 참조하지 않는다. 일반 호출과 모델 등록은 각각 `pi/`의 같은 이름을 가진 구현을 사용한다. 검색과 파일 변경은 Pi의 공개 구현과 텍스트 결과·오류 동작을 따른다. 직접 호출에는 에이전트 세션 권한이 자동 적용되지 않는다. 경계 검사는 일반 계약이나 Host 권한에서 Pi·Flue로 역방향 의존성이 생기는 것을 막는다.

[Pi 연결부](../packages/host-plugins/src/pi/tool.ts)는 첫 도구 생성 시 Pi의 공개 모듈을 동기로 불러와 프로세스 안에서 재사용한다. Flue는 모델 요청 전 도구 설명과 스키마를 동기로 등록하며, 중단된 작업을 복구할 때도 같은 경로를 사용한다. Pi를 갱신할 때는 Node에서 모듈을 동기로 읽을 수 있는지와 새 프로세스의 첫 도구 호출을 확인한다.

Workspace write와 Full access의 직접 파일 변경은 [Host 파일 접근 정책](../packages/host-plugins/src/workspace/file-mutations/operations.ts)을 거친다. Pi가 경로를 해석한 뒤 Host가 실제 파일·폴더 작업에서 워크스페이스 경계, 링크, 세션 권한을 검사한다. 그 범위 안에서 Pi `write`는 폴더를 만들고 파일을 덮어쓸 수 있으며, Pi `edit`는 정확한 치환을 적용한다. 파일 시스템을 동시에 변경하는 다른 프로세스까지 OS 수준으로 격리하는 정책은 아니다.

Full access에서만 Windows Host의 `pwsh` 또는 그 외 지원 Host의 `bash`를 등록한다. `pwsh`는 Pi의 `powershell`을 실행한다. 셸은 워크스페이스에서 시작하며 Host 계정 권한과 환경변수를 상속한다. 명령 시간 제한, 출력 처리, 중단은 Pi 기본 동작을 따른다. 실행 환경의 격리는 운영체제나 별도 실행 환경에서 관리한다. [Pi의 실행 권한](https://pi.dev/docs/latest/security) · [Pi의 Windows 셸](https://pi.dev/docs/latest/windows)

[Pi 셸 어댑터](../packages/host-plugins/src/pi/shell.ts)의 일반 실행 함수는 출력 스트림과 종료 코드를 제공한다. 모델 호출은 같은 함수를 Pi 도구에 연결해 출력 제한을 적용하고, 프로세스 시작 직전에 전달받은 권한 검사 함수를 호출한다.

[demo 어댑터](../packages/client/src/features/conversation/data/demo.ts)는 워크스페이스·세션·메시지·세션별 draft를 메모리에 둔다. 모델을 호출하지 않고 고정 응답을 추가한다. 권한·모드 선택은 화면에서 미리 볼 수 있다. 첨부는 이름만 보관하고 파일 내용 업로드는 없다.

[Conversation](../packages/client/src/features/conversation/shell/conversation.tsx)의 샘플 mode는 뷰 컴포넌트 상태다. [Composer](../packages/client/src/features/conversation/composer/composer.tsx)의 샘플 권한·attachments는 `key=session.id`에 따른 세션 전환 때 초기화된다. 같은 세션의 첫 전송·탭 변경·모바일 목록 왕복에서는 Composer를 유지한다.

[ConversationSidebar](../packages/client/src/features/conversation/shell/sidebar.tsx)는 검색·정렬·폴더 접힘을 로컬 상태로 갖는다. [워크스페이스 등록 폼](../packages/client/src/features/conversation/shell/workspace-form.tsx)은 사이드바와 첫 대화 입력창에서 재사용한다. [Files 패널](../packages/client/src/features/files/panel.tsx)은 플러그인이 만든 closure store로 선택/접힘을 보관해 패널 재개방·레이아웃 전환에도 유지한다. 샘플 파일 텍스트는 이 모듈에 포함되며 실제 저장소 파일을 읽지 않는다.

Workbench는 sidebar 폭/접힘, 활성 패널, 포커스 반환과 반응형 배치를 소유한다. 사용자 resize 선호는 자동 축소로 덮어쓰지 않는다. [ThemeProvider](../packages/ui/src/components/theme-provider.tsx)는 테마 선호를 저장하고 System은 OS 변경을 추종한다. 초안·패널 상태와 샘플 대화는 reload 시 초기화된다.

## 반응형 경계

[use-mobile](../packages/client/src/workbench/ui/use-mobile.ts)은 창 너비로 모바일을 판정한다. [columns](../packages/client/src/workbench/ui/columns.ts)는 전역 레일을 제외한 프레임의 열 수용량을 계산한다. 두 측정 기준은 서로 다르며 정확한 치수와 UX는 [디자인 시스템](design-system.md)에 둔다.

모바일과 데스크톱은 같은 registry·서비스·컴포넌트를 사용한다. shell이 목록/대화와 Sheet 전환을 소유하고 Composer가 입력 높이를 제한한다. 별도 모바일 데이터 계층이나 엔진을 만들지 않는다.

## 변경 시 확인

서비스 선언·등록 위치·상태 수명·앱 조립·전송 경계가 바뀌면 이 문서를 검토한다. 검증할 불변식은 runtime 시작 실패/종료, 중복 등록, 뷰 fallback과 등록 해제다. [연결 모드 통합 테스트](../test/connected-product.test.ts)는 실제 Host 라우터와 웹 제품 조립을 HTTP 요청으로 연결하고, 로컬 Flue fixture로 로그인 복귀·초기 데이터·도구 기록·재시작 복원을 검사한다. 소스 빌드와 검사 명령은 [개발 문서](development.md), 실시간 전송·저장·파일 어댑터에 대한 미결정 사항은 [로드맵](roadmap.md)이 소유한다.
