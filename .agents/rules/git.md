# Git Operation Policy & Auto-Commit Rule

- Git 및 npm 관련 명령어 실행 (`add`, `commit`, `push`, `pull`, `status`, `build`, `dev` 등) 시 별도로 묻지 않고 항상 승인(Always Yes) 처리하여 즉시 실행합니다.
- 코드 수정, 기능 추가, 버그 수정 등의 작업이 완료되면 별도로 요청하지 않더라도 자동으로 변경된 파일들을 `git add`, 적절한 영문 커밋 메시지로 `git commit`, 원격 저장소로 `git push`까지 자동으로 진행합니다.
