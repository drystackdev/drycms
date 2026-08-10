# Tạo entry mới của collection B ngay trong dialog chọn quan hệ (từ collection A)

Yêu cầu: đang ở collection A, field kiểu `relation`/`relationmirror` trỏ tới
collection B → cần nút "+ Tạo mới" ngay trong dialog chọn (picker) để tạo một
entry B mới mà không phải rời trang. Magic AI (Magic Chat) cũng cần làm được
việc tương đương khi được yêu cầu trong chat.

## Plan

Chia 2 phase độc lập, có thể ship riêng: Phase 1 (UI, tự chứa) không phụ
thuộc Phase 2 (Magic). Phase 2 rủi ro permission cao hơn nên nên duyệt riêng.

### Phase 1 - UI: nút "+ New" trong `RelationField`'s picker dialog

Hiện trạng (`src/components/fields/RelationField.tsx`): dialog picker chỉ có
`DataTable` chọn từ `source.fetchRows` - không có đường tạo mới.
`source: RelationFieldSource` được dựng theo từng field ở
`useRelationFieldSource` (`src/pages/content-entry-editor/FieldRenderer.tsx:192`),
scope đúng theo `targetTypeId` của field đang mở.

**Thay đổi:**

1. `useRelationFieldSource` thêm nhánh: chỉ set khi
   `canAccess(targetType.id, "create")` đúng (permission của **collection B**,
   không mượn quyền của A - đúng nguyên tắc `kind: fetch` đã áp dụng, xem
   `status/magic-chat.md` Phase B). Trả về một "khả năng tạo mới" (label +
   handler) gắn vào `RelationFieldSource`, tương tự cách `previewDialog` đã
   được trả kèm `source` hôm nay.
2. **Component mới** `QuickCreateEntryDialog` (cạnh `FieldRenderer.tsx`):
   nhận `targetType`, `allTypes`, `onCreated(row)`, `onCancel`. Bên trong:
   `blankEntryValue(buildEntryFieldTree(targetType, allTypes))` làm giá trị
   khởi tạo, render field bằng logic dùng chung với `ContentEntryEditor`.
   - `renderFieldNodes` hiện là hàm private trong `ContentEntryEditor.tsx`
     (dòng 79) - cần tách ra module dùng chung (vd
     `content-entry-editor/entry-fields-form.tsx`) để cả hai nơi gọi, tránh
     chép logic field-by-field lần hai.
   - Save gọi `createContentEntriesApi(...).create(value)` (đã có sẵn, dùng
     đúng permission "create" server-side qua `checkAccess`).
3. `RelationField.tsx`: thêm nút "+ New {label}" trong footer dialog picker
   (cạnh Cancel/Save). Bấm → mở `QuickCreateEntryDialog` như **dialog lồng
   trong dialog** (native `<dialog>` tự xếp top-layer đúng thứ tự `show` sau
   nằm trên - đã có tiền lệ y hệt: `ImageField`'s `FileManager` dialog cũng mở
   lồng trong dialog khác). Tạo xong → thêm id mới vào `draftSelected` (single:
   thay thế; multiple: add) rồi để 2 effect `resolveLabels`/`resolveSummaries`
   sẵn có tự lấy nhãn hiển thị lên card.
4. **Đệ quy tự nhiên, không cần code riêng**: nếu B cũng có field `relation`
   trỏ tới C, `QuickCreateEntryDialog` của B dùng lại đúng
   `useRelationFieldSource`/`RelationFieldAdapter` nên field đó cũng tự có nút
   "+ New" của riêng nó. Không giới hạn cứng độ sâu - dialog native chồng
   được nhiều lớp; chỉ cần lưu ý UX (không phải hôm nay).

**Việc cần xác nhận lúc code** (không chặn plan): client-side field
validation trước khi POST create hiện nằm ở đâu trong `ContentEntryEditor`
(có thể tái dùng thẳng, hoặc trả lỗi qua response và map vào `fieldErrors`
như validate phía server đã làm).

### Phase 2 - Magic AI: `kind: create` cho collection liên quan

Hiện trạng (`status/magic-chat.md` Phase B, đã xong): Magic đã tự tra cứu
được entry có sẵn qua `kind: fetch` rồi **chọn** id hợp lệ để ghi vào field
`relation` (validate qua `allowedRelationIds`, xem
`ai-magic-write-fields.ts:96` `coerceRelation`). Magic **chưa** tạo được entry
mới ở bất cứ đâu - capability contract hiện tại (`CAPABILITY_INSTRUCTION`,
`ai-magic-write-prompt.ts`) nói rõ "không tạo entry".

**Thiết kế mới, tái dùng tối đa hạ tầng `fetch` đã có:**

1. **Protocol** (`ai-magic-write-protocol.ts`): thêm `MagicWriteCreateTurn`
   (`kind: "create"`, `typeSlug`, `fields: {..chỉ scalar..}`) - turn KHÔNG
   BAO GIỜ terminal, giống `fetch`. `validateCreateTurn` theo khuôn
   `validateFetchTurn`.
2. **Allow-list hẹp hơn `fetch`**: `fetch` hiện cho phép tra cứu **bất kỳ**
   content type nào (`source: types` liệt kê hết). `create` phải hẹp hơn -
   CHỈ những `typeSlug` thực sự là `targetTypeId` của một field
   `relation`/`relationmirror` trên chính type đang mở. Đúng phạm vi user yêu
   cầu ("A có ref đến B"), không mở rộng thành "AI tạo entry ở collection bất
   kỳ".
3. **Server** (file mới `ai-magic-write-create.ts`, cạnh
   `ai-magic-write-fetch.ts`): `executeMagicCreate` phải re-check **CẢ HAI**
   quyền cho đúng type B (không mượn quyền của A đang mở):
   - `checkAccess(targetType.id, "create")`
   - `checkAccess(targetType.id, "magic")` - **quan trọng**: nếu bỏ qua bước
     này, Magic ở collection A có "magic" bật sẽ tạo được entry ở collection
     B dù B tắt Magic hoàn toàn - lỗ hổng bypass permission thật.
   - Field trong entry mới CHỈ nhận scalar (tái dùng thẳng
     `WRITABLE_COLUMN_TYPES`/`coerceScalar` từ `ai-magic-write-fields.ts`) -
     v1 không cho AI tạo entry có nested relation/component ngay trong lượt
     tạo, giữ blast radius nhỏ.
   - Tạo xong, nhét id mới vào **cùng** `AllowedRelationIds` map mà `fetch`
     đang populate (`targetTypeId -> Set<id>`) - nhờ vậy `kind: fields` ngay
     sau đó ghi quan hệ tới id vừa tạo **không cần sửa** `coerceRelation`/
     `applyMagicWriteFields` chút nào, đi qua đúng allow-list check có sẵn.
   - Ngân sách hop RIÊNG, chặt hơn `fetchHops` (đề xuất cap 2/lượt) - đây là
     ghi dữ liệu thật, không phải tra cứu chỉ-đọc như `fetch`.
4. **Client** (`MagicChat.tsx`): thêm SSE status tương tự `fetching`
   (`creating: label`) → dòng trạng thái riêng trong luồng chat ("Đang tạo
   mục mới trong 'Tag': 'Launch'…") - phân biệt rõ "AI đang NÓI" và "AI đang
   GHI DỮ LIỆU MỚI" (nặng hơn một field write bình thường).
5. **Prompt**: `CAPABILITY_INSTRUCTION` sửa từ "không tạo entry" thành "tạo
   được entry mới CHỈ trong collection có quan hệ trực tiếp với entry đang
   mở, khi được yêu cầu rõ, và chỉ nếu collection đó cũng bật Magic".

**Quyết định sản phẩm cần chốt trước khi code Phase 2** (đề xuất mặc định,
không phải điểm chặn cứng): KHÔNG yêu cầu xác nhận riêng cho từng lượt
`create` - xử lý nhất quán với cách `kind: fields` đang hoạt động hôm nay
(có thể revert qua `EntryPreviewDialog`/xoá tay entry vừa tạo). Đây là loại
hành động AI mới thật sự (ghi dữ liệu ở NGOÀI phạm vi entry đang mở, chứ
không chỉ field của entry hiện tại) nên đáng để user tự cân nhắc lại mặc định
này trước khi ship, không chỉ đọc qua.

### Testing

- Unit: `ai-magic-write-protocol.test.ts` (parse/validate `kind: create`),
  test mới cho `executeMagicCreate` theo đúng khuôn
  `ai-magic-write-fetch.test.ts` (sqlite thật, không mock adapter) - gồm case
  "type B tắt Magic" và case "không có quyền create ở B".
- Playwright: smoke cho `QuickCreateEntryDialog` (Phase 1) theo
  `project_drycms_qa_method` (computed-style, không chỉ screenshot) - đây là
  bề mặt UI mới, Magic hiện chưa có e2e nào (khoảng trống có sẵn, không mở
  rộng phạm vi lần này).

## Status

**Cả 2 phase đã code xong (2026-08-10), theo đúng plan ở trên, không lệch
hướng nào đáng kể.**

### Phase 1 - UI

- `entry-fields-form.tsx` (mới): `renderFieldNodes` tách khỏi
  `ContentEntryEditor.tsx`, dùng chung cho cả editor thật lẫn dialog tạo
  nhanh.
- `QuickCreateEntryDialog.tsx` (mới): form tạo entry rút gọn (không Magic,
  không autosave draft, không preview/delete), tái dùng
  `buildEntryFieldTree`/`blankEntryValue`/`findPasswordChangeErrors` đúng như
  `ContentEntryEditor` đang làm cho entry mới.
- `RelationField.tsx`: `RelationFieldSource` thêm `createTarget` (optional,
  render-prop). Nút "+ New {label}" trong footer picker; tạo xong: single-
  select tự commit+đóng picker luôn, multi-select chỉ tick thêm + reset về
  trang 0 + refetch (`refreshToken`).
- `FieldRenderer.tsx`: `useRelationFieldSource` thêm tham số `allowCreate`
  (mặc định false) - chỉ `RelationFieldAdapter` (field `relation` thật) bật
  `true`; `RelationMirrorFieldAdapter` KHÔNG có nút tạo (đúng lý do đã ghi ở
  plan: mirror cần tự động điền lại quan hệ ngược, form tạo nhanh không làm
  được việc đó). `createTarget` chỉ xuất hiện khi
  `canAccess(targetType.id, "create")` đúng cho CHÍNH collection B.
- CSS: `.quick-create-entry-dialog[open]`/`-body` nhập vào đúng rule dùng
  chung với `.ref-picker-dialog`/`.component-item-dialog` có sẵn.
- Đệ quy "B lại có ref tới C" hoạt động tự nhiên qua composition, không cần
  code riêng - đã xác nhận qua đọc lại luồng render, chưa xác nhận bằng mắt
  (xem mục QA bên dưới).

### Phase 2 - Magic AI (`kind: create`)

- `ai-magic-write-protocol.ts`: `MagicWriteCreateTurn` + `validateCreateTurn`,
  nối vào `parseMagicWriteYaml`. Không đổi `parsePartialMagicWriteYaml` - turn
  này không có block-literal nào cần preview live, nhánh "khác `fields`" có
  sẵn đã xử lý đúng.
- `ai-magic-write-create.ts` (mới, server): `executeMagicCreate` - re-check
  CẢ `magic` lẫn `create` cho ĐÚNG type B (không mượn quyền của A), scope
  `typeSlug` giới hạn trong `creatableTypeSlugs` (hẹp hơn hẳn `kind: fetch`),
  field ghi qua `applyMagicWriteFields` KHÔNG kèm `allowedImageSrcs`/
  `allowedRelationIds` riêng → tự động chỉ nhận scalar/group, relation/image
  trên entry mới bị drop im lặng (không cần code lọc riêng).
- `ai-magic-write.ts`: `creatableTypeSlugs` tính từ chính field `relation`
  (không phải `relation-mirror`) của type đang mở; ngân sách riêng
  `MAGIC_CREATE_MAX_HOPS = 2` (chặt hơn `MAGIC_FETCH_MAX_HOPS = 3`, vì đây là
  ghi dữ liệu thật); id tạo được nạp thẳng vào `allowedRelationIds` dùng
  chung với `fetch` - `kind: fields` sau đó ghi quan hệ tới id mới hoàn toàn
  không cần sửa `coerceRelation`.
- `ai-magic-write-prompt.ts`: `buildCapabilityInstruction` (trước là hằng số,
  giờ là hàm) chỉ thêm câu "được tạo entry ở collection liên quan" khi có
  `creatableRelatedTypes`; mục "kind: create" (số 6) + dòng đếm "five/six
  possible top-level replies" cũng CHỈ xuất hiện khi có ít nhất 1 collection
  liên quan - type không có field `relation` nào thì không tốn 1 token prompt
  nào cho khả năng này.
- `MagicChat.tsx` (client): thêm `MagicChatStreamEvent.creating` + tham số
  `onCreating` cho `requestMagicTurn`, dùng chung 1 hàm `pushHopStatus` cho cả
  `fetching`/`creating` (status bubble riêng biệt "AI đang làm" khác "AI đang
  nói", đúng tinh thần `fetching` cũ).
- **Quyết định sản phẩm đã chốt theo đề xuất mặc định trong plan**: KHÔNG bắt
  xác nhận riêng cho mỗi lượt `create` - nếu user muốn đổi, đây là chỗ cần
  sửa (`ai-magic-write.ts`'s nhánh `turn.kind === "create"`).

### Test

- Unit mới: `ai-magic-write-protocol.test.ts` (+3 test `kind: create`),
  `ai-magic-write-create.test.ts` (+6 test, sqlite thật không mock - scope
  ngoài `creatableTypeSlugs`, type lạ, thiếu quyền, relation/image bị drop,
  fields rỗng), `ai-magic-write-prompt.test.ts` (+2 test - có/không
  `creatableRelatedTypes`).
- `bun run typecheck`, `bun run test` (1023 pass, cùng 16 fail có sẵn từ
  trước - đã xác nhận bằng `git stash` là fail độc lập với thay đổi lần này,
  liên quan seed/content-types drift), `bun run build` (client+SSR) đều sạch.

### Việc CHƯA làm

- **Chưa xác nhận bằng mắt trong browser thật** (Playwright bận - một
  process Chrome khác đang giữ profile suốt phiên này, thử lại nhiều lần đều
  fail). Mọi verify chỉ qua đọc code + typecheck + unit test + build. Cần mở
  tay 1 collection có field `relation`, bấm "+ New", tạo thử, và (nếu có AI
  key thật) thử yêu cầu Magic "tạo một danh mục mới tên X và gắn vào bài
  này" để xác nhận `kind: create` chạy đúng qua SSE thật.
- Chưa test lồng-2-lớp thật (B có field `relation` sang C, bấm "+ New" bên
  trong dialog tạo B) - chỉ xác nhận đúng qua đọc luồng code, chưa bấm thử.

## Fix (2026-08-10): mở rộng "+ New" sang field `relationmirror`

User bấm thử thật, báo "không thấy nút new" - hoá ra đang xem field
`relationmirror` (tự sinh, phía B nhìn ngược lại A), không phải field
`relation` thật (field thật đã hoạt động đúng). Đây đúng là giới hạn CỐ Ý đã
ghi ở Phase 1 gốc (mirror cần tự điền lại quan hệ ngược, form gốc chưa làm
được) - user xác nhận muốn làm luôn phần này thay vì để lại cho lần sau.

**Thay đổi thêm** (không phá vỡ gì ở Phase 1/2 gốc, chỉ cộng thêm):

- `entry-fields-form.tsx`: `renderFieldNodes` thêm 2 tham số cuối -
  `lockedFieldName` (khoá 1 fieldset, KHÔNG kèm banner "AI is writing" của
  `streamingFieldName`) và `currentEntryId` (id entry đang mở, truyền tiếp
  xuống `FieldRenderer`).
- `FieldRenderer.tsx`: `FieldRendererProps` + `useRelationFieldSource` thêm
  `presetRelation?: { fieldId, value }` - chỉ `RelationMirrorFieldAdapter`
  tính ra (từ `node.sourceFieldId` + `currentEntryId`, quy ra bare-string hay
  mảng dựa theo `reverseCardinality === "oneToMany"`). Nút "+ New" ở mirror
  CHỈ hiện khi `currentEntryId` có thật (entry đang mở đã lưu - chưa lưu thì
  chưa có gì để trỏ ngược về, cố tình ẩn nút thay vì tạo ra entry mồ côi).
- `QuickCreateEntryDialog.tsx`: thêm `presetRelation` - tự set giá trị field
  quan hệ tương ứng vào value khởi tạo (và mỗi lần mở lại) + khoá đúng field
  đó qua `lockedFieldName`, admin thấy field hiện sẵn (không phải ẩn), có
  chip/label của chính entry đang mở, không sửa được.
- `ContentEntryEditor.tsx`: 2 lệnh gọi `renderFieldNodes` truyền thêm
  `entryId` làm `currentEntryId`.

Typecheck + `bun run test` (1024 pass, cùng 16 fail có sẵn từ trước) +
`bun run build` (client+SSR) đều sạch. **Vẫn CHƯA xác nhận bằng mắt** - cùng
lý do Playwright bận như trên.

## Speed

Code xong toàn bộ (Phase 1 + Phase 2 + mở rộng mirror) trong 1 phiên liên
tục, không có điểm chặn kỹ thuật. Việc còn lại duy nhất là QA browser thật -
chỉ chờ có trình duyệt rảnh, không phải việc cần code thêm.

## Port sang `sivelap` (2026-08-10)

Toàn bộ tính năng ở trên được code trên branch `mai-anh-quyen`, `sivelap` đã
tách nhánh từ trước đó nên không có sẵn. Theo yêu cầu, port cả 2 commit
(`977d0e0` Phase 1+2 gốc, `29f66bd` mở rộng mirror) qua `sivelap` bằng
`git cherry-pick -n`, cả hai áp sạch, không có conflict thật nào trên các
file thuộc tính năng này.

**Cố tình loại 2 file ra khỏi lần port** (cả hai chỉ tình cờ nằm chung commit
`977d0e0` với Quick Create Entry, không liên quan chức năng):

- `src/store/auth.ts` - `977d0e0` kèm luôn 1 fix Web Locks cho race điều kiện
  refresh-token giữa nhiều tab (thay `recentlyRefreshedInAnotherTab`-only
  bằng `navigator.locks.request`). `sivelap` có cùng baseline sliding-refresh
  (không rõ vì sao 2 branch trùng y hệt dù không chung ancestor gần) nhưng
  CHƯA có fix Web Locks này - đây là một cải tiến độc lập, không phải một
  phần của "add new cho ref/mirror" nên không port lần này. Có thể port riêng
  sau nếu cần (diff nằm nguyên trong `977d0e0`).
- `src/server/app-router/generated-asset-hrefs.ts` - build artifact (hash
  asset), không hand-merge; tự sinh lại đúng theo build của `sivelap`.

**Verify sau port**: `bun run typecheck` sạch, `bun run test` 1121/1122 pass
(1 fail duy nhất là `sitemap.test.ts` - xác nhận bằng `git stash` là fail có
sẵn từ trước trên `sivelap`, không liên quan lần port này), `bun run build`
(client+SSR) sạch. Chưa QA bằng mắt trên `sivelap` (kế thừa luôn khoảng
trống QA đã ghi ở trên).
