# AI chat trở thành trợ lý xây schema (BuilderContentType)

## Context

Trang `/content-types/builder-content-type` (`src/pages/BuilderContentType.tsx`) đã có
layout 2 cột: panel "Builder" (danh sách collection/singleton/component, dùng
`draftsSignal`/`diffContentType` để hiện badge new/edited) và panel "AI chat".
Panel chat hiện tại **chỉ là chat text thuần túy**: gửi `{conversationId, message}`
tới `POST /api/ai/chat`, nhận SSE markdown, render bằng `marked`+`DOMPurify`. AI
không biết schema đang xây, không có cách nào để AI thực sự tạo/sửa field, và
không có cơ chế hỏi trắc nghiệm.

Yêu cầu:
1. AI hiểu được schema hiện tại (đang xây trong cuộc hội thoại, hoặc type đã có sẵn).
2. AI có thể đề xuất sửa/thêm field — và việc đó phải thực sự lên draft (giống
   khi người dùng tự sửa tay), không chỉ nói suông.
3. Khi cần hỏi thêm thông tin, AI hỏi bằng trắc nghiệm (chọn 1 hoặc nhiều đáp
   án) thay vì chờ người dùng gõ tự do — composer ẩn tạm, chỉ hiện nút chọn.
4. Có nút "Review" để **AI tự rà soát lại schema hiện tại** và báo cáo (đây là
   review cho AI đọc lại, không phải UI xem cho người — người dùng đã xem được
   qua panel Builder/ContentTypeEditor sẵn có).

Người dùng đã xác nhận: (a) composer bị ẩn khi có câu hỏi trắc nghiệm đang chờ
trả lời — không giữ song song; (b) nút "Review" chỉ là một hành động gửi yêu
cầu rà soát tới AI qua kênh chat có sẵn, không mở UI mới; (c) phần hướng dẫn/
persona của AI (system prompt) phải cấu hình được qua `dry.config.ts` ở
`ai.schemaBuilder` (đè lên prompt mặc định), kèm `ai.outputLang` (ví dụ `"vi"`)
để ép AI hỏi và trả lời bằng ngôn ngữ đó — không hardcode trong code.

Toàn bộ state schema thật (fields, features, validation...) tiếp tục đi qua cơ
chế **draft** đã có (`src/content-types/draft-store.ts` — `saveDraft`), và việc
apply lên DB thật vẫn qua `ApplyBuildDialog`/`planBatch`/`applyBatch` không đổi
gì. AI chỉ là một "người dùng thứ hai" thao tác lên cùng draft store đó.

## Kiến trúc / giao thức

**Giao thức hành động của AI**: AI trả lời bình thường bằng markdown, nhưng khi
cần thực hiện hành động máy đọc được (đề xuất schema, hỏi trắc nghiệm), AI chèn
một fenced code block đặc biệt:

```` ```drycms-action
{"type":"propose_schema", "targetTypeId": null, "kind":"collection", "name":"blog_post", "label":"Blog post", "description":"...", "features":{"slug":true}, "fields":[ ... ]}
``` ````

hoặc

```` ```drycms-action
{"type":"ask_choice", "question":"Bạn muốn field \"status\" cho phép chọn nhiều giá trị không?", "multiple":false, "options":[{"id":"single","label":"Chỉ một giá trị"},{"id":"multi","label":"Nhiều giá trị"}]}
``` ````

Client parse block này sau khi stream xong, tách phần "prose" (render markdown
bình thường) khỏi phần action (render UI riêng: bubble đề xuất schema, hoặc
widget trắc nghiệm). Không cần đổi API `POST /api/ai/chat` phía trả lời — câu
trả lời trắc nghiệm của người dùng vẫn gửi lại dưới dạng 1 câu message string
bình thường qua đúng đường ống SSE hiện có.

**System prompt được ghép từ 2 nguồn, tách rõ trách nhiệm:**

1. **Phần "instructions" — cấu hình được, sống ở server** (`dry.config.ts` →
   `ai.schemaBuilder` + `ai.outputLang`): persona, giải thích giao thức
   `drycms-action` (2 action `propose_schema`/`ask_choice`, ví dụ JSON), các
   luật chung ("đừng tự bịa field `relationmirror`", "hỏi trắc nghiệm khi cần
   làm rõ", v.v.), và câu ép ngôn ngữ trả lời nếu `outputLang` được set (ví dụ
   `"vi"` → "Luôn hỏi và trả lời bằng tiếng Việt."). Có default built-in nếu
   người dùng không override `ai.schemaBuilder` trong config. **Không đổi theo
   từng request** trong 1 lần khởi động server.
2. **Phần "context" — dữ liệu động, do client build mỗi lượt gọi**
   (`src/content-types/ai-schema-context.ts`): catalog các field type hợp lệ
   (từ `fieldTypes` registry, chỉ client có vì registry gắn với Editor
   components), danh sách content type hiện có (id/name/kind — để AI tham
   chiếu khi sửa type đã tồn tại hoặc chọn target cho `relation`), và
   **definition đầy đủ của working draft hiện tại** (nếu có). Đây là phần đổi
   theo state UI, nên phải build lại mỗi request.

Server (`src/server/routes/ai.ts`) ghép 2 phần này thành 1 system prompt cuối
cùng trước khi gửi cho provider: `schemaBuilder instructions + outputLang câu
lệnh ngôn ngữ + context data do client gửi`. Toàn bộ system prompt **không lưu
vào lịch sử hội thoại** phía server (`conversations` Map) — chỉ dùng cho đúng
lượt gọi đó, vì phần context thay đổi liên tục.

⚠️ Vì phần giải thích giao thức `drycms-action` nằm trong `schemaBuilder`
(server, có thể bị người dùng override toàn bộ qua config) còn phần parse
response lại nằm ở client (`ai-action-parser.ts`), 2 bên phải khớp đúng 1 hợp
đồng cố định (tên field bắt buộc trong JSON action). Nếu người dùng tự viết
`ai.schemaBuilder` riêng mà quên nhắc tới giao thức này, AI sẽ không biết cách
trả action nữa — cần ghi rõ điều này trong doc-comment của `schemaBuilder` để
người dùng override biết cần giữ lại phần nào.

## Phase 1 — Config: `ai.schemaBuilder` + `ai.outputLang`

File: `src/server/options.ts`

- Thêm vào `DryAiOption`: `schemaBuilder?: string` (đè lên system prompt mặc
  định của tính năng AI-xây-schema — doc-comment phải nói rõ: nếu override,
  cần tự giữ lại phần mô tả giao thức `drycms-action` nếu muốn AI vẫn đề xuất
  schema/hỏi trắc nghiệm được, xem ghi chú hợp đồng ở trên) và
  `outputLang?: string` (ví dụ `"vi"`, `"en"` — ép ngôn ngữ AI hỏi/trả lời;
  không set thì để model tự chọn theo ngôn ngữ người dùng gõ).
- Cả 2 field áp dụng cho **cả `local` lẫn `server` mode** (không phụ thuộc
  provider) — thêm vào cả `ResolvedLocalAiOption` và `ResolvedServerAiOption`
  (hoặc factor thành field chung, resolve 1 lần trong `resolveAiOption` trước
  khi rẽ nhánh `mode`, rồi spread vào cả 2 nhánh return).
- Validate trong `resolveAiOption`: nếu có set thì phải là string không rỗng
  (ném `TypeError` theo đúng convention lỗi hiện có trong file, ví dụ cạnh chỗ
  validate `ai.keyName`). Không set → giữ `undefined`, không áp default ở đây
  (default nội dung prompt để ở `ai.ts`, xem Phase 2 — giữ `options.ts` chỉ lo
  validate hình dạng, không ôm nội dung prompt dài).
- Cập nhật `dry.config.ts` (ví dụ trong doc/comment, không bắt buộc đổi file
  thật của repo trừ khi người dùng muốn dùng ngay):
  ```ts
  ai: {
    mode: "server",
    schemaBuilder: "...", // tuỳ chỉnh persona/luật, hoặc bỏ trống dùng default
    outputLang: "vi",
  },
  ```

## Phase 2 — Backend: ghép system prompt & thread `context`

File: `src/server/routes/ai.ts`

- Thêm `context?: string` vào interface `ChatRequest` (phần dữ liệu động do
  client gửi — xem Phase 3). Validate độ dài (ví dụ ≤ 12_000 ký tự) tương tự
  cách các field khác đang bị giới hạn trong
  `validateMessages`/`validateSingleMessage`.
- Thêm hằng số `DEFAULT_SCHEMA_BUILDER_PROMPT` (persona + giải thích giao thức
  `drycms-action` + luật chung, tiếng Anh làm mặc định trung lập) và hàm
  `composeSystemPrompt(context: string | undefined): string` — ghép:
  `(ai.schemaBuilder?.trim() || DEFAULT_SCHEMA_BUILDER_PROMPT)` +
  (nếu có `ai.outputLang`: câu ép ngôn ngữ, map vài mã phổ biến sang tên đầy
  đủ — `{ vi: "Vietnamese", en: "English" }`, fallback dùng nguyên giá trị nếu
  không có trong map) + (nếu có `context` từ client: nối vào cuối, có tiêu đề
  rõ ràng như `"Current schema context:\n" + context`).
- `resolveChatConversation` giữ nguyên việc lưu lịch sử hội thoại (không lưu
  `context`/system prompt vào `conversations` Map — build lại mỗi lượt).
- Thêm tham số `systemPrompt?: string` xuyên suốt:
  `createChatStream` → `streamServerAiWithCredential` /
  `streamGoogleAiWithCredential` / `streamLocalCli`, và tiêm vào request theo
  từng provider:
  - OpenAI (`/v1/responses`): thêm field top-level `instructions: systemPrompt`.
  - Anthropic (`/v1/messages`): thêm field top-level `system: systemPrompt`.
  - Google (`generateContent`/`streamGenerateContent`): thêm
    `systemInstruction: { parts: [{ text: systemPrompt }] }`.
  - Local CLI (`promptForCli`): chèn `systemPrompt` vào đầu chuỗi prompt ghép,
    trước phần lịch sử hội thoại.
- Chỉ sửa các hàm đang thực sự nằm trên đường đi của `POST` handler (đường
  stream). `requestServerAiWithCredential`/`runLocalCli` (non-stream) hiện
  không được gọi ở đâu cả — không đụng vào, ngoài phạm vi.

## Phase 3 — Client: build dữ liệu động (`context`) gửi cho AI

File mới: `src/content-types/ai-schema-context.ts`

- `buildFieldTypeCatalog(): string` — duyệt `fieldTypes` (từ
  `field-registry.ts`), với mỗi type không `internal` (bỏ qua `password`,
  `relationmirror`) liệt kê: key, shape, config fields khả dụng, validation
  fields khả dụng (chú ý các field phụ thuộc điều kiện: `select` cần
  `options` không rỗng/không trùng; `image`/`select`/`relation`/`component`
  chỉ có min/max items khi ở chế độ multiple/repeatable/non-manyToOne).
- `buildAiSchemaContext(params): string` nhận: definition hiện tại của working
  draft (hoặc `null`), danh sách `allTypes` (id/name/label/kind, để AI biết gì
  đã tồn tại và dùng làm target cho `relation`/`component`). Trả về 1 chuỗi
  **thuần dữ liệu** (không nhét persona/giao thức — phần đó đã do server lo ở
  Phase 2), dùng làm `context` gửi kèm mỗi request.

## Phase 4 — Client: parser cho action block

File mới: `src/content-types/ai-action-parser.ts`

- Định nghĩa `AiChatAction`:
  `{ type: "propose_schema"; targetTypeId?: string | null; kind?: ContentTypeKind; name?: string; label?: string; description?: string; features?: ContentTypeFeatures; fields: RawAiField[] } | { type: "ask_choice"; question: string; multiple?: boolean; options: { id: string; label: string }[] }`.
- `parseAiMessage(text: string): { prose: string; action: AiChatAction | null }`
  — tìm fenced block ` ```drycms-action ... ``` `, `JSON.parse` nội dung, validate
  tối thiểu (đúng `type`, các field bắt buộc tồn tại đúng kiểu). Nếu parse lỗi:
  trả `action: null`, giữ nguyên `prose` là toàn bộ text gốc (không throw, không
  vỡ luồng chat).
- `prose` là phần text sau khi cắt bỏ fenced block, dùng để render markdown như
  hiện tại (`renderAssistantMessage`).

## Phase 5 — Client: sanitize & merge đề xuất vào draft

File mới: `src/content-types/ai-proposal-sanitize.ts`

- `sanitizeAiFields(rawFields, existingFields: FieldDefinition[]): FieldDefinition[]`:
  với mỗi field AI đề xuất — nếu `id` không khớp field đang tồn tại trong
  `existingFields`, coi là field mới → cấp `crypto.randomUUID()` mới (không tin
  id do AI tự sinh); validate `type` nằm trong `fieldTypes` và không phải field
  `internal` (chặn AI tự tạo `relationmirror`/`password`); áp lại đúng các luật
  tự-nhất-quán đã thấy trong `FieldDialog.tsx` (format/regex loại trừ nhau,
  regex/minLength ép `required=true`, `select.options` không rỗng/không trùng
  — field không hợp lệ bị **loại bỏ riêng lẻ** kèm cảnh báo, không huỷ toàn bộ
  đề xuất; item-count validation chỉ giữ khi field ở chế độ multiple/repeatable
  tương ứng, sortable chỉ giữ khi hợp lệ theo cardinality/repeatable). Renormalize
  `order` theo index cuối cùng (giống `withNormalizedOrder` trong
  `ContentTypeEditor.tsx`).
- `applyAiProposal(action, workingDefinition, existingFields)` — guard: nếu
  `workingDefinition.frozen` thì bỏ qua toàn bộ đề xuất; loại các field nằm
  trong `protectedFieldIds` khỏi danh sách bị sửa/xoá. Trả về
  `{ definition: ContentTypeDefinition; warnings: string[] }`.

## Phase 6 — Client: cập nhật `BuilderContentType.tsx`

- Đổi `ChatMessage` thành discriminated union:
  `{id; role:"user"; kind:"text"; text} | {id; role:"assistant"; kind:"text"; text} | {id; role:"assistant"; kind:"choice"; question; options; multiple; answered?: string[]} | {id; role:"assistant"; kind:"proposal"; summary: string; warnings: string[]}`.
- Thêm state `workingTypeId: string | null`. Khi 1 `propose_schema` action được
  xử lý thành công: nếu có `targetTypeId` hợp lệ (khớp 1 type trong
  `definitions`/`drafts`) thì áp lên type đó; ngược lại áp lên `workingTypeId`
  hiện tại; nếu chưa có `workingTypeId`, tạo `crypto.randomUUID()` mới, dùng
  `kind` từ action (fallback `selectedKind` đang chọn ở panel Builder), rồi gọi
  `saveDraft(nextDefinition, isNew)` — **đúng API draft đã có sẵn**, khiến card
  tương ứng tự xuất hiện/update ở panel Builder bên trái, không cần build thêm
  gì mới ở đó.
- Sau khi `sendToAi` hoàn tất stream cho 1 assistant message: chạy
  `parseAiMessage` trên `message.text`. Nếu có `action`:
  - `ask_choice` → đổi message đó thành `kind:"choice"`, giữ `prose` (nếu có)
    làm phần dẫn nhập hiển thị phía trên các nút chọn.
  - `propose_schema` → chạy Phase 5, gọi `saveDraft`, đổi message thành
    `kind:"proposal"` với `summary` build từ `diffContentType(baseline, next)`
    (tái dùng logic hiển thị đã có trong `ApplyBuildDialog.tsx`: "Added/Removed/Changed
    field X (TypeLabel)"), cộng `warnings` nếu Phase 4 có loại field nào.
  - Không có action → giữ nguyên `kind:"text"` như hiện tại.
- Render message list: thêm nhánh cho `kind:"choice"` (component mới,
  `ChatChoicePrompt`, xem dưới) và `kind:"proposal"` (bubble hiện `summary` +
  danh sách `warnings` nếu có, style giống bubble assistant text hiện tại,
  không cần nút bấm gì thêm vì "review" đã là hành động riêng — xem dưới).
- **Composer**: tính `pendingChoice` = message cuối cùng nếu nó là
  `kind:"choice"` và `!answered`. Nếu có `pendingChoice`: render
  `ChatChoicePrompt` thay cho `<form class="ai-chat-composer">` (ẩn hẳn
  textarea/nút Send, đúng lựa chọn người dùng đã chọn). `ChatChoicePrompt`
  nhận `options`, `multiple`, `onSubmit(selectedIds)`: nút dạng segmented
  button-group (mở rộng pattern `.file-view-toggle` đã có — single-select:
  bấm 1 nút là chọn; multi-select: `aria-pressed` toggle từng nút, có nút
  "Xác nhận" riêng để submit). Khi submit: đánh dấu message đó
  `answered = selectedLabels`, đẩy 1 `ChatMessage` role `"user"` kind `"text"`
  mới với text là các label đã chọn (nối bằng dấu phẩy), rồi gọi
  `sendToAi(...)` y hệt luồng composer hiện tại — không cần đổi API.
- **Nút "Review"**: 1 nút nhỏ cạnh composer (hoặc trong `ai-chat-composer`),
  enabled khi `workingTypeId !== null`. Bấm vào: đẩy 1 user message cố định
  (ví dụ: `"Hãy rà soát lại toàn bộ schema hiện tại: kiểm tra tính hợp lý,
  các field còn thiếu, và đề xuất cải thiện nếu có."`) và gọi `sendToAi` như
  bình thường — AI nhận lại đầy đủ `context` (definition mới nhất) nên tự
  "đọc lại" được. Không cần thêm action/API riêng cho việc này.
- `sendToAi` cần build `context` mỗi lần gọi: lấy definition hiện tại của
  `workingTypeId` (ưu tiên `getDraft(workingTypeId)?.definition`, fallback
  definition live nếu có) + `definitions` (cho catalog `allTypes`), gọi
  `buildAiSchemaContext(...)` (Phase 3), gửi kèm trong body POST
  (`{ conversationId, message, context }`).

## Phase 7 — CSS

File: `src/styles/components.css` (cạnh các rule `.ai-chat-*` hiện có, dòng
~228-326)

- `.ai-chat-choice`, `.ai-chat-choice-question`, `.ai-chat-choice-options`
  (flex-wrap group), `.ai-chat-choice-option[aria-pressed="true"]` (style theo
  đúng convention `.file-view-toggle` đã có sẵn — không tạo hệ màu mới),
  `.ai-chat-choice-submit` (chỉ hiện ở chế độ multiple).
- `.ai-chat-proposal` cho bubble tóm tắt đề xuất schema (list các dòng
  added/removed/changed, tái dùng style gần giống phần diff trong
  `ApplyBuildDialog.tsx` nếu có class tương tự, hoặc style tối giản mới).
- Nút "Review" nhỏ cạnh composer: tái dùng class button `sm outline`/`ghost`
  đã có, không cần CSS riêng.

## Các quyết định/luật quan trọng cần giữ đúng khi code

- **Không tin id AI tự sinh** cho field mới — luôn cấp uuid thật ở client.
- **Không cho AI tạo `relationmirror`** hay bất kỳ field `internal: true` nào.
- **Tôn trọng `frozen`/`protectedFieldIds`** — validate ở Phase 5 trước khi
  `saveDraft`, không dựa vào AI tự giác tuân thủ.
- Field không hợp lệ bị loại từng cái kèm cảnh báo, **không huỷ cả đề xuất**.
- `context` không được lưu vào lịch sử hội thoại phía server (tránh phình
  bộ nhớ `conversations` Map và lặp dữ liệu cũ).
- Toàn bộ việc apply lên DB thật (`planBatch`/`applyBatch` trong
  `ApplyBuildDialog`) giữ nguyên không đổi — AI chỉ chạm tới draft store.

## Kiểm thử

- `bun run typecheck` sau khi đổi type `ChatMessage`/`ChatRequest`.
- `bun run test` cho các file test hiện có liên quan (`content-types.test.ts`
  nếu draft-diff/http-api bị chạm; thêm test mới cho
  `ai-proposal-sanitize.ts`/`ai-action-parser.ts` nếu thời gian cho phép —
  đây là logic thuần, dễ unit test không cần server).
- Chạy `bun run dev`, vào `/dry/content-types/builder-content-type`, thử
  hội thoại tạo 1 collection mới bằng mô tả tự do, xác nhận:
  - Card tương ứng xuất hiện ở panel Builder bên trái với badge "new".
  - Khi AI hỏi trắc nghiệm, composer ẩn, hiện đúng các nút chọn; bấm chọn thì
    composer hiện lại.
  - Bấm "Review" thấy AI trả lời nhận xét dựa trên đúng field hiện có (không
    bịa field không tồn tại).
  - Mở card đó trong Builder panel (`ContentTypeEditor`) thấy field đúng như
    AI đã thêm; "Apply Builder" (ApplyBuildDialog) vẫn hoạt động bình thường
    để đẩy lên DB thật.
