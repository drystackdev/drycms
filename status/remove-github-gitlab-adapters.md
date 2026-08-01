# Loại bỏ adapter GitHub/GitLab

## Plan

1. Chốt phạm vi: loại bỏ GitHub/GitLab khỏi storage adapter và KV adapter; giữ nguyên UI/OAuth “Login with GitHub” vì đó không phải backend adapter.
2. Thu hẹp contract và config về các backend còn hỗ trợ: storage-family chỉ còn `local`; KV giữ `local`, `sqlite`, `D1`, `KV`.
3. Xóa factory/import/type/credential resolution và các file implementation/test riêng của GitHub/GitLab.
4. Cập nhật các consumer dùng chung: file content engine, icons, richtext storage, KV, route/config types và comments về backend.
5. Cập nhật test theo hành vi mới: mặc định local, reject config cũ ở config-resolution time, không còn test gọi remote adapter; bổ sung kiểm tra không còn `GITHUB_*`/`GITLAB_*` được đọc.
6. Cập nhật ARCHITECTURE, key-value plan và status/docs có tuyên bố GitHub/GitLab là backend được hỗ trợ.
7. Chạy `bun run typecheck`, `bun run test`, `bun run build`, rà soát `rg` và kiểm tra migration/config error message trước khi merge.

## Status

- Quyết định: xóa hoàn toàn GitHub/GitLab khỏi các backend adapter, không chỉ deprecate. Lý do chính là loại bỏ remote round-trip latency, retry/rate-limit/concurrency complexity và gánh nặng bảo trì khi hệ thống đã có local/SQLite/D1/KV phù hợp hơn cho runtime data.
- Đã khảo sát: `src/storage/github.ts`, `src/storage/gitlab.ts`, `src/storage/index.ts`, `src/kv/git.ts`, `src/kv/factory.ts`, `src/server/options.ts` và các test/docs liên quan.
- Đã xác định các mặt cắt cấu hình: `storage`, `icons`, `content.engine: "file"`, `richtext.storage`, `kv`.
- Đã xóa implementation/test: `src/storage/github.ts`, `src/storage/gitlab.ts`, `src/kv/git.ts` và các factory/import liên quan.
- Đã thu hẹp config về local storage và local/SQLite/D1/KV; config cũ GitHub/GitLab bị từ chối tại startup.
- Đã cập nhật consumer comments, architecture và KV plan.
- Xác minh: `bun run typecheck`, `bun run test` (585 tests), `bun run build` đều pass.

## Speed

- Phần khảo sát hoàn tất trong một lượt; không có blocker.
- Hoàn tất: 3 pha code/test/docs đã chạy xong; không còn blocker trong repo.
