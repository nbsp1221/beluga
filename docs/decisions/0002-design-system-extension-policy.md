---
status: accepted
date: 2026-11-07
decision-makers:
  - Beluga product owner
---

# 공식 기본 요소와 승인된 공통 확장

이 기록은 기존 사용자 승인을 통합한다. 입력 포커스 결정은 [공식 입력 포커스 복원](0003-restore-official-input-focus.md)에서 대체했다. 현재 수치·소유 코드·예외의 적용 범위는 [디자인 시스템](../design-system.md)의 단일 register가 기준이다.

## 맥락

DSH와 Codex의 익숙한 레이아웃을 유지하면서 Tailwind와 shadcn으로 일관되고 변경 가능한 프론트를 만들어야 한다. 원본 CSS 복사, 화면마다 다른 override, 공식 컴포넌트를 사용했다는 이유만으로 UX까지 검증됐다고 보는 방식은 이 목표를 충족하지 못했다.

## 결정

기존 semantic token 값 → 공식 public props/조합 → 근거와 사용자 승인이 있는 공통 확장 순서로 검토한다. 새 토큰·primitive 내부 수정·override는 기본적으로 허용하지 않지만, 실제 요구와 유지 비용을 설명한 제한된 예외는 가능하다. 같은 조정을 다른 파일로 옮기는 것은 예외 제거가 아니다.

원본 픽셀 일치보다 승인된 공식 기본 크기·표현을 우선한다. DSH 공간 구성에 좌측 전역 탐색, 항상 보이는 대화 헤더, 모바일 목록/대화 분리 등 합의된 제품 결정을 조합한다. 구현 상태 문구를 제품 chrome에서 제거하되 실제 엔진이 있다는 의미를 만들어내지 않는다.

공식 기본으로 돌아갈 수 있는 수정은 제거한다. 유지하는 확장은 가장 가까운 공통 소유자에서 관리하며 기능 상태를 UI 패키지로 옮기거나 일회용 wrapper로 조정을 숨기지 않는다. 새 요구가 없다면 별도 모바일 토큰 체계나 composer 색 토큰을 만들지 않는다.

## 중요한 선택과 비용

테마의 색 값만으로는 공식 입력의 고정 focus 두께를 변경할 수 없었다. 사용자는 공통 입력 focus 토큰과 이를 소비하는 세 primitive 연결을 승인했다. 이후 값 변경은 중앙화되지만 최초 소스 연결과 registry 업그레이드 검토 비용은 남는다. 전역 ring 의미를 바꾸거나 투명화하는 대안은 다른 컨트롤까지 영향을 줘 채택하지 않았다.

Composer는 일반 폼과 다른 복합 편집 표면이므로 별도 승인된 정상 focus 예외를 갖는다. 기존 card 역할을 선택하는 조합과 그 색 값을 정하는 테마는 구분한다. 오류·커서·툴바 focus·강제 색 피드백까지 제거하는 승인이 아니다.

Select 동작과 ghost Button 표현은 공개 render 조합으로 연결한다. 폴더의 expanded와 선택 상태를 분리하는 조정, 모바일 target과 pane 크기 역시 사용자 승인 범위로 한정한다. 공식 Sidebar 전체를 도입해 독립 레일·resize·등록 소유권을 바꾸는 것은 단순 스타일 정리가 아니다.

이 정책은 모든 className을 예외로 취급하지도, public className이므로 모두 허용하지도 않는다. 구조·상태 동작·의미별 색·표현 조정의 역할과 실제 영향으로 판단한다. 시각적 변화가 필요한 재검토는 비교 화면과 대안을 먼저 제시한다.

## 근거

- [shadcn theming](https://ui.shadcn.com/docs/theming), [Base UI composition](https://base-ui.com/react/handbook/composition): 의미별 테마 값과 행동/표현 조합의 경계.
- [shadcn monorepo](https://ui.shadcn.com/docs/monorepo): 공유 기본 요소와 앱 기능 조합을 구분하는 실무 사례.
- [Atlassian border](https://atlassian.design/foundations/border), [MUI theme components](https://mui.com/material-ui/customization/theme-components/): 공통 폭/색과 명시적인 확장 방식. 특정 제품 수치나 모든 스타일을 토큰으로 만들라는 근거는 아니다.
- [assistant-ui Composer](https://www.assistant-ui.com/docs/primitives/composer), [DSH 입력 표면](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css): 내부 편집기와 외부 표면 분리. 모든 focus를 없애는 보편 규칙은 아니다.

## 확인 방법

공식 소스 diff와 실제 라이트/다크·데스크톱/모바일 상태를 함께 확인한다. 토큰 값을 바꿨을 때 해당 역할의 모든 소비자가 반영되는지, 승인된 예외가 한 소유자에서 관리되는지, 오류·키보드·모달 수명이 유지되는지 확인한다. 미검증 접근성 범위는 [로드맵](../roadmap.md)에 남기고 전체 적합성을 선언하지 않는다.
