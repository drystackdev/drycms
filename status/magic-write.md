# Magic Write (AI hỗ trợ viết bài)

Nguồn yêu cầu: `plans/ai-generate.md`

## Plan

### Quyết định kiến trúc

1. **Không dùng `field-events.ts`'s CustomEvent bus** — bus đó dành cho code
   ngoài bundle (plugin/extension). Magic Write là component cùng bundle với
   `ContentEntryEditor.tsx`, nên nhận `updateFieldValue`/`applyFieldSet` qua
   props trực tiếp, giống `EntryPreviewDialog`.
2. **AI không viết vào field `relation`/`relation-mirror`** — chỉ đọc dữ liệu
   liên kết làm context. AI có thể viết vào: `text`, `richtext`, `number`,
   `boolean`, `date`, `select`, `image` (giới hạn trong ảnh đã chọn), `flatten`
   (đệ quy), `component-repeat` (mảng item, đệ quy). Không viết vào
   `password`/`secretkey`.
3. **Ảnh: client resize/compress, server gọi provider.** Không có codec ảnh
   server-side, và thêm dependency native (sharp...) sẽ phá tính tương thích
   `kind: "cloudflare"`. Path ảnh gốc được gửi kèm làm nhãn vị trí; server
   verify path qua `storage.stat()` trước khi tin.

   **CẬP NHẬT (2026-08-06) — resize riêng ~240px cho ảnh gửi AI, KHÔNG dùng
   nguyên cấu hình `optimizeUploadImage` (1024px/quality 0.82).** Cấu hình
   1024px đó tune cho ảnh hiển thị/lưu trữ (Media library), không phải cho
   việc tiết kiệm token AI. Điểm quan trọng: chi phí token ảnh ở API vision
   (Anthropic/OpenAI/Google) tính theo **số pixel** (chiều rộng×cao), KHÔNG
   theo `quality`/dung lượng file webp — hạ quality không giúp giảm token,
   chỉ giúp giảm payload để không vượt body-size cap của chính app (§1.8).
   Ảnh 240px so với 1024px giảm token còn khoảng ~5-6% (tỉ lệ theo diện
   tích) — với mục đích chỉ để AI "nhận diện nội dung ảnh, không đọc chữ
   nhỏ", 240px là đủ (gần với input size chuẩn của nhiều model vision,
   VD 224-256px).

   Đổi `file-manager-image-optimize.ts`'s `optimizeUploadImage(file:
   File): Promise<File>` thành nhận thêm optional
   `{maxWidth?, quality?}` (default = giữ nguyên `OPTIMIZED_IMAGE_MAX_WIDTH`/
   `OPTIMIZED_IMAGE_QUALITY` hiện tại → không đổi hành vi upload cũ). Bước
   chọn ảnh cho Magic Write gọi `optimizeUploadImage(file, {maxWidth: 240})`
   — dùng lại đúng 1 cài canvas-resize, không viết hàm thứ 2.
4. **CẬP NHẬT (2026-08-06) — đổi wire format từ JSON sang một YAML-subset tự
   định nghĩa, để stream nội dung thật theo từng field (không chỉ tên field)
   mà không cần thủ thuật "đóng ngoặc/nháy tạm rồi parse lại" của JSON.**

   Lý do đổi: user muốn thấy nội dung AI viết xuất hiện dần, không chỉ tên
   field, để UX không cảm giác chờ lâu. Với JSON, muốn hiện giá trị chuỗi
   (đặc biệt HTML nhiều dòng của richtext) đang mọc dần thì mỗi lần nhận delta
   phải "đóng tạm" chuỗi/ngoặc chưa đóng rồi `JSON.parse` lại toàn bộ
   (`repairPartialJson`/`closeOpenJson`) — càng về cuối object càng tốn, và
   nội dung nhiều dòng phải escape `\n`/`\"` nên không thể "nối thẳng" text
   thô vào preview.

   YAML có **block literal** (`key: |` rồi các dòng thụt vào là nội dung thô,
   không escape) — giải quyết đúng vấn đề này: cứ nhận thêm dòng nào thì nối
   thẳng dòng đó vào phần preview đang mở, không cần parse lại. Đây **không
   phải YAML chuẩn đầy đủ** (không anchor/tag/flow-collection) mà là một
   dialect nhỏ tự định nghĩa cho đúng shape Magic Write cần — cùng tinh thần
   với dialect HTML riêng mà `html.ts` đã tự viết parser cho, nên viết 1
   parser dòng-theo-dòng nhỏ (~150-250 dòng) là hợp với convention "tự viết
   API mỏng thay vì thêm dependency" của repo, **không cần** thêm gói
   `yaml`/`js-yaml`.

   Quy tắc dialect (do mình định nghĩa, ghi rõ trong system prompt gửi AI):
   - Mọi giá trị văn xuôi (text/richtext/lựa chọn dạng label) LUÔN dùng block
     literal `key: |` + dòng thụt sâu hơn — không có trường hợp scalar trần
     cho chuỗi, để parser không phải xử lý quy tắc quote/escape của YAML
     thật.
   - `number`/`boolean`/`date`/`select`-id/đường dẫn ảnh dùng scalar trần
     (`key: value` cùng dòng) — bộ ký tự an toàn, không đụng cú pháp YAML.
   - `flatten` field → mapping lồng theo thụt dòng (`author:` rồi `name: |`).
   - `component-repeat` field → block sequence (`- heading: |` / `  body: |`)
     mỗi item là 1 mapping.
   - Ví dụ 1 terminal turn (`kind: fields`):
     ```yaml
     kind: fields
     summary: |
       Đã viết tiêu đề, đoạn mở bài và chọn ảnh cover.
     fields:
       title: |
         10 Tips for a Better Morning Routine
       publishedDate: 2026-08-06
       featured: true
       heroImage: photos/cover.jpg
       body: |
         <h2>Wake Up Early</h2>
         <p>...</p>
       author:
         name: |
           Jane Doe
       sections:
         - heading: |
             Section One
           body: |
             <p>...</p>
     ```
   - `kind: question` turn giữ cùng field `topic/question/multi/allowOther/
     choices` như wizard, chỉ đổi encoding sang dialect này (label/question
     vẫn block literal).

   Parse: `parseMagicWriteYaml(text)` (validate đầy đủ, dùng cho terminal
   turn) + `parsePartialMagicWriteYaml(text)` (scan những gì đã nhận, trả
   preview đang mở của field hiện tại + giá trị đã đóng của các field trước
   — không cần "sửa" gì cả, chỉ là quét dở dang). Cả 2 sống trong
   `ai-magic-write-protocol.ts`.

   Vì đổi hẳn wire format (không còn JSON), **bỏ** kế hoạch tách
   `ai-json-stream.ts` dùng chung với wizard — wizard giữ nguyên JSON, không
   đổi, không đụng tới code đang chạy. `AiChoiceQuestion` (UI component dùng
   chung cho câu hỏi làm rõ) vẫn tái dùng được bình thường vì nó nhận object
   đã parse xong, không quan tâm encoding gốc là JSON hay YAML-subset.

   **CẬP NHẬT LẦN 2 (2026-08-06) — apply ngay từng field thật khi field đó
   viết xong, disable field đang được viết, enable lại khi xong.** Thay cho
   "chỉ preview trong dialog, Apply 1 lần ở cuối" — user muốn field thật
   trong form (không phải panel riêng trong dialog) là nơi thể hiện việc
   AI đang viết, và disable nó lại trong lúc đó để tránh user gõ đè.

   Cơ chế cụ thể — tái dùng đúng pattern `<fieldset disabled>` đã có sẵn ở
   `ContentEntryEditor.tsx:725` (`<fieldset disabled={!canEdit}>` bọc toàn
   form): mỗi field top-level đã được bọc riêng trong
   `renderFieldNodes()` (`ContentEntryEditor.tsx:93` cặp Title/Slug,
   `:125` field thường) bằng `<div key={node.fieldName}
   data-field-name={node.fieldName}>` — đổi `div` này thành `<fieldset
   data-field-name={node.fieldName} disabled={streamingFieldName ===
   node.fieldName}>` (thêm param `streamingFieldName?: string | null` vào
   `renderFieldNodes`). Vì `<fieldset disabled>` tự disable MỌI control con
   bên trong (kể cả field lồng sâu của `flatten`/`component-repeat`), chỉ
   cần disable ở granularity field top-level là tự động khoá đúng cả khối
   con đang được AI viết, không cần plumbing `disabled` riêng cho từng field
   component.

   ⚠️ **Fieldset trần có border/padding mặc định — phải reset, không thì vỡ
   layout.** Global reset ở `src/styles/forms.css:376` (`:where(fieldset)`)
   gán `border: 1px solid var(--dry-border); border-radius:
   var(--dry-radius-lg); padding: 1rem;` cho MỌI fieldset. Outer fieldset
   (`:725`) tránh được nhờ class `.content-entry-editor-form` reset riêng
   `border: none; padding: 0;` (`src/styles/components.css:2393-2396`) — áp
   đúng class đó (hoặc 1 class mới cùng rule) cho các fieldset lồng theo
   field mới này. Vì đây là fieldset nằm NGANG HÀNG bên trong 1 ô của
   `.content-entry-editor-grid` (CSS grid) — chỗ khác với outer fieldset
   (nó bọc quanh cả grid, không phải 1 item của grid) — cần reset thêm
   `margin: 0; min-width: 0;` (fieldset có `min-width` nội tại theo chuẩn
   browser, dễ làm 1 item không co lại đúng trong grid/flex). Thêm rule mới
   trong `src/styles/components.css` cạnh `.content-entry-editor-form`,
   VD `.content-entry-editor-field { border: none; padding: 0; margin: 0;
   min-width: 0; }`, dùng cho cả fieldset field-level này.

   - **Scalar field** (text/number/boolean/date/select): an toàn để cập
     nhật giá trị thật sống theo từng nhịp throttle của
     `parsePartialMagicWriteYaml` — gọi `updateFieldValue(name, partial)`
     ngay trong lúc field đó đang mở khoá stream (không có bước parse rủi
     ro nào ở giữa, chỉ là chuỗi/số thô). Field disabled nhưng value hiển
     thị mọc dần thật trong input.
   - **RichText field**: KHÔNG feed HTML nửa-vời vào `importCleanHtml`
     giữa chừng (DOMParser parse sai tag chưa đóng) — trong lúc field này
     là `streamingFieldName`, field hiện trạng thái disabled kèm skeleton/
     placeholder "AI đang viết…" (không phải nội dung thật đang mọc từng
     ký tự). Chỉ gọi `updateFieldValue` **đúng 1 lần** khi block literal
     của field đó đóng hẳn (đã qua `sanitizeAiRichTextHtml`) — field pop
     nội dung thật vào rồi enable lại ngay.
   - Field nào KHÔNG phải target (theo `mode: "empty"|"selected"`) thì
     `streamingFieldName` không bao giờ trỏ tới nó — không bị đụng, không
     bị disable.
   - Không còn nút "Apply" thủ công cho các field đã stream xong — chúng
     tự commit ngay khi field đó đóng. Dialog Preview/Reset
     (`EntryPreviewDialog`, diff có sẵn) vẫn là cơ chế "undo sau khi đã
     apply" nếu user muốn revert 1 field AI viết — không cần build UI
     review riêng.
   - `streamingFieldName` sống ở `ContentEntryEditor.tsx` (cùng chỗ với
     `updateFieldValue`), được `MagicWriteDialog` set qua callback prop mỗi
     khi con quét `parsePartialMagicWriteYaml` phát hiện field top-level
     đang mở đổi sang field khác (hoặc về `null` khi hết).
5. **Magic Write yêu cầu `ai.mode === "server"`** — mode "local" (CLI) không
   có protocol gửi ảnh. Nút Magic Write ẩn khi `window.__DRY_CONFIG__.aiMode
   !== "server"`.

   ĐÃ LÀM (2026-08-06): phát hiện `ai.mode` trước đây bị suy ra cứng từ
   `kind` top-level (`kind: "cloudflare"` mới có `mode: "server"` — nhưng
   `kind: "cloudflare"` đổi luôn storage/content/kv sang R2/D1/KV, và
   Workers adapter chưa tồn tại trong repo này, nên sẽ sập dev server local).
   Đã tách `ai.mode` ra khỏi `kind` trong `src/server/options.ts`
   (`DryAiOption.mode?: "local"|"server"`, override độc lập; validate chặn
   `mode:"local"` + `kind:"cloudflare"` vì CLI không spawn được trên
   Workers). `dry.config.ts` đã đổi thành
   `{ ai: { lang: "vi", mode: "server", provider: "anthropic" } }` —
   `kind` vẫn là `"local"` (storage/content/kv không đổi). Đã có sẵn 1
   `aiKey` entry thật trong DB dev (`"Test API "`, provider Google/
   gemini-3.5-flash) — việc chọn key thật sự dùng provider riêng của từng
   row (`providerFromEntry`), không bị chặn bởi `ai.provider` trong config,
   nên key Google này sẽ hoạt động được ngay khi server chạy lại. Test +
   typecheck đã pass (828 tests).

### Server-side

- Route mới: `POST /api/ai/magic-write` — thêm nhánh `slug === "magic-write"`
  trong `src/server/routes/ai.ts` (logic tách sang
  `src/server/routes/ai-magic-write.ts`, import vào `ai.ts`).
- Request: `{typeSlug, entryId?, currentValue: EntryValue, prompt, images?,
  mode: "empty"|"selected", targetFields?, history?, aiKeyName?}`.
- Response: SSE giống wizard — `{delta}`, `{retry}`, `{turn, aiLabel}`,
  `{error}`.
- Protocol mới `src/content-types/ai-magic-write-protocol.ts` — wire format
  là YAML-subset tự định nghĩa (xem quyết định #4), KHÔNG dùng lại
  `ai-wizard-protocol.ts`'s JSON/partial-JSON-repair (wizard giữ nguyên,
  không đổi). Export: `MagicWriteQuestionTurn` | `MagicWriteFieldsTurn
  {summary, fields}`; `parseMagicWriteYaml(text)` (parse+validate hình thái
  toàn văn bản, dùng khi terminal turn về xong); `parsePartialMagicWriteYaml
  (text)` (quét dở dang, trả preview field đang mở + field đã đóng — không
  cần "sửa" gì, chỉ là bộ quét dòng-theo-dòng dừng giữa chừng).
- Validate schema-driven (sau khi đã parse YAML thành object):
  `parseMagicWriteFields(nodes, raw, ctx)` đi theo `EntryFieldNode[]` thật
  của content type (từ `buildEntryFieldTree`), theo từng loại field ở quyết
  định #2. Lọc theo `mode`/`targetFields` ở server (không tin model tự tuân
  thủ).
- Prompt builder `src/content-types/ai-magic-write-prompt.ts`:
  `describeFieldsForPrompt(nodes, value)` + `buildMagicWriteSystemPrompt(...)`
  — mô tả toàn bộ field, dialect HTML cho phép của RichText, **dialect
  YAML-subset của response** (quy tắc block-literal-cho-mọi-chuỗi ở quyết
  định #4, kèm ví dụ mẫu chính xác như trên), danh sách ảnh kèm path, ràng
  buộc mode/targetFields.
- Relation-context helper (yêu cầu #4) `src/content-types/engine/
  entry-relation-context.ts`: `loadRelationContext(entryAdapter, allTypes,
  nodes, currentValue)` — lấy full value của entry liên kết (1 cấp, không đệ
  quy), rút gọn về vài field đầu, cap tổng số dòng (~20).
- Sanitizer RichText `src/content-types/ai-richtext-sanitize.ts`:
  `sanitizeAiRichTextHtml(html, allowedImageSrcs)` — regex allow-list theo
  đúng dialect HTML của field (không cần dependency mới, không phải sanitizer
  đầy đủ cho HTML internet, chỉ chặn model behave xấu: script/on*/javascript:).
- Multimodal: mở rộng `ChatMessage` với `images?: {mimeType, base64}[]`, thêm
  nhánh build content-block cho Anthropic/OpenAI/Google trong
  `requestServerAiWithCredential`/`streamServerAiWithCredential`/
  `streamGoogleAiWithCredential` (thêm, không thay code nhánh string cũ).
- Permission: bỏ `requireSuperAdmin`-only, dùng
  `resolveAccess(...).can(type.id, kind==="singleton" ? "setting" : "update")`
  — export/tái dùng `checkAccess` từ `content-entries.ts`.
- Body size: `maxBodyBytesFor(segment, slug?)` thêm case
  `ai`+`magic-write` ⇒ ~6 MiB (đủ ~6 ảnh webp đã tối ưu). Thread `slug` qua
  `handler.ts`'s `bodyLimitResponse`/`limitRequestBody`.

### Client-side

- `src/pages/content-entry-editor/MagicWriteDialog.tsx` — stage machine
  start→loading→turn(question)/done→error, giống `AiSchemaWizardPanel.tsx`
  nhưng KHÔNG có stage "review" riêng nữa (xem quyết định #4, cập nhật lần
  2) — field thật trong form chính là nơi hiện streaming. Ảnh chọn qua
  `FileManager multiple accept=ảnh`. Toggle "chỉ điền field trống" vs "chọn
  field để ghi đè" (checkbox list, trừ relation/password/secretkey).
  - Stage **loading**: dialog chỉ cần hiện tiến trình tổng quát (VD: "Đang
    viết: title ✓ · body…") + nút Hủy — nội dung thật đã hiện ngay trong
    field thật (disabled) nhờ `streamingFieldName`. Mỗi khi
    `parsePartialMagicWriteYaml` phát hiện 1 field top-level đóng xong +
    qua validate, gọi callback `onFieldStreamed(name, value)` lên
    `ContentEntryEditor.tsx` → `updateFieldValue` ngay (auto-apply, xem
    quyết định #4) + chuyển `streamingFieldName` sang field kế tiếp (hoặc
    `null` khi hết).
  - Không cần build diff/review UI riêng — `EntryPreviewDialog` (đã có sẵn,
    tính diff tự động vì `updateFieldValue` được gọi bình thường) là chỗ
    user revert lại field nào đó nếu AI viết không như ý.
- Nút "Magic Write" (icon `SparkleIcon`, style giống nút "Ask AI" ở
  `BuilderContentType.tsx`) thêm ở **2 nơi** trong `ContentEntryEditor.tsx`
  (toolbar chính `usePageHeaderActions` + bản lặp trong VEI dialog), gate theo
  quyền edit + `aiMode === "server"`.
- Câu hỏi làm rõ (yêu cầu #1): model tự quyết định khi nào hỏi, cap 2 câu,
  hướng dẫn trong system prompt "chỉ hỏi khi thực sự cần". Tái dùng UI
  `QuestionStep` của wizard (khuyến nghị tách thành
  `src/components/AiChoiceQuestion.tsx` dùng chung).

### RichText chọn đoạn để AI viết lại (yêu cầu #6)

- Nút toolbar mới `src/components/RichTextField/ai-rewrite-button.tsx` —
  disable khi không có selection, mở dialog nhỏ (giống `link-menu.tsx`) nhập
  hướng dẫn viết lại.
- Cần hàm mới trong `html.ts`: `importCleanHtmlFragment(html, {inline?})` trả
  về `Fragment`/node[] (khác `importCleanHtml` chỉ parse cả doc).
- Command mới trong `commands.ts`: `replaceSelectionWithHtml(html, inline)` —
  `state.tr.replaceWith(from, to, nodes)`.
- Server: slug riêng nhẹ `magic-write-selection` (hoặc mode riêng trong cùng
  route) — không cần field-tree/relation, chỉ `{passage, instruction}` →
  HTML. Có thể tái dùng thẳng `createChatStream` (không cần đổi protocol).
- Toggle per-field `RichTextFieldConfig.aiRewrite?: boolean` trong
  `field-registry.ts`, theo đúng convention các toggle khác (bold/italic/...).

### Phân kỳ

| Phase | Nội dung | Phụ thuộc |
|---|---|---|
| 1 | Generate toàn entry: text/richtext/number/boolean/date/select/flatten. Không ảnh, không quiz. Sanitizer đã có từ đây. | `ai.mode: server` |
| 2 | Ảnh làm context: FileManager picker, optimize, base64, multimodal request, validate closed-set src. | Phase 1 |
| 3 | Relation context + component-repeat làm target. | Phase 1 |
| 4 | RichText chọn đoạn viết lại. | Độc lập, chỉ cần sanitizer của Phase 1 |
| 5 | Câu hỏi làm rõ (quiz). | Phase 1, nên có sau 2/3 |

**Khuyến nghị v1 = Phase 1 + Phase 2** — thiếu ảnh thì tính năng chưa đúng với
tên "Magic Write" mà yêu cầu gốc nhấn mạnh (mục 3). Phase 3-5 là bổ sung có
thể làm sau, không block nhau.

### File cần tạo

- `src/content-types/ai-magic-write-protocol.ts` (turn types + parser
  YAML-subset đầy đủ + parser dở dang — không tách file riêng, không dùng
  chung với wizard)
- `src/content-types/ai-magic-write-prompt.ts`
- `src/content-types/ai-richtext-sanitize.ts`
- `src/content-types/engine/entry-relation-context.ts`
- `src/server/routes/ai-magic-write.ts`
- `src/pages/content-entry-editor/MagicWriteDialog.tsx`
- `src/components/AiChoiceQuestion.tsx` (khuyến nghị, tách từ wizard)
- `src/components/RichTextField/ai-rewrite-button.tsx`

### File cần sửa

- `src/server/routes/ai.ts`, `src/server/routes/content-entries.ts` (export
  `checkAccess`), `src/server/request-limits.ts`, `src/server/handler.ts`,
  `src/components/RichTextField/html.ts`, `.../commands.ts`,
  `.../toolbar-buttons.ts`, `src/content-types/field-registry.ts`.
- `src/components/FileManager/file-manager-image-optimize.ts` —
  `optimizeUploadImage` nhận thêm optional `{maxWidth?, quality?}` (default
  giữ nguyên hằng số cũ, hành vi upload không đổi); Magic Write gọi với
  `{maxWidth: 240}` (xem quyết định #3, cập nhật).
- `src/styles/components.css` — thêm rule reset border/padding/margin/
  min-width cho fieldset field-level mới (cạnh `.content-entry-editor-form`
  đã có, xem quyết định #4 phần cảnh báo fieldset).
- `src/pages/ContentEntryEditor.tsx` — thêm state `streamingFieldName`,
  render `<MagicWriteDialog>`, nút toolbar ở 2 vị trí (như cũ); và
  `renderFieldNodes()` (dòng ~68-140): đổi `<div key={node.fieldName}
  data-field-name={node.fieldName}>` bọc mỗi field top-level (cả nhánh
  Title/Slug gộp và nhánh field thường) thành `<fieldset
  data-field-name={node.fieldName} disabled={streamingFieldName ===
  node.fieldName}>`, thêm param `streamingFieldName` vào hàm.
- `src/pages/content-type-editor/AiSchemaWizardPanel.tsx` — CHỈ nếu tách
  `AiChoiceQuestion.tsx` (đổi sang import component UI dùng chung); đây là
  refactor thuần UI/JSX, không đụng protocol JSON/parse của wizard. Có thể
  bỏ qua và giữ 1 bản UI hỏi-đáp riêng trong `MagicWriteDialog.tsx` nếu muốn
  giảm tối đa file đụng tới ở lần triển khai đầu.

## Status

Feature Magic Write: chưa bắt đầu code — user đang xem lại plan trước khi
chốt phase bắt đầu (Phase 1+2 khuyến nghị / chỉ Phase 1 / chỉ Phase 4 độc
lập).

Việc phụ (prerequisite): đã xong — tách `ai.mode` khỏi `kind` để chạy được
server-mode AI (gọi HTTP thật, cần cho gửi ảnh) mà không phải chuyển toàn bộ
storage/content/kv sang Cloudflare. Server cần restart để áp dụng
`dry.config.ts` mới (dev server hot-reload không tự áp dụng lại
`resolveOptions()` ở lần đọc config gốc — cần xác nhận lại khi restart).

## Speed

- Đã xong: research 3 hướng (entry editor/field system, RichText/ProseMirror,
  File Management/server routes) + 1 lượt Plan agent thiết kế đầy đủ + tách
  ai.mode/kind (code + test + typecheck pass).
- Chưa làm: code Magic Write. Cần chốt phase bắt đầu với user.
