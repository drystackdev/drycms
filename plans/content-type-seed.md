# Seed content type do app tự định nghĩa + đóng gói lúc build

## 1. Bối cảnh

`src/content-types/seed.ts` hiện tại chỉ seed **6 content type hệ thống**
(`user`, `menu`, `menuItem`, `seo`, `aiKey`, `role`) - id cố định trong `IDS`,
chạy qua `defaultContentTypeDefinitions()` + `pendingSeedStatements()`. Hàm
này được gọi ở **module scope** của cả hai engine adapter
(`engine/sqlite.ts:63`, `engine/d1.ts:88`) - tức là chạy lại **mỗi lần server
khởi động**, diff theo `name` (lowercase) so với bảng `metadata` hiện có, tạo
bổ sung type nào còn thiếu. Bắt buộc phải chạy every-boot vì `user`/`role`
cần tồn tại NGAY từ lúc boot - `GET /api/auth/session` gọi
`findType(allTypes, "user")` trên mọi request, kể cả trước khi có ai đăng ký
(`routes/auth.ts:93-97,211-212`).

Không có cơ chế nào hiện tại để: (a) một app dùng drycms định nghĩa/lưu lại
content type + dữ liệu media riêng của nó theo cách tái tạo được, và (b) đưa
những content type + asset đó vào một bản deploy production mới mà không phải
tạo tay lại từng cái qua UI.

## 2. Quyết định đã chốt (đã hỏi người dùng, theo thứ tự thời gian)

1. **Seed chỉ đóng gói schema (meta) của content type, KHÔNG đóng gói dữ liệu
   thực (entries/rows)**. Production sau khi seed có đầy đủ content type +
   field, nhưng bảng dữ liệu trống - admin tự nhập dữ liệu qua UI.
2. **Một hệ thống thống nhất**: script seed viết/đồng bộ tay và cơ chế tự
   động đóng gói lúc build dùng chung một định dạng file, một loader - không
   phải hai tính năng rời rạc.
3. ~~Seed chỉ tự chạy đúng 1 lần lúc tạo superadmin, không chạy lại mỗi
   boot~~ - **đã thay bằng quyết định #4 bên dưới cho phần schema** (asset
   zip thì VẪN chỉ chạy 1 lần, xem mục 6).
4. **Khi có `dry.seed.json`, nó THAY THẾ HOÀN TOÀN `seed.ts` làm nguồn danh
   sách "content type mặc định cần tồn tại"** - chạy every-boot, diff-by-name,
   y hệt cơ chế `pendingSeedStatements` hiện tại, chỉ đổi nguồn dữ liệu. Không
   có file → dùng `defaultContentTypeDefinitions()` (6 type hệ thống, hardcode)
   như hôm nay. Có file → toàn bộ danh sách trong file (bao gồm cả bản sao
   của 6 type hệ thống, vì `seed:sync` chụp nguyên trạng DB dev - DB dev vốn
   đã có 6 type đó) được dùng thay, `defaultContentTypeDefinitions()` không
   được gọi tới nữa.
   **Đánh đổi đã được xác nhận với người dùng**: 1 content type do app tự
   định nghĩa, nếu bị admin xoá trên production sau khi go-live, sẽ **tự tạo
   lại ở lần boot kế tiếp** (vì vẫn còn trong `dry.seed.json` của bản build
   đang chạy) - đúng caveat mà 6 type hệ thống đã luôn có, giờ áp dụng cho
   toàn bộ danh sách.

## 3. Kiến trúc tổng quan

```
[Dev: xây content type qua Content-Type Builder UI, upload media]
                │
                │  bun run seed:sync   (chạy tay khi dev muốn "chốt" state)
                ▼
        dry.seed.json  (repo root, cạnh dry.config.ts)
        { "contentTypes": [...TOÀN BỘ types hiện có, kể cả 6 type hệ thống] }
                │
                │  bun run build   (tự động, không cần dev làm gì thêm)
                ▼
  dist/server/entry-node.js   (KHÔNG đụng dry.seed.json - file đó ở nguyên
                                repo root, đọc tươi mỗi lần module load)
  dist/server/seed-assets.zip (storage/icons/components/pageComponents zip lại)
                │
                │  deploy lên production CÙNG VỚI dry.seed.json ở repo root
                │  (file thật cần tồn tại lúc runtime - xem "Sự cố khi
                │  implement" bên dưới), chạy `node dist/server/entry-node.js`
                ▼
  MỖI LẦN BOOT: engine/sqlite.ts|d1.ts gọi pendingSeedStatements() như cũ,
  nhưng danh sách "default" giờ lấy từ dry.seed.json đã đóng gói (nếu có)
  thay vì defaultContentTypeDefinitions() - ensure mọi type trong đó tồn tại,
  y hệt cơ chế hôm nay, KHÔNG cần thay đổi gì ở 2 file engine này.
                │
                ▼
   Admin đầu tiên mở /register → POST register-first-admin
                │  (đúng thời điểm hasAnyUser === false, đã có lock sẵn)
                ▼
   extractPackagedSeedAssets() → giải nén zip vào ĐÚNG root theo dry.config.ts
   của production đang chạy (có thể khác root lúc build) - CHỈ CHẠY 1 LẦN,
   gated bởi hasAnyUser giống schema seed KHÔNG áp dụng ở đây (asset không
   nên ghi đè lại mỗi boot, sẽ đè lên chính sửa đổi của admin sau này).
                │
                ▼
        tạo user superadmin, đăng nhập vào hệ thống đã có sẵn schema + asset
```

Điểm mấu chốt (**đã sửa sau khi implement, xem "Sự cố khi implement" ở cuối
mục này**): `content-types/seed.ts` đọc `dry.seed.json` bằng `node:fs`
thường (`readFileSync`, đồng bộ, tha thứ khi file thiếu) - CÙNG một idiom
`server/options.ts`'s `readDotEnv` đã dùng cho `.env`. Sự tồn tại của file
(tại `process.cwd()`, tức repo root/deployment root) chính là công tắc
bật/tắt tính năng, đúng yêu cầu "không có file thì lấy seed.ts, có thì bỏ
qua seed.ts" - nhưng KHÔNG bake vào JS bundle như bản thiết kế đầu tiên định
làm; xem lý do bên dưới.

> **Sự cố khi implement, đã sửa**: bản thiết kế đầu tiên dùng
> `import.meta.glob("/dry.seed.json", { eager: true })` để Vite tự bỏ qua
> file thiếu thay vì lỗi build (khác `import` tĩnh, vốn bắt buộc file phải
> tồn tại). Đây là cú pháp CHỈ Vite hiểu - `content-types/seed.ts` cũng được
> require bởi 2 script chạy bằng `bun` thẳng (không qua Vite):
> `scripts/dry-generate.ts` (đã có từ trước) và `scripts/seed-sync.ts` (mục
> 4) - cả hai import content engine, kéo theo `seed.ts`. Chạy `bun run
> seed:sync` với bản `import.meta.glob` ném lỗi ngay khi module load:
> `TypeError: import.meta.glob is not a function`. Đổi hẳn sang `node:fs`
> đồng bộ giải quyết triệt để (chạy giống hệt dưới bun/Node/Vite, không cần
> transform nào), đổi lại: `dry.seed.json` giờ là một file thật cần tồn tại
> ở deployment root lúc RUNTIME (đọc mỗi lần module load, không bake vào
> bundle) - xem mục 5 cập nhật.

## 4. Thành phần mới

- **`dry.seed.json`** (repo root, KHÔNG check in mặc định) -
  `{ "contentTypes": ContentTypeDefinition[] }`. Chứa TOÀN BỘ content type
  hiện có của dev DB tại thời điểm `seed:sync` chạy gần nhất (kể cả 6 type hệ
  thống - không lọc bỏ gì cả, vì giờ đây file này khi tồn tại phải tự đủ khả
  năng thay thế hoàn toàn `seed.ts`).

- **`scripts/seed-sync.ts`** (chạy qua `bun run seed:sync`) - script chạy tay
  tách hẳn khỏi `content-types/seed.ts`. Kết nối vào content engine hiện tại
  của dev (dùng lại `resolveOptions()` + `createContentEngineAdapter()` y hệt
  dev server), gọi `schemaAdapter.listContentTypes()`, ghi TOÀN BỘ kết quả
  (pretty-printed) đè lên `dry.seed.json`. Thao tác "chụp ảnh state hiện
  tại", không phải merge - chạy lại là ghi đè hoàn toàn.

- **`content-types/seed.ts`** - thêm:
  ```ts
  import { readFileSync } from "node:fs";
  import { resolve as resolvePath } from "node:path";

  export interface PackagedSeed {
    contentTypes: ContentTypeDefinition[];
  }

  function loadPackagedSeed(): PackagedSeed | undefined {
    try {
      return JSON.parse(readFileSync(resolvePath(process.cwd(), "dry.seed.json"), "utf8")) as PackagedSeed;
    } catch {
      return undefined;
    }
  }

  const realPackagedSeed = loadPackagedSeed();

  export function resolveDefaultContentTypeDefinitions(
    packagedSeed: PackagedSeed | undefined = realPackagedSeed,
  ): ContentTypeDefinition[] {
    return packagedSeed?.contentTypes ?? defaultContentTypeDefinitions();
  }
  ```
  (`packagedSeed` là tham số có default, không phải hardcode thẳng
  `realPackagedSeed` bên trong - để unit test tiêm một seed giả mà không cần
  file thật trên đĩa.) `pendingSeedStatements` đổi dòng
  `const all = defaultContentTypeDefinitions();` thành
  `const all = resolveDefaultContentTypeDefinitions();` - **chỉ một dòng
  đổi**, mọi logic diff-by-name/tạo statement còn lại giữ nguyên.
  `defaultContentTypeDefinitions()` (hardcoded) vẫn giữ nguyên, dùng làm
  fallback khi không có `dry.seed.json`.
  → **`engine/sqlite.ts` và `engine/d1.ts` KHÔNG cần sửa gì** - chúng vẫn gọi
  `pendingSeedStatements(existingNames)` y như cũ, chỉ là hàm này giờ trả kết
  quả khác tuỳ có `dry.seed.json` hay không.
  **Đọc bằng `node:fs` thường, KHÔNG dùng `import.meta.glob`** - xem "Sự cố
  khi implement" ở mục 3: `seed.ts` bị require bởi 2 script chạy thẳng qua
  `bun` (`dry-generate.ts`, `seed-sync.ts`), nơi cú pháp riêng của Vite không
  tồn tại. Hệ quả: `dry.seed.json` được đọc TƯƠI mỗi lần module load (không
  bake vào JS bundle), tại `process.cwd()` - đúng giả định `resolveOptions()`
  đã dùng cho mọi root khác, nhưng khác với cách `dry.config.ts` được bake
  thẳng vào bundle qua `import` tĩnh ở `server/config.ts`. Production cần
  file `dry.seed.json` tồn tại thật ở deployment root (nơi `bun run start`
  chạy) - không phải chỉ trong bundle.

- **`src/content-types/seed-assets.ts`** - CHỈ xử lý phần asset (zip), không
  còn liên quan schema nữa:
  - `extractPackagedSeedAssets(resolved: ResolvedDryOption)` - tìm
    `seed-assets.zip` cạnh chính module này
    (`fileURLToPath(new URL("./seed-assets.zip", import.meta.url))`, đúng
    bất kể `cwd` lúc chạy `node dist/server/entry-node.js`); không có file
    thì no-op. Có thì giải nén, mỗi entry trong zip có prefix
    `storage/`, `icons/`, `components-storage/`, `page-components-storage/` -
    map từng prefix sang root TƯƠNG ỨNG mà `resolveOptions()` của
    **production đang chạy** trả về (không phải root lúc build).

- **`src/lib/zip.ts`** - zip writer (dùng ở `scripts/build-seed-assets.ts`)
  + zip reader/extractor (dùng ở runtime, bundle vào `entry-node.js`). Tự
  viết tay, không thêm dependency mới: chỉ dùng `node:fs`, `node:path`,
  `node:zlib` (`zlib.crc32()` - có sẵn từ Node 22.2+, engines của package.json
  đã yêu cầu >=22.12.0). Bản đầu chỉ hỗ trợ method STORE (không nén) - đơn
  giản, đủ dùng, không cần code inflate ở runtime; nén (DEFLATE qua
  `zlib.deflateRawSync`/`inflateRawSync`, vẫn stdlib) có thể thêm sau như một
  cải tiến độc lập, không đổi format container.

- **`scripts/build-seed-assets.ts`** - bước build mới. Gọi
  `resolveOptions()` với `dry.config.ts` hiện tại (giống hệt cách dev server
  resolve), với 4 root "có thể đóng gói":

  | key zip | nguồn resolve |
  | :-- | :-- |
  | `storage` | `resolved.storage.root` |
  | `icons` | `resolved.icons.root` |
  | `components-storage` | `resolved.components.storage.root` |
  | `page-components-storage` | `resolved.pageComponents.storage.root` |

  KHÔNG đóng gói `pagesCache`/`typesCache` (cache, tự sinh lại được), không
  đóng gói `kv` (runtime state, không phải asset), không đóng gói
  `content.file`/DB sqlite (dữ liệu entries - loại trừ theo quyết định #1).
  Root nào không tồn tại trên đĩa thì bỏ qua, không lỗi. Ghi ra
  `dist/server/seed-assets.zip`. Cả 4 root rỗng/không tồn tại → có thể bỏ qua
  tạo file zip, `extractPackagedSeedAssets` coi "không có file" là no-op.

## 5. Thay đổi ở file có sẵn

- **`src/content-types/seed.ts`** - thêm `loadPackagedSeed()` (đọc
  `node:fs`) + `resolveDefaultContentTypeDefinitions()` như mục 4; đổi 1 dòng
  trong `pendingSeedStatements`. Cập nhật doc comment ở đầu file (đang nói
  "`pendingSeedStatements` re-seeds một default còn thiếu theo TÊN" - giờ
  thêm 1 câu nói rõ danh sách "default" có thể đến từ `dry.seed.json`).

- **`package.json`**:
  - Thêm script `"seed:sync": "bun scripts/seed-sync.ts"`.
  - Sửa `"build"` thành 3 bước tuần tự: `vite build --outDir dist/client &&
    vite build --ssr src/server/entry-node.ts --outDir dist/server && bun
    scripts/build-seed-assets.ts` (bước zip chạy SAU vite SSR build vì ghi
    vào `dist/server/`; `bun` chứ không phải `node` - script import thẳng
    `.ts` project, giống `dry:generate` đã làm từ trước).

- **`src/server/routes/auth.ts`** - trong nhánh `register-first-admin`, bên
  trong `withFirstAdminRegistrationLock`, ngay sau khi xác nhận
  `!(await hasAnyUser(...))` và TRƯỚC khi `entryAdapter.createEntry(userType,
  ...)` tạo user: gọi `await extractPackagedSeedAssets(resolvedOptions)`
  (**chỉ asset, KHÔNG cần gọi gì cho schema nữa** - schema đã tự đảm bảo tồn
  tại từ lúc boot). Đặt trước bước tạo user để nếu giải nén lỗi giữa chừng,
  request fail và KHÔNG có user nào được tạo - retry sạch, không cần cờ đánh
  dấu "đã chạy" riêng.
  Cần truyền `ResolvedDryOption` vào route context (kiểm tra xem
  `context`/`getContentAdapters` đã có sẵn hay phải xuyên qua
  `server/config.ts`/`options.ts` thêm).

- **`docs/ARCHITECTURE.md`** - thêm một đoạn ngắn dưới mục Auth mô tả
  `dry.seed.json` thay thế `seed.ts` khi có mặt, trỏ sang file plan này thay
  vì lặp lại chi tiết.

## 6. Định dạng `dry.seed.json`

```json
{
  "contentTypes": [ /* ContentTypeDefinition[], id giữ nguyên từ DB gốc, gồm cả 6 type hệ thống */ ]
}
```

Id của content type do UI tạo là `randomUUID()` thật (xem
`server/routes/content-types.ts:262`, `lib/uuid.ts`); 6 type hệ thống có id
cố định `system-*` từ `IDS` trong `seed.ts`. Không có va chạm id giữa hai
nhóm. `seed:sync` giữ nguyên id khi chụp lại, để chạy nhiều lần / seed nhiều
production khác nhau vẫn cùng một danh tính logic.

## 7. Rủi ro & cạnh biên

- **Type app-defined bị admin xoá trên production sẽ tự tạo lại ở boot kế
  tiếp** - đã xác nhận chấp nhận với người dùng (quyết định #4), giống hệt
  caveat mà `seed.ts` đã có tài liệu hoá cho 6 type hệ thống từ trước.
- **Adopt `dry.seed.json` khiến app KHÔNG còn tự động nhận type hệ thống mới
  khi upgrade drycms** - hôm nay, upgrade drycms thêm 1 type hệ thống mới thì
  mọi app tự động có type đó ở lần boot kế tiếp (qua
  `defaultContentTypeDefinitions()`). Một khi app có `dry.seed.json`,
  `resolveDefaultContentTypeDefinitions()` không bao giờ gọi tới
  `defaultContentTypeDefinitions()` nữa - type hệ thống mới sẽ KHÔNG xuất
  hiện cho tới khi dev tự `seed:sync` lại (từ một dev DB đã upgrade, nên đã
  có type mới đó) rồi build lại. Cần ghi rõ trong tài liệu cho người
  dùng/dev biết, đây là đánh đổi cố ý khi dùng tính năng này.
- **`dry.seed.json` chứa type đã bị xoá khỏi dev DB** - `seed:sync` OVERWRITE
  toàn bộ file mỗi lần chạy, type bị xoá tự động biến mất khỏi seed lần chụp
  kế tiếp.
- **Singleton trong seed - đã kiểm tra, không chặn** - `pendingSeedStatements`
  chỉ tạo TABLE (qua `planMigration`), không gọi `ensureSingletonEntry`
  (hàm đó chỉ được `routes/content-types.ts`'s `performSave` gọi, tức chỉ khi
  tạo/sửa qua Content-Type Builder UI). Một singleton đến từ `dry.seed.json`
  vì vậy KHÔNG có sẵn row ngay lúc boot, khác với tạo tay qua UI. Không phải
  lỗi: `GET` một singleton chưa có row trả `entry: null` (không throw -
  `content-entries.ts:324-330`), và `PUT` (`saveSingletonEntry`) tự tạo row ở
  lần lưu đầu tiên - chỉ là admin thấy trang trống tới khi tự lưu lần đầu,
  không phải tự động có sẵn dữ liệu mặc định như tạo qua UI. Hợp lý với
  quyết định #1 (seed chỉ schema, không seed dữ liệu) - hành vi hiện tại thật
  ra NHẤT QUÁN hơn, không phải một khoảng trống cần vá.
- **Build không chạy `bun run seed:sync` trước** - `dry.seed.json` vẫn là
  bản cũ nhất đã được chốt tay/lần sync gần nhất, KHÔNG tự động đồng bộ lúc
  build. Quên `seed:sync` thì build đóng gói seed cũ, không phải state DB mới
  nhất.
- **D1**: asset zip/extract hoàn toàn không phụ thuộc `content.engine` -
  `storage`/`icons`/`components`/`pageComponents` luôn là `kind: "local"`
  (chưa có backend nào khác), tính năng chạy như nhau bất kể app dùng sqlite
  hay D1. Phần schema (`resolveDefaultContentTypeDefinitions`) đã nằm trong
  `pendingSeedStatements`, vốn đã dùng chung cho cả hai engine từ trước, nên
  tự động hoạt động ở cả hai mà không cần code riêng.
- **Nhiều lần deploy cùng 1 bản build** - mỗi production instance có DB
  riêng, `hasAnyUser` riêng; schema seed thì every-boot nên luôn nhất quán,
  asset seed chỉ chạy ở lần tạo superadmin đầu tiên của TỪNG instance.

## 8. Ngoài phạm vi (rõ ràng KHÔNG làm ở lượt này)

- Seed dữ liệu thực (entries/rows) - quyết định #1.
- Nén zip (DEFLATE) - để STORE cho bản đầu, thêm sau nếu kích thước asset
  thực sự là vấn đề.
- Một UI trong Content-Type Builder để "seed" bằng tay qua nút bấm - lượt
  này chỉ có CLI (`bun run seed:sync`) + tự động lúc build.
- Remote storage backend (r2/s3) - `PLANNED_STORAGE_KINDS` trong
  `options.ts` chưa implement, không liên quan lượt này.
- Cơ chế merge/cảnh báo khi `dry.seed.json` "lệch" so với type hệ thống mới
  sau khi upgrade drycms (xem rủi ro ở mục 7) - chỉ ghi nhận, không tự động
  xử lý.

## 9. Kiểm chứng

- `bun run typecheck` sạch.
- Unit test cho `content-types/seed.ts`: `resolveDefaultContentTypeDefinitions()`
  trả về `defaultContentTypeDefinitions()` khi tiêm `undefined` (không có
  `dry.seed.json`), trả về nội dung packaged khi tiêm một `PackagedSeed` giả.
- Unit test cho `lib/zip.ts`: roundtrip write → read cho vài file nhỏ + thư
  mục lồng nhau + file rỗng.
- Test thủ công end-to-end: tạo 1 content type mới qua UI dev, `bun run
  seed:sync`, `bun run build`, xoá sạch `.dry/` + DB, chạy
  `node dist/server/entry-node.js`, xác nhận content type mới đã tồn tại
  NGAY LÚC BOOT (trước khi tạo superadmin, kiểm qua Content Types API/DB
  trực tiếp), rồi mở `/register`, tạo superadmin, xác nhận asset xuất hiện
  đúng chỗ theo `dry.config.ts` của lần chạy production đó (thử đổi
  `storage.root` khác lúc build để chắc chắn không hardcode đường dẫn
  build-time).
- `bun run test:e2e` vẫn xanh (repo test không có `dry.seed.json` → hoàn
  toàn no-op, không được phép làm hỏng luồng hiện tại).

## 10. Thứ tự triển khai gợi ý

1. `src/content-types/seed.ts`'s `resolveDefaultContentTypeDefinitions()` +
   `loadPackagedSeed()` (đọc `node:fs`, KHÔNG `import.meta.glob` - xem "Sự cố
   khi implement" ở mục 3) + đổi 1 dòng trong `pendingSeedStatements` + unit
   test. Bước này tự đứng được, không phụ thuộc gì khác, và đã giải quyết
   trọn vẹn phần schema.
2. `src/lib/zip.ts` (writer + reader) + unit test.
3. `src/content-types/seed-assets.ts` (`extractPackagedSeedAssets`) + unit
   test.
4. Nối `extractPackagedSeedAssets` vào `routes/auth.ts`'s
   `register-first-admin` + test tích hợp.
5. `scripts/build-seed-assets.ts` + sửa `package.json`'s `build` script.
6. `scripts/seed-sync.ts` + `package.json`'s `seed:sync` script.
7. Test thủ công end-to-end đầy đủ (mục 9) + cập nhật `docs/ARCHITECTURE.md`.
