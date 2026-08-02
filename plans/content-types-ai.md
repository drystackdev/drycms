# Content Type Builder được AI hỗ trợ

## Mục tiêu

Mở rộng Builder Content type hiện có để AI biến mô tả tự nhiên thành proposal
content type có thể review. Người dùng luôn nhìn thấy và chỉnh proposal trước
khi nó trở thành staged draft; AI không được tự ý migrate schema hoặc ghi dữ
liệu.

Phạm vi MVP:

- Tạo collection, singleton hoặc component mới.
- Cập nhật type hiện có theo hướng additive/non-destructive.
- Đề xuất field, label, description, validation và feature mà builder hiện tại
  đã hỗ trợ.
- Thay đổi nguy hiểm (xóa/purge, retype, rename machine name, đổi relation
  target, tắt feature) chỉ xuất hiện trong diff/cảnh báo và cần xác nhận rõ.
- Mọi thay đổi thật đi qua draft-store.ts, planBatch và applyBatch; không có
  đường ghi schema riêng cho AI.

Không nằm trong MVP: AI tự apply từ chat; chỉnh role, permission metadata, user
auth fields, aiKey, seo hoặc type hidden/frozen; lưu transcript/raw response/
prompt có secret; tạo field renderer/editor riêng cho AI.

## Baseline cần bám theo

Kế hoạch tích hợp vào implementation hiện có, không tạo lại:

1. BuilderContentType.tsx đã là entry page, có builder panel, AI chat, mobile
   tabs và mở ContentTypeEditor trong builder-editor-dialog.
2. ContentTypeEditor đã xử lý field order, system fields, relation mirrors,
   feature toggles, protected fields và trash hai giai đoạn.
3. FieldsList, FieldListItem, FieldDialog, field registry và FeaturesFieldset
   là UI/model chính cần tái sử dụng.
4. draft-store.ts lưu DraftEntry { definition, isNew } trong localStorage và
   được Content Types page/Builder dùng chung.
5. ApplyBuildDialog đã snapshot live/draft, gọi content-types mode plan rồi
   mode apply, hiển thị destructive summary, xử lý partial failure và
   optimistic version.
6. ContentTypeDefinition.version là optimistic lock; mọi save path mới phải
   kiểm tra version.
7. aiKey đã là hidden singleton có hidden repeatable component aiKeyItem.
   Credential write-only và mã hóa; không thực hiện migration aiKey trong plan.
8. /api/ai/chat đã có authentication, Super Admin check, local CLI/server
   provider, fallback, SSE và conversation TTL trong memory. Builder đã gửi
   conversationId và đọc stream.

## Flow và UX mục tiêu

Giữ /dry/content-types/builder là entry point chính. Có thể thêm CTA từ
/dry/content-types, nhưng không tạo page AI thứ hai và không chuyển workspace
chính vào dialog mới.

Flow:

    Mô tả yêu cầu
      -> /api/ai/chat hỏi/thu thập thông tin
      -> proposal JSON đã parse/validate
      -> mở proposal trong ContentTypeEditor hiện tại
      -> người dùng chỉnh và chọn thay đổi
      -> Save to staged draft
      -> Content Types / Apply and build
      -> planBatch -> review warning/version -> applyBatch

Chat chỉ kết thúc ở question, proposal, draft hoặc error. Nút apply thật vẫn
nằm trong Apply and build, không nằm trong chat.

Proposal wrapper hiển thị trạng thái New, Existing, Modified, Review required và
Rejected. FieldDialog tiếp tục là nơi chỉnh field/validation. Không tạo schema
editor song song. ApplyBuildDialog là nơi hiển thị migration/destructive
summary chính thức; physical SQL preview, nếu cần, là phase sau dựa trên
resolveTableTree và DOM table/card.

Builder/proposal phải có loading, empty, error, retry và overflow ngang trên màn
hình nhỏ. DOM là nguồn hiển thị schema chính; connector/icon chỉ bổ sung. Giữ
OverlayScrollbars, class conventions và reduced-motion hiện có. Không hiển thị
chain-of-thought, chỉ hiển thị trạng thái kiểm chứng được và lỗi đã redact.

## Hợp đồng proposal

Dùng schema trung gian versioned, không cho model trả ContentTypeDefinition rồi
ghi thẳng:

    {
      schema: 'drycms.ai.content-type-proposal.v1',
      operation: 'create' | 'update',
      targetId?: string,
      baseVersion?: number,
      assumptions: string[],
      questions: Question[],
      changes: ProposedChange[],
      warnings: Warning[]
    }

Mỗi ProposedChange tham chiếu field/feature bằng id hoặc stable path và chứa
old/new value để tạo diff. Server phải:

- giới hạn body, số field, độ sâu component/relation và độ dài text;
- normalize name/order/config/validation bằng helper hiện có;
- kiểm tra reserved/duplicate name, target type, component cycle và table
  collision;
- loại bỏ hidden/frozen type, protected field, role/permission data, secret
  value và key ngoài allowlist;
- kiểm tra baseVersion với definition live;
- dựng candidate trong memory và chạy validation/dry-run hiện có;
- trả normalized proposal cùng warning, không ghi schema.

Hiện FieldValidation có unique nhưng chưa có indexed. Proposal không được tạo
indexed giả trước khi capability index hoàn thành.

## Tích hợp AI hiện tại

### Chat API

Mở rộng /api/ai/chat thay vì tạo /ai/sessions riêng ở MVP:

- giữ conversationId, SSE, TTL và Super Admin enforcement;
- bổ sung intent để phân biệt question và proposal;
- dùng instruction cố định yêu cầu proposal schema v1;
- validate structured output server-side trước event proposal;
- giới hạn message/output và plan lại mọi proposal trước khi lưu draft;
- conversation hết TTL hoặc version stale thì UI yêu cầu tạo proposal lại.

Chỉ khi cần resume cross-device/audit đầy đủ mới thêm session store server-side.

### Config/provider

Tái sử dụng DryAiOption hiện tại:

    ai: {
      mode: 'local' | 'server',
      provider?: 'codex' | 'claude' | 'openai' | 'anthropic',
      command?, args?, keyName?, model?, baseUrl?, cwd?, timeoutMs?
    }

Không đổi shape config sang provider google/custom trong feature này. AI Key
hiện dùng label ChatGPT, Anthropic, Google, Custom; server đã normalize chúng
thành provider nội bộ. Nếu cần ổn định hóa id, làm migration riêng có
backward-compatibility test.

DEV CLI chỉ chạy ngoài production, dùng argv đã tách, timeout, exit-code check
và không shell-interpolate prompt. Server mode đọc key từ singleton aiKey,
decrypt ở server và redact lỗi.

## Draft và apply

1. Thêm AI workspace state tối thiểu trong localStorage, tách khỏi shape
   DraftEntry: conversationId, normalized proposal, target/baseVersion, selected
   change ids, active tab, collapse state và updatedAt.
2. Không lưu key, secret, raw provider response hoặc transcript đầy đủ.
3. Save to staged draft phải validate/plan ở server trước rồi gọi
   saveDraft(definition, isNew).
4. Builder card và Content Types page giữ draft badge/count theo logic hiện có.
5. Nếu live version khác baseVersion, báo stale và yêu cầu reload/merge/retry;
   không âm thầm overwrite.
6. Dùng nguyên ApplyBuildDialog: planBatch là dry-run, destructive summary cần
   review, applyBatch mới chạy migration; partial success giữ draft chưa apply.

## AI key và quyền

Không xây lại AI Keys. Chỉ bổ sung capability cần cho Builder vào API hiện có:

- test connection dùng payload cố định, không chứa content người dùng;
- response chỉ gồm status/provider/model/latency/message đã redact;
- key write-only, không trả trong list, console, log, audit;
- chat, proposal validation và plan yêu cầu session + Super Admin;
- schema write tiếp tục chịu enforcement hiện tại.

AI không được sửa role, user protected fields, aiKey, hidden seo, role
permissions hoặc auth data. Permission choices vẫn sinh từ metadata hiện tại.

## Physical index (phụ thuộc, không gộp vào AI MVP)

Nếu muốn AI đề xuất indexed, hoàn tất capability schema trước:

- thêm indexed vào validation/model và FieldDialog;
- mở rộng ColumnSpec, tree.ts, migration.ts, SQLite và D1 cho non-unique/
  unique index và toggle/drop an toàn;
- đưa index changes vào SavePlan/diff; test create, alter, recreate,
  child-table, rename và duplicate data;
- file engine chỉ lưu definition, không phát sinh DDL.

Trước phase này, validator phải reject hoặc trả warning cần xử lý, không
silently tạo index.

## Các phase

### Phase 0 — contract và baseline

- Viết kiểu/test dùng chung cho BuilderContentType, ContentTypeEditor,
  draft-store, ApplyBuildDialog và /api/ai/chat.
- Chốt proposal v1, allowlist và destructive policy.
- Test reject hidden/frozen/protected/secret và stale version.
- Xác nhận seed aiKey singleton/component; không thêm migration ngược.

### Phase 1 — proposal pipeline

- Tạo parser/validator/normalizer server-side cho proposal v1.
- Mở rộng /api/ai/chat trả event proposal đã validate, giữ SSE/TTL.
- Adapter proposal -> ContentTypeDefinition; không bypass editor hoặc
  content-types route.
- Test malformed JSON, oversized output, cycle, duplicate/reserved name,
  invalid target/config và provider failure.

### Phase 2 — tích hợp Builder

- Hiển thị proposal/change status trong chat và Builder panel.
- Mở proposal vào ContentTypeEditor, tái sử dụng field list/dialog/features.
- Thêm Save to staged draft, restore workspace, stale warning và discard/retry.
- Không thêm page/dialog schema mới.

### Phase 3 — plan/apply và hardening

- Nối staged draft vào ApplyBuildDialog qua planBatch/applyBatch.
- Test diff, destructive warning, partial failure, retry và lock conflict.
- Test permission, prompt injection, secret redaction, SSRF custom URL, CLI
  timeout, provider fallback, invalid stream và expired conversation.
- QA Playwright screenshot + computed-style/DOM assertion ở light/dark; chạy
  typecheck, unit test, build và git diff --check.

### Phase 4 — capability mở rộng

- Thực hiện physical index nếu product thật sự cần AI đề xuất index.
- Sau đó mới thêm physical usage preview từ resolveTableTree và ai.lang/copy
  đa ngôn ngữ.

## Tiêu chí hoàn thành MVP

- Từ /dry/content-types/builder, người dùng tạo được collection/singleton/
  component bằng mô tả tự nhiên và nhận proposal có schema version.
- Proposal được chỉnh bằng editor hiện tại, lưu và mở lại được sau reload; không
  migrate trước Apply and build.
- Mọi schema write đi qua validation, optimistic lock, planBatch và applyBatch;
  conflict không làm mất draft.
- AI không thể chỉnh system/protected/permission/secret data và không lộ key.
- Provider/CLI lỗi hoặc output sai đưa UI về trạng thái retryable, không tạo
  definition/migration một phần.
- Builder, Content Types list, draft badge và Apply and build vẫn hoạt động
  bình thường khi không dùng AI.
