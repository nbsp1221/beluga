---
status: accepted
date: 2026-11-14
decision-makers:
  - Beluga product owner
---

# 공식 입력 포커스 복원

[공통 확장 결정](0002-design-system-extension-policy.md)의 입력 포커스 예외를 대체한다. 기존 1px 안쪽 윤곽선을 유지하려면 세 기본 요소의 생성 소스를 수정하고 Composer에서 다시 억제해야 했다. 일반 입력과 Composer의 키보드 포커스는 공식 Base Nova 스타일로 표시할 수 있다.

Input, Textarea, InputGroup은 공식 포커스 경계와 3px 링을 사용한다. Composer의 입력 포커스는 바깥 InputGroup에 표시된다. 입력 전용 토큰과 일반 포커스 억제 규칙을 제거한다. 강제 색상에서는 브라우저가 그림자 링을 지우므로 Composer의 기존 Highlight 윤곽선을 유지한다.

레지스트리 갱신 시 일반·오류·비활성 상태와 키보드 포커스를 확인한다. 강제 색상에서도 포커스 경계를 구분할 수 있는지 확인한다. [shadcn Input Group](https://ui.shadcn.com/docs/components/base/input-group) · [shadcn Prompt Input](https://ui.shadcn.com/docs/ai-elements/base/prompt-input)
