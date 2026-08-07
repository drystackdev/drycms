# Magic (khung chat) - nâng cấp từ Magic Write

Tiếp nối `status/magic-write.md` (tính năng Magic Write đã chạy thật, 12 vòng
phản hồi). Tài liệu này chỉ ghi phần **thay đổi**: đổi tên thành "Magic",
đổi UX từ "1 prompt + tối đa 2 câu hỏi trắc nghiệm" sang **khung chat đầy đủ**,
AI chủ động hỏi lại và tự quyết định khi nào đủ thông tin để viết.

## Plan

### Hạ tầng đã có (không phải xây lại)

- `MagicWriteTurn = question | fields` + `history: ChatMessage[]` (cap 20) -
  protocol vốn đã nhiều lượt.
- System prompt bơm sẵn mỗi lượt: field tree + **giá trị hiện tại từng field**
  - label + relation context 1 cấp + danh sách path ảnh.
- Stream SSE `{delta}/{retry}/{turn}/{error}`, retry 3 lần khi sai dialect,
  permission theo `checkAccess`, rate-limit `acquireAiStreamSlot`,
  timeout riêng 90s, Google 503 auto-retry.
- Live-feed vào field thật + `fieldset disabled` + status ở topbar.
- `/api/ai/chat` (conversation store server-side) vẫn còn nhưng **không client
  nào dùng** - UI chat của Builder đã bị gỡ. Không tái dùng, chỉ ghi nhận.

### Quyết định

1. **`kind: chat` - lượt nói chuyện thường.** Wire format giữ nguyên dialect
   YAML-subset; `text: |` là block literal nên `\n` đi thẳng qua, không escape.
   - Render **plain text** với `white-space: pre-wrap`. KHÔNG markdown parser,
     KHÔNG `dangerouslySetInnerHTML`.
   - Prompt cấm: `**`, `#`, `-` đầu dòng, bảng, và **code fence** (fence phá
     `extractMagicWriteYaml`). Ngắt đoạn bằng dòng trống.
   - Mọi dòng của `text` phải giữ thụt lề, kể cả dòng trống.
2. **Khoan dung khi sai dialect**: parse không ra `kind:` nào ⇒ coi TOÀN BỘ
   câu trả lời là chat text, không lỗi, không retry. Xoá được ngõ cụt
   "AI could not produce a valid reply after 3 attempts" trong pha chat.
3. **Giữ `kind: question`** - render thành bong bóng có chip chọn ngay trong
   luồng chat (dùng lại CSS `ai-wizard-question`/`ai-wizard-choices`). Luật
   prompt: đáp án thuộc tập đóng nhỏ → `question`; còn lại → `chat`. **Bỏ**
   luật "tối đa 2 câu hỏi".
4. **`kind: fields` KHÔNG còn là lượt cuối.** Viết xong → đẩy 1 dòng trạng
   thái vào luồng chat ("Đã viết: Tiêu đề, Nội dung - {summary}") và chat
   tiếp được để chỉnh sửa.
   - History chỉ giữ **lời nói**, TUYỆT ĐỐI không nhét lại khối YAML đã viết
     (hiện `MagicWriteDialog.tsx:325` nhét cả `rawTextRef.current` - vô hại
     với lượt `question`, nhân đôi token với lượt `fields`).
   - Không cần: nội dung vừa viết đã quay lại qua `currentValue` ở lượt sau
     (server dựng lại `fieldsDescription` từ giá trị form sống mỗi request).
5. **`kind: fetch` (Phase B)** - AI chủ động lấy dữ liệu NGOÀI entry hiện tại.
   Vòng lặp chạy hoàn toàn server-side trong `streamMagicWrite`, KHÔNG dùng
   tool-calling gốc của provider (3 nhánh stream tay cho Anthropic/OpenAI/
   Google là dự án riêng).
   - Allow-list nguồn v1: `entries` (vài field đầu, cap dòng), `entry` (1 id),
     `media` (path ảnh 1 thư mục), `types`.
   - Mỗi query chạy lại `checkAccess` cho ĐÚNG type được hỏi (không mượn
     quyền của entry đang mở). `password`/`secretkey` không bao giờ ra kết quả.
   - Cap 3 hop/lượt. Client hiện dòng trạng thái "Đang xem 5 bài blog gần đây…".
6. **Không ép dùng UI hệ thống** (user chốt 2026-08-07) - tận dụng cái phù hợp,
   còn lại viết mới:
   - Dùng lại: `FileManager` + CSS `.image-picker-dialog`, `Popover`/
     `ContextMenu`, `useOverlayScrollbars`, CSS `ai-wizard-*`, `thumbnailUrl`.
   - Viết mới: composer `<textarea>` riêng (không label, Enter gửi /
     Shift+Enter xuống dòng, auto-grow - `TextField` không có cả ba), thanh
     đính kèm ảnh, bong bóng tin nhắn.

### UI - bong bóng nổi, KHÔNG phải modal (user chốt 2026-08-07)

Yêu cầu gốc: "người dùng thấy được UI thay đổi và vẫn chat được với UI, có
thể dễ dàng đóng mở". Modal `<dialog>` không đáp ứng được - backdrop chặn hết
tương tác với form. Nên bỏ hẳn khung dialog xl, thay bằng **bong bóng chat
kiểu widget**: nút tròn nổi góc dưới-phải, bấm mở panel, panel KHÔNG chặn
trang, form vẫn bấm/gõ/cuộn được bình thường trong lúc chat.

**Cơ chế nổi lên trên: Popover API, đã có tiền lệ trong repo.**
`Toast.tsx:351` dùng `popover="manual"` + `showPopover()` để nổi trên cả
`<dialog>` đang mở mà không cần thang z-index - dùng đúng cơ chế đó cho bong
bóng + panel.

- `manual` (không phải `auto`) là bắt buộc: `auto` sẽ light-dismiss/Esc-close
  ngay khi user bấm vào một field trong form - đúng thứ tính năng này cần cho
  phép.
- ⚠️ **Top layer xếp theo "cái nào `show` sau thì nằm trên"**
  (`Toast.tsx:374`). Panel mở picker ảnh (`<dialog showModal()>`) thì picker
  nằm trên panel - đúng mong muốn. Nhưng nếu có `<dialog>` nào mở SAU khi
  panel đã `showPopover()`, panel sẽ bị chôn: cần re-promote
  (`hidePopover()`/`showPopover()`) đúng như Toaster đang làm.

**Va chạm với Toast**: `.toast-viewport` mặc định `bottom-end`, inset 1.5rem,
rộng 22rem (`components.css:1816`) - trùng đúng chỗ panel. VEI frame đã tự
đổi sang `bottom-start` (`VeiFrame.tsx:31`). Cách rẻ nhất: panel set một CSS
var khi mở, `.toast-viewport` đọc
`inset-inline-end: calc(1.5rem + var(--dry-toast-shift, 0px))` - một var, một
rule, nhánh `.start` (VEI) không bị ảnh hưởng.

**Cái này xoá bỏ, không phải hoãn:**

- Toàn bộ logic ẩn/hiện theo loại lượt (`kind === "fields"` thì ẩn) - panel
  cứ mở suốt, người dùng nhìn field chạy phía sau. Đây vốn là phần rối nhất.
- `openToken`/`dialogVisible`/`activeRef` - quay lại `open` boolean bình
  thường, panel tự giữ trạng thái.
- Ý "thu nhỏ về nút topbar": bong bóng CHÍNH LÀ trạng thái thu nhỏ.
- `useDialogSync`, CSS `.magic-chat-dialog[open]`, và cả bẫy "phải scope
  `[open]`".

**Thêm được nhờ non-modal**: khi một field bắt đầu được viết, cuộn nó vào tầm
nhìn - form đã có sẵn `data-field-name` trên mỗi fieldset top-level
(`ContentEntryEditor.tsx`), nên chỉ là `scrollIntoView({block:"center"})`.
Đúng tinh thần "thấy được UI thay đổi".

**Kích thước**: panel 24rem × min(70vh, 40rem), có nút mở rộng sang ~40rem
cho nội dung dài. Mobile: bong bóng giữ nguyên, panel thành sheet toàn màn.

```
   form thật vẫn bấm/gõ được       ┌──────────────────────────┐
   ┌───────────────┐               │ ✨ Magic  [key ▾] ⤢  -  ✕│ flex:none
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

`-` thu gọn về bong bóng · `✕` kết thúc phiên · `⤢` mở rộng panel.

- Lượt `fetch` + lượt viết xong = dòng trạng thái giữa khung, không bong bóng
  - phân biệt "AI nói" với "AI làm".
- Nút (+) mở menu → "Chọn ảnh" mở picker `FileManager` dạng `<dialog
showModal()>`; mở sau panel nên nằm trên panel (đúng luật "show sau nằm
  trên"), đóng xong panel lộ lại nguyên trạng. Về sau thêm "Đính kèm bài viết
  khác…" cho `fetch` mà không đổi layout.
- Empty state: chip gợi ý ("Viết bài về…", "Rút gọn mở bài", "Đặt lại tiêu đề
  chuẩn SEO") - lái hành vi rẻ hơn mọi lời giải thích.

**Auto-scroll "dính đáy"**: trước mỗi lần render nội dung mới, đo viewport có
trong ~48px cuối không. Ở đáy → kéo xuống; user đã cuộn lên → không đụng, hiện
chip "↓ tin mới". Đang stream dùng `behavior:"auto"` (smooth đá nhau khi delta
về liên tục), chip mới dùng smooth. Mở lại panel từ bong bóng → nhảy đáy tức
thì, không animation.
⚠️ OverlayScrollbars chuyển scroll sang `.os-viewport` bên trong, phần tử được
ref KHÔNG tự cuộn. Cần bổ sung vào `hooks/overlayscrollbars.ts` (tương thích
ngược): `isNearBottom(px = 48)` + `scrollToBottom` nhận `behavior`.
`scrollToBottom` hiện chưa nơi nào dùng - đây là chỗ dùng đầu tiên.

### Rủi ro + cách xử lý

| #   | Rủi ro                                                | Cách xử lý                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ~~Dialog xl che mất UX "xem AI viết vào field thật"~~ | **Không còn tồn tại**: panel non-modal (Popover API) nên form không bị che/khoá. Bỏ luôn logic ẩn-hiện theo loại lượt và chỗ giật ở `MagicWriteDialog.tsx:291`                                                                                                                                                                                                                            |
| 2   | "AI chủ động lấy thông tin" cần tool-calling          | `kind: fetch` + vòng lặp server + allow-list (quyết định #5)                                                                                                                                                                                                                                                                                                                              |
| 3   | `fields` hết terminal ⇒ history phình                 | History chỉ giữ lời nói; nội dung quay lại qua `currentValue` (quyết định #4)                                                                                                                                                                                                                                                                                                             |
| 4   | Token phình theo độ dài chat                          | (a) không nhân đôi nội dung; (b) ảnh chỉ gửi kèm ở lượt được đính kèm, lượt sau chỉ còn path + mô tả model tự viết; (c) thêm cap TỔNG ký tự cuộc trò chuyện (hiện chỉ có cap 20 message + 100k ký tự/message), vượt thì cắt lượt cũ nhất và báo "đã rút gọn"; (d) `cache_control` cho nhánh Anthropic - system prompt đang nằm đầu message user đầu tiên, đúng vị trí (Phase C, tuỳ chọn) |
| 5   | Chat mở ra kỳ vọng vượt khả năng ("lưu bài giúp tôi") | Capability contract trong prompt: liệt kê làm được gì / KHÔNG làm được gì (lưu-publish entry, tạo-sửa field, xoá, upload, truy cập web); ngoài phạm vi → `kind: chat` giải thích + đề xuất cái gần nhất. Cộng chip gợi ý ở empty state                                                                                                                                                    |
| 6   | Hai giao diện rời (chat vs trắc nghiệm)               | `question` render thành bong bóng có chip (quyết định #3)                                                                                                                                                                                                                                                                                                                                 |
| 7   | Không có e2e nào cho Magic Write                      | (a) unit cho `chat`/`fetch` trong `ai-magic-write-protocol.test.ts` + bất biến "lượt chat KHÔNG BAO GIỜ commit field"; (b) cờ dev-only (VD `DRY_AI_FAKE=1`) cho `/api/ai/magic-write` phát lại kịch bản SSE đóng hộp → Playwright chạy toàn luồng, xác định, miễn phí, tiện cả lúc dev tay; (c) smoke test curl như cũ (nhớ restart dev server)                                           |
| 8   | Mất cuộc trò chuyện khi rời trang                     | v1 chấp nhận + `ConfirmDialog` khi đang có phiên chạy. KHÔNG đẩy localStorage (entry-draft đã dùng chỗ đó, dễ đá nhau)                                                                                                                                                                                                                                                                    |

### Phân kỳ

| Phase | Nội dung                                                           | Ghi chú                            |
| ----- | ------------------------------------------------------------------ | ---------------------------------- |
| A     | `kind: chat` + khung chat + `fields` không còn terminal            | Ăn ~80% giá trị, đổi ít protocol   |
| B     | `kind: fetch` + allow-list + phân quyền theo từng type             | Phần "chủ động lấy thông tin" thật |
| C     | Quản lý ngữ cảnh: cap tổng, tóm tắt, ảnh theo lượt, prompt caching | Khi chat dài thành thói quen       |

### Chốt 3 điểm chặn (2026-08-07)

**A. ~~Thu nhỏ về nút topbar~~ → THAY BẰNG bong bóng nổi** (user chốt cùng
ngày, xem mục "UI - bong bóng nổi" ở trên). Không còn modal nên không còn
khái niệm "ẩn khi đang viết": panel mở suốt, form chạy phía sau.
**Sửa lại phát sinh**: bong bóng luôn hiện diện (giống widget chat thường
thấy) nên nút "Magic" ở 2 vị trí topbar (chính + VEI header) không còn giữ
vai trò "chỉ báo phiên" nữa - chỉ còn là lối gọi phụ, bấm vào thì mở đúng
panel y hệt bấm bong bóng, không có logic "reveal session" riêng. Trạng thái
(spinner/"Đang viết…") hiện thẳng TRÊN bong bóng (badge nhỏ), không cần đồng
bộ 2 nơi hiện trạng thái nữa.
Vẫn giữ lại từ hướng cũ: gộp `onStreamingFieldChange` thành **một** callback
`onStatusChange({ active, phase, streamingField })`, vì `ContentEntryEditor`
vẫn cần `streamingField` để disable fieldset + `scrollIntoView`.

**B. Ba hành động tách bạch, không thao tác nào lỡ tay giết chat.**

| Hành động          | Kích hoạt                            | Tác dụng                                                                                                                                                                               |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Thu gọn**        | `-`, bấm lại bong bóng               | Panel về bong bóng. Phiên sống, history nguyên vẹn. KHÔNG dùng `popover="auto"` (light-dismiss/Esc sẽ đóng panel ngay khi user bấm vào field - đúng thứ phải cho phép)                 |
| **Dừng**           | ⏹ (nút gửi đổi hình khi đang stream) | `abort()` lượt đang chạy, **giữ** phiên/history/composer. Field đã commit KHÔNG rollback (revert qua `EntryPreviewDialog` như mọi thay đổi khác). Đẩy 1 dòng "Đã dừng." vào luồng chat |
| **Kết thúc phiên** | `✕`                                  | Xoá history + reset. `ConfirmDialog` nếu đang stream                                                                                                                                   |

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
  (`photos/cover.jpg - ảnh bình minh trên núi`). Cần nhìn kỹ lại thì bong
  bóng có nút "gửi lại ảnh này".
- Kết quả: mỗi ảnh trả token vision **đúng một lần** thay vì mọi lượt.

### Khoảng trống còn lại (rà soát 2026-08-07)

Có đề xuất mặc định cho từng cái - chỉ cần duyệt hoặc bác:

1. **AI key chọn lúc nào?** `useAiKeySelection(dialogVisible && stage ===
"start")` gắn vào state modal cũ, không còn áp dụng. → _đề xuất: load 1
   lần khi panel mở lần đầu trong phiên, khoá lại sau tin nhắn đầu tiên._
2. **Lỗi giữa cuộc chat** → _đề xuất: thành 1 dòng trong luồng chat + nút
   "Thử lại" tại chỗ, giữ nguyên text user đã gõ; bỏ hẳn `stage: "error"`
   toàn màn._ Gồm cả 429, timeout 90s, mất mạng giữa stream.
3. **Hoàn tác một lượt viết** → _đề xuất v1: giữ nguyên `EntryPreviewDialog`
   (diff + Reset) như hiện tại, dòng trạng thái liệt kê field đã viết để biết
   revert cái gì._ Không xây undo per-turn.
4. **User sửa tay rồi chat tiếp** → _đề xuất: thêm luật prompt "không viết
   lại field admin vừa sửa trừ khi được yêu cầu rõ"._ Rẻ, tránh ghi đè bực mình.
5. **Trạng thái "đang soạn"**: bong bóng rỗng + spinner trước delta đầu tiên
   (có ảnh thì chờ vài giây). → _đề xuất: có._
6. **Ngôn ngữ UI**: admin app đang tiếng Anh ("Magic Write", "Cancel",
   "Write") nhưng placeholder ví dụ tiếng Việt và `ai.lang: "vi"`. → _đề xuất:
   chuỗi UI tiếng Anh cho nhất quán, nội dung AI theo `ai.lang`._
7. **Mobile**: panel 24rem → full-screen sheet, composer tránh bàn phím ảo,
   strip ảnh cuộn ngang. → _đề xuất: làm ngay ở Phase A, rẻ hơn nhiều so với
   vá sau._
8. **A11y**: `role="log"` cho danh sách, `aria-live="polite"` CHỈ cho dòng
   trạng thái (không đọc từng delta), bong bóng đang stream để `aria-busy`,
   focus trả về composer sau khi gửi.
9. **"Cuộc trò chuyện mới"**: nút xoá lịch sử để bắt đầu lại mà không phải
   đóng/mở trang. → _đề xuất: có, trong header_ (cũng là hành động "kết thúc
   phiên" ở bảng B).

## Status

Chưa code. Thiết kế đã chốt qua 4 lượt trao đổi (hướng tính năng → rủi ro →
đặc tả UI → 3 điểm chặn). Không còn điểm chặn nào; 9 mục còn lại đều đã có
mặc định, chỉ chờ user bác nếu không đồng ý.

## Speed

- Sẵn sàng code Phase A. Thứ tự đề xuất: protocol (`kind: chat` + khoan dung)
  → khung chat + composer + scroll → luật ẩn/thu nhỏ + nút topbar trạng thái
  → dừng/đóng/phiên mới → ảnh theo lượt → mobile/a11y.

## Phase A - ĐÃ XONG CODE (2026-08-07)

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

## Fix (2026-08-07): rà soát CSS layout + phản hồi UI vòng 1

- **2 xung đột CSS thật phát hiện khi rà soát theo yêu cầu user**: (a)
  `MagicChat.tsx` tự viết `useEffect` set `el.style.height` cho textarea
  composer, trong khi `forms.css:84` đã có `:where(textarea) { field-sizing:
content }` auto-grow thuần CSS cho MỌI textarea trong app - inline style
  từ JS luôn thắng, đá nhau mỗi lần gõ. Xoá hẳn effect + ref, chỉ giữ
  `min-height`/`max-height` để giới hạn. (b) `.magic-chat-bubble` là
  `<button>` trơn nên vẫn dính `padding: 0 0.75rem` từ base `button` rule
  làm icon lệch tâm - thêm `padding: 0` (không dùng class `.icon` có sẵn vì
  nó tự ép `width: 2.25rem`, sẽ đè mất kích thước bubble).
- **User feedback 3 điểm**:
  1. Bỏ nút "✕" (end conversation) - thay bằng nút "Clear all" (EraserIcon,
     đúng convention `<EraserIcon /> Clear all` đã dùng ở
     `ContentEntryEditor.tsx`), disable khi `messages.length === 0`. Khác
     hành vi cũ: KHÔNG đóng panel nữa, chỉ xoá sạch history/messages/ảnh
     đính kèm - về lại empty state ngay trong panel đang mở. `-` (thu gọn)
     giữ nguyên, không đổi.
  2. Bong bóng Magic to hơn: `3.25rem` → `4rem`, `font-size` icon
     `1.375rem` → `1.625rem` theo tỉ lệ. Spinner ring/dot badge giữ nguyên
     kích thước tuyệt đối (vẫn cân đối trên bubble to hơn, không cần đổi).
  3. Bỏ box-shadow ở ô nhập composer - hoá ra không phải chỉ thiếu ở
     `:focus` (đã có `box-shadow:none` sẵn ở đó), mà còn thiếu ở trạng thái
     nghỉ: `:where(input,select,textarea)` gán `box-shadow:
var(--dry-shadow-xs)` mặc định, `:where()` specificity 0 nên property
     nào `.magic-chat-input` không tự set thì vẫn lọt qua - thêm
     `box-shadow: none` ở cấp base rule.
- Typecheck sạch + build sạch + 900 test pass sau cả 2 vòng sửa. Vẫn CHƯA
  test được UI thật trong browser (không có browser tool phiên này).

## Fix (2026-08-07): user gửi screenshot thật - 2 bug thật + 1 UX

User gửi ảnh chụp Magic đang chạy thật - phát hiện được những gì rà soát
tĩnh (đọc code) không thấy ra:

1. **BUG THẬT nghiêm trọng: bong bóng tin nhắn không xếp chồng dọc, bị bóp
   hẹp/word-wrap từng chữ một.** Gốc rễ: `.magic-chat-messages` dùng
   `useOverlayScrollbars` (hook OverlayScrollbars) - hook này DI CHUYỂN các
   con thật của phần tử vào một `.os-viewport` được sinh ra bên trong (đúng
   như doc comment gốc của chính hook đã cảnh báo), nên `display:flex;
flex-direction:column` tôi gán trên `.magic-chat-messages` không còn áp
   dụng đúng chỗ các `.magic-chat-row` nữa - chúng đã bị chuyển xuống 1 cấp.
   `.ai-wizard-body` (list lượt hội thoại tương tự của AI Schema Wizard) đã
   từng gặp đúng dạng vấn đề này và chọn `overflow-y:auto` thuần (không dùng
   hook) - sửa theo đúng tiền lệ đó: bỏ hẳn `useOverlayScrollbars` cho
   `.magic-chat-messages`, thay bằng `ref` thường + tự tính `isNearBottom`/
   `scrollToBottom` trực tiếp qua `scrollTop`/`scrollHeight`. Hệ quả: phần mở
   rộng thêm vào `hooks/overlayscrollbars.ts` (`isNearBottom`, `viewport()`,
   `scrollToBottom` nhận tham số) không còn ai gọi - **trả file về nguyên
   trạng gốc** (qua git show, không sửa tay) thay vì để lại API thừa không
   dùng. Picker ảnh đính kèm (`MagicChatImagePicker`) vẫn dùng hook bình
   thường - không bị bug này vì nội dung bên trong (FileManager) không phụ
   thuộc flex-column layout do component cha set.
2. **Bong bóng tròn bị lộ viền bo góc gốc của trình duyệt (squircle, không
   phải hình tròn).** Không phải lỗi CSS override như đoán ban đầu (đã kiểm
   tra kỹ, `border-radius:50%` áp dụng đúng, không bị ghi đè) - mà là thiếu
   `appearance: none`. Cả app không có chỗ nào reset `appearance` cho
   `<button>` trơn vì mọi nút khác đều là hình chữ nhật bo góc
   (`var(--dry-radius-md)`) nên control chrome gốc của OS/trình duyệt lẫn
   vào không ai nhận ra - đây là nút hình tròn hoàn toàn ĐẦU TIÊN trong app
   nên mới lộ ra. Thêm `appearance:none` + `-webkit-appearance:none`, kèm
   `aspect-ratio:1` phòng hờ.
3. **UX**: bong bóng nổi không còn hiện khi panel đang mở (`{!open && (...
bubble ...)}`) - panel tự nó đã là "chỗ Magic đang ở", hiện cả 2 cùng lúc
   là thừa; nút "-" trong panel đã là đường quay lại trạng thái bong bóng.

- Typecheck sạch + build sạch + 900 test pass. Bài học: rà soát CSS tĩnh
  (đọc code, specificity) bắt được 2 lỗi ở vòng trước, nhưng bug OverlayScrollbars
  - squircle chỉ lộ ra khi NHÌN THẤY ảnh chụp thật - nhắc lại đúng giới hạn
    đã ghi trong "Việc CHƯA làm" #1: không có browser tool thì rủi ro bỏ sót
    loại bug này là thật, không phải lý thuyết.

## Fix (2026-08-07): quay lại dùng OverlayScrollbars cho `.magic-chat-messages`

User chốt: `.magic-chat-messages` vẫn phải dùng scrollbar theo thư viện (đồng
bộ với app-wide rule, xem `feedback_scrollbar_full_coverage` memory), kèm
cảnh báo đúng trọng tâm bug lần trước - thư viện "dựng lại cấu trúc HTML".
Thay vì bỏ cuộc như lần trước, sửa đúng gốc rễ bằng cơ chế chính thức của
OverlayScrollbars (đọc thẳng `node_modules/overlayscrollbars` - source +
README, không đoán): `elements: { viewport: <phần tử tự tạo>, content:
false }`. Khi đó thư viện dùng ĐÚNG phần tử mình cung cấp làm viewport thật
(gắn `data-overlayscrollbars-viewport`, tự quản overflow/scroll) thay vì tạo
`padding`/`viewport`/`content` mới rồi dời con thật xuống 2-3 cấp - gốc rễ
bug cũ.

- **`hooks/overlayscrollbars.ts`**: `useOverlayScrollbars` có thêm
  `viewportRef` (opt-in, mặc định không dùng ai bị ảnh hưởng - 20 call site
  khác trong app giữ nguyên hành vi cũ). Ref này vào một phần tử con thật sự
  nằm trong `ref` (host) TRƯỚC khi effect mount chạy; hook thấy nó liền gọi
  `OverlayScrollbars({ target, elements: { viewport, content: false } },
...)` thay vì `OverlayScrollbars(target, ...)`. Thêm lại `isNearBottom`
  (như bản nháp cũ đã bỏ) nhưng KHÔNG thêm `viewport()` getter như bản nháp
  cũ từng làm - không cần nữa, vì giờ caller đã tự giữ `viewportRef` sẵn, gắn
  listener `scroll` thẳng lên đó được.
- **`MagicChat.tsx`**: `.magic-chat-messages` (ref, host - không còn tự
  scroll) bọc `.magic-chat-messages-viewport` (viewportRef - viewport thật +
  `display:flex;flex-direction:column`, cha trực tiếp của `.magic-chat-row`).
  `isNearBottom`/`scrollToBottom` lấy thẳng từ hook, listener "user tự cuộn
  lên" gắn trên `viewportRef.current`.
- **CSS**: `.magic-chat-messages` chỉ còn `flex/min-height/padding` (không
  `overflow-y`/`overscroll-behavior`/`scrollbar-gutter` nữa - thư viện tự lo,
  đúng tiền lệ `.sidebar-scroll`). `.magic-chat-messages-viewport` là class
  mới, giữ `display:flex;flex-direction:column;gap`.
- **Verify thật trong browser** (Playwright chạy tay qua `bun`, không phải
  MCP browser tool - không có sẵn phiên này): login thật bằng
  `project_drycms_dev_admin_credentials`, mở `/content/blog/new`, đọc DOM
  sau khi mở panel - xác nhận `viewportHasOsViewportAttr: true`,
  `viewportIsDirectChildOfHost: true`, `emptyStateIsDirectChildOfViewport:
true` (không bị dời cấp). Gửi 1 tin nhắn thật, đo `getBoundingClientRect`
  2 row: row 2 `top` = row 1 `top` + `height` + gap - xếp chồng dọc đúng,
  không phải bug cũ (chữ bị bóp/word-wrap từng ký tự). Screenshot xác nhận
  lại bằng mắt.
- ⚠️ Lưu ý cho phiên sau nếu định làm tương tự cho `.ai-wizard-body` (cùng
  cảnh ngộ, xem `status/magic-write.md`/comment cũ) - CHƯA đụng tới, ngoài
  phạm vi yêu cầu lần này (user chỉ nói "ô chat magic").
- Typecheck sạch + build sạch + 900 test pass.

## Fix (2026-08-07): lưu lịch sử chat vào IndexedDB, sống sót qua reload

User chốt: mất khung chat khi reload trang là không chấp nhận được nữa
(khác với risk #8 gốc "v1 chấp nhận mất" - v1 chỉ né localStorage vì
`entry-draft` chiếm chỗ đó, nhưng bản thân entry-draft giờ đã tự chuyển sang
IndexedDB từ trước rồi, xem `entry-draft-db.ts` - lý do gốc để KHÔNG làm coi
như không còn, dùng thẳng IndexedDB, DB riêng để không đụng `entry-draft`).

- **File mới `magic-chat-store.ts`** (cạnh `MagicChat.tsx`, không phải
  `content-types/` - đây là state phiên chat của UI, không phải dữ liệu
  entry): rập khuôn đúng phong cách `content-types/entry-draft-db.ts`
  ("degrade-safely-on-any-failure" - mọi thao tác nuốt lỗi, best-effort) -
  DB `drycms-magic-chat` riêng, KHÔNG có `BroadcastChannel` đồng bộ liên-tab
  như entry-draft (không ai ngoài 1 instance `MagicChat` cần biết phiên đổi).
  Key `magicChatKey` = `${typeSlug}:${entryId ?? "__new__"}`, y hệt quy ước
  `__new__` của `draftKey`.
  - Cũng là nơi giữ type `ChatBubble`/`MagicChatHistoryMessage`/
    `MagicChatEncodedImage` luôn (dời từ `MagicChat.tsx` sang) - module lưu
    trữ là nơi hợp lý nhất để định nghĩa "một phiên lưu được gồm những gì".
- **`MagicChat.tsx`**: 2 effect mới.
  1. Nạp lại khi mount/đổi `[typeSlug, entryId]` - reset state trắng TRƯỚC
     (tránh lóe lịch sử của entry cũ khi chuyển entry mà component không bị
     unmount), rồi load async. KHÔNG tự mở panel (`open` giữ nguyên) - chấm
     đỏ có sẵn trên bong bóng đã đủ báo hiệu, tự bung panel mỗi lần reload
     sẽ phiền.
  2. Lưu lại mỗi khi `messages` đổi (debounce 300ms trong store, giống
     `saveEntryDraft`), guard `messages.length === 0` để không tự ghi đè
     phiên thật bằng mảng rỗng lúc effect #1 mới reset xong, chưa load kịp.
  - `idRef` (bộ đếm `magic-${n}`) lưu kèm thành `nextId` - thiếu cái này thì
    tin nhắn mới sau khi phục hồi dễ trùng `id` với tin nhắn cũ, vỡ React key.
  - **Bẫy phát hiện qua Playwright, không phải suy luận tĩnh**: bong bóng
    assistant còn `streaming:true` lúc reload xảy ra (request chết theo
    trang, không gì resolve nó nữa) - nếu chỉ đổi `streaming:false` thì CHƯA
    đủ: `MagicChatBubbleView` hiện chấm "đang gõ" dựa trên `text` RỖNG hay
    không, không dựa trên `streaming` - đóng băng một bong bóng rỗng vẫn hiện
    "đang gõ" MÃI MÃI. Sửa: rỗng → đổi hẳn thành dòng trạng thái
    "Interrupted." (cùng quy ước "Stopped." của nút Dừng có sẵn); có chữ rồi
    → giữ nguyên chữ, chỉ tắt `streaming`.
  - `clearAllNow()` gọi thêm `discardMagicChatSession` - "Clear all" xoá cả
    IndexedDB, không chỉ state trong RAM.
- **Verify thật qua Playwright** (login thật, gửi 1 tin nhắn, đợi qua
  debounce, `page.reload()`): 2 row phục hồi đúng nội dung, panel KHÔNG tự
  mở, chấm đỏ có hiện, không còn "đang gõ" bị kẹt. "Clear all" rồi reload →
  0 row, xác nhận discard xuyên suốt.
- Typecheck sạch + build sạch + 900 test pass.

## Phase B: `kind: fetch` + AI có thể chọn ref/refs (relation) - 2026-08-06/07

User yêu cầu code thẳng `kind: fetch` (đã thiết kế sẵn ở quyết định #5, chưa
làm) **cộng thêm** khả năng AI tự chọn giá trị cho field `relation`
("ref"/"refs") - trước giờ field này luôn bị loại khỏi Magic (decision #2 gốc:
"relation/relation-mirror... never a write target"), vì không có cách nào an
toàn để AI biết ID nào hợp lệ. `kind: fetch` gỡ đúng nút thắt đó: AI tra cứu
được danh sách entry thật trước khi chọn.

### `kind: fetch` - tra cứu dữ liệu NỘI BỘ drycms (không phải internet)

- **`ai-magic-write-protocol.ts`**: thêm `MagicWriteFetchTurn` (`source:
"entries"|"entry"|"media"|"types"` + `typeSlug`/`id`/`search`/`path`, toàn
  scalar phẳng - không cần đổi parser YAML-subset chung, `parseMapping` vốn
  đã đọc được `key: value` bất kỳ). `validateFetchTurn` theo đúng khuôn
  `validateQuestionTurn`. Đây là turn KHÔNG BAO GIỜ terminal.
- **File mới `server/routes/ai-magic-write-fetch.ts`** (`executeMagicFetch`):
  - `source: entries/entry` - chạy lại `checkAccess` với action `"view"`
    (KHÔNG mượn quyền `"update"` của entry đang mở) cho ĐÚNG type được hỏi.
    `password`/`secretkey` không cần tự lọc tay - `entryAdapter.getEntry`/
    `listEntries` đã tự mask thành `{hasExisting}` ngay ở tầng engine
    (`entry-codec.ts`'s `rowToValue`, dùng chung mọi caller) - `formatRow`
    chỉ in string/number/boolean nên marker bị bỏ qua tự nhiên. KHÔNG BAO GIỜ
    gọi `getRawEntry` (hàm duy nhất cố tình bỏ qua mask).
  - `source: media` dùng `storageAdapter.list()` (không phải `listNames()` -
    optional trên interface, `list()` luôn có).
  - `source: types` liệt kê tên/label/kind mọi content type không phải
    component.
  - Test thật với sqlite tạm (theo đúng khuôn `content-entries.test.ts`,
    KHÔNG mock adapter) - kể cả case "session không có quyền view" và case
    "secretkey không bao giờ lọt vào resultText".
- **`ai-magic-write.ts`**: vòng lặp cũ (`for attempt < 3` retry sai dialect)
  tách thành 2 ngân sách riêng - `dialectAttempt` (dialect sai, như cũ, vẫn
  cap 3) và `fetchHops` (cap 3, riêng - lượt fetch sạch nhưng không chịu trả
  lời cuối không được đốt chung ngân sách với lượt sai dialect). Tổng vòng
  lặp có trần cứng `3+3=6` bất kể tổ hợp nào. Khi gặp `kind: fetch`: chạy
  `executeMagicFetch`, gom `seenEntryIds` vào `allowedRelationIds` (Map
  `targetTypeId -> Set<id>`), bắn SSE `{fetching: label}` (KHÔNG đóng
  stream), nhét kết quả thành message `user` giả rồi gọi lại model.
- **`MagicChat.tsx`**: `requestMagicTurn` thêm callback `onFetching` (reset
  `rawTextRef` như `onRetry`, cộng thêm đẩy 1 bong bóng `role:"status"` hiện
  `label`).

### AI chọn "ref"/"refs" (relation) - mở khoá nhờ `kind: fetch`

- **`isMagicChatCandidate`**: bỏ loại `relation` (giữ nguyên loại
  `relation-mirror` - mirror vẫn read-only, ghi qua nó cần cơ chế
  claim/unclaim của field gốc, không phải việc của Magic).
- **`ai-magic-write-fields.ts`**: `applyMagicWriteFields` thêm tham số
  `allowedRelationIds` (mirror hệt `allowedImageSrcs`) - một ID CHỈ được ghi
  nếu nó nằm trong tập `kind: fetch` đã thực sự trả về **trong lượt này**
  (KHÔNG cộng dồn qua nhiều lượt như ảnh - tra cứu lại rẻ, không như gửi lại
  ảnh). Dây `manyToOne` = 1 scalar số (`category: 12`); `oneToMany`/
  `manyToMany` = list số cách nhau dấu phẩy (`tags: 12,45,88`) - **cố tình
  KHÔNG dùng block sequence** như `component-repeat`, để khỏi đụng vào parser
  chung.
- **`ai-magic-write-prompt.ts`**: `describeNode` thêm nhánh `relation` (chỉ
  `relation-mirror` mới bị loại); `CAPABILITY_INSTRUCTION` cập nhật (bỏ "no
  other entries", giữ nguyên "no web access"); `buildMagicWriteSystemPrompt`
  thêm mục `4. kind: fetch` + hướng dẫn cách ghi relation ngay trong ví dụ
  `kind: fields`.

### 2 bug thật, chỉ lộ ra khi chạy thật (không phải đọc code)

1. **`targetTypeId` (id nội bộ, vd `"app-category"`) ≠ `typeSlug` mà
   `kind: fetch` thật sự khớp (`ContentTypeDefinition.name`, vd
   `"category"`)** - phát hiện qua smoke test THẬT (curl + Google
   `gemini-3.5-flash` thật): model gửi `kind: fetch typeSlug: app-category`
   trước (sai, tốn 1 hop), tự sửa thành `category` ở hop sau nhờ đúng thông
   điệp lỗi có gợi ý "Available: ...". Hệ thống KHÔNG gãy (cơ chế tự sửa lỗi
   hoạt động đúng như thiết kế) nhưng phí 1 hop - sửa gốc: `describeNode`
   giờ resolve `targetTypeId -> tên thật` qua `allTypes` (tham số mới của
   `describeFieldsForPrompt`) rồi in đúng chữ `typeSlug "category"` - khớp y
   hệt field mà `kind: fetch` cần. Chạy lại smoke test: model vẫn thỉnh
   thoảng đoán sai lần đầu (bản chất xác suất của LLM, không phải bug - đã
   thử 2 lần, cả 2 đều tự sửa đúng ở hop 2) - cơ chế phục hồi mới là điều đảm
   bảo, không phải kỳ vọng model đúng ngay lần đầu.
2. **BUG THẬT nghiêm trọng, chỉ thấy khi bấm thử trên UI**: `applyMagicWriteFields`
   ghi relation ID dạng **số thô** (khớp tầng engine - `rowToValue`/
   `entries.getEntry` đều trả `target_id` dạng number thật) nhưng
   `RelationFieldAdapter` (`FieldRenderer.tsx`) chỉ nhận **string đã hash**
   (`typeof value === "string" ? value : ""` - number lọt qua thành `""`,
   tức "No items selected." dù AI đã "ghi" xong). Lý do: MỌI relation value
   trong app đã được hash ở biên HTTP từ trước (`content-entries.ts`'s
   `encodeRelationIds`/`decodeRelationIds`, chạy trên mọi GET/POST/PUT) -
   `EntryValue` phía client LUÔN là string hash, chưa từng là number thô.
   Sửa: `coerceRelation` gọi `encodeEntryId` (từ `lib/id-hash.ts`, thuần, an
   toàn import ở module framework-agnostic) ngay bước cuối, sau khi đã xác
   nhận ID nằm trong `allowedRelationIds` (allow-list vẫn giữ number - chỗ
   duy nhất đổi sang string là giá trị TRẢ VỀ). Wire format model viết không
   đổi gì (vẫn số thô, khớp đúng những gì `kind: fetch` cho nó thấy) - việc
   encode là chi tiết triển khai ẩn, model không cần biết.
   Bài học lặp lại đúng như 2 bug OverlayScrollbars/squircle ở trên: đọc code
   tĩnh (kể cả đọc rất kỹ, đã trace đúng luồng `rowToValue`) không bắt được
   loại lỗi "hai tầng dùng hai quy ước biểu diễn khác nhau cho cùng 1 khái
   niệm" - phải bấm/gọi thật mới lộ ra.

- Typecheck sạch + build sạch + 927 test pass (thêm test cho cả 2 file mới/
  sửa, gồm test riêng xác nhận giá trị trả về là `encodeEntryId(...)` chứ
  không phải number thô).
- **Việc CHƯA làm / ngoài phạm vi lần này**: chưa verify lại bằng Playwright
  thật trên UI sau bug #2 (đang bị Google free-tier rate-limit "20
  requests/..." sau nhiều lần smoke test liên tục trong phiên - đã xác nhận
  qua curl là SSE trả đúng string hash, nhưng chưa xác nhận bằng mắt
  `RelationFieldAdapter` hiện đúng chip trong panel Category thật). Chưa đụng
  `.ai-wizard-body`/schema wizard (không liên quan, ngoài yêu cầu).
