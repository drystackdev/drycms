# Google Verification: name+content singleton (replaces the SeoDefaults FileField)

## Plan

Bối cảnh: đã có `seoDefaults.googleSiteVerificationFile` (FileField, upload
thật) + `src/server/google-verification.ts`'s `tryServeGoogleVerificationFile`
(đọc live qua storage adapter, phục vụ ở root). Yêu cầu mới: bỏ cách upload
file, thay bằng 1 singleton hệ thống riêng lưu 2 field string (`name`,
`content`), route sẽ tự sinh response tại `/<name>` từ `content` - không đụng
storage adapter nữa nên tự động portable sang Cloudflare (D1/R2) mà không cần
thủ thuật gì thêm.

1. **Gỡ FileField khỏi SeoDefaults**
   - `seed.ts`: xoá field `googleSiteVerificationFile` khỏi `seoDefaults.fields`
     (về lại `fields: []`), xoá `IDS.seoDefaultsGoogleSiteVerificationFile`.
   - Migrate DB live (script throwaway, `planSave`/`applySave`, backup
     `.dry/content.sqlite` trước - theo đúng quy trình đã dùng lần trước).
   - `bun run dry:generate` lại `dry.generated.d.ts`.
   - Giữ nguyên `FileField`/`file` field type trong registry (component dùng
     chung, không riêng cho tính năng này - vẫn là field type hợp lệ cho use
     case khác sau này). Sẽ xác nhận lại nếu muốn xoá hẳn.

2. **Content type mới: `googleVerification` (singleton hệ thống)**
   - `system-fields.ts`: thêm `GOOGLE_VERIFICATION_TYPE_ID` (cùng pattern
     `SEO_DEFAULTS_TYPE_ID`).
   - `seed.ts`: thêm định nghĩa singleton `hidden: true, locked: true` (như
     `seoDefaults`/`systemSettings`), 2 field `text`:
     - `name` - placeholder `google1234567890abcdef.html`, required.
     - `content` - placeholder `google-site-verification:
       google1234567890abcdef.html`, required, multiline (cho phép dán cả
       đoạn HTML dài nếu cần).
   - Thêm vào mảng trả về cuối `defaultContentTypeDefinitions()`.
   - Apply lên DB live bằng script throwaway tương tự (tạo type mới qua
     `planSave`/`applySave`, `version: 0`).

3. **Viết lại `src/server/google-verification.ts`**
   - Bỏ hẳn phần đọc storage adapter (`getStorageAdapter`/`StorageError`/
     stream) - chỉ còn: match `pathname === "/" + row.name`, trả về
     `new Response(row.content, { headers: { "Content-Type": mimeType(row.name) } })`.
   - Đơn giản hơn hẳn bản cũ, và giờ chạy đúng như nhau trên local (sqlite)
     lẫn Cloudflare (D1) - không còn phụ thuộc `kind: "local" | "cloudflare"`
     storage nữa.
   - Wiring vào `page-handler.ts` giữ nguyên (cùng chữ ký hàm).

4. **Settings: tách "Color schema" / "Google Verification"**
   - `DryLayout.tsx`: đổi entry `settings` (hiện `label: "Settings"`, 1 link
     phẳng) thành **1 nhóm cha "Settings" có 2 sub-item tĩnh** - tái dùng đúng
     UI pattern `ContentNavGroup` đang có cho Collection/Singleton (expand/
     collapse, popover khi sidebar thu gọn), tổng quát hoá tham số của nó từ
     `ContentTypeDefinition[]` sang `{id,label,href}[]` để dùng chung được cho
     cả 2 trường hợp (tránh tạo component riêng trùng lặp UI).
     - Sub-item 1: "Color schema" - href `/dry/settings/color-schema`,
       permissionName `systemSettings` (giữ nguyên logic quyền cũ).
     - Sub-item 2: "Google Verification" - href
       `/dry/settings/google-verification`, permissionName
       `googleVerification`.
   - `routers/App.tsx`: 2 route con thay cho route `/dry/settings` phẳng hiện
     tại (+ redirect `/dry/settings` -> `/dry/settings/color-schema` cho link
     cũ/bookmark khỏi vỡ).
   - `pages/Settings.tsx`: đổi tiêu đề trang từ "Settings" -> "Color schema"
     (nội dung/logic giữ nguyên 100%, không đổi hành vi).
   - `pages/GoogleVerificationSettings.tsx` (mới): form đơn giản 2
     `TextField` (Name, Content) + nút Save, cùng pattern load/save singleton
     đang dùng ở `Settings.tsx` (`createContentEntriesApi("googleVerification")`),
     nhưng không có phần theme/preview.

5. **Test/QA**
   - Cập nhật `seed.test.ts` (seoDefaults quay lại 0 field, thêm assertion
     cho `googleVerification`).
   - `bun run typecheck`, `bun run test` (so với baseline 16 fail sẵn có,
     không tăng thêm).
   - QA thủ công qua curl/API (Playwright có thể đang bị khoá bởi phiên
     khác): tạo `googleVerification` entry, `GET /<name>` phải trả đúng
     `content` ở root, còn API list root khác vẫn 404/route như cũ.

## Status

Chưa bắt đầu - đang chờ xác nhận kế hoạch.

## Speed

N/A - lên kế hoạch xong, chưa code.
