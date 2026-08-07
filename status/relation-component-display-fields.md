# Relation/Component field: chọn field hiển thị (displayFields)

## Plan

### Bối cảnh
Hiện tại, khi 1 field kiểu `relation` hoặc `component` (repeatable) hiển thị danh
sách các item của nó, UI luôn tự lấy **field đầu tiên** của type/target làm
nhãn hiển thị, hard-code ở 3 chỗ khác nhau:

- `ContentEntryList.tsx:531` — cột relation trong bảng List:
  `labelField: visibleTargetColumns[0]?.fieldName`
- `FieldRenderer.tsx:173` (`useRelationFieldSource`) — chip list trong
  `RelationField` ở form sửa entry: `labelField = queryableColumns[0]?.fieldName`
- `FieldRenderer.tsx:351` (`ComponentRepeatFieldAdapter`) — dòng tóm tắt mỗi
  item trong `ComponentField`: `summaryField = node.itemFields.find(f => f.kind === "column")?.fieldName`

Theo xác nhận của user: **nơi cấu hình** là `FieldDialog.tsx` khi add/edit field
Relation/Component trong Content Types (đúng chỗ hiện đang mặc định lấy cột
đầu tiên). Cấu hình lưu trên field đó, áp dụng cho **mọi nơi** field được hiển
thị (List page + form sửa entry). Đệ quy "list trong list" dùng chính
`displayFields` đã cấu hình của field con lồng bên trong.

### 1. Data model
- `field-registry.ts`: thêm `displayFields?: string[]` vào `RelationFieldConfig`
  và `ComponentFieldConfig`. Rỗng/undefined = giữ nguyên hành vi cũ (field đầu
  tiên) — không cần migrate dữ liệu cũ.

### 2. FieldDialog UI
- Cần `allTypes: ContentTypeDefinition[]` (đã có sẵn ở `ContentTypeEditor.tsx`,
  chỉ cần thread thêm 1 prop xuống `FieldDialog`, hiện nó chỉ nhận
  `dynamicOptions` rút gọn).
- Khi `draftType === "relation"` (có `target`) hoặc `"component"` (có
  `componentId`): resolve type đích qua `allTypes`, lấy danh sách field khả dụng
  bằng `flattenDisplayColumns(buildEntryFieldTree(targetType, allTypes))`
  (loại password/secretkey sẵn có).
- Thêm control `MultiSelect` mới "Display fields" (options = field đó, thứ tự
  chọn = thứ tự hiển thị từng dòng).

### 3. Bộ dựng "entry summary" dùng chung (file mới, thuần logic, test được)
`src/content-types/engine/entry-summary.ts`:
```
interface SummaryLine {
  fieldName: string; label: string;
  kind: "text" | "image" | "boolean" | "nested-list" | ...;
  value?: unknown;
  items?: { id: string; lines: SummaryLine[] }[]; // chỉ có ở kind nested-list
}
buildEntrySummary(displayFields, entryValue, fieldNodes, allTypes, depth, visitedTypeIds): SummaryLine[]
```
- Field thường → 1 dòng text/image/boolean...
- Field component-repeat → đệ quy ngay trên data đã có sẵn (inline, không cần
  fetch), dùng `displayFields` của chính field con đó.
- Field relation → chỉ tạo khung `nested-list` với id; DỮ LIỆU con (entry.value
  của target) do tầng gọi (UI, có fetch async) truyền vào — builder giữ thuần
  túy, không tự fetch.
- **Guard chống vòng lặp**: type đích đã có trong `visitedTypeIds` → dừng đệ quy
  (chỉ hiện id/placeholder); cộng thêm giới hạn độ sâu cứng (vd 4 cấp) làm lưới
  an toàn thứ 2. Bắt buộc phải có bất kể lựa chọn ở câu hỏi trước, vì type có
  thể tự quan hệ với chính nó.
- richtext block-level → strip về plain text (không render HTML thô trong 1 dòng).

### 4. Component hiển thị dùng chung
`src/components/EntrySummaryLines.tsx`: render `SummaryLine[]` →
`Label: value` mỗi dòng; `image` → `<img class="cell-image">` nhỏ (tái dùng
class có sẵn, không phải chuỗi `[img](WxH)` literal — đó chỉ là ký hiệu ví dụ
của user); `nested-list` → `<ul>` con thụt lề tăng dần theo `depth`
(margin-left theo cấp), mỗi item tự gọi lại `EntrySummaryLines`.

### 5. Đấu nối vào 3 nơi hiển thị
a. **ComponentField.tsx** (qua `ComponentRepeatFieldAdapter`): thêm prop
   `renderSummary?: (item, index) => ComponentChildren`, dùng thay cho
   `summaryOf` (giữ `summaryOf` làm fallback text/aria-label).
b. **RelationField.tsx** (qua `useRelationFieldSource`): đổi/thêm
   `resolveSummaries(ids)` (vẫn 1 `entriesApi.get` mỗi id như hiện tại) trả về
   `SummaryLine[]` thay vì string; chip `<li>` render `<EntrySummaryLines>`.
c. **ContentEntryList.tsx**: `RelationColumn` cần thêm `displayFields`
   (thread từ `EntryFieldNode` — xem mục 6); `relationLabels` đổi thành lưu
   `SummaryLine[]`/id; `renderRelationCell` đổi từ badge 1 dòng sang khối xếp
   dòng cho mỗi item liên kết, vẫn giữ kiểu rút gọn "hiện 2 + còn lại N" như
   hiện tại để tránh phá layout bảng.

### 6. Plumbing kiểu dữ liệu
- `entry-tree.ts`: `EntryRelationNode`/`EntryComponentRepeatNode` thêm
  `displayFields?: string[]`, copy từ `FieldDefinition.config` khi build node.
- `ContentEntryList.tsx`: `RelationColumn` thêm `displayFields?: string[]`.

### 7. Edge cases bắt buộc test
- Relation tự quan hệ với chính type đang xét (A → A) chọn hiển thị field lồng
  chính nó → không được treo (cycle guard).
- Component lồng component nhiều cấp → cap độ sâu.
- Field trong `displayFields` bị xoá/đổi tên sau này → bỏ qua êm, không lỗi
  (giống cách `fieldOrder` đã xử lý field lạ).
- `displayFields` rỗng ở field cũ chưa từng cấu hình → ra kết quả y hệt hành vi
  hiện tại.

### 8. Thứ tự làm (mỗi bước build/test được độc lập)
1. Data model + entry-tree plumbing (chỉ đổi type, chưa đổi UI/behavior).
2. `entry-summary.ts` + unit test (logic thuần, test trước khi đụng UI).
3. `EntrySummaryLines.tsx` + CSS (đọc `docs/DESIGN.md` trước khi viết CSS).
4. Đấu vào `ComponentField` (rủi ro thấp nhất — data đã có sẵn, không fetch).
5. Đấu vào `RelationField` (chip list form sửa entry).
6. Đấu vào `ContentEntryList` relation column (rủi ro cao nhất — đổi chiều cao
   row của bảng).
7. UI chọn "Display fields" trong `FieldDialog` (làm cuối, vì lúc này mọi nơi
   tiêu thụ config đã sẵn sàng đọc nó).
8. QA thủ công/Playwright qua cả 3 nơi hiển thị + chạy lại e2e liên quan.

### File sẽ đổi/thêm
- `src/content-types/field-registry.ts`
- `src/content-types/engine/entry-tree.ts`
- `src/content-types/engine/entry-summary.ts` (mới) + `entry-summary.test.ts` (mới)
- `src/pages/content-type-editor/FieldDialog.tsx`
- `src/pages/ContentTypeEditor.tsx` (thread `allTypes` prop)
- `src/components/fields/RelationField.tsx`
- `src/components/fields/ComponentField.tsx`
- `src/pages/content-entry-editor/FieldRenderer.tsx`
- `src/pages/ContentEntryList.tsx`
- `src/components/EntrySummaryLines.tsx` (mới)
- CSS (file/khu vực xác định sau khi đọc `docs/DESIGN.md`)

## Status
**Hoàn thành** (2026-08-07), theo đúng thứ tự ở mục 8, cộng thêm phần mở rộng
cho `relationmirror` (yêu cầu bổ sung giữa chừng của user):

- Data model + `entry-tree.ts` plumbing (`displayFields` trên
  `RelationFieldConfig`/`ComponentFieldConfig`; `flattenSummaryCandidates`
  mới bên cạnh `flattenDisplayColumns`).
- `entry-summary.ts` (`buildEntrySummary`, thuần/async, nhận `resolveRelation`
  injected) + 10 unit test (fallback field-đầu-tiên, thứ tự dòng theo
  `displayFields`, ảnh, boolean/richtext format, đệ quy component-repeat,
  đệ quy relation qua fetch, id lỗi/thiếu, và **guard vòng lặp tự-quan-hệ** -
  test dựng 2 type A/B trỏ vào nhau, xác nhận dừng ở `MAX_SUMMARY_DEPTH=4`
  thay vì treo).
- `EntrySummaryLines.tsx` (renderer dùng chung) + CSS
  (`.entry-summary-lines/-line/-nested`, `.entry-summary-relation-cell/-item`,
  `.link.multiline` override cho `ComponentField`).
- Đấu nối cả 3 nơi hiển thị: `ComponentField` (`renderSummary`), `RelationField`
  (`resolveSummaries`), `ContentEntryList` relation column (`renderRelationCell`
  đổi từ badge sang block xếp dòng, vẫn giữ "hiện 2 + N more").
- `FieldDialog`: `DisplayFieldsInput` (component mới, theo pattern
  `DefaultValueInput` đã có) - multi-select field từ type đích, cần thread
  `allTypes` prop mới xuống `FieldDialog`.
- **Relation Mirror** (yêu cầu bổ sung của user giữa chừng): mirror không có
  `config` thật của riêng nó (field ảo, không nằm trong `fields[]`) nên
  `displayFields` không thể sống trong `RelationMirrorFieldConfig` như field
  thật - thêm overlay map mới `ContentTypeDefinition.fieldDisplayFields`
  (cùng pattern tự-heal với `fieldSides`/`fieldDescriptions` đã có), thread
  qua `system-fields.ts`'s `relationMirrorFieldsFor` vào `config.displayFields`
  của mirror field synthesize ra - khác với `fieldDescriptions` (chỉ cosmetic
  ở schema editor), map này **có** chảy tới `entry-tree.ts`'s
  `EntryRelationMirrorNode.displayFields` thật, nên `RelationMirrorFieldAdapter`
  ở form sửa entry thấy được config, không chỉ FieldDialog.

QA thủ công qua Playwright trên dev server thật (không phải fixture): xác
nhận cả 4 nơi hoạt động đúng qua toàn bộ luồng thật (FieldDialog → Save draft
→ Apply and build → Confirm → Save) - `blog.category` (relation, target
Category) hiện "Title: … / Slug: …" ở cột List; `category`'s auto-gen mirror
"Blog Post" hiện "Cover Image: - / Title: …" trên card ở entry editor; `menu.refs`
(component-repeat) hiện "Label: … / Description: …" từng dòng trong item list.
Phát hiện thú vị lúc QA: dữ liệu seed sẵn có (`dry.seed.json`) đã có sẵn
`displayFields` trên field `blog.category` và `menu.refs` từ trước (không phải
do phiên này tạo ra) - xác nhận UI đọc đúng config có sẵn, không chỉ config
mới tự tạo.

`bun run typecheck` sạch (trừ 4 lỗi có sẵn, không liên quan, trong
`src/server/routes/auth.ts` - việc của phiên khác). `bun run test` 951/967
pass; 16 fail còn lại đều là lỗi có sẵn không liên quan (đụng bảng trùng tên
do `dry.seed.json` đã được checked-in với nhiều content type của app thật,
trong `seed.test.ts`/`sqlite.test.ts`/`entries-sqlite.test.ts`/
`dry-reader.test.ts`/`content-types.test.ts` - không phải file phiên này đụng
tới).

## Speed
Xong trong 1 phiên làm việc liên tục, không blocker.
