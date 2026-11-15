---
status: accepted
date: 2026-11-07
decision-makers:
  - Beluga product owner
---

# 독립 제품과 플러그인 조립 경계

이 기록은 기존 사용자 승인과 구현의 근거를 통합한다. 새로운 엔진·transport·배포 방식의 승인을 뜻하지 않는다.

## 맥락

DSH의 기능 확장성과 UI 구조를 참고하면서 Beluga의 스택과 제품 방향에 맞게 변경할 수 있어야 한다. DSH 위에 확장을 붙이면 upstream 제품 구조에 종속되고, 전체 엔진·UI 기반을 직접 만들면 유지 부담이 커진다.

## 결정

DSH에서 영감을 받은 독립 제품을 만들고 Turborepo 모노레포에서 앱 조립, 공통 계약, runtime, UI와 기능 플러그인을 나눈다. 기능은 서비스/화면 등록과 해제 가능한 수명으로 연결한다. 공유 버튼 같은 표현 요소는 라이브러리로 재사용한다.

Client와 Host는 별도 그래프이며 네트워크 계약을 통해 연결한다. 현재 신뢰된 내부 플러그인의 정적 조립을 사용한다. 외부 설치·마켓플레이스·핫스왑·범용 레이아웃 엔진을 미리 도입하지 않는다. 구현의 정확한 책임과 진입점은 [아키텍처](../architecture.md)가 소유한다.

DSH/Codex/파생 제품 소스와 자산을 제품 구현으로 복사하지 않는다. 공식 shadcn 생성은 허용된 재사용이다. 거절된 초기 프론트는 새 구현의 템플릿이나 유지할 구조적 근거로 삼지 않는다.

## 비교한 대안과 결과

DSH 배포판/플러그인 확장은 기존 기능을 빠르게 활용하지만 독립 제품이라는 목표와 맞지 않는다. 반대로 모든 엔진·기본 요소의 자체 구현은 현재 요구보다 크다. 독립 셸과 명시적인 어댑터는 양쪽 비용을 줄이지만 UI/Host 상태 수명과 비동기 전송 계약은 Beluga가 설계해야 한다.

SDK 실행 엔진의 재사용을 우선 검토하되 어떤 SDK나 worker 격리가 필요할지는 후속 결정이다. 모든 기능을 개별 패키지로 배포하지 않고 필요가 생길 때 경계를 강화한다. 이 단계의 플러그인 분리는 보안 격리를 제공하지 않는다.

## 근거와 한계

- [DeepSeek Harness Desktop b0f5a78](https://github.com/ShuaixinHuang/deepseek-harness-desktop/tree/b0f5a786bbaa1cd99256fb8dfe4276bebfbf0ff0): DSH 영감을 명시한 독립 Desktop/CLI. Electron UI와 core RPC worker, Pi SDK를 분리한다. 엔진 재사용과 프로세스 경계의 사례이며 Beluga에 Electron을 도입하라는 근거는 아니다.
- [PiWeb ab9a571](https://github.com/RexVane/PiWeb/tree/ab9a5718a8ed3bd60f0a6f2fabc748a610d19adc): 자체 웹 UI와 Pi SDK를 조립하며 세션과 snapshot/이벤트 변환을 분리한다. DSH 영감은 [과거 README](https://github.com/RexVane/PiWeb/blob/5fa6b188ec999b07c985e347363a97c2722f5762/README.md)의 근거이며 현재 README가 같은 연관성을 주장한다고 쓰지 않는다. 해당 SSE/재연결 방식의 그대로 도입은 승인되지 않았다.
- [Tenon 35957a7](https://github.com/harry-ma-qiang/tenon/tree/35957a78f2db91e785e71ded0da4e2bd57464d8f): Cordis 영감 독립 microkernel과 선택적 DSH bridge. 서비스·부작용의 소유자 해제를 참고한다. 동일한 소비자용 프론트 제품이 아니며 BEAM/다중 언어 bus는 채택하지 않는다.

위 비교는 소스 근거다. 각 제품 전체 실행·보안·성능을 검증한 것이 아니고 시장의 다수결도 아니다. DSH 런타임에 의존하는 확장 사례를 독립 제품의 증거로 혼동하지 않는다.

## 확인 방법

앱이 플러그인을 선택하고 기능이 UI 등록/자원을 해제하는지, 공통 UI가 라우팅·서비스에 의존하지 않는지, Client가 Host 구현을 import하지 않는지 검토한다. 시작 실패와 종료·등록 해제는 runtime/기능 검증으로 확인한다. 미완성 계약은 [로드맵](../roadmap.md)에 남긴다.
