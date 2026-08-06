# System memory + System Settings + dời User/SEO Defaults

## Plan

Ba việc độc lập, làm theo thứ tự C → A → B (rủi ro tăng dần).

### Phần C - dời `User`/`SEO Defaults` vào menu System

- `seed.ts`: thêm `hidden: true` cho content type `user` (`IDS.user`) và
  `seoDefaults` (`SEO_DEFAULTS_TYPE_ID`) - giữ nguyên field/kind/API, chỉ ẩn
  khỏi nhóm Collection/Singleton generic (đúng cơ chế `redirect`/`aiKey` đang
  dùng).
- `DryLayout.tsx`: thêm 2 entry mới vào mảng `NAV`, `section: "System"`:
  "Users" trỏ route Collection User hiện tại, "SEO Defaults" trỏ route
  singleton editor hiện tại. Không đổi trang đích, chỉ đổi cách vào.
- DB thật (`.dry/content.sqlite`) đã tồn tại - đổi `seed.ts` không tự áp dụng
  cho type đã seed. Phải cập nhật field `hidden` cho 2 type này qua chính cơ
  chế sửa content-type sống (staged apply), KHÔNG re-run seed - xem memory
  "Seed script vs live DB".

### Phần A - collection `memory` (kho đồng bộ cài đặt cá nhân theo tài khoản)

Quyết định đã chốt với user:
- Tên: `memory` (không phải `__memory` - vi phạm `CONTENT_TYPE_NAME_RE`,
  quy tắc đặt tên hệ thống dùng cờ `hidden`/`locked`/`frozen`, không dùng
  tiền tố).
- **Ẩn hoàn toàn**: `hidden: true, locked: true, frozen: true`, KHÔNG có nav
  entry, KHÔNG có trang quản trị nào (khác `role`/`aiKey` vẫn có UI riêng dù
  hidden). Đã verify `BuilderContentType.tsx` lọc `!definition.hidden` ở cả
  `liveDefinitions` và `BuilderCollectionList` nên type này biến mất luôn
  khỏi màn Content Types, không chỉ khỏi sidebar.
- Phạm vi dữ liệu: kho chung cho MỌI cài đặt cá nhân (không chỉ MagicChat) -
  tức mirror của `drycms:store` (theme, sidebar collapsed, submenu open...)
  cộng thêm lịch sử MagicChat.

Schema:
- `user`: relation -> `user`, cardinality `oneToOne`, required.
- `data`: `text` (multiline), JSON string - không có field type "json" thật
  trong `field-registry.ts`, serialize giống cách `aiKey.model` đang làm.
- `version`: `int`, server tăng dần mỗi lần ghi thành công.
- `features: { timestamps: true }` cho `updatedAt`.

API riêng (`src/server/routes/memory.ts`), theo mẫu self-service của
`routes/auth.ts` (`update-profile`)/`Profile.tsx` - KHÔNG qua generic
content-entries permission (permission model không có khái niệm "chỉ sửa
bản ghi của mình"):
- `GET /api/memory`: tự resolve user từ session cookie, find-or-create row
  theo `user = session.id`, trả `{ data, version }`.
- `PUT /api/memory` nhận `{ data, version }`: nếu `version` client < version
  server -> từ chối, trả bản server mới nhất (client tự merge lại); ngược
  lại ghi đè, `version = server.version + 1`. Last-write-wins theo version,
  không merge 3-way.

Client:
- Mở rộng `useStore.tsx`/`drycms:store` thay vì viết state riêng: đọc local
  trước (hiển thị ngay), fetch `GET /api/memory` nền, so version - server
  cao hơn thì ghi đè local, local cao hơn (vừa sửa lúc mất mạng) thì đẩy
  lên server. Mỗi thay đổi: ghi local ngay + debounce `PUT /api/memory`.
- MagicChat: cân nhắc kỹ trước khi gộp thẳng lịch sử chat (hiện ở IndexedDB
  qua `magic-chat-store.ts`, có thể lớn/có ảnh) vào chung 1 blob nhỏ với UI
  prefs - có thể làm version "nhảy" liên tục vì lý do không liên quan và
  đẩy payload lớn qua mạng mỗi lần đổi theme. Đề xuất khi build: giữ
  IndexedDB làm cache đầy đủ/nhanh cho THIẾT BỊ hiện tại, chỉ đồng bộ lên
  `memory` một cửa sổ giới hạn (vd N phiên gần nhất, có cap kích thước) để
  phục vụ "tiếp tục trên máy khác" - không đồng bộ toàn bộ lịch sử.

### Phần B - System Settings (Super Admin, chia sẻ toàn hệ thống)

Quyết định đã chốt: chỉ áp dụng cho admin UI (`tokens.css`, `.dry` root),
không đụng tới trang public (Tailwind riêng). Sắc độ phụ (lighter/dark/
darker/foreground) tự tính từ màu gốc, không bắt nhập tay.

- Content type mới `systemSettings`: `kind: "singleton"`, `locked: true`,
  `hidden: true` (không hiện trong nhóm Singleton chung - có trang riêng).
- Field (map vào `--dry-*` trong `src/styles/tokens.css`):
  - `primaryColor`, `secondaryColor`, `infoColor`, `successColor`,
    `warningColor`, `errorColor` (mỗi field 1 hex base) -> đích
    `--dry-primary`, `--dry-secondary-main`, `--dry-info`, `--dry-success`,
    `--dry-warning`, `--dry-error`; các biến thể `-lighter/-light/-dark/
    -darker/-foreground` tự tính bằng công thức lighten/darken.
  - `fontFamily` (select) -> `--dry-font-sans`.
  - `baseFontSize` -> `--dry-text-base` (suy ra `-sm`/`-xs` theo tỉ lệ cố
    định, không cho chỉnh riêng từng bậc ở v1).
  - `radius` -> `--dry-radius` (suy ra `-sm/-md/-lg/-xl` theo tỉ lệ).
- Áp dụng: server render CSS động (route mới, vd
  `GET /api/system-settings/theme.css`) trả `.dry { --dry-primary: ...; }`,
  admin shell include route này - MỌI user tải cùng 1 theme, không qua
  `memory`/localStorage (đây là setting chia sẻ, không phải theo máy).
- Trang `src/pages/Settings.tsx`, route `${path}/settings`: kích hoạt nav
  item đã có sẵn (`DryLayout.tsx` dòng ~139, hiện `ready: false`), thêm lazy
  import + route trong `App.tsx`. Quyền: `superAdminOnly: true` trên nav
  item (giống `content-types`/`icon-management`/`ai-keys`) + permission
  `setting` phía server như singleton khác.
- Form: color picker theo từng intent + live preview, số cho
  `baseFontSize`/`radius`.

## Status

**Cả 3 phần đã triển khai xong, test xanh, build xanh.**

- Đã khảo sát kiến trúc: content-type system (`hidden`/`locked`/`frozen`),
  nav (`DryLayout.tsx` đã có sẵn nav item "Settings" chưa build), tokens.css,
  useStore/localStorage, MagicChat/magic-chat-store (IndexedDB theo máy),
  Profile.tsx/routes/auth.ts (mẫu self-service, không qua generic
  permission), permissions.ts (không có row-level ownership).
- Đã chốt với user: tên `memory`, ẩn hoàn toàn không có UI; phạm vi memory =
  kho chung mọi cài đặt cá nhân; System Settings chỉ áp dụng admin UI; màu
  phụ tự tính từ màu gốc.

**Phần C** - `seed.ts`: `hidden: true` cho `user`/`seoDefaults`.
`DryLayout.tsx`: 2 nav entry mới ("Users", "SEO Defaults", section System),
thêm `permissionAction` vào kiểu NAV item (mặc định `"view"`, singleton cần
`"setting"` - bug tiềm ẩn nếu copy nguyên `permissionName` pattern cũ cho
singleton). Đã PUT trực tiếp qua `/api/content-types/:id` (đăng nhập bằng
dev admin credentials) để áp `hidden: true` lên 2 row đã tồn tại trong DB
sống - verify: generic entries/singleton API vẫn hoạt động bình thường sau
khi ẩn (chỉ nav grouping đổi, không đổi data).

**Phần A** - `seed.ts`: type `memory` (`hidden+locked+frozen`, fields
`user`/`data`/`version`) - relation dùng `manyToOne` (không có `oneToOne`
thật trong `RelationCardinality`), "tối đa 1 row/user" enforce ở route, không
phải DB constraint. `src/server/routes/memory.ts`: `GET`/`PUT /api/memory`,
tự resolve `session.id`, `findEntry` theo `where: [{field:"user",op:"eq"}]`,
version protocol server-wins (409 kèm bản mới nhất khi client stale). Đăng
ký route trong `handler.ts`. `src/hooks/useStore.tsx`: thêm
`initMemorySync()` (pull-rồi-reconcile, gọi 1 lần từ `DryLayout.tsx`'s mount
effect) + debounce push mỗi lần `writeStoreValue` - dùng
`window.fetch` đã được `lib/native/csrf-fetch.ts` patch sẵn CSRF/401-refresh
nên không cần tự xử lý. Giới hạn đã biết (v1): overwrite chỉ đổi
`localStorage`, không đẩy lại vào state/signal đã mount (vd `collapsed`) -
chỉ ăn ở lần mount/điều hướng tiếp theo. MagicChat KHÔNG được gộp vào lần
này (như đã cân nhắc trong Plan) - vẫn ở IndexedDB riêng máy, để tránh mở
rộng phạm vi (cỡ payload, chính sách prune) chưa được xác nhận với user.

**Phần B** - `seed.ts`: singleton `systemSettings` (`hidden+locked`, KHÔNG
`frozen` - schema sửa được qua entries API bình thường), 9 field (6 màu hex +
fontFamily + baseFontSize + radius). `src/lib/color-shades.ts`: derive
5-shade ramp bằng RGB-mix tuyến tính về trắng/đen (không qua HSL, tránh lệch
hue) + luminance WCAG chọn foreground trắng/đen. `src/server/routes/
system-settings.ts`: `GET .../theme.css` public (không cần session - thêm
`isPublicThemeCss` exemption trong `handler.ts`, vì màn login cũng dùng
chung `.dry` root), render `.dry { --dry-*: ...; }` KHÔNG bọc `@layer`
(unlayered luôn thắng layered trong CSS cascade, khỏi lo thứ tự `<link>`).
`src/lib/apply-system-theme.ts`: side-effect import ở đầu `main.tsx`, chèn
`<link>` trỏ route trên vào `<head>` lúc bootstrap - áp dụng cho mọi trang
kể cả trước đăng nhập. `src/pages/Settings.tsx`: form riêng (không dùng
generic singleton editor) qua `createContentEntriesApi("systemSettings").
getSingleton/saveSingleton` - đúng API có sẵn, không cần route riêng để ghi.
Nav item "Settings" (đã có sẵn, `ready:false`) → `ready:true` +
`superAdminOnly:true`.

**Test đã cập nhật** (do thêm 2 content type + 1 relationmirror mới trên
`user`, không phải regression): `seed.test.ts` (đếm/danh sách type, field
`memory`/`systemSettings`), `entry-tree.test.ts` (relationmirror "memory"
trailing trên cây field của `user`), `sqlite.test.ts` + `content-types.test.ts`
(danh sách 10 type mặc định, `user`/`seoDefaults` giờ `hidden:true`).

**Verify thủ công qua dev server thật** (curl + dev admin credentials, sau
khi restart dev server để `pendingSeedStatements` chạy lại):
- `memory` và `systemSettings` tự tạo trong DB sống ngay khi restart.
- PUT `hidden:true` cho `user`/`seoDefaults` qua content-types API thành
  công; generic entries/singleton API vẫn đọc/ghi bình thường sau đó.
- `/api/memory` GET/PUT round-trip đúng; PUT với version cũ trả `409` +
  `conflict:true` kèm bản server mới nhất; PUT với version đúng bump version.
  Tình cờ bắt được: một phiên trình duyệt thật đang mở đã tự gọi
  `initMemorySync()` và tạo row thật (dữ liệu UI state thật, không phải
  test) - đã khôi phục lại data gốc sau khi test xong để không mất state
  của phiên đó.
- `/api/system-settings/theme.css` trả 200 không cần session; sau khi lưu
  `systemSettings` qua API, CSS trả về đúng shade đã derive; đã reset lại
  giá trị mặc định sau test.
- `bun run typecheck`: sạch (2 lỗi còn lại nằm ở `ai-magic-write.ts`, thuộc
  một phiên khác đang sửa file đó song song - xem git status lúc bắt đầu -
  không đụng tới).
- `bun run test`: 926/926 pass (1 lần timeout ở
  `build-component-bundle.test.ts` do chạy đồng thời với dev server, pass
  lại ngay khi chạy riêng - không liên quan tới thay đổi của task này).
- `bun run build`: client + SSR đều thành công, `Settings` code-split đúng.

## Speed

Hoàn thành trong 1 lượt làm việc liên tục, từ khảo sát tới verify qua dev
server thật. Không còn việc tồn đọng cho 3 phần đã chốt; các điểm chủ động
để lại cho tương lai (không phải việc dở dang): đồng bộ MagicChat vào
`memory`, và khả năng đẩy overwrite của `initMemorySync` vào state/signal đã
mount thay vì chỉ localStorage.
