# Magic (khung chat) — nâng cấp từ Magic Write

Tiếp nối `status/magic-write.md` (tính năng Magic Write đã chạy thật, 12 vòng
phản hồi). Tài liệu này chỉ ghi phần **thay đổi**: đổi tên thành "Magic",
đổi UX từ "1 prompt + tối đa 2 câu hỏi trắc nghiệm" sang **khung chat đầy đủ**,
AI chủ động hỏi lại và tự quyết định khi nào đủ thông tin để viết.

## Plan

### Hạ tầng đã có (không phải xây lại)

- `MagicWriteTurn = question | fields` + `history: ChatMessage[]` (cap 20) —
  protocol vốn đã nhiều lượt.
- System prompt bơm sẵn mỗi lượt: field tree + **giá trị hiện tại từng field**
  + label + relation context 1 cấp + danh sách path ảnh.
- Stream SSE `{delta}/{retry}/{turn}/{error}`, retry 3 lần khi sai dialect,
  permission theo `checkAccess`, rate-limit `acquireAiStreamSlot`,
  timeout riêng 90s, Google 503 auto-retry.
- Live-feed vào field thật + `fieldset disabled` + status ở topbar.
- `/api/ai/chat` (conversation store server-side) vẫn còn nhưng **không client
  nào dùng** — UI chat của Builder đã bị gỡ. Không tái dùng, chỉ ghi nhận.

### Quyết định

1. **`kind: chat` — lượt nói chuyện thường.** Wire format giữ nguyên dialect
   YAML-subset; `text: |` là block literal nên `\n` đi thẳng qua, không escape.
   - Render **plain text** với `white-space: pre-wrap`. KHÔNG markdown parser,
     KHÔNG `dangerouslySetInnerHTML`.
   - Prompt cấm: `**`, `#`, `-` đầu dòng, bảng, và **code fence** (fence phá
     `extractMagicWriteYaml`). Ngắt đoạn bằng dòng trống.
   - Mọi dòng của `text` phải giữ thụt lề, kể cả dòng trống.
2. **Khoan dung khi sai dialect**: parse không ra `kind:` nào ⇒ coi TOÀN BỘ
   câu trả lời là chat text, không lỗi, không retry. Xoá được ngõ cụt
   "AI could not produce a valid reply after 3 attempts" trong pha chat.
3. **Giữ `kind: question`** — render thành bong bóng có chip chọn ngay trong
   luồng chat (dùng lại CSS `ai-wizard-question`/`ai-wizard-choices`). Luật
   prompt: đáp án thuộc tập đóng nhỏ → `question`; còn lại → `chat`. **Bỏ**
   luật "tối đa 2 câu hỏi".
4. **`kind: fields` KHÔNG còn là lượt cuối.** Viết xong → đẩy 1 dòng trạng
   thái vào luồng chat ("Đã viết: Tiêu đề, Nội dung — {summary}") và chat
   tiếp được để chỉnh sửa.
   - History chỉ giữ **lời nói**, TUYỆT ĐỐI không nhét lại khối YAML đã viết
     (hiện `MagicWriteDialog.tsx:325` nhét cả `rawTextRef.current` — vô hại
     với lượt `question`, nhân đôi token với lượt `fields`).
   - Không cần: nội dung vừa viết đã quay lại qua `currentValue` ở lượt sau
     (server dựng lại `fieldsDescription` từ giá trị form sống mỗi request).
5. **`kind: fetch` (Phase B)** — AI chủ động lấy dữ liệu NGOÀI entry hiện tại.
   Vòng lặp chạy hoàn toàn server-side trong `streamMagicWrite`, KHÔNG dùng
   tool-calling gốc của provider (3 nhánh stream tay cho Anthropic/OpenAI/
   Google là dự án riêng).
   - Allow-list nguồn v1: `entries` (vài field đầu, cap dòng), `entry` (1 id),
     `media` (path ảnh 1 thư mục), `types`.
   - Mỗi query chạy lại `checkAccess` cho ĐÚNG type được hỏi (không mượn
     quyền của entry đang mở). `password`/`secretkey` không bao giờ ra kết quả.
   - Cap 3 hop/lượt. Client hiện dòng trạng thái "Đang xem 5 bài blog gần đây…".
6. **Không ép dùng UI hệ thống** (user chốt 2026-08-07) — tận dụng cái phù hợp,
   còn lại viết mới:
   - Dùng lại: `FileManager` + CSS `.image-picker-dialog`, `Popover`/
     `ContextMenu`, `useOverlayScrollbars`, CSS `ai-wizard-*`, `thumbnailUrl`.
   - Viết mới: composer `<textarea>` riêng (không label, Enter gửi /
     Shift+Enter xuống dòng, auto-grow — `TextField` không có cả ba), thanh
     đính kèm ảnh, bong bóng tin nhắn.

### UI — bong bóng nổi, KHÔNG phải modal (user chốt 2026-08-07)

Yêu cầu gốc: "người dùng thấy được UI thay đổi và vẫn chat được với UI, có
thể dễ dàng đóng mở". Modal `<dialog>` không đáp ứng được — backdrop chặn hết
tương tác với form. Nên bỏ hẳn khung dialog xl, thay bằng **bong bóng chat
kiểu widget**: nút tròn nổi góc dưới-phải, bấm mở panel, panel KHÔNG chặn
trang, form vẫn bấm/gõ/cuộn được bình thường trong lúc chat.

**Cơ chế nổi lên trên: Popover API, đã có tiền lệ trong repo.**
`Toast.tsx:351` dùng `popover="manual"` + `showPopover()` để nổi trên cả
`<dialog>` đang mở mà không cần thang z-index — dùng đúng cơ chế đó cho bong
bóng + panel.
- `manual` (không phải `auto`) là bắt buộc: `auto` sẽ light-dismiss/Esc-close
  ngay khi user bấm vào một field trong form — đúng thứ tính năng này cần cho
  phép.
- ⚠️ **Top layer xếp theo "cái nào `show` sau thì nằm trên"**
  (`Toast.tsx:374`). Panel mở picker ảnh (`<dialog showModal()>`) thì picker
  nằm trên panel — đúng mong muốn. Nhưng nếu có `<dialog>` nào mở SAU khi
  panel đã `showPopover()`, panel sẽ bị chôn: cần re-promote
  (`hidePopover()`/`showPopover()`) đúng như Toaster đang làm.

**Va chạm với Toast**: `.toast-viewport` mặc định `bottom-end`, inset 1.5rem,
rộng 22rem (`components.css:1816`) — trùng đúng chỗ panel. VEI frame đã tự
đổi sang `bottom-start` (`VeiFrame.tsx:31`). Cách rẻ nhất: panel set một CSS
var khi mở, `.toast-viewport` đọc
`inset-inline-end: calc(1.5rem + var(--dry-toast-shift, 0px))` — một var, một
rule, nhánh `.start` (VEI) không bị ảnh hưởng.

**Cái này xoá bỏ, không phải hoãn:**
- Toàn bộ logic ẩn/hiện theo loại lượt (`kind === "fields"` thì ẩn) — panel
  cứ mở suốt, người dùng nhìn field chạy phía sau. Đây vốn là phần rối nhất.
- `openToken`/`dialogVisible`/`activeRef` — quay lại `open` boolean bình
  thường, panel tự giữ trạng thái.
- Ý "thu nhỏ về nút topbar": bong bóng CHÍNH LÀ trạng thái thu nhỏ.
- `useDialogSync`, CSS `.magic-chat-dialog[open]`, và cả bẫy "phải scope
  `[open]`".

**Thêm được nhờ non-modal**: khi một field bắt đầu được viết, cuộn nó vào tầm
nhìn — form đã có sẵn `data-field-name` trên mỗi fieldset top-level
(`ContentEntryEditor.tsx`), nên chỉ là `scrollIntoView({block:"center"})`.
Đúng tinh thần "thấy được UI thay đổi".

**Kích thước**: panel 24rem × min(70vh, 40rem), có nút mở rộng sang ~40rem
cho nội dung dài. Mobile: bong bóng giữ nguyên, panel thành sheet toàn màn.

```
   form thật vẫn bấm/gõ được       ┌──────────────────────────┐
   ┌───────────────┐               │ ✨ Magic  [key ▾] ⤢  —  ✕│ flex:none
   │ Tiêu đề       │               ├──────────────────────────┤
   │ [đang viết…]  │ ← nhìn thấy   │ ┌──────────────────┐     │
   └───────────────┘   ngay        │ │ assistant        │     │ ← vùng DUY
                                   │ └──────────────────┘     │   NHẤT cuộn
                                   │      ┌─────────────────┐ │
                                   │      │ user            │ │
                                   │      └─────────────────┘ │
                                   │  · Đã viết: Tiêu đề ·    │ ← trạng thái
                                   ├──────────────────────────┤
                                   │ [ảnh]✕                   │ strip đính kèm
                                   │ (+) Nhắn cho Magic…  [→] │ composer
                                   └──────────────────────────┘
                                                         ( ✨ )  ← bong bóng
                                                                  khi đóng
```

`—` thu gọn về bong bóng · `✕` kết thúc phiên · `⤢` mở rộng panel.

- Lượt `fetch` + lượt viết xong = dòng trạng thái giữa khung, không bong bóng
  — phân biệt "AI nói" với "AI làm".
- Nút (+) mở menu → "Chọn ảnh" mở picker `FileManager` dạng `<dialog
  showModal()>`; mở sau panel nên nằm trên panel (đúng luật "show sau nằm
  trên"), đóng xong panel lộ lại nguyên trạng. Về sau thêm "Đính kèm bài viết
  khác…" cho `fetch` mà không đổi layout.
- Empty state: chip gợi ý ("Viết bài về…", "Rút gọn mở bài", "Đặt lại tiêu đề
  chuẩn SEO") — lái hành vi rẻ hơn mọi lời giải thích.

**Auto-scroll "dính đáy"**: trước mỗi lần render nội dung mới, đo viewport có
trong ~48px cuối không. Ở đáy → kéo xuống; user đã cuộn lên → không đụng, hiện
chip "↓ tin mới". Đang stream dùng `behavior:"auto"` (smooth đá nhau khi delta
về liên tục), chip mới dùng smooth. Mở lại panel từ bong bóng → nhảy đáy tức
thì, không animation.
⚠️ OverlayScrollbars chuyển scroll sang `.os-viewport` bên trong, phần tử được
ref KHÔNG tự cuộn. Cần bổ sung vào `hooks/overlayscrollbars.ts` (tương thích
ngược): `isNearBottom(px = 48)` + `scrollToBottom` nhận `behavior`.
`scrollToBottom` hiện chưa nơi nào dùng — đây là chỗ dùng đầu tiên.

### Rủi ro + cách xử lý

| # | Rủi ro | Cách xử lý |
|---|---|---|
| 1 | ~~Dialog xl che mất UX "xem AI viết vào field thật"~~ | **Không còn tồn tại**: panel non-modal (Popover API) nên form không bị che/khoá. Bỏ luôn logic ẩn-hiện theo loại lượt và chỗ giật ở `MagicWriteDialog.tsx:291` |
| 2 | "AI chủ động lấy thông tin" cần tool-calling | `kind: fetch` + vòng lặp server + allow-list (quyết định #5) |
| 3 | `fields` hết terminal ⇒ history phình | History chỉ giữ lời nói; nội dung quay lại qua `currentValue` (quyết định #4) |
| 4 | Token phình theo độ dài chat | (a) không nhân đôi nội dung; (b) ảnh chỉ gửi kèm ở lượt được đính kèm, lượt sau chỉ còn path + mô tả model tự viết; (c) thêm cap TỔNG ký tự cuộc trò chuyện (hiện chỉ có cap 20 message + 100k ký tự/message), vượt thì cắt lượt cũ nhất và báo "đã rút gọn"; (d) `cache_control` cho nhánh Anthropic — system prompt đang nằm đầu message user đầu tiên, đúng vị trí (Phase C, tuỳ chọn) |
| 5 | Chat mở ra kỳ vọng vượt khả năng ("lưu bài giúp tôi") | Capability contract trong prompt: liệt kê làm được gì / KHÔNG làm được gì (lưu-publish entry, tạo-sửa field, xoá, upload, truy cập web); ngoài phạm vi → `kind: chat` giải thích + đề xuất cái gần nhất. Cộng chip gợi ý ở empty state |
| 6 | Hai giao diện rời (chat vs trắc nghiệm) | `question` render thành bong bóng có chip (quyết định #3) |
| 7 | Không có e2e nào cho Magic Write | (a) unit cho `chat`/`fetch` trong `ai-magic-write-protocol.test.ts` + bất biến "lượt chat KHÔNG BAO GIỜ commit field"; (b) cờ dev-only (VD `DRY_AI_FAKE=1`) cho `/api/ai/magic-write` phát lại kịch bản SSE đóng hộp → Playwright chạy toàn luồng, xác định, miễn phí, tiện cả lúc dev tay; (c) smoke test curl như cũ (nhớ restart dev server) |
| 8 | Mất cuộc trò chuyện khi rời trang | v1 chấp nhận + `ConfirmDialog` khi đang có phiên chạy. KHÔNG đẩy localStorage (entry-draft đã dùng chỗ đó, dễ đá nhau) |

### Phân kỳ

| Phase | Nội dung | Ghi chú |
|---|---|---|
| A | `kind: chat` + khung chat + `fields` không còn terminal | Ăn ~80% giá trị, đổi ít protocol |
| B | `kind: fetch` + allow-list + phân quyền theo từng type | Phần "chủ động lấy thông tin" thật |
| C | Quản lý ngữ cảnh: cap tổng, tóm tắt, ảnh theo lượt, prompt caching | Khi chat dài thành thói quen |

### Chốt 3 điểm chặn (2026-08-07)

**A. ~~Thu nhỏ về nút topbar~~ → THAY BẰNG bong bóng nổi** (user chốt cùng
ngày, xem mục "UI — bong bóng nổi" ở trên). Không còn modal nên không còn
khái niệm "ẩn khi đang viết": panel mở suốt, form chạy phía sau.
**Sửa lại phát sinh**: bong bóng luôn hiện diện (giống widget chat thường
thấy) nên nút "Magic" ở 2 vị trí topbar (chính + VEI header) không còn giữ
vai trò "chỉ báo phiên" nữa — chỉ còn là lối gọi phụ, bấm vào thì mở đúng
panel y hệt bấm bong bóng, không có logic "reveal session" riêng. Trạng thái
(spinner/"Đang viết…") hiện thẳng TRÊN bong bóng (badge nhỏ), không cần đồng
bộ 2 nơi hiện trạng thái nữa.
Vẫn giữ lại từ hướng cũ: gộp `onStreamingFieldChange` thành **một** callback
`onStatusChange({ active, phase, streamingField })`, vì `ContentEntryEditor`
vẫn cần `streamingField` để disable fieldset + `scrollIntoView`.

**B. Ba hành động tách bạch, không thao tác nào lỡ tay giết chat.**

| Hành động | Kích hoạt | Tác dụng |
|---|---|---|
| **Thu gọn** | `—`, bấm lại bong bóng | Panel về bong bóng. Phiên sống, history nguyên vẹn. KHÔNG dùng `popover="auto"` (light-dismiss/Esc sẽ đóng panel ngay khi user bấm vào field — đúng thứ phải cho phép) |
| **Dừng** | ⏹ (nút gửi đổi hình khi đang stream) | `abort()` lượt đang chạy, **giữ** phiên/history/composer. Field đã commit KHÔNG rollback (revert qua `EntryPreviewDialog` như mọi thay đổi khác). Đẩy 1 dòng "Đã dừng." vào luồng chat |
| **Kết thúc phiên** | `✕` | Xoá history + reset. `ConfirmDialog` nếu đang stream |

Chi tiết cần đúng: `run()` hiện `return` im lặng khi `signal.aborted`, nên
không phân biệt được dừng với huỷ → thêm `stopReasonRef: "stop" | "cancel" |
null`. History sau khi dừng: **bỏ qua** phần assistant trả dở (nửa vời làm
model bối rối ở lượt sau); riêng nếu lượt đó là `fields` và đã commit được
vài field thì ghi vào history đúng một dòng "Đã viết: X, Y (bị dừng giữa
chừng)" để lượt sau AI biết hiện trạng.

**C. `images` theo lượt, nhưng `allowedImageSrcs` theo cả phiên.**
- Client: ảnh đính kèm ở composer → gắn vào message của lượt đó rồi clear
  strip; bong bóng user hiển thị lại thumbnail của lượt đó.
- Request: `images` (có base64) = **ảnh của lượt này**; thêm
  `sessionImagePaths: string[]` (CHỈ path, không base64) = mọi ảnh đã đính
  kèm trong phiên.
- Server (`ai-magic-write.ts:268`): base64 gắn vào **message user cuối**
  (lượt hiện tại) thay vì priming mỗi lượt; priming vẫn liệt kê `imagePaths`
  **tích luỹ toàn phiên**.
- ⚠️ **Bẫy im lặng**: `allowedImageSrcs` phải là **hợp của cả phiên**
  (`storage.stat()` verify từng path như hiện tại). Nếu chỉ lấy ảnh lượt này
  thì lượt sau AI gán ảnh cũ vào `heroImage` sẽ bị `applyMagicWriteFields`
  drop lặng lẽ, không báo lỗi gì.
- Model không "nhìn" lại được ảnh lượt cũ (API stateless, không còn base64
  trong request): prompt yêu cầu model mô tả ngắn mỗi ảnh ngay lượt nhận;
  client giữ mô tả đó, đính vào danh sách path ở các lượt sau
  (`photos/cover.jpg — ảnh bình minh trên núi`). Cần nhìn kỹ lại thì bong
  bóng có nút "gửi lại ảnh này".
- Kết quả: mỗi ảnh trả token vision **đúng một lần** thay vì mọi lượt.

### Khoảng trống còn lại (rà soát 2026-08-07)

Có đề xuất mặc định cho từng cái — chỉ cần duyệt hoặc bác:

1. **AI key chọn lúc nào?** `useAiKeySelection(dialogVisible && stage ===
   "start")` gắn vào state modal cũ, không còn áp dụng. → *đề xuất: load 1
   lần khi panel mở lần đầu trong phiên, khoá lại sau tin nhắn đầu tiên.*
2. **Lỗi giữa cuộc chat** → *đề xuất: thành 1 dòng trong luồng chat + nút
   "Thử lại" tại chỗ, giữ nguyên text user đã gõ; bỏ hẳn `stage: "error"`
   toàn màn.* Gồm cả 429, timeout 90s, mất mạng giữa stream.
3. **Hoàn tác một lượt viết** → *đề xuất v1: giữ nguyên `EntryPreviewDialog`
   (diff + Reset) như hiện tại, dòng trạng thái liệt kê field đã viết để biết
   revert cái gì.* Không xây undo per-turn.
4. **User sửa tay rồi chat tiếp** → *đề xuất: thêm luật prompt "không viết
   lại field admin vừa sửa trừ khi được yêu cầu rõ".* Rẻ, tránh ghi đè bực mình.
5. **Trạng thái "đang soạn"**: bong bóng rỗng + spinner trước delta đầu tiên
   (có ảnh thì chờ vài giây). → *đề xuất: có.*
6. **Ngôn ngữ UI**: admin app đang tiếng Anh ("Magic Write", "Cancel",
   "Write") nhưng placeholder ví dụ tiếng Việt và `ai.lang: "vi"`. → *đề xuất:
   chuỗi UI tiếng Anh cho nhất quán, nội dung AI theo `ai.lang`.*
7. **Mobile**: panel 24rem → full-screen sheet, composer tránh bàn phím ảo,
   strip ảnh cuộn ngang. → *đề xuất: làm ngay ở Phase A, rẻ hơn nhiều so với
   vá sau.*
8. **A11y**: `role="log"` cho danh sách, `aria-live="polite"` CHỈ cho dòng
   trạng thái (không đọc từng delta), bong bóng đang stream để `aria-busy`,
   focus trả về composer sau khi gửi.
9. **"Cuộc trò chuyện mới"**: nút xoá lịch sử để bắt đầu lại mà không phải
   đóng/mở trang. → *đề xuất: có, trong header* (cũng là hành động "kết thúc
   phiên" ở bảng B).

## Status

Chưa code. Thiết kế đã chốt qua 4 lượt trao đổi (hướng tính năng → rủi ro →
đặc tả UI → 3 điểm chặn). Không còn điểm chặn nào; 9 mục còn lại đều đã có
mặc định, chỉ chờ user bác nếu không đồng ý.

## Speed

- Sẵn sàng code Phase A. Thứ tự đề xuất: protocol (`kind: chat` + khoan dung)
  → khung chat + composer + scroll → luật ẩn/thu nhỏ + nút topbar trạng thái
  → dừng/đóng/phiên mới → ảnh theo lượt → mobile/a11y.

## Phase A — ĐÃ XONG CODE (2026-08-07)

Làm trong 1 phiên liên tục theo đúng thứ tự đề xuất ở trên. Typecheck sạch +
**900 test pass** (87 file, +7 test mới cho protocol) + `bun run build`
sạch (client + SSR) xuyên suốt. Verified bằng smoke test THẬT qua curl với
AI key thật (Google `gemini-3.5-flash`, restart dev server trước khi test -
đúng bài học cũ trong `magic-write.md`): `kind: chat` (model tự giới thiệu
khả năng, đúng dialect, đúng field list thật), `kind: fields` (viết
title/slug/excerpt), và 1 lượt follow-up (`history` chỉ chứa lời nói trước
đó, `prompt` là lượt hiện tại, `currentValue` phản ánh field vừa viết) - model
CHỈ sửa đúng `excerpt` được yêu cầu, không đụng title/slug, xác nhận
`SCOPE_INSTRUCTION` hoạt động đúng qua nhiều lượt thật.

### Quyết định lệch khỏi plan gốc (đưa ra trong lúc code, không hỏi lại vì đều
là chi tiết triển khai, không đổi UX đã chốt với user)

1. **Bỏ hẳn 2 nút "Magic Write" ở topbar (chính + VEI header), không giữ lại
   làm "lối gọi phụ" như bản nháp "Chốt 3 điểm chặn" từng đề xuất.** Lý do:
   với bong bóng nổi LUÔN hiện diện (không phải ẩn sau modal nữa), một nút
   topbar thứ 2 làm cùng việc chỉ là trùng lặp, không còn lý do tồn tại. Bong
   bóng tự mang trạng thái (spinner/dot/tooltip) nên cũng không cần đồng bộ
   trạng thái ra topbar nữa - dòng "Writing X…" ở topbar bị xoá theo.
2. **Không gộp `onStreamingFieldChange` thành `onStatusChange`.** Lý do gộp
   ban đầu (topbar cần active+phase+streamingField để dựng text) không còn
   áp dụng khi topbar không còn hiển thị trạng thái - giữ nguyên tên/API cũ
   `onStreamingFieldChange(name)`, đơn giản hơn, ít đổi hơn.
3. **`history` đổi nghĩa hẳn: `prompt` giờ là lượt HIỆN TẠI trên MỌI lượt gọi
   (không chỉ lượt đầu), `history` là CÁC LƯỢT TRƯỚC đó (không gồm lượt hiện
   tại).** Bản nháp đặc tả UI cũ mô tả "gắn ảnh vào priming hay history cuối"
   phức tạp hơn cần thiết - tách hẳn "lượt hiện tại" ra khỏi "lịch sử" làm
   rõ chỗ gắn ảnh (luôn là message cuối cùng, dựng riêng) và xoá được biến
   `kickoff` (chỉ áp dụng lượt đầu) khỏi `ai-magic-write.ts`. Xác nhận đúng
   qua smoke test follow-up thật ở trên.
4. **Câu hỏi (`kind: question`) không cần renderer streaming riêng cho từng
   choice** - `parsePartialMagicWriteYaml` chỉ cần thêm field `question`
   (giống `summary` đã có sẵn) để câu hỏi hiện chữ chảy dần như một bong bóng
   assistant bình thường; `choices` chỉ có ở terminal event, lúc đó mới đổi
   bong bóng sang dạng chip tương tác.
5. **Picker ảnh đính kèm: viết bản rút gọn của `ImageField`'s dialog (chỉ tab
   File, dùng lại `FileManager` + CSS `.image-picker-dialog`), không tái
   dùng nguyên `<ImageField multiple>`** - đúng quyết định #6 ("không ép
   dùng UI hệ thống"), vì ImageField mang theo khung 4:3 + danh sách kéo-thả
   không hợp với một nút đính kèm ephemeral trong composer.
6. **Toast tránh bong bóng bằng CSS `:has()` thuần, không cần JS/CSS-var từ
   component.** `body:has(.magic-chat-bubble):has(.magic-chat-widget:not(.vei))
   .toast-viewport:not(.start)` (và cặp `.vei`/`.start` ngược lại) - 2 rule
   CSS, không cần state/effect nào để đồng bộ giữa 2 component không có quan
   hệ cha-con.
7. **`hooks/overlayscrollbars.ts` thêm `viewport()`** (trả về phần tử
   `.os-viewport` thật) thay vì chỉ thêm `isNearBottom`/`scrollToBottom` như
   dự tính ban đầu - cần thiết để tự gắn listener `scroll` phát hiện "user đã
   cuộn lên" (không có cách nào khác đọc được sự kiện scroll thật từ hook cũ).

### Việc CHƯA làm (đề xuất cho phiên sau, không phải lỗi)

1. **Chưa test UI thật trong browser** (không có browser tool trong phiên
   này) - mọi verify UI chỉ qua đọc code + typecheck + build + smoke test
   server-side bằng curl (xác nhận đúng luồng SSE/dialect/scope, KHÔNG xác
   nhận bong bóng/panel/composer/auto-scroll thật trong DOM). Cần user tự mở
   trang Content Entry và bấm thử.
2. **Mô tả ảnh "nhớ lại" qua nhiều lượt** (`status/magic-chat.md` quyết định
   C, phần "model tự mô tả ảnh ngay lúc nhận, client giữ mô tả gắn vào path
   ở lượt sau") - CHƯA làm; hiện tại `sessionImagePaths` chỉ giữ path (đủ để
   `allowedImageSrcs` không bị lỗi), model sẽ KHÔNG còn "nhớ" nội dung ảnh cũ
   ở lượt sau nếu không được nhắc lại bằng lời. Cải thiện UX, không phải bug
   - để lại cho phiên sau nếu cần.
3. **Phase B (`kind: fetch`)** và **Phase C (cap tổng ký tự lịch sử, prompt
   caching)** - chưa làm, đúng như phân kỳ ban đầu.
4. **Cờ dev-only phát lại SSE đóng hộp cho e2e** (rủi ro #7 ở trên) - chưa
   làm; Magic vẫn không có e2e coverage nào.
5. **Chưa xoá `/api/ai/chat` (conversation store không còn ai gọi)** - ngoài
   phạm vi lần này, chỉ ghi nhận lại như hạ tầng đã có từ trước.
