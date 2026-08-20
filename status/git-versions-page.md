# Trang quản lý version git (`/dry/settings/versions`)

Yêu cầu gốc của user (2026-08-21): "làm trang quản lý version git, có thể xem
toàn bộ lịch sử quay về 1 commit bất kì" + "ai cũng xem được" (AI đọc được
lịch sử qua MCP).

## Plan

### Quyết định đã chốt với user (2026-08-21)

| # | Câu hỏi | Chốt |
|---|---|---|
| 1 | Khôi phục những gì | **Code + schema (`content/types.json`) + entries (`content/entries/**`)** - toàn bộ trạng thái repo tại commit đó. |
| 2 | Cơ chế revert trên git | **Commit mới (revert tiến)**: tạo 1 commit có nội dung = commit cũ, đặt lên HEAD. Không force push, không xoá commit của ai. |
| 3 | Sau khi restore | **Tự chạy Build & publish** (client-side, `publishAllPages`). |
| 4 | Vị trí trang | **Settings → Versions** (`/dry/settings/versions`), cạnh "Git Sync". |
| 5 | AI (MCP) | **Chỉ đọc**: `list_versions` / `read_version` / `read_version_file`. Không có tool restore - rollback là hành động phá huỷ, chỉ người bấm. |

### Ràng buộc đã xác minh trong repo

| # | Sự thật trong code | Hệ quả |
|---|---|---|
| 1 | `pullPagesSourceSnapshot` lọc `PAGE_SOURCE_FILE_PATTERN` = `tsx/ts/css/md` | Không bao giờ kéo `content/*.json`. Cần hàm pull mới lấy **cả 2 root** (page-source + `content/`). |
| 2 | `commitFiles` (github/gitlab) nhận 1 `isValidPath` | Commit revert cần validator hợp cả 2 root → thêm `commitRepositoryChanges`. |
| 3 | `getCommitDetail` lọc riêng page-source, `getContentCommitDetail` lọc riêng `content/` | Trang này cần detail **gộp** → `getRepositoryCommitDetail`. |
| 4 | `provider: "custom"` (self-hosted) không có REST API | Trang phải hiện trạng thái "không hỗ trợ" thay vì lỗi cứng (`CUSTOM_GIT_UNSUPPORTED_REASON`). |
| 5 | `planSave` ném `version_conflict` khi `next.version` ≠ version live | Định nghĩa lấy từ commit cũ mang version cũ → phải **gắn lại version live** trước khi apply, nếu không mọi restore đều fail. |
| 6 | `createEntry` dùng autoincrement, không nhận id | Restore entry phải giữ nguyên id (quan hệ relation trỏ theo id) → thêm `restoreEntry(type, allTypes, id, value)` vào `ContentEntryEngineAdapter` + 2 engine. |
| 7 | `redactSecretFields` xoá hẳn key `password`/`secretkey` khỏi JSON | Restore không được ghi đè secret bằng `undefined` → giữ nguyên giá trị đang có trong DB cho đúng các field đó. |
| 8 | `GIT_MIRROR_EXCLUDED_TYPE_NAMES` = role/user/githubSync/aiKey/memory | Restore entries **không đụng** các type này (token git, mật khẩu, key AI vẫn nguyên) - cũng là lý do restore không tự khoá chính mình ra ngoài. |
| 9 | `handleBatch` tự commit `content/types.json` sau khi apply | Restore cần tắt commit đó (`commitToGit: false`) để chỉ có **một** commit revert duy nhất. |
| 10 | Build chạy trong browser (`publishAllPages`) | Auto-build sau restore phải do client gọi, server không build được. |
| 11 | `resyncWorkingCopy` (`git-repo.ts`) đã có | Sau restore phải resync working copy ZenFS, nếu không dock Page Builder sẽ báo dirty giả. |

### Giai đoạn

- **G1 - lớp git**: `github-source-sync.ts` thêm `pullRepositorySnapshot`,
  `getRepositoryCommitDetail`, `readRepositoryFileAtCommit`,
  `commitRepositoryChanges`; mirror sang `gitlab-source-sync.ts`, decline
  trong `custom-git-source-sync.ts`, dispatch trong `git-source-sync.ts`.
- **G2 - engine**: `restoreEntry` (upsert theo id cố định) cho
  `entries-sqlite.ts` + `entries-d1.ts` + interface.
- **G3 - orchestrator**: `src/server/git-restore.ts` - pull snapshot → ghi
  page source → apply schema → restore entries → commit revert. Có
  `mode: "plan"` (không ghi gì, chỉ trả summary + destructive changes).
- **G4 - route**: `src/server/routes/versions.ts` (`GET ""`/`commit`/`file`,
  `POST restore`) + gate trong `handler.ts`.
- **G5 - client**: `src/pages/settings/Versions.tsx` + api client + route
  trong `App.tsx` + nav trong `DryLayout.tsx`; sau restore: `resyncWorkingCopy`
  → `publishAllPages`.
- **G6 - MCP**: 3 tool chỉ đọc.
- **G7 - test + typecheck**.

## Status

**Xong toàn bộ 7 giai đoạn (2026-08-21).**

Server:
- `github-source-sync.ts` + `gitlab-source-sync.ts`: `pullRepositorySnapshot`,
  `getRepositoryCommitDetail`, `readRepositoryFileAtCommit`,
  `commitRepositoryChanges` (đều bao cả 2 root); `custom-git-source-sync.ts`
  từ chối cả 4; dispatch trong `git-source-sync.ts`.
- Engine: `restoreEntry(type, allTypes, id, value)` (sqlite + d1 + interface)
  - upsert giữ nguyên id; `applyTimestamps` có mode `"restore"` (giữ
  createdAt/updatedAt của snapshot); `entry-validate.ts` thêm
  `keptSecretPaths` để field secret bị redact không làm fail `required`.
- `git-restore.ts`: pull snapshot tại sha + tại HEAD → ghi page source →
  `runBatch(..., { commitToGit: false })` cho schema → xoá type không còn →
  restore/xoá entries → ghi lại `drafts` của doc → **một** commit revert.
  `mode: "plan"` không ghi gì.
- `routes/versions.ts`: `GET ""`/`commit`/`file`, `POST restore`; gate đọc =
  quyền setting `githubSync`, gate restore = Page Builder + Content Types.
  `routes/content-types.ts` tách `runBatch` ra khỏi `handleBatch` và export
  `regenerateTypesCache`.

Client: `pages/settings/Versions.tsx` + `page-components/git/versions-http-api.ts`
+ route `/dry/settings/versions` + nav "Versions" cạnh "Git Sync" + CSS
`.versions-*`. Sau khi restore: `resyncWorkingCopy` → `publishAllPages`.

MCP (yêu cầu "ai cũng xem được"): `list_versions`, `read_version`,
`read_version_file` - **chỉ đọc**, không có tool restore. Đã ghi vào
`docs/MCP.md`.

Kiểm tra:
- `bun run typecheck` xanh; unit suite **1485/1485 xanh** (154 file, +11 test
  mới: `git-restore.test.ts` 3, `routes/versions.test.ts` 6, `restoreEntry`
  trong `entries-sqlite.test.ts` 2). `bun run build` xanh.
- QA thật trên dev server (repo GitLab thật `thanhkhan2k/drycms-storage`,
  nhánh `drycms-dev`): list 30 commit, commit detail + diff, đọc file tại
  commit, và **restore plan** đều trả dữ liệu đúng. Playwright: trang render,
  nav có "Versions", mở commit → 14 file + diff, bấm Restore → dialog tóm tắt
  đúng ("27 page-source files rewritten, 1 deleted"), Cancel đóng sạch,
  0 lỗi console.
- **Chưa chạy `mode: "apply"` trên repo thật** - nó sẽ ghi đè project sống và
  push commit lên GitLab của user, nên để user tự bấm.

Ghi chú phát hiện khi QA: các commit hiện có trên nhánh đều **chưa có**
`content/types.json` (feature content-types-json-file đang làm dở, chưa
commit), nên restore về chúng chỉ khôi phục page source và báo warning đúng
như thiết kế. Khi `content/types.json` đã được commit thì nhánh schema +
entries mới thực sự chạy.

## Speed

Hoàn tất trong một lượt, không có blocker. Không thêm dependency mới.
