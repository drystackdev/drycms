# Kế hoạch phát triển hệ thống Key Value tốc độ cao

> Quyết định hiện tại: GitHub/GitLab đã bị loại khỏi sản phẩm và không còn là
> backend được hỗ trợ. Các phần mô tả Git backend bên dưới là lịch sử thiết kế
> và không được triển khai lại; backend hiện tại là `local`, `sqlite`, `D1` và
> Cloudflare `KV`.

## 1. Mục tiêu và phạm vi

Xây dựng một hệ thống Key Value (KV) dùng được ở server-side với các mục tiêu:

- Đọc/ghi nhanh qua một lớp cache `Map` trong bộ nhớ.
- Có cơ chế tự dọn dẹp entry hết hạn hoặc không còn được sử dụng.
- Có adapter thay thế được theo môi trường:
  - `local`
  - `sqlite`
  - `D1`
  - `KV` (Cloudflare KV)
- Dữ liệu có thể đồng bộ xuống storage bền vững để không mất sau khi process/server khởi động lại.
- Có thể chịu được lỗi mạng hoặc lỗi backend mà không làm hỏng dữ liệu đang có trong memory.
- Giữ đúng quy ước hiện tại của drycms: validate config lúc startup, adapter interface độc lập với route, không đưa secret vào `dry.config.ts`, và không thêm dependency nếu REST/API glue thủ công là đủ.

Phạm vi giai đoạn đầu là một KV tổng quát cho metadata, session phụ trợ, feature flags, cache có TTL và dữ liệu cấu hình nhỏ. Không dùng hệ này để thay thế content engine hoặc lưu file/media nhị phân.

## 2. Kiến trúc đề xuất

Tách thành ba lớp:

```text
KV API / service
        |
        v
MemoryStore (Map + TTL + LRU/idle cleanup)
        |
        v
Persistence coordinator (dirty queue, debounce, retry, conflict policy)
        |
        v
KeyValueAdapter
  local | sqlite | D1 | KV
```

### 2.1. `KeyValueAdapter`

Đây là interface chung cho mọi backend. API tối thiểu nên có:

```ts
interface KeyValueAdapter {
  get(namespace: string, key: string): Promise<KvRecord | null>;
  set(namespace: string, key: string, record: KvRecord): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string, options?: ListOptions): Promise<KvRecordMeta[]>;
  batch?(operations: KvBatchOperation[]): Promise<void>;
  close?(): Promise<void>;
}
```

`KvRecord` cần lưu cả dữ liệu và metadata để các adapter có cùng semantics:

```ts
interface KvRecord {
  key: string;
  value: unknown; // JSON-safe ở phase 1
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  accessedAt?: string;
  etag?: string;
}
```

Quyết định phase 1: value là JSON-serializable, có giới hạn kích thước cấu hình rõ ràng. Binary, stream và custom serializer để phase sau nhằm giữ hot path đơn giản và đồng nhất giữa SQLite, Git và Cloudflare KV.

### 2.2. `KeyValueStore`/service

Service là API mà phần còn lại của ứng dụng gọi, không gọi adapter trực tiếp. Nó chịu trách nhiệm:

- normalize namespace/key;
- cache hit/miss;
- TTL và stale entry;
- tăng version;
- đưa mutation vào dirty queue;
- flush bất đồng bộ;
- hydrate dữ liệu khi khởi động;
- metrics và health status;
- bảo vệ khỏi write race trong cùng process.

Các hàm nên có:

```ts
get<T>(namespace: string, key: string, options?: GetOptions): Promise<T | null>;
set<T>(namespace: string, key: string, value: T, options?: SetOptions): Promise<void>;
delete(namespace: string, key: string): Promise<void>;
has(namespace: string, key: string): Promise<boolean>;
clear(namespace?: string): Promise<void>;
flush(options?: FlushOptions): Promise<FlushResult>;
close(): Promise<void>;
```

## 3. Memory `Map` và tự dọn dẹp

Không lưu trực tiếp `Map<string, unknown>`. Mỗi entry cần một wrapper có metadata:

```ts
type MemoryEntry<T> = {
  value: T;
  version: number;
  expiresAt?: number;
  lastAccessAt: number;
  dirty: boolean;
  queued: boolean;
  sizeBytes: number;
};
```

### 3.1. Chính sách dọn dẹp

Triển khai theo ba tầng, có thể bật/tắt bằng config:

1. **TTL expiration:** entry có `expiresAt <= now` được xem là miss; không trả dữ liệu hết hạn. Entry hết hạn được enqueue delete nếu backend cần dọn persistent record.
2. **Idle expiration:** entry không được đọc trong `idleTtl` sẽ bị loại khỏi memory. Nếu entry dirty thì phải flush trước, hoặc giữ lại trong dirty queue độc lập.
3. **Memory cap/LRU:** khi vượt `maxEntries` hoặc `maxBytes`, loại các entry sạch ít được dùng trước. Dirty entry không được âm thầm loại bỏ; phải flush, hoặc báo lỗi nếu flush thất bại.

### 3.2. Cơ chế chạy cleanup

- Có một timer cleanup duy nhất cho mỗi `KeyValueStore`, không tạo timer riêng cho từng key.
- Cleanup quét theo batch giới hạn (`cleanupBatchSize`) để tránh block event loop.
- Dùng min-heap theo `expiresAt` nếu số entry lớn; phase MVP có thể quét `Map` định kỳ với ngưỡng đã đo.
- Khi `get()` gặp entry hết hạn, xóa nhanh khỏi memory và schedule persistence delete, không chờ backend trên hot path.
- `unref()` timer trên Node để cache không giữ process sống khi app shutdown.
- Các counter cần theo dõi: hit, miss, expired, evicted, dirty, flush success/failure, queue depth.

### 3.3. Semantics TTL

- `ttl: 0` nghĩa là không cache hoặc xóa ngay, cần quy định rõ trong API; đề xuất dùng `ttl: undefined` cho no-expiry và không dùng `0` cho no-expiry.
- TTL được tính từ thời điểm `set`, không tự gia hạn khi đọc trừ khi caller chọn `touchOnGet`.
- Persistent record cũng lưu `expiresAt`; sau restart, hydrate bỏ qua record đã hết hạn.
- Clock dùng Unix milliseconds; khi có chênh lệch clock giữa nhiều server, không dùng TTL để quyết định conflict.

## 4. Đồng bộ và khôi phục sau restart

### 4.1. Write path

Luồng ghi đề xuất:

1. Validate key/value và serialize JSON.
2. Ghi vào memory ngay để trả latency thấp.
3. Tăng `version` theo key.
4. Đánh dấu dirty và thêm vào queue, coalescing nhiều lần ghi cùng key thành giá trị mới nhất.
5. Flush nền sau `flushDebounceMs` hoặc khi queue đạt `flushBatchSize`.
6. Nếu adapter hỗ trợ `batch`, gửi một batch; nếu không, chạy giới hạn concurrency.
7. Chỉ xóa cờ dirty khi adapter đã xác nhận thành công đúng version.

Không được coi việc ghi vào memory là đã bền vững nếu caller yêu cầu `durable: true`. Với option này, `set()` phải chờ flush thành công và trả lỗi rõ ràng nếu backend thất bại.

### 4.2. Startup hydrate

Thêm lifecycle rõ ràng:

```text
createKeyValueStore()
  -> adapter.open/initialize
  -> load snapshot/index
  -> bỏ record expired
  -> populate Map tới warmup limit
  -> mark ready
```

Hai mode:

- `lazy`: server nhận request ngay, key chưa có trong memory sẽ đọc backend rồi cache.
- `eager`: load toàn bộ namespace hoặc danh sách key được cấu hình trước khi server báo ready.

Đề xuất mặc định `lazy` để startup không bị kéo dài bởi GitHub/GitLab; cho phép `eager` với local/SQLite/D1 khi dataset nhỏ. Với Git backend, ưu tiên một snapshot/index duy nhất thay vì một request cho từng key.

### 4.3. Flush khi shutdown

- Đăng ký `SIGTERM`, `SIGINT`, và hook tương đương của runtime.
- Ngừng nhận mutation mới, chờ các in-flight adapter calls, flush dirty queue trong `shutdownTimeoutMs`.
- Nếu quá timeout, ghi cảnh báo gồm namespace/key count và để journal/recovery queue giữ lại mutation chưa flush.
- Không dùng `process.exit()` trước khi promise flush hoàn tất.
- Trong serverless/Workers, không trông chờ process shutdown; dùng `ctx.waitUntil()` hoặc flush đồng bộ theo request quan trọng.

### 4.4. Durable journal và chống mất dữ liệu

Để tránh mất mutation khi process chết giữa memory write và flush:

- local/SQLite: có thể ghi một write-ahead journal nhỏ trước khi acknowledge ở chế độ durable;
- D1/KV: dùng record version và retry; mutation quan trọng chờ write backend;
- GitHub/GitLab: ghi pending operations vào local spool/journal rồi batch commit; sau khi commit thành công mới mark complete.

MVP có thể không bật journal cho cache ephemeral, nhưng phải có `durability: "memory" | "async" | "sync"` để semantics không bị ngầm hiểu.

## 5. Chi tiết adapter

### 5.1. `local`

- Lưu theo namespace/key dưới một root riêng, JSON hoặc snapshot sharded.
- Tránh một file duy nhất quá lớn; đề xuất layout `root/<namespace>/<hash-prefix>/<encoded-key>.json`.
- Ghi file tạm rồi `rename` để atomic trên cùng filesystem.
- `list()` đi qua directory/index; không đọc toàn bộ value khi chỉ cần metadata.
- Có thể dùng journal append-only và compaction định kỳ.
- Phù hợp development, single-node và git diff nếu dữ liệu cần kiểm tra bằng mắt.

### 5.2. `sqlite`

- Tái sử dụng `SqliteHandle` hiện có trong `src/content-types/engine/sqlite-driver.ts`, không thêm driver thứ hai.
- Tạo bảng riêng, ví dụ `dry_kv_records`, có khóa `(namespace, key)` và index `expires_at`, `updated_at`.
- Dùng transaction cho read-modify-write, version check và batch flush.
- Bật WAL/busy timeout nếu driver hiện tại hỗ trợ; kiểm tra concurrency thực tế trên Bun/Node/better-sqlite3.
- Adapter mở một connection theo lifecycle store, không mở connection cho mỗi request.

### 5.3. `D1`

- Tái sử dụng shape `D1Database`, `D1PreparedStatement` và batch helper hiện có.
- Nhận binding theo request/context, không cache `D1Database` ở module scope; đây là ràng buộc kiến trúc hiện tại.
- Dùng `INSERT ... ON CONFLICT DO UPDATE` kèm `WHERE version = ?` để chống ghi đè ngoài ý muốn.
- Dùng `batch()` cho flush nhiều mutation; pagination cho hydrate/list.
- Không giả định D1 hỗ trợ transaction dài qua nhiều request; `durable: sync` chỉ đảm bảo request hiện tại đã nhận kết quả D1.

### 5.4. `github`

- Dùng GitHub Contents/Git Trees API hiện có, không thêm SDK.
- Lưu snapshot/index KV dưới root riêng, ví dụ `kv/<namespace>/...`; mỗi record là JSON.
- Flush nhiều key bằng một commit tree để giảm số API calls và tránh trạng thái nửa batch.
- Dùng branch/commit SHA làm optimistic concurrency token; nếu branch đã đổi từ remote, re-read base tree rồi retry theo policy.
- Giới hạn kích thước batch, số file và payload theo GitHub API; không dùng Git backend cho hot write latency cao.
- Read-after-write chỉ được coi là chắc chắn sau commit thành công; trước đó memory có thể mới hơn remote.

### 5.5. `gitlab`

- Tương tự GitHub nhưng dùng GitLab Repository Files/Commits API qua adapter glue hiện có.
- Ưu tiên commit batch cho nhiều operation.
- Dùng branch và last commit ID/etag nếu API trả về để phát hiện conflict.
- Hỗ trợ `GITLAB_HOST` self-managed theo cơ chế config hiện tại.
- Cùng cảnh báo latency/rate-limit như GitHub; phù hợp persistence/config sync, không phù hợp làm primary hot store.

### 5.6. `KV` (Cloudflare KV)

- Dùng binding lấy từ `context.env` theo request/runtime, cùng nguyên tắc với D1.
- KV vốn đã là persistent distributed store nhưng có eventual consistency; adapter phải document rõ điều này.
- Tách metadata TTL thành `expirationTtl` của KV và/hoặc lưu `expiresAt` trong value để service tự kiểm tra thống nhất.
- Dùng key format có namespace, ví dụ `drycms:kv:<namespace>:<encoded-key>`.
- `list()` phải hỗ trợ cursor; không giả định scan toàn bộ namespace là rẻ.
- Không triển khai read-through cache global bằng module state trong Workers nếu làm sai semantics giữa isolate; memory cache chỉ là cache best-effort theo isolate/request lifecycle.

## 6. Conflict, consistency và lỗi

### 6.1. Versioning

Mỗi key có `version` tăng đơn điệu trong phạm vi store. Adapter phải hỗ trợ compare-and-set ở mức tối thiểu trong các backend có thể làm được. Nếu backend không có CAS hoàn chỉnh, service ghi `updatedAt`/etag và áp dụng policy được cấu hình.

Các policy:

- `last-write-wins`: phù hợp cache và feature flag đơn giản;
- `reject-on-conflict`: trả lỗi để caller quyết định;
- `merge`: chỉ bật cho value có merge strategy được đăng ký, không merge JSON tùy tiện.

### 6.2. Retry và backoff

- Retry lỗi mạng, 429 và lỗi 5xx với exponential backoff + jitter.
- Không retry lỗi validation, auth hoặc conflict mà không có policy.
- Có giới hạn retry theo operation và dead-letter/pending journal sau khi vượt ngưỡng.
- Circuit breaker cho GitHub/GitLab để không làm nghẽn request khi remote đang lỗi.

### 6.3. Read behavior khi backend lỗi

- Nếu memory có entry còn hạn: trả stale theo `staleIfError` tùy option và phát metric.
- Nếu memory miss và backend lỗi: trả lỗi có mã `backend_unavailable`, không trả `null` giả làm mất dữ liệu.
- `get({ consistency: "remote" })` bỏ qua cache hoặc revalidate theo use case quản trị.

## 7. Config và API route

Mở rộng `DryOption` bằng section riêng, không nhét KV vào `storage` vì storage hiện tại là file tree API:

```ts
kv: {
  adapter: "local" | "sqlite" | "D1" | "github" | "gitlab" | "KV",
  namespace?: string,
  root?: string,
  branch?: string,              // GitHub/GitLab; mặc định theo subsystem
  file?: string,
  binding?: string,
  maxEntries?: number,
  maxBytes?: number,
  defaultTtl?: number,
  idleTtl?: number,
  cleanupIntervalMs?: number,
  flushDebounceMs?: number,
  durability?: "memory" | "async" | "sync",
  consistency?: "local-first" | "remote-first",
}
```

Với các config dùng GitHub/GitLab, `branch` được phép nhập trực tiếp trong
`dry.config.ts`. Không còn branch dùng chung trong environment. Nếu bỏ trống,
branch được đặt theo subsystem đang sử dụng:

```text
storage         -> "storage"
icons           -> "icons"
content         -> "content"
components.storage -> "components"
```

Quy tắc này áp dụng cho mọi section có thể dùng GitHub/GitLab (`storage`,
`icons`, `content` khi dùng `engine: "file"`, và `components.storage`).
Token/repo/project vẫn lấy từ environment để không đưa credential vào source
code. Branch được cấu hình độc lập cho từng subsystem.

Khi triển khai, cập nhật các type config hiện tại (`DryStorageOption`,
`DryIconsOption`, `DryContentOption`, `DryComponentsOption`) và helper
`resolveFileBackedOption()` để nhận `branch` tùy chọn; các hàm resolve GitHub/
GitLab nhận branch đã resolve thay vì đọc branch environment trực tiếp. Cần giữ
backward compatibility: config không có `branch` vẫn hoạt động như hiện tại.

Khi adapter GitHub/GitLab phát hiện branch chưa tồn tại, phải tạo branch với
tree rỗng. Branch mới không được kế thừa dữ liệu từ branch chính; dữ liệu chỉ
được thêm khi subsystem tương ứng thực hiện operation đầu tiên.

`resolveOptions()` phải:

- áp dụng default và normalize path/root;
- reject option không đúng adapter, ví dụ `binding` ngoài `D1`/`KV`, `file` ngoài `sqlite`, `root` không hợp lệ;
- validate giới hạn TTL, số lượng entry, byte size và interval;
- validate env credentials lúc startup cho Node/GitHub/GitLab;
- không validate live D1/KV binding như object vì chúng chỉ tồn tại trong request context.

API route phase sau, nếu cần quản trị/debug:

- `GET /api/kv/:namespace/:key` - chỉ cho quyền admin hoặc internal caller;
- `PUT`, `DELETE` - không mở cho public content API;
- `GET /api/kv-health` - queue depth, last flush, backend latency, error state; tuyệt đối không trả value/secret.

Trước khi thêm route cần quyết định KV là internal service hay là tính năng public. Mặc định kế hoạch này chọn internal service; route quản trị chỉ là phase sau.

## 8. UI quản trị Key Value và quyết định realtime

Màn hình Key Value chỉ mở cho Super Admin. Vì vậy không cần thiết kế kênh
realtime hai chiều hoặc tối ưu cho nhiều client đồng thời.

### 8.1. Danh sách

Danh sách hiển thị metadata trước, không tải toàn bộ value cho mọi dòng:

- namespace;
- key;
- preview value;
- kích thước;
- created/updated time;
- expiresAt hoặc TTL còn lại;
- trạng thái `dirty`, `expired`, `flush-error` nếu có.

Value đầy đủ chỉ tải khi mở trang chi tiết key. Key nhạy cảm phải được mask
mặc định và không ghi value vào log.

### 8.2. Cơ chế tự cập nhật - quyết định MVP

Chọn **REST + polling định kỳ**, không dùng WebSocket, long response hoặc SSE
trong MVP. Khi server cập nhật hoặc xóa key, UI sẽ nhận biết ở lần polling
tiếp theo.

API danh sách cần trả một `revision` của namespace/store:

```json
{
  "revision": 42,
  "items": [],
  "nextCursor": null
}
```

UI gửi revision/ETag trước đó qua `If-None-Match`. Nếu chưa thay đổi, server
trả `304 Not Modified` hoặc `{ "changed": false }` để không tải lại dữ liệu.
Nếu revision thay đổi, UI tải lại trang hiện tại; phase sau có thể bổ sung
`updatedSince` để chỉ lấy delta.

Chính sách UI:

- polling mỗi 5–10 giây khi màn hình đang mở;
- dừng polling khi tab không active;
- có nút Refresh thủ công;
- dùng cursor pagination, không tải toàn bộ value;
- nếu polling lỗi, giữ danh sách hiện tại và hiển thị trạng thái stale/error.

WebSocket hoặc SSE chỉ được xem xét lại khi có nhu cầu cập nhật dưới một giây,
nhiều admin cùng thao tác, hoặc cần theo dõi trạng thái flush/backend realtime.

## 9. Cấu trúc file dự kiến

```text
src/kv/
  types.ts                 # record, options, error, adapter contract
  store.ts                 # public KeyValueStore, cache + lifecycle
  memory.ts                # Map, TTL, LRU, cleanup
  queue.ts                 # dirty queue, coalescing, retry
  codec.ts                 # JSON encode/decode, size limits
  index.ts                 # factory
  adapters/
    local.ts
    sqlite.ts
    d1.ts
    github.ts
    gitlab.ts
    cloudflare-kv.ts
  *.test.ts
```

Có thể đổi `cloudflare-kv.ts` thành `kv.ts`, nhưng nên dùng tên đầy đủ để tránh nhầm với module service `src/kv/index.ts`.

## 10. Lộ trình triển khai

### Phase 0 - Chốt contract và benchmark baseline

- Viết RFC ngắn cho semantics TTL, version, durability và consistency.
- Định nghĩa giới hạn MVP: JSON-only, kích thước value tối đa, namespace bắt buộc hay mặc định.
- Benchmark mục tiêu: p50/p95 `get` cache hit, `set` async, flush batch, hydrate startup.
- Chốt adapter nào là primary theo môi trường triển khai.

### Phase 1 - Core memory store

- Tạo types/error/options.
- Implement Map wrapper, TTL, idle TTL, max entries/max bytes và cleanup timer.
- Implement `get/set/delete/has/clear` với test fake clock.
- Implement dirty queue nhưng dùng fake adapter trước.
- Test write coalescing, concurrent set cùng key, eviction không làm mất dirty data.

### Phase 2 - Persistence coordinator và local adapter

- Implement async/sync durability, debounce, retry, flush/close.
- Implement local adapter atomic write, list metadata, journal tối thiểu.
- Thêm startup hydrate và shutdown hook cho Node.
- Test crash-like scenario: mutation chưa flush, restart, journal replay.

### Phase 3 - SQLite và D1

- Tái sử dụng driver/helper hiện có.
- Migration/schema cho bảng KV và index expiry.
- Implement transaction/CAS SQLite.
- Implement per-request D1 adapter factory và batch statements.
- Test persistence, version conflict, expiration và D1 fake binding.

### Phase 4 - GitHub và GitLab

- Tách codec/index/snapshot để giảm request.
- Implement tree/commit batch và conflict retry.
- Tái sử dụng conventions/env của `src/storage/github.ts` và `gitlab.ts`.
- Test bằng fake REST server, không gọi network thật trong unit test.

### Phase 5 - Cloudflare KV và runtime integration

- Thêm binding type/config.
- Implement `get/put/delete/list` với TTL và cursor.
- Tích hợp `env`/`ctx` vào lifecycle route hoặc request-scoped factory.
- Test eventual consistency bằng fake delayed backend.

### Phase 6 - Observability, migration và rollout

- Metrics/logs: cache, cleanup, queue, flush, backend, conflict, stale reads.
- Health endpoint hoặc server startup diagnostics.
- Tool import/export giữa adapters để chuyển `local -> sqlite/D1/KV`.
- Feature flag bật KV theo namespace.
- Canary một namespace không nhạy cảm, sau đó mới mở rộng.

## 11. Kiểm thử và tiêu chí nghiệm thu

### Unit test

- TTL hết hạn đúng cả khi đọc và khi cleanup nền.
- Idle/LRU không loại dirty entry chưa được persist.
- `maxBytes` tính theo encoded payload, không theo `JSON.stringify` ước lượng sai.
- Concurrent writes cùng key không làm version lùi.
- Flush coalesces nhiều mutation thành operation cuối.
- Retry/backoff không retry lỗi không retryable.
- Hydrate bỏ record expired và khôi phục record còn hạn.

### Adapter contract test

Cùng một test suite chạy cho mọi adapter khi backend fake/fixture sẵn sàng:

- get missing, set, overwrite, delete;
- list theo namespace/cursor;
- version/CAS/conflict;
- batch atomicity theo khả năng backend;
- round-trip Unicode, null, array, object và payload gần giới hạn.

### Integration/E2E

- Server restart vẫn đọc được dữ liệu đã flush.
- Backend chậm không block cache hit.
- Backend down vẫn trả stale data theo policy, không che lỗi bằng null.
- SIGTERM flush trong timeout.
- D1/KV không bị cache binding ở module scope.
- GitHub/GitLab chỉ tạo một commit cho một logical batch.

### Tiêu chí hiệu năng ban đầu

- Cache hit không có I/O và không tạo promise backend.
- Cleanup chạy bounded work, không quét/block event loop quá ngưỡng benchmark.
- 1.000 mutation cùng namespace được coalesced thành batch phù hợp.
- p95 flush local/SQLite được đo riêng với GitHub/GitLab; không dùng một ngưỡng chung cho mọi backend.

## 12. Rủi ro và quyết định cần chốt

- **Git backend không phải database:** nếu cần độ trễ ghi thấp hoặc nhiều writer, chọn SQLite/D1/KV làm primary; GitHub/GitLab chỉ làm persistence/sync.
- **Cloudflare KV eventual consistency:** không dùng KV thuần cho dữ liệu cần read-after-write nghiêm ngặt nếu không có lớp version/revalidation.
- **Multi-process Node:** mỗi process có Map riêng; cần xác định single-process là supported mặc định hay phải thêm invalidation/pub-sub ở phase sau.
- **Value lớn:** phải chặn trước khi adapter nhận payload; tránh biến KV thành file store trá hình.
- **Secret:** không expose KV debug route và không log value; cân nhắc namespace đánh dấu `sensitive` để redaction.
- **Sync hai chiều:** MVP nên chọn một primary writer. Nếu cần pull remote changes hai chiều, bổ sung change log/cursor và conflict UI sau khi core ổn định.

## 13. Kết quả mong đợi sau MVP

MVP hoàn tất khi drycms có một `KeyValueStore` độc lập, memory-first, tự dọn dẹp an toàn, flush nền có retry, khôi phục sau restart, và chạy qua adapter `local`, `sqlite`, `D1`, `github`, `gitlab`, `KV` theo cùng contract. Mỗi adapter phải có test contract tương ứng và config lỗi phải fail ngay khi resolve options, trước khi nhận request.
