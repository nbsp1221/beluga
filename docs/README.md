---
status: current
owner: maintainers
last_reviewed: 2026-11-13
---

# 문서 지도와 관리 규칙

Beluga의 문서는 다음 작업자가 올바르게 변경하는 데 필요한 지식을 보존한다. 조사량이나 작업 시간을 기록하기 위해 파일을 추가하지 않는다.

## 읽을 문서

- [제품](product.md): 비전, 사용 맥락, 제품 원칙과 비목표.
- [아키텍처](architecture.md): 현재 코드의 책임·의존성·상태 수명과 확장 경계.
- [디자인 시스템](design-system.md): 현재 UI 규칙, 승인된 확장 범위, 관리 코드와 검수 기준.
- [로드맵](roadmap.md): 미구현 작업, 미결정 사항, 검증 공백과 완료 조건.
- [독립 플러그인 제품 결정](decisions/0001-independent-plugin-product.md), [디자인 시스템 확장 결정](decisions/0002-design-system-extension-policy.md): 중요한 선택의 이유와 비용.
- [사용자 README](../README.md): 설치 경로와 첫 대화.
- [Host 운영](hosting.md): 실행 계정, 원격 접속, 데이터 보관과 문제 진단.
- [릴리스 검증](releasing.md): 설치 산출물, 실행 및 데이터 유지 확인.
- [개발](development.md), [에이전트 지침](../AGENTS.md), [제3자 고지](../THIRD_PARTY_NOTICES.md): 소스 빌드와 검사, 작업 규칙, 출처·라이선스.

## 한 사실의 관리 위치

현재 계약은 소유 문서 한 곳에서 관리하고 다른 문서는 링크한다. 타입·기본값·패키지 목록은 소스를 연결하며 수동 카탈로그를 복제하지 않는다. 이해에 필요한 경계와 중요한 수치는 설명하되 코드 변경과 함께 검토한다.

현재 동작은 코드에 대조한다. 승인된 의도와 코드가 다르면 불일치로 기록하며 코드를 근거로 승인을 소급해서 만들지 않는다. 미래의 제안을 구현 사실이나 확정된 결정으로 쓰지 않는다.

루트 AGENTS는 상시 작업 규칙과 읽기 안내만 둔다. 개인의 대화 선호는 개인 설정에 둔다. 하위 AGENTS는 해당 영역만의 추가 규칙이 있을 때 만들고 루트 규칙을 복제하지 않는다.

## 버전 관리와 폐기

프로젝트에 남길 문서는 반복되는 독자 필요가 있고, 관리 책임과 갱신 계기가 있어야 한다. 제품 경계·현재 계약·중요한 결정 이유·법적 고지·미해결 위험은 보존한다. 임시 계획, 전체 대화, 조사 초안, 실행 로그, 스크린샷, 일회성 컴포넌트 대조표는 영구 문서가 아니다.

작업 증거는 저장소 밖 작업 공간 또는 Git에서 제외한 `.local/`에 둔다. 필요한 결정·출처·검증 공백을 소유 문서로 옮긴 뒤 작업 종료 시 폐기 여부를 검토한다. 이슈 트래커를 도입하면 상세 작업 목록을 그곳으로 옮기고 로드맵과 이중 관리하지 않는다.

삭제 전에는 다음을 확인한다.

1. 유효한 결정의 이유·정확한 범위·관리 코드와 미해결 항목을 이관한다.
2. 새 문서를 코드와 대조하고 이전 파일을 가리키는 링크를 수정한다.
3. Git 복구가 불가능한 원본은 저장소 밖에 복사하고 해시로 검증한다.
4. 중복 원본을 제거한다. 커밋되는 `docs/archive/`에 일회성 기록을 계속 쌓지 않는다.

ADR은 예외다. 중요한 결정을 바꾸면 후속 ADR을 쓰고 이전 ADR은 `superseded`와 대체 링크로 보존한다. 기존 승인 범위를 축소·확대하는 문서 정리는 새 제품 결정이므로 먼저 확인한다. 커밋 대상이라는 분류가 커밋 허가는 아니다.

## 프론트매터

`docs/`의 현재 기준 문서는 `status: current`, `owner`, `last_reviewed: YYYY-MM-DD`를 필수로 둔다. `maintainers`는 문서에 연결된 코드·제품 결정을 관리하는 저장소 유지관리자의 역할명이다. 담당이 분리되면 실제 팀/계정으로 바꾼다.

`last_reviewed`는 코드와 승인 내용을 대조한 날짜다. 오탈자 수정이나 포맷만으로 갱신하지 않는다. 날짜가 최근이라는 이유만으로 브라우저·실기기 검증 완료를 뜻하지 않는다.

ADR은 `status`, `date`, `decision-makers`를 필수로 둔다. 상태는 `proposed`, `accepted`, `rejected`, `superseded` 중 하나다. `date`는 결정 기록을 갱신한 날짜이며, 대체된 결정은 본문에서 후속 ADR을 연결한다. 역사적 결정을 주기적으로 최신 사실처럼 다시 쓰지 않는다.

루트 README·AGENTS와 라이선스 고지는 이 스키마 대상이 아니다. 특히 AGENTS frontmatter를 도구 공통의 조건부 로딩 기능으로 가정하지 않는다. `expires`나 `retention`은 Git 제외나 자동 삭제를 실행하지 않으므로 현재 스키마에 넣지 않는다.

## 갱신과 검증

계약 변경은 아키텍처, 공통 UI 변경은 디자인 시스템, 중요한 방향 변경은 ADR을 같은 변경에서 검토한다. 해결된 로드맵 항목은 제거하고 지속적으로 필요한 계약만 해당 문서에 남긴다. 완료 작업 일지로 만들지 않는다.

문서 변경 시 프론트매터의 필수값·날짜·상태, 상대 링크와 제목 앵커, 삭제 문서에 대한 참조, 소유 코드의 존재를 확인한다. Markdown 포맷은 루트에서 `pnpm format:check`로 확인한다. 링크·메타데이터는 검토자가 확인한다.

문서만 바꾼 경우 전체 앱 빌드가 검증을 대신하지 않는다. 코드·의존성·설정 변경이 동반되면 해당 검사를 추가한다. 문서 사이트·별도 CMS·복잡한 수명 자동화는 현재 필요하지 않다.

## 근거

- [DSH 문서 기준](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/AGENTS.md): 사실의 단일 관리 위치와 상시 지침/상세 문서 분리. 대규모 폴더 체계 전체를 도입하지 않는다.
- [Diátaxis](https://diataxis.fr/start-here/): 독자의 학습·절차·참조·설명 목적을 구분한다. 빈 디렉터리부터 만들지 않는다.
- [Google의 문서화 지침](https://abseil.io/resources/swe-book/html/ch10.html): 개발 흐름 안의 갱신, 책임·검토 날짜, 쓸모없는 문서의 제거 또는 폐기 표시.
- [ADR 원안](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [MADR 메타데이터](https://adr.github.io/madr/decisions/0013-use-yaml-front-matter-for-meta-data.html): 중요한 결정 이유와 대체 이력 보존.
- [GitHub Docs 스키마](https://github.com/github/docs/blob/main/src/frame/lib/frontmatter.ts): 메타데이터는 실제 검증 규칙과 함께 관리한다. GitHub의 필드 전체를 복제하지 않는다.
- [Codex 지침](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [AGENTS frontmatter 토론](https://github.com/agentsmd/agents.md/issues/10): 도구의 지침 발견 규칙과 자체 문서 메타데이터를 구분한다.
