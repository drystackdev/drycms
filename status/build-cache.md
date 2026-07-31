# Kế hoạch xây dựng Cache & Background Sync cho Preact CMS

> **Tiến độ**: Phase 2-9 đã triển khai 2026-07-30.
> - Phase 2 (Version Backend): `ContentEntryEngineAdapter.getResourceVersion()` + bump trên create/update/delete/saveSingleton cho cả 3 engine (`file` qua `.index/<type>._version.json`, `sqlite` qua bảng `_versions` trong transaction thật, `D1` qua bảng `_versions` bump tuần tự sau khi data ghi thành công — xem mục 6/7 về caveat D1). Test cho sqlite/file.
> - Phase 3 (API Version Protocol): `GET` ở `routes/content-entries.ts` đọc header `X-Data-Version`, trả `{changed, version, data?}`; nếu version khớp thì bỏ qua cả query, không chỉ response. Client (`entries-http-api.ts`) có thêm `listVersioned`/`getVersioned`/`getSingletonVersioned`. Test ở `routes/content-entries.test.ts`.
> - Phase 4 (IndexedDB Cache Layer): `lib/idb-cache.ts` — `getCacheEntry`/`setCacheEntry`/`deleteCacheEntry`/`clearCache`, hand-rolled, không dùng thư viện, tự degrade về no-op nếu IndexedDB không khả dụng.
> - Phase 5+6 (`useFetch()` + debounce/abort): `hooks/useFetch.ts` — `useFetch(key, fetcher, options)` kiểu SWR-lite, cache-first render, debounce 150ms mặc định, `AbortController` + request-id chống response cũ ghi đè response mới.
> - Phase 7 (Signals): `store/sync.ts` (`refreshingCount`/`globalRefreshing`), hiển thị qua `components/SyncIndicator.tsx` gắn trong `DryLayout.tsx`'s topbar.
> - Phase 8 (thông báo đồng bộ thành công): **đã đổi từ toast sang inline trong header** (2026-07-30, theo yêu cầu) — `store/sync.ts` thêm signal `syncSuccess` + `flashSyncSuccess()` (tự ẩn sau 3s, gọi lại thì gia hạn thay vì chồng). `SyncIndicator.tsx` (cạnh nút đổi theme) hiện icon check + "Đã cập nhật" thay vì spinner khi vừa đồng bộ xong; không còn toast nào cho trường hợp này. Vẫn chỉ kích hoạt khi có cache cũ VÀ version đổi (không phải lần load đầu). Test: `entries-cache.spec.ts` thêm case xác nhận hiện rồi tự ẩn, không có `.toast` nào xuất hiện.
> - Phase 9 (Migration màn hình): `pages/ContentEntryList.tsx` (List cho mọi content type, vd Roles) và `pages/ContentTypes.tsx` (List content-types) đã chuyển sang `useFetch()`. Đã đánh giá 2 ứng viên khác (`ContentEntryEditor.tsx`, `RelationField.tsx`) và **quyết định không migrate** — form đang edit dở dễ bị background-sync ghi đè, và `RelationField` cố tình backend-agnostic (dùng cả cho nguồn in-memory ở Showcase). Các màn hình khác chưa động tới.
> - **Mở rộng phạm vi**: `ContentTypes.tsx` cũng cần cơ chế version riêng (đúng như build-cache.md nói, đây là bảng/danh sách như bất kỳ resource nào khác) — đã thêm `ContentEngineAdapter.getResourceVersion()` (tách biệt với schema `version` của từng definition), bump trong `applySave`/`deleteContentType`/boot-seed, cho cả 3 engine (`sqlite`/`D1`/`file`, khoá `"__content-types__"`). Route `content-types.ts` áp cùng protocol `X-Data-Version`. Client thêm `listVersioned`.
> - Verify: unit test (route + cả 2 loại engine: entries VÀ content-types) + 3 test Playwright mới (`e2e/entries-cache.spec.ts`, `e2e/content-types-cache.spec.ts`).
> - Gap đã biết: boot-time seed role/permission vẫn bypass version (mục Phase 2); D1 chưa có test harness nào trong repo.
> - **Phát hiện quan trọng khi verify**: `astro.config.mjs` đã bị đổi (bởi phiên/tiến trình khác, đã commit sẵn, không phải tôi) từ `content.engine: "sqlite"` sang `{engine:"file", kind:"github"}` (repo `khancoder282/test-filestorage`) giữa chừng phiên làm việc — khiến các lần tôi restart dev server để build lại lib vô tình nạp cấu hình GitHub thật (POST mất ~8s, GET ~3-4s), làm loạt test Playwright timeout dù code không sai. Đã xác minh lại bằng cách tạm trả về sqlite, chạy pass sạch, rồi phục hồi đúng nguyên trạng github qua `git checkout`. Sau đó bạn tự đổi config sang `{engine:"file"}` (local) — build-cache đã verify lại pass sạch trên cả 3 config (sqlite/github/local-file).
> - **Đã sửa luôn 10/11 test Playwright lỗi có sẵn** (không liên quan build-cache, phát hiện trong lúc verify): stale selector do UI đổi (label "Title"→"Table Name", nút icon không có "+"/aria-label, IconGlyph thay `<img>` bằng `<span>` mask-image, field name giờ camelCase, URL có thêm query string, form Save bị disabled tới khi dirty) — sửa hết trong `e2e/*.spec.ts`. Riêng 1 lỗi thật trong app: nút Remove ở field-list thiếu `aria-label` (đã thêm, khớp convention `aria-label="Reorder"` có sẵn). Còn lại 2 test cần quyết định người: overflow-viewport test (nội dung dialog giờ ngắn hơn, không overflow ở viewport cũ) và test "ID row" (UI không còn hiển thị field "ID" riêng nữa) — xem chi tiết trong memory.

## 1. Mục tiêu

CMS sử dụng **Preact + Preact Signals**, không có HTTP/fetch wrapper trung tâm.

Dữ liệu backend đến từ `content.engine`, có 3 giá trị thực tế trong drycms:

* **`file` engine** — dữ liệu lưu dưới dạng file JSON (`data/<type>/<id>.json` + `.index/<type>._seq.json`), qua storage adapter `local` / `github` / `gitlab`. "GitHub" **không phải** một engine riêng — nó là một storage kind bên trong engine `file`, dùng chung code path `index-store.ts` với `local` và `gitlab`.
* **`sqlite` engine** — SQLite cục bộ.
* **`D1` engine** — Cloudflare D1, cùng SQL dialect với SQLite nhưng chạy qua HTTP binding, **không có transaction đa-statement thật** (`db.batch()` chỉ atomic trong một lần gọi, xem `content-types/engine/d1.ts:124-132`).

Storage adapter `github`/`gitlab` có độ trễ tương đối cao (gọi Git API), vì vậy không nên để UI phụ thuộc trực tiếp vào thời gian phản hồi. Để giữ kiến trúc đơn giản, áp dụng **cùng một cơ chế version** cho cả 3 storage kind của `file` engine lẫn cho `sqlite`/`D1`, dù `local`/`sqlite`/`D1` vốn đã nhanh.

Mục tiêu của hệ thống:

1. Hiển thị dữ liệu từ IndexedDB gần như ngay lập tức.
2. Âm thầm kiểm tra dữ liệu mới ở background.
3. Không block UI trong quá trình đồng bộ.
4. Không gọi API liên tục khi người dùng thao tác nhanh.
5. Server chịu trách nhiệm xác định dữ liệu có thay đổi hay không.
6. SQLite và GitHub sử dụng cùng một cơ chế version ở tầng API.
7. Khi phát hiện dữ liệu mới, cập nhật UI và thông báo cho người dùng.
8. Không cần cơ chế clear/invalidate cache khi `POST`, `PUT`, `DELETE`.
9. Giữ kiến trúc đơn giản, không phụ thuộc SWR/TanStack Query ở phiên bản đầu.

---

# 2. Nguyên tắc kiến trúc

Kiến trúc tổng thể:

```text
                     Preact CMS
                         │
                         ▼
                    useFetch()
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
          IndexedDB              API Layer
           Snapshot                  │
              │              ┌───────┴───────┐
              │              ▼               ▼
              │         file engine      sqlite / D1
              │    (local/github/gitlab)    engine
              │              │               │
              │   .index/*._version.json  _versions
              │              │               │
              │              └───────┬───────┘
              │                      │
              │                 data + version
              │                      │
              └──────────────────────┘
                         │
                         ▼
                    Preact UI
```

Nguyên tắc quan trọng:

> **IndexedDB là cache, không phải source of truth. Backend là source of truth.**

---

# 3. Không xây dựng Fetch Wrapper toàn hệ thống

Hệ thống hiện tại **không có fetch wrapper trung tâm**.

Không nên ép toàn bộ hệ thống phải chuyển sang một wrapper fetch mới chỉ để phục vụ cache.

Thay vào đó xây dựng một abstraction độc lập, dạng SWR-lite: nhận **cache key** + **fetcher function**, không phải raw URL — vì hệ thống hiện tại gọi API qua các wrapper theo resource (`entries-http-api.ts`: `list/get/getSingleton/...`, `http-api.ts`), không phải URL string thuần. `useFetch(url)` sẽ buộc phải viết thêm lớp chuyển đổi URL ↔ tham số không cần thiết.

```ts
const {
  data,
  loading,
  refreshing,
  reload,
} = useFetch("posts:list", () => entriesApi.list("posts"));

const {
  data,
  loading,
  refreshing,
  reload,
} = useFetch(`role:${id}`, () => entriesApi.get("role", id));
```

`useFetch()` là điểm tích hợp của cơ chế cache đối với Preact. Fetcher function chịu trách nhiệm gọi đúng wrapper hiện có (`entries-http-api.ts`, `http-api.ts`, ...) và trả về `{ data, version }` hoặc `{ changed, version, data? }` (xem mục 8); `useFetch()` không tự biết resource đến từ engine nào.

Kiến trúc:

```text
Preact Component
       │
       ▼
   useFetch(key, fetcher)
       │
       ├── IndexedDB (theo key)
       │
       └── fetcher()  ──► API wrapper hiện có (entries-http-api.ts, ...)
             │
             ▼
          API Layer
```

---

# 4. Phân biệt 3 loại version

Đây là phần cần chốt rõ để tránh nhầm lẫn.

## 4.1. Schema Version

Nằm trong content type:

```text
content-types/system-role.json
```

Ví dụ:

```json
{
  "id": "system-role",
  "version": 3
}
```

Version này biểu thị:

> Cấu trúc/schema của resource đang ở version nào.

**Không sử dụng version này để cache dữ liệu.**

---

## 4.2. Data Version

Đây là version của dữ liệu thực tế.

Ví dụ:

```text
roles = version 42
users = version 18
posts = version 71
```

Data version do backend quản lý.

Nó trả lời câu hỏi:

> Dữ liệu mà client đang cache có còn là snapshot mới nhất không?

---

## 4.3. Cache Version

IndexedDB lưu lại `dataVersion` mà server đã trả về.

Ví dụ:

```text
IndexedDB
key: GET:/roles
version: 42
data: [...]
```

Server:

```text
roles version = 43
```

Client biết:

```text
42 != 43
```

→ cache đã cũ → lấy dữ liệu mới.

---

# 5. Version cho `file` engine (local / github / gitlab)

Áp dụng đồng nhất cho cả 3 storage kind của engine `file` — `local`, `github`, `gitlab` — vì cả ba dùng chung code path trong `index-store.ts`. Không tách riêng "local" ra khỏi cơ chế version để tránh một nhánh đặc biệt chỉ vì local vốn nhanh.

Dữ liệu `file` engine giữ nguyên cấu trúc hiện tại.

Ví dụ:

```text
content/
├── content-types/
│   ├── system-role.json
│   └── ...
│
├── data/
│   ├── role/
│   │   ├── 1.json
│   │   └── 2.json
│   └── ...
│
└── .index/
    ├── role._seq.json
    └── role._version.json
```

Thêm file:

```text
.index/role._version.json
```

Ví dụ:

```json
{
  "version": 42
}
```

Không thêm:

```json
{
  "id": 1,
  "name": "Super Admin",
  "version": 42
}
```

vào từng record.

### Lý do

Version này thuộc về **resource/collection**, không phải metadata của từng record.

Nếu:

```text
role/1.json
role/2.json
role/3.json
```

có bất kỳ thay đổi nào thì tăng:

```text
role version
42 → 43
```

---

# 6. Version cho `sqlite` / `D1` engine

Cả `sqlite` và `D1` sử dụng cùng một bảng riêng để quản lý data version — D1 cùng SQL dialect nên schema và statement giống hệt SQLite.

Lưu ý: `metadata.version` đã tồn tại sẵn ở cả hai engine (`content-types/engine/sqlite.ts`, `content-types/engine/d1.ts`), nhưng đó là **schema version** dùng cho optimistic-concurrency của content-type definition — khác hoàn toàn với **data version** ở đây. Bảng mới `_versions` không thay thế hay tái dùng `metadata.version`.

Không thêm `version` vào từng bảng dữ liệu.

Tạo:

```sql
CREATE TABLE _versions (
    resource TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

**Caveat riêng cho D1**: D1 không có transaction đa-statement thật (`db.batch()` chỉ atomic trong một lần gọi — xem `d1.ts:124-132`, nơi engine hiện tại đã phải xử lý vấn đề này bằng cách batch theo từng bảng rồi mới bump `metadata` version sau cùng). Việc bump `_versions` cho D1 phải nằm **trong cùng một `db.batch()`** với các statement ghi dữ liệu của resource đó — không phải một `UPDATE _versions` riêng chạy sau. Nếu một resource ghi vào nhiều bảng (component cascade, child table), atomicity chỉ đảm bảo per-table như cách `applySave` hiện tại đang làm, không phải toàn bộ plan.

Ví dụ:

```text
_versions

resource       version       updated_at
----------------------------------------
roles             42             ...
users             18             ...
posts             71             ...
```

Nếu `roles` thay đổi:

```text
42 → 43
```

---

# 7. Data và version phải được cập nhật cùng transaction

Đối với SQLite, thay đổi dữ liệu và tăng version phải nằm trong cùng transaction thật (`BEGIN`/`COMMIT`).

Đối với D1, không có `BEGIN`/`COMMIT` đa-statement — thay vào đó bump version phải nằm trong cùng lệnh `db.batch()` với các statement ghi dữ liệu (xem caveat ở mục 6).

Ví dụ (SQLite):

```text
BEGIN TRANSACTION

UPDATE roles
SET name = 'New name'
WHERE id = 1;

UPDATE _versions
SET version = version + 1,
    updated_at = ...
WHERE resource = 'roles';

COMMIT
```

Nếu một thao tác thất bại:

```text
ROLLBACK
```

Như vậy không xảy ra trường hợp:

```text
Data đã thay đổi
nhưng version chưa thay đổi
```

hoặc ngược lại.

---

# 8. API Layer thống nhất `file` / `sqlite` / `D1`

Dù nguồn dữ liệu đến từ engine nào (`file` với storage kind local/github/gitlab, `sqlite`, hay `D1`), API phía client nên nhận một format thống nhất. Trong drycms, các route (`routes/content-entries.ts`, ...) đã funnel qua `createContentEntryEngineAdapter` chung — đây là điểm hợp lý để chuẩn hóa response, thay vì sửa từng route riêng lẻ.

Ví dụ:

```json
{
  "data": [...],
  "version": 42
}
```

Client không cần biết:

```text
data đến từ file engine (local/github/gitlab)
```

hay:

```text
data đến từ sqlite/D1
```

Client chỉ cần quan tâm:

```text
data
version
```

---

# 9. Cơ chế kiểm tra version

Client lưu:

```text
IndexedDB
version = 42
```

Khi background sync:

```http
GET /api/roles
X-Data-Version: 42
```

Backend kiểm tra:

```text
Client version = 42
Server version = 42
```

→ dữ liệu không thay đổi.

Nếu:

```text
Client version = 42
Server version = 43
```

→ dữ liệu đã thay đổi.

---

# 10. Response khi dữ liệu không thay đổi

Có thể dùng response:

```json
{
  "changed": false,
  "version": 42
}
```

Không cần gửi lại toàn bộ data.

Hoặc trong tương lai có thể sử dụng HTTP caching semantics như:

```text
ETag
If-None-Match
304 Not Modified
```

Việc lựa chọn cách nào phụ thuộc vào API layer hiện tại.

Ở phiên bản đầu, response `changed` có thể đơn giản và dễ kiểm soát hơn.

---

# 11. Response khi dữ liệu thay đổi

Server:

```json
{
  "changed": true,
  "version": 43,
  "data": [...]
}
```

Client thực hiện:

```text
API response
    │
    ├── Update IndexedDB
    │       ├── data
    │       └── version = 43
    │
    └── Update Preact state
```

Sau đó hiển thị Toast.

---

# 12. Flow `useFetch()`

## 12.1. Có cache

```text
useFetch()
    │
    ▼
IndexedDB
    │
    ▼
Có cache
    │
    ├── data → Preact UI ngay
    │
    └── version → background sync
```

State:

```ts
loading = false
refreshing = true
```

UI không cần chờ GitHub API.

---

## 12.2. Không có cache

```text
useFetch()
    │
    ▼
IndexedDB
    │
    └── Không có
          │
          ▼
      GET API
          │
          ▼
      data + version
          │
          ├── IndexedDB
          └── Preact UI
```

State:

```ts
loading = true
refreshing = false
```

---

# 13. Background Sync

Sau khi cache đã được render:

```text
IndexedDB
    ↓
UI hiển thị ngay
    ↓
background request
    ↓
API
    ↓
check version
```

### Không thay đổi

```text
version giống nhau
      ↓
Không update IndexedDB
Không update UI
Không Toast
```

### Có thay đổi

```text
version khác nhau
      ↓
Nhận data mới
      ↓
Update IndexedDB
      ↓
Update Preact UI
      ↓
Toast
```

---

# 14. Debounce API

Do GitHub API có độ trễ, không nên request liên tục khi người dùng thao tác nhanh.

Ví dụ:

```text
Page 1
Page 2
Page 3
Page 4
Page 5
```

IndexedDB vẫn đọc ngay:

```text
Page 1 → UI
Page 2 → UI
Page 3 → UI
Page 4 → UI
Page 5 → UI
```

Nhưng API chỉ gọi request cuối:

```text
Page 5 → GitHub API
```

Debounce ban đầu:

```text
100–200ms
```

Không debounce việc đọc IndexedDB.

---

# 15. Cancel request cũ

Nếu request đã bắt đầu thì debounce không đủ.

Sử dụng:

```text
AbortController
```

và/hoặc request sequence.

Ví dụ:

```text
request #1 → page 1
request #2 → page 2
request #3 → page 3
```

Chỉ request mới nhất được phép cập nhật state.

Nếu response page 1 đến sau page 3:

```text
Response #1
    ↓
Ignore
```

Không được ghi đè UI.

---

# 16. Preact Signals cho global refreshing

Vì CMS sử dụng **Preact**, dùng **Preact Signals** cho trạng thái background synchronization toàn hệ thống.

Không dùng boolean global đơn giản:

```ts
refreshing = true
```

vì nhiều request có thể chạy đồng thời.

Thay vào đó:

```ts
refreshingCount = signal(0);
```

Khi request bắt đầu:

```text
refreshingCount++
```

Khi request kết thúc:

```text
refreshingCount--
```

Global state:

```ts
refreshing = computed(
  () => refreshingCount.value > 0
);
```

---

# 17. Layout hiển thị trạng thái đồng bộ

Layout có thể đọc global signal:

```text
Global Signal
      │
      ▼
    Layout
      │
      ▼
Small Sync Indicator
```

Ví dụ:

```text
┌────────────────────┐
│ ↻ Đang đồng bộ... │
└────────────────────┘
```

Indicator này không phải loading chính của page.

Nó chỉ cho biết:

> CMS đang âm thầm kiểm tra/cập nhật dữ liệu.

---

# 18. `refreshing` của `useFetch()`

`useFetch()` vẫn có state riêng:

```ts
const {
  data,
  loading,
  refreshing,
  reload,
} = useFetch(url);
```

Hai trạng thái khác nhau:

```text
useFetch.refreshing
→ request hiện tại đang background refresh

global refreshing
→ toàn CMS có ít nhất một background request
```

---

# 19. Toast khi có dữ liệu mới

Nếu:

```text
client version = 42
server version = 43
```

và server trả data mới:

```text
Update IndexedDB
       ↓
Update Preact state
       ↓
Toast
```

Ví dụ:

```text
✓ Dữ liệu đã được cập nhật mới nhất
```

Toast chỉ xuất hiện khi **thực sự nhận được data mới**.

Không Toast khi:

```text
client version = server version
```

---

# 20. `POST`, `PUT`, `DELETE`

Không thực hiện:

```text
POST   → clear cache
PUT    → clear cache
DELETE → clear cache
```

Không cần:

```text
invalidate()
mutate()
clearCache()
```

Sau khi mutation hoàn tất, dữ liệu server đã thay đổi và version backend cũng thay đổi.

Lần GET/background sync tiếp theo:

```text
Client version = 42
Server version = 43
```

→ tự phát hiện dữ liệu mới.

---

# 21. `reload()`

`reload()` cho phép component chủ động yêu cầu đồng bộ:

```ts
await reload();
```

Flow:

```text
reload()
   ↓
GET API
   ↓
Check version
   │
   ├── unchanged
   │      └── Không làm gì
   │
   └── changed
          ├── Update IndexedDB
          ├── Update Preact state
          └── Toast
```

---

# 22. Error Handling

## Có cache + API lỗi

```text
IndexedDB
    ↓
UI hiển thị cache
    ↓
Background API
    ↓
Error
```

Giữ nguyên cache.

Không xóa dữ liệu.

Có thể ghi log hoặc hiển thị trạng thái sync thất bại tùy UI.

---

## Không có cache + API lỗi

```text
IndexedDB
    ↓
Không có data
    ↓
API Error
    ↓
Error State
```

Khi đó component phải hiển thị error state bình thường.

---

# 23. IndexedDB Cache Schema

Cache layer nên lưu metadata cùng data:

```ts
interface CacheEntry<T> {
  key: string;
  data: T;
  version: number;
  cachedAt: number;
}
```

Ví dụ:

```text
key:
GET:/roles?page=1

version:
42

cachedAt:
1785320000000

data:
[...]
```

Không lưu version vào từng record.

---

# 24. Cache Key

Cache key phải bao gồm toàn bộ thông tin ảnh hưởng đến response.

Ví dụ:

```text
GET:/roles
GET:/roles?page=1
GET:/roles?page=2
GET:/roles?search=admin
GET:/roles?page=1&search=admin
```

Query parameter cần được normalize để tránh cùng một request tạo ra nhiều cache key khác nhau.

---

# 25. Không deep compare JSON

Không thực hiện:

```ts
JSON.stringify(oldData) === JSON.stringify(newData)
```

Client không chịu trách nhiệm xác định data có thay đổi hay không.

Server quản lý:

```text
data version
```

Client chỉ so sánh:

```text
cache.version
        vs
server.version
```

---

# 26. Không version từng record

Không thêm:

```json
{
  "id": 1,
  "name": "Admin",
  "version": 42
}
```

vào từng file GitHub hoặc từng row SQLite.

Version được quản lý theo **resource/collection**:

```text
roles       → version 42
users       → version 18
permissions → version 31
```

Điều này giảm duplication và đơn giản hóa synchronization.

---

# 27. Quan hệ giữa resource

Không xây dựng dependency/invalidation graph trong phiên bản đầu.

Ví dụ:

```text
posts
 └── category
```

Không cần client phải biết:

```text
category thay đổi
→ invalidate posts
```

Nếu API response của `posts` phụ thuộc vào category và category thay đổi làm response `/posts` thay đổi, backend phải tăng:

```text
posts version
```

Client chỉ cần kiểm tra version của chính resource đang fetch.

---

# 28. Kiến trúc hoàn chỉnh

```text
                              Preact CMS
                                  │
                                  ▼
                             useFetch()
                                  │
                   ┌──────────────┴──────────────┐
                   │                             │
                   ▼                             ▼
               IndexedDB                     API Layer
                 Cache                           │
                   │                    ┌────────┴────────┐
                   │                    ▼                 ▼
                   │             file engine         sqlite / D1
                   │        (local/github/gitlab)      engine
                   │                    │                 │
                   │         .index/*._version.json  _versions
                   │                    │                 │
                   │                    └────────┬────────┘
                   │                             │
                   │                         data + version
                   │                             │
                   └─────────────────────────────┘
                                  │
                                  ▼
                              Preact State
                                  │
                                  ▼
                                  UI
                                  │
                       ┌──────────┴──────────┐
                       ▼                     ▼
                  Global Signal            Toast
                       │
                       ▼
                     Layout
                       │
                       ▼
                Sync Indicator
```

---

# 29. Flow thực tế

Khi user mở CMS:

```text
1. useFetch()
       ↓
2. IndexedDB
       ↓
3. Có cache?
       │
       ├── Có → UI hiện ngay
       │
       └── Không → loading
       ↓
4. Background API
       ↓
5. Gửi cached version
       ↓
6. Backend kiểm tra version
       │
       ├── Không đổi
       │      ↓
       │   Kết thúc
       │
       └── Có đổi
              ↓
          Data mới
              ↓
       Update IndexedDB
              ↓
       Update Preact
              ↓
       Show Toast
```

---

# 30. Khi người dùng chuyển page liên tục

```text
User:
1 → 2 → 3 → 4 → 5
```

```text
IndexedDB:
1 → hiện ngay
2 → hiện ngay
3 → hiện ngay
4 → hiện ngay
5 → hiện ngay
```

API:

```text
1 → debounce
2 → debounce
3 → debounce
4 → debounce
5 → GET
```

Nếu request cũ đã chạy:

```text
AbortController
+
Request ID
```

đảm bảo response cũ không ghi đè response mới.

---

# 31. Các thành phần cần triển khai

### A. IndexedDB Cache Layer

Chịu trách nhiệm:

* Open database.
* Tạo cache store.
* `get(key)`.
* `set(key, data, version)`.
* `delete(key)` nếu cần cho maintenance.
* `clear()` chỉ dành cho reset/debug/migration.
* Normalize cache key.

---

### B. Version Manager phía `file` engine (local/github/gitlab)

Chịu trách nhiệm:

* Tạo/quản lý `.index/<resource>._version.json` — dùng chung code path `index-store.ts` cho cả 3 storage kind.
* Tăng version khi resource thay đổi.
* Đọc version khi API request.
* Trả version cho API layer.

---

### C. Version Manager phía `sqlite` / `D1`

Chịu trách nhiệm:

* Tạo `_versions` (schema giống nhau cho cả hai engine).
* Lấy version theo resource.
* Tăng version khi resource thay đổi.
* SQLite: đảm bảo data update và version update nằm cùng transaction (`BEGIN`/`COMMIT`).
* D1: đảm bảo data update và version update nằm cùng `db.batch()` (không có transaction đa-statement thật — xem mục 6/7).

---

### D. API Response Layer

Chuẩn hóa response:

```ts
interface VersionedResponse<T> {
  changed: boolean;
  version: number;
  data?: T;
}
```

Có thể thay đổi implementation sang HTTP `304/ETag` sau này nếu phù hợp.

---

### E. `useFetch()`

Chịu trách nhiệm:

* Read cache.
* Set initial data.
* Background sync.
* Debounce.
* Abort request.
* Request identity.
* Version check.
* Update IndexedDB.
* Update Preact state.
* `loading`.
* `refreshing`.
* `reload()`.

---

### F. Global Sync Signal

Chịu trách nhiệm:

* Theo dõi số lượng background sync đang chạy.
* Cung cấp trạng thái cho Layout.
* Không phụ thuộc vào component cụ thể.

---

### G. Toast

Chịu trách nhiệm:

* Thông báo khi nhận data mới.
* Không thông báo khi version không thay đổi.

---

# 32. Thứ tự triển khai

## Phase 1 — Kiểm tra kiến trúc

* Kiểm tra cách CMS hiện tại gọi GitHub API.
* Kiểm tra SQLite API.
* Xác định resource cần cache.
* Xác định format API hiện tại.
* Xác định nơi có thể quản lý version.

**Không vội thay đổi fetch architecture.**

---

## Phase 2 — Version Backend

### `file` engine (local / github / gitlab)

Tạo:

```text
.index/<resource>._version.json
```

### `sqlite` / `D1`

Tạo:

```text
_versions
```

Đảm bảo mutation làm thay đổi data đồng thời tăng version — cùng transaction cho SQLite, cùng `db.batch()` cho D1 (mục 6/7).

---

## Phase 3 — API Version Protocol

Thống nhất:

```text
request:
X-Data-Version: N

response:
changed + version + data
```

hoặc lựa chọn HTTP `ETag/304` nếu phù hợp.

---

## Phase 4 — IndexedDB Cache Layer

Xây dựng:

```text
CacheEntry
get()
set()
key normalization
```

Test độc lập với Preact.

---

## Phase 5 — `useFetch()`

Implement:

```text
IndexedDB → UI
        +
background API
        +
version
```

Sau đó bổ sung:

```text
loading
refreshing
reload
```

---

## Phase 6 — Debounce + Request Cancellation

Thêm:

```text
100–200ms debounce
+
AbortController
+
request ID
```

Đặc biệt kiểm thử trường hợp:

```text
page 1 → page 2 → page 3 → page 4
```

và response trả về không đúng thứ tự.

---

## Phase 7 — Preact Signals

Tạo global:

```text
refreshingCount
globalRefreshing
```

Tích hợp vào Layout.

---

## Phase 8 — Toast

Khi:

```text
server version != cache version
```

và server trả data mới:

```text
Update UI
+
Update IDB
+
Toast
```

---

## Phase 9 — Migration dần các màn hình

Không cần sửa toàn CMS một lần.

Có thể chuyển từng màn hình:

```text
Posts
  ↓
Users
  ↓
Roles
  ↓
Permissions
  ↓
...
```

Mỗi màn hình chuyển sang:

```ts
useFetch(...)
```

và kiểm tra behavior.

---

# 33. Những thứ cố tình không triển khai

Phiên bản đầu không có:

* SWR.
* TanStack Query.
* Fetch wrapper toàn hệ thống.
* Cache invalidation.
* Auto clear cache khi POST.
* Auto clear cache khi PUT.
* Auto clear cache khi DELETE.
* Deep comparison JSON.
* Optimistic update.
* WebSocket.
* Realtime synchronization.
* Version trên từng record.
* Dependency graph giữa các cache.
* Polling liên tục.

Những thứ này chỉ được bổ sung nếu hệ thống thực tế phát sinh nhu cầu.

---

# 34. Kiến trúc được chốt

Cuối cùng hệ thống sẽ có 4 tầng version/cache rõ ràng:

```text
┌─────────────────────────────────────────────┐
│                 Schema Version              │
│ content-types/*.json                        │
│                                             │
│ Chỉ quản lý cấu trúc dữ liệu                │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│                  Data Version               │
│                                             │
│ file (local/github/gitlab): .index/*._version.json │
│ sqlite / D1: _versions                     │
│                                             │
│ Quản lý snapshot dữ liệu                    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│                 Cache Version               │
│                                             │
│ IndexedDB                                   │
│                                             │
│ Lưu version server gần nhất                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│               Global Sync State             │
│                                             │
│ Preact Signals                              │
│                                             │
│ Chỉ biểu thị background sync đang chạy      │
└─────────────────────────────────────────────┘
```

## Nguyên tắc cuối cùng

> **Preact CMS ưu tiên tốc độ hiển thị hơn việc chờ API. IndexedDB cung cấp snapshot gần nhất ngay lập tức, trong khi dữ liệu từ engine `file` (local/github/gitlab) hoặc `sqlite`/`D1` được kiểm tra và đồng bộ dần ở background. Data version được quản lý ở backend theo từng resource; `file` engine lưu version trong `.index/*._version.json`, `sqlite`/`D1` lưu version trong bảng `_versions` (tách biệt với `metadata.version` vốn là schema version, không phải data version). Client chỉ lưu version đó cùng cache trong IndexedDB. Preact Signals (đã có sẵn trong drycms) quản lý trạng thái đồng bộ toàn hệ thống để Layout có thể hiển thị indicator nhỏ. Khi server phát hiện version mới, client cập nhật cache, cập nhật UI và hiển thị Toast. Không cần clear/invalidate cache sau POST, PUT hoặc DELETE.**

Đây là kiến trúc **đơn giản, ít coupling và phù hợp với đặc thù CMS có storage adapter (github/gitlab) độ trễ cao**, đồng thời vẫn mở đường để nâng cấp lên ETag/304, realtime sync hoặc các cơ chế cache nâng cao nếu sau này thực sự cần. Kiến trúc này khớp tốt với mô hình SPA `client:only` hiện tại của drycms (preact-iso, không có SSR data-fetching cần đối chiếu) — không có xung đột server/client boundary khi thêm IndexedDB.
