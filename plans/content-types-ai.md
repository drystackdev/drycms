# Content Type Builder được AI hỗ trợ

## Mục tiêu

Thêm một AI Content Type Builder vào trang `/dry/content-types`. Người quản
trị mô tả nhu cầu bằng ngôn ngữ tự nhiên; AI hỏi lại những thông tin còn thiếu,
đề xuất schema, rồi tạo một bản nháp content type để người quản trị xem xét và
áp dụng. AI không được tự ý xóa dữ liệu, thay đổi quyền, hoặc sửa các content
type hệ thống.

Phạm vi bản đầu tiên:

- Tạo content type mới.
- Cập nhật content type hiện có theo kiểu additive/non-destructive.
- Thêm field, đổi label/description, validation và feature.
- Không tự động xóa field, đổi kiểu field, đổi tên field, đổi relation target
  hoặc tắt feature. Các thay đổi này chỉ được đề xuất và phải được xác nhận rõ
  ràng ở bước review.
- Tạo migration qua flow `plan`/`apply` hiện có; AI không có đường ghi schema
  riêng.

## Baseline cần chuẩn hóa trước

1. Đối chiếu `status/ai-key-singleton.md` với source thực tế. Hiện
   `src/content-types/seed.ts` vẫn định nghĩa `aiKey` là collection, trong khi
   status nói đã chuyển thành singleton chứa danh sách key. Chọn một mô hình
   chính thức, cập nhật seed/upgrade/test trước khi AI builder phụ thuộc vào nó.
2. Dùng provider id ổn định (`openai`, `anthropic`, `google`, `custom`), không
   dùng label UI (`ChatGPT`, `Google`, ...) làm giá trị lưu trữ.
3. Giữ các cờ `hidden`, `frozen`, `protectedFieldIds` của `role`, `permission`,
   `user`, `aiKey` và `seo`. AI builder không được đưa các type này vào target
   có thể chỉnh sửa.
4. Với `content.engine: "file"`, index chỉ là metadata/khả năng tra cứu nếu
   sau này cần; bản đầu tiên chỉ tạo physical index cho `sqlite` và `D1`.

## Trải nghiệm người dùng

### Entry point

Trong card bên cạnh bảng content types, thêm card “AI Content Type Builder” có
mô tả ngắn, trạng thái cấu hình AI và nút bắt đầu. Card dùng class
`.border-magic`; hiệu ứng chỉ chạy khi hover/focus hoặc card đang được chọn,
tôn trọng `prefers-reduced-motion` và không làm nền nhấp nháy.

Nếu chưa có AI key hợp lệ, card vẫn mở được nhưng hiển thị “Chưa cấu hình AI”,
kèm link đến trang AI Keys và tùy chọn DEV CLI nếu đã bật trong config.

### AI Builder page

Nên triển khai AI Builder thành một page riêng, ví dụ
`/dry/content-types/ai-builder`, thay vì đặt toàn bộ workspace trong dialog.
Conversation có thể dùng một dialog nhỏ cho từng câu hỏi, nhưng proposal và
field editor cần chiếm toàn bộ vùng làm việc. Lý do:

- nhiều field/table vẫn đọc được mà không phải cuộn trong dialog;
- người dùng có thể rời trang rồi quay lại mà không mất proposal;
- dễ hiển thị diff, validation và bảng physical usage đồng thời;
- có thể tái sử dụng UI field hiện tại thay vì tạo một field renderer thứ hai.

Card AI ở `/dry/content-types` chỉ là entry point. Nút bắt đầu route tới page
builder; page có nút `Back to Content Types` và `Apply & build` không nằm trong
AI chat mà nằm ở flow chính của Content Types.

### Dialog builder

Trong page builder, nội dung chính gồm ba vùng, chuyển thành tab trên màn hình
hẹp:

1. **Conversation**: câu hỏi của AI, input trả lời, file/JSON mẫu tùy chọn,
   nút “AI tự quyết định” cho câu hỏi không quan trọng, và nút gửi.
2. **Proposal**: schema preview bằng UI trực quan, không hiển thị physical
   schema dưới dạng text tree. Mỗi table là một panel/card riêng; field là các
   row có type icon, label, name, validation/index badge và trạng thái thay đổi.
   Mỗi thay đổi có checkbox; mặc định chỉ chọn thay đổi an toàn.
3. **Console**: trạng thái request, provider/model, retry, token usage nếu có,
   và lỗi kỹ thuật. Không hiển thị prompt chứa secret hoặc giá trị API key.

AI không cần hiển thị chain-of-thought. Console chỉ hiển thị tiến trình có thể
kiểm chứng: “đang phân tích”, “đang kiểm tra tên field”, “đã tạo đề xuất”,
“đang chạy dry-run”.

Luồng tối thiểu:

```text
Mở card
  -> chọn tạo mới / cập nhật type hiện có
  -> AI hỏi từng nhóm thông tin còn thiếu
  -> trả lời hoặc cho AI tự quyết định
  -> AI trả proposal có version/schema rõ ràng
  -> server validate + plan dry-run
  -> review diff/cảnh báo
  -> lưu thành draft content type
  -> Apply and build dùng flow staged apply hiện tại
```

AI chỉ được kết thúc ở trạng thái `proposal` hoặc `draft`; không gọi `apply`
trực tiếp từ chat. Người dùng vẫn có thể chỉnh proposal bằng UI trước khi lưu
draft.

### Tái sử dụng field UI hiện tại

Các field trong proposal phải hiển thị giống field item hiện tại của Content
Type Editor, ưu tiên tái sử dụng `FieldsList`, `FieldListItem`, `FieldDialog`,
registry và các component field đang có. Không tạo một phiên bản field card AI
riêng có behavior khác.

Mỗi item cần thêm một lớp trạng thái proposal, nhưng giữ layout và thao tác
quen thuộc:

- `New`: field AI đề xuất thêm.
- `Existing`: field đã có và không thay đổi.
- `Modified`: label/config/validation thay đổi.
- `Review required`: rename, retype, drop hoặc relation change.
- `Rejected`: người dùng bỏ chọn, vẫn giữ trong lịch sử proposal nhưng không
  đi vào draft.

Khi mở `FieldDialog`, các giá trị AI đề xuất được nạp vào draft form hiện tại;
người dùng chỉnh sửa bằng cùng validation và cùng field registry. Với field
không an toàn, dialog chỉ hiển thị diff và yêu cầu xác nhận riêng.

### Lưu proposal cục bộ và quay lại apply

`draft-store.ts` hiện là nguồn state cho staged content-type changes, nhưng
không nên chỉ giữ proposal trong memory. Thêm một persisted AI workspace draft
ở client:

- lưu vào IndexedDB nếu đã có cache layer; localStorage chỉ là fallback nhỏ;
- lưu `workspaceId`, target type id/version, proposal đã validate, các field đã
  chọn/bỏ chọn, conversation state tối thiểu và `updatedAt`;
- không lưu API key, secret field value, raw provider response hoặc transcript
  đầy đủ;
- debounce khi ghi và dọn draft cũ theo TTL;
- khi quay lại, kiểm tra content-type `version`; nếu version đã đổi thì báo
  stale draft và chạy lại plan, không âm thầm ghi đè.

Proposal chỉ trở thành draft chính thức của Content Type Builder sau khi server
đã validate và trả về normalized definition. Từ đó:

```text
AI Builder page
  -> validate proposal
  -> lưu workspace draft cục bộ
  -> "Save to Content Types"
  -> draft-store.ts
  -> quay về /content-types
  -> người dùng mở Apply & build
  -> plan / review / apply theo flow hiện tại
```

Nút `Save to Content Types` chỉ lưu staged draft, không migrate database. Nếu
người dùng rời page trước bước này, workspace draft vẫn có thể khôi phục; nếu
họ đã lưu staged draft, Content Types page là nơi duy nhất hiển thị và áp dụng
thay đổi thật.

### Schema preview UI

Schema preview cần có hai lớp hiển thị, dùng chung dữ liệu nhưng phục vụ hai
nhu cầu khác nhau:

#### Collapse card cho từng content type

Mỗi content type/proposal là một collapse card. Đây là trạng thái hiển thị mặc
định trên AI Builder page:

- **Đóng**: chỉ hiển thị summary gồm `Name`, `Description`, số lượng field,
  list icon và các feature đang bật.
- **Mở**: hiển thị đầy đủ field list, validation/index badge, relation/component
  target, change status và physical table usage.
- Có thể mở nhiều card cùng lúc; trạng thái đóng/mở được lưu trong workspace
  draft để khi quay lại trang không mất ngữ cảnh.
- Card mới hoặc card có warning/destructive change được mở sẵn lần đầu và có
  badge rõ ràng.

Summary card nên có bố cục:

```text
┌─ Posts ────────────────────────────────────────────┐
│ Blog posts                         [Collection]     │
│ Articles published on the website                  │
│                                                     │
│ [☷ 8 fields]   Features: [✓ Draft] [✓ Slug] [+2]  │
│                                                     │
│                                         [⌄ Expand]  │
└─────────────────────────────────────────────────────┘
```

Trong đó:

- `Name` là machine name; label hiển thị cạnh đó nếu khác nhau.
- `Description` bị truncate tối đa vài dòng khi đóng, có tooltip hoặc
  `title` để xem đầy đủ.
- `☷ fields` là list icon kèm số lượng. Hover/focus hiển thị tooltip liệt kê
  tên field; click icon hoặc vùng summary sẽ mở card.
- Feature hiển thị bằng checkbox read-only/badge. Checkbox chỉ là trạng thái
  proposal, không phải control ghi ngay vào database.
- Hover/focus trên từng feature hiển thị tooltip gồm tên đầy đủ, ý nghĩa,
  field/table được sinh ra và trạng thái `new`/`existing`/`changed`.
- Không dùng màu làm tín hiệu duy nhất; feature và change status luôn có label,
  icon hoặc text thay thế.

Khi card mở, phần header vẫn giữ summary để người dùng không mất context; bên
dưới mới render `FieldsList` hiện tại và các section `Features`, `Relations`
và `Physical usage`. Nút collapse dùng `aria-expanded`, `aria-controls` và có
keyboard focus rõ ràng.

**Logical schema** hiển thị cách người dùng nghĩ về content type:

- Header card: tên, label, Collection/Singleton/Component và mô tả.
- Feature badges: Draft, Slug, Timestamps, Sortable, SEO.
- Field rows: label, machine name, field type, required/unique/indexed và
  relation/component target.
- Các row mới, sửa đổi và cảnh báo được đánh dấu bằng màu + icon, không chỉ
  dựa vào màu để người dùng có accessibility tốt.
- Cho phép mở inline để chỉnh field an toàn; field nguy hiểm có nút xem diff
  nhưng không cho sửa trực tiếp nếu proposal chưa được xác nhận.

**Physical usage** hiển thị field thực sự được dùng trong từng table bằng UI,
không dùng chuỗi dạng `posts -> posts_tags`:

- Mỗi table là một `schema-table-card` có header tên table, loại table và badge
  `new`/`existing`/`rebuild`.
- Bên trong là bảng field nhỏ với các cột `Column`, `Source field`, `SQL type`,
  `Required`, `Unique`, `Index` và `Change`.
- System fields có badge `System`; field sinh từ relation/component có badge
  `Generated`; custom fields hiển thị link ngược về logical field.
- Table con nằm trong vùng nested card của table cha. Dùng đường nối hoặc
  connector chỉ để minh họa quan hệ parent/child; mọi thông tin quan trọng vẫn
  phải nằm trên card để không phụ thuộc vào việc đọc sơ đồ.
- Cuối mỗi `schema-table-card` có summary row cố định: `Fields used: 8`, số
  system/generated/custom fields, số index và số cảnh báo. Khi mở rộng summary,
  người dùng xem được toàn bộ field đang dùng cho table đó.
- Có toggle `Logical schema` / `Physical tables`, không bắt người dùng đọc cả
  hai lớp cùng lúc.

Ví dụ bố cục:

```text
┌─ Posts · Collection ───────────────────────────────┐
│ Draft  Slug  Timestamps                             │
│ Title       title       Text       Required          │
│ Author      author      Relation → Users             │
│ Tags        tags        Component (repeatable)       │
└─────────────────────────────────────────────────────┘

┌─ Physical tables ──────────────────────────────────┐
│ posts                 Existing · 6 fields · 2 index │
│ Column       Source       SQL type   Index  Change   │
│ title        Title        TEXT       —      New      │
│ author_id    Author       INTEGER    ✓      New      │
│ createdAt    System       TEXT       —      Existing │
│ Fields used: 6   Custom: 2   System: 3   Warnings: 0│
│                                                     │
│ └─ posts_tags       New · 4 fields                  │
│    parent_id        Generated     INTEGER            │
│    target_id        Tags          INTEGER   Index    │
│    position         Generated     INTEGER            │
│    Fields used: 4   Generated: 3   Warnings: 0       │
└─────────────────────────────────────────────────────┘
```

Các card phải có trạng thái loading, empty, error và overflow ngang trên màn
hình nhỏ. Không dùng canvas/SVG làm nơi duy nhất chứa schema; DOM table/card
mới là nguồn hiển thị chính để hỗ trợ keyboard, screen reader và test bằng
computed style. Sơ đồ connector nếu có chỉ là lớp trang trí bổ sung.

### Ngôn ngữ và config

Thêm config:

```ts
ai: {
  lang: "vi" | "en",
  provider?: "openai" | "anthropic" | "google" | "custom",
  model?: string,
  cli?: { enabled?: boolean, commands?: { claude?: string, codex?: string } },
}
```

`lang` quyết định ngôn ngữ hội thoại và copy UI do AI sinh ra; tên field kỹ
thuật, provider id và JSON schema luôn giữ format ổn định. Config phải được
validate tại `resolveOptions()` và không đọc lại ở từng request.

## Mô hình dữ liệu AI key

AI key lấy từ bản ghi AI Keys, không đặt secret trong `dry.config.ts` và không
đưa secret về client. Mỗi cấu hình nên có:

```ts
{
  id, name, provider, model, baseUrl?, key, enabled, sortIndex?
}
```

- `model` là field bắt buộc khi provider cần model; luôn hiển thị model thực tế
  sẽ dùng.
- `baseUrl` chỉ dùng cho `custom` hoặc provider cho phép override; phải chặn
  URL nội bộ/loopback khi production để tránh SSRF.
- `enabled` loại key tắt khỏi rotation.
- Nhiều key cùng provider/model chọn theo `sortIndex`, sau đó fallback tuần tự
  khi lỗi rate limit/quota; không fallback khi lỗi authentication.
- `key` dùng `secretkey`, write-only, để trống khi edit nghĩa là giữ secret cũ;
  list API không trả giá trị thật.

### Test AI key

Thêm action “Test connection” ở từng AI key. Action gửi một prompt cố định,
không chứa dữ liệu người dùng, yêu cầu response JSON tối thiểu. Kết quả chỉ trả
trạng thái, provider/model, latency và message đã redact; không lưu prompt/
response đầy đủ.

Có thể mở rộng `SecretKeyField` bằng `actions` hoặc render slot, nhưng action
test nên thuộc form/page AI Keys, không nhúng logic provider vào field primitive.
Server là nơi thực hiện test và enforce quyền Super Admin.

## Provider adapter và DEV CLI

Tạo interface nội bộ:

```ts
interface AiProviderAdapter {
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
  testConnection(): Promise<AiTestResult>;
}
```

Mỗi adapter chịu trách nhiệm auth, endpoint, model mapping, timeout, retry,
structured output và redact lỗi. Builder chỉ làm việc với interface này.

DEV CLI là fallback chỉ dùng khi `NODE_ENV !== "production"` và được bật rõ
trong `ai.cli.enabled`. Thứ tự chọn:

1. AI key đã chọn trong database.
2. `claude` nếu executable tồn tại và chạy được.
3. `codex` nếu executable tồn tại và chạy được.

Không dùng shell interpolation với prompt; truyền input qua stdin hoặc argv an
toàn, đặt timeout, giới hạn output, kiểm tra exit code và parse stream JSON nếu
CLI hỗ trợ. Command config phải là executable/argv đã tách, không nhận chuỗi
shell tùy ý. Nếu cả hai CLI thất bại, không tạo draft một phần.

## Hợp đồng AI proposal

AI không được trả về `ContentTypeDefinition` tùy ý rồi ghi thẳng. Dùng schema
trung gian có version, ví dụ `drycms.ai.content-type-proposal.v1`:

```ts
{
  schema: "drycms.ai.content-type-proposal.v1",
  operation: "create" | "update",
  targetId?: string,
  assumptions: string[],
  questions: Question[],
  changes: ProposedChange[],
  warnings: Warning[]
}
```

Server phải parse/validate JSON; giới hạn kích thước, số field, độ sâu
component/relation và độ dài text; chuẩn hóa name/order/config/validation qua
helper hiện có; kiểm tra reserved names, duplicate names, target type, vòng
relation và table-name collision; loại bỏ thay đổi tới system types, quyền,
secret values và key ngoài allowlist; chạy dry-run để proposal biết trước
migration/destructive changes.

Chỉ lưu audit metadata tối thiểu: provider, model, timestamp, actor và proposal
schema version. Không lưu API key và mặc định không lưu toàn bộ transcript.

## Index và unique

Mở rộng validation của field với `indexed?: boolean` và phân biệt:

- `unique: true` tạo **unique index**, đồng thời giữ validation unique hiện có;
- `indexed: true` tạo **non-unique index**;
- hai cờ có thể cùng bật nhưng chỉ tạo một unique index;
- chỉ field có physical SQL column mới được index; virtual, một số relation và
  JSON nested phải báo unsupported thay vì tạo index giả;
- child-table field index trên cột thực tế của child table, tên index ổn định
  theo table + local field path;
- AI phải nêu lý do và cảnh báo chi phí write/storage, không tự index mọi field.

Mở rộng đối xứng trong `tree.ts`, `migration.ts`, `sqlite.ts` và `d1.ts`:

1. `ColumnSpec` mang `indexed` và index identity ổn định.
2. Create/recreate tạo index thường và unique đúng loại.
3. Diff phát hiện add/drop/toggle index, kể cả rename cùng save.
4. Alter tạo/drop index theo thứ tự an toàn.
5. `SavePlan` đưa index changes vào preview.
6. Test SQLite và D1 statement generation; file engine chỉ lưu definition,
   không phát sinh DDL.

## API và quyền

Thêm route AI dưới `${path}/api/ai`, tách khỏi `content-types.ts`:

- `POST /ai/sessions`: tạo session ngắn hạn và trả câu hỏi đầu tiên;
- `POST /ai/sessions/:id/messages`: gửi câu trả lời, trả proposal/question;
- `POST /ai/sessions/:id/plan`: validate proposal và dry-run;
- `POST /ai/keys/:id/test`: test một AI key;
- `DELETE /ai/sessions/:id`: hủy và dọn session.

Route cần session + Super Admin. Session có TTL ngắn; không tin session id tự do
từ client, không log prompt chứa secret. Rate limit theo actor/IP, giới hạn
concurrency và timeout. D1 adapter tạo per-request như các route khác.

Draft vẫn dùng `draft-store.ts`/`ApplyBuildDialog` và endpoint content-types
hiện có. Không thêm bypass để AI ghi trực tiếp metadata.

## Các phase triển khai

### Phase 0 — nền tảng

- Resolve drift của `aiKey` singleton/collection.
- Chốt provider ids, proposal schema v1, config shape và security policy.
- Viết test config resolution, proposal validation và quyền.

### Phase 1 — schema index

- Thêm `indexed` vào model/field dialog/HTTP validation.
- Hoàn thiện migration SQLite/D1, preview và test rename/toggle, child table,
  recreate, duplicate data khi bật unique.
- Hiển thị index trong diff Content Type Builder.

### Phase 2 — AI keys và provider layer

- Hoàn thiện `model`, `baseUrl`, `enabled` theo baseline đã chọn.
- Thêm test connection, adapters, redact/timeout/retry.
- Thêm `ai.lang` và DEV CLI fallback; production fail closed nếu CLI bật.

### Phase 3 — builder

- Thêm card, `.border-magic`, dialog responsive và reduced-motion.
- Xây session/message/plan APIs.
- Render conversation, console tiến trình và proposal diff; chưa apply tự động.
- Map proposal an toàn vào draft-store.

### Phase 4 — apply và hardening

- Tích hợp Apply and build, xử lý version conflict và stale draft.
- Test permission, SSRF, secret redaction, prompt injection, oversized output,
  CLI timeout, provider failure và retry.
- Chạy typecheck, unit test, build, `git diff --check`; UI phải QA bằng
  screenshot + computed-style assertions ở cả hai theme.

## Tiêu chí hoàn thành

- Tạo được collection/singleton/component bằng tiếng Việt hoặc tiếng Anh và
  luôn thấy proposal trước khi schema thay đổi.
- Proposal không thể sửa `role`, `permission`, protected user fields, `aiKey`,
  `seo`, permission/role data hoặc secret.
- Mọi schema change đi qua validation, optimistic lock, dry-run và staged apply;
  version conflict không làm mất draft.
- AI key không xuất hiện trong response, console, audit log hoặc transcript mặc
  định.
- Test connection có lỗi hữu ích nhưng không lộ credential.
- SQLite/D1 tạo đúng physical index; file engine không tạo SQL DDL.
- Provider lỗi, CLI không tồn tại hoặc model trả JSON sai đều đưa UI về lỗi có
  thể retry, không tạo dữ liệu nửa chừng.
