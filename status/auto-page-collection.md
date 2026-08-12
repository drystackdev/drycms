# Bỏ `seoUrlPattern` - route ↔ collection tự suy ra từ code trang

## Plan

Xoá hẳn config `seoUrlPattern` (ô "Sitemap URL pattern" trong Content Type
Editor). Thay bằng: đọc chính source của trang `[param]` - một trang động
bắt buộc phải lấy entry của nó bằng `dry().collection("<name>").get(<param>)`,
nên chính lời gọi đó LÀ mapping route → collection, luôn khớp với code.

Không thêm cơ chế mới nào khác: không AST, không render thử, không config
thay thế. Một hàm thuần ~10 dòng, dùng chung cho cả 2 phía đang cần mapping.

1. `src/server/app-router/page-collection.ts` (mới) - hàm thuần
   `collectionTypeForPageSource(source, allTypes)`.
2. `dynamic-routes.ts` - `matchingType` bỏ so `seoUrlPattern`, dùng hàm trên;
   `resolveDynamicPages` nhận thêm `sourceByPath`.
3. `page-build.ts` / `PageEditor.tsx` / `PageBuild.tsx` - truyền source +
   sửa lời cảnh báo "no content type's seoUrlPattern matches".
4. `sitemap.ts` (nhánh dev) - đảo chiều: duyệt các `[param]` template của
   route tree (thay vì duyệt type có `seoUrlPattern`), mỗi template resolve
   collection từ source rồi liệt kê slug đã publish.
5. `DevPagesSource.readSource()` (mới) + impl trong `scripts/dev-server.mjs` -
   server dev cần đọc text của `page.tsx` cho bước 4.
6. Xoá `seoUrlPattern` khỏi `types.ts` + ContentTypeEditor.
7. Tests: mới cho hàm thuần; sửa `dynamic-routes.test.ts`, `sitemap.test.ts`,
   fixture `DevPagesSource` trong `page-handler.test.ts`.
8. Dọn config chết + help/docs (vòng 2, theo yêu cầu sau): xoá
   `livePreviewUrl`; sửa help text feature Slug/SEO; viết lại phần route
   động trong `docs/APP-ROUTER.md`.

## Status

- [x] 1. `page-collection.ts` + test
- [x] 2. `dynamic-routes.ts`
- [x] 3. page-build / PageEditor / PageBuild
- [x] 4. `sitemap.ts` dev branch
- [x] 5. `DevPagesSource.readSource` + dev-server
- [x] 6. Xoá field khỏi types + UI
- [x] 7. Tests xanh + typecheck
- [x] 8. Config chết + help + docs

## Speed

Xong. `bun run test` 1231 pass / 0 fail (118 file), `bun run typecheck` sạch.

Kiểm chứng thật trên dev server (`.dry/pages-source` + `.dry/content.sqlite`
sống): `/demo/[slug]` resolve đúng ra `demoArticle` (collection, slug=true)
mà không có config nào; thêm 1 row published tạm → `/sitemap.xml` hiện
`http://localhost:5173/demo/tmp-sitemap-check`, xoá row → sitemap sạch lại.
Đáng chú ý: `demoArticle` trước giờ KHÔNG hề có `seoUrlPattern`, tức là
sitemap dev của chính project này vẫn luôn thiếu trang động - đúng cái giá
của việc bắt khai báo tay mà cơ chế mới xoá bỏ.

### Vòng 2 - config chết, help, docs

- `livePreviewUrl` (ô "Live Preview") xoá khỏi `types.ts` + editor: chưa bao
  giờ có ai đọc, doc comment vẫn ghi "will eventually". Không có definition
  nào trong DB sống mang key này nên không cần migrate.
- Đã quét liveness các key config còn lại (`fieldOrder`/`fieldSides`/
  `fieldDescriptions`/`fieldDisplayFields`/`hidden`/`locked`/`frozen`/
  `protectedFieldIds`, và toàn bộ option trong `server/options.ts` gồm
  `pagesCache.edgeTtl`, `kv.*`, `ai.*`): tất cả đều có người đọc thật -
  `livePreviewUrl` là cái chết duy nhất.
- Help text: feature **Slug** giờ nói rõ `pages/blogs/[slug]/page.tsx` đọc
  collection này sẽ build 1 trang/entry; feature **SEO** nói rõ có cả
  Hide-from-search-engines và ảnh hưởng tới sitemap.
- `docs/APP-ROUTER.md`: thêm mục "Dynamic routes: the page's own `dry()` call
  decides which pages exist" (4 bước + các bẫy: gọi gián tiếp, `.list()`,
  collection không bật Slug, noIndex). Nhân tiện sửa 2 chỗ đã sai thực tế:
  `params` (giờ có cả ambient global `params()`, kèm bẫy shadow) và mục "Not
  built yet" vẫn ghi chưa có 404 page/meta tag trong khi `404.tsx`/`500.tsx`
  + `setTitle`/`buildSeoTags` đã chạy từ lâu.

Thay đổi hành vi có chủ ý (không phải regression):

- Sitemap dev giờ chỉ liệt kê URL động khi THỰC SỰ có file route tương ứng.
  Trước đây một collection có `seoUrlPattern` nhưng không có `page.tsx` vẫn
  được quảng cáo trong sitemap → 404 với crawler.
- Bỏ điều kiện `features.seo` cho entry động trong sitemap dev (chỉ còn cần
  `features.slug`): trang tồn tại thì phải có trong sitemap, `seo` chỉ để
  ghi đè `noIndex`. Khớp với nhánh prod (registry `_pages`) vốn không hề
  đọc `features.seo`.
- Giới hạn đã biết: quét bằng regex trên source, nên `dry().collection(...)
  .get()` bị gián tiếp qua biến/helper, hoặc nằm trong comment, sẽ không/sai
  nhận diện. UI đã có sẵn chỗ báo template không resolve được (Page Builder
  "Unresolved dynamic routes", Page Editor preview) nên trường hợp này hiện
  ra ngay chứ không âm thầm.
