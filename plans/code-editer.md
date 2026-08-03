# Xây dựng Editer từ prism-code-editor (https://prism-code-editor.netlify.app/)

## Mục tiêu

Chỉ tập trung xây **1 component Editer** (editor TSX/Preact + type-check +
suggestion). Không quan tâm nơi gọi dùng nó để làm gì (ghi file, preview...)
- việc đó là chuyện của nơi gọi, plan riêng khi tới lúc.

### API bề mặt (props)

- `value: string` - code hiện tại (controlled).
- `onChange: (result: EditerResult) => void` - xem shape bên dưới.
- extra type files (string[]/record) - xem mục 2.

### Shape của `EditerResult` (trả ra từ `onChange`, không chỉ trả code string)

```ts
interface EditerResult {
  code: string; // nội dung hiện tại, giống value cũ
  success: boolean; // true khi KHÔNG có syntax error (type error không chặn success)
  errors: EditerDiagnostic[]; // rỗng khi success = true
}

interface EditerDiagnostic {
  message: string;
  line: number;
  column: number;
  length: number;
  source: "syntax" | "type"; // phân biệt lỗi cú pháp (chặn) vs lỗi type (chỉ cảnh báo)
}
```

- `success` chỉ phụ thuộc lỗi `syntax` (code parse được, transpile/eval được)
  - lỗi `type` vẫn liệt kê trong `errors` để hiển thị nhưng không làm
  `success` thành `false`, vì nơi gọi có thể vẫn muốn chạy preview code dù
  còn lỗi type.
- Field cụ thể có thể chỉnh lại khi code thật (vd thêm `warnings` riêng nếu
  cần) - đây là bản nháp shape để thống nhất hướng trước khi build.

## Quyết định kiến trúc

### 1. Engine: prism-code-editor, không dùng Monaco

Từng có bản nháp nhắc tới Monaco (có sẵn TS IntelliSense) nhưng đã chốt lại
dùng **prism-code-editor** - nhẹ, dễ style khớp design system riêng của
drycms, đổi lại phải tự build phần type-check/suggestion (mục 2-3) thay vì
có sẵn.

### 2. Type suggestion: virtual FS + extra files truyền tường minh

Không tự động discover/theo dõi file khác trong project (không cần file
watcher đồng bộ real-time với server). Thay vào đó Editer nhận thêm prop
kiểu string chứa nội dung `.tsx`/`.ts` khác (vd nội dung 1 component/type
dùng chung), nạp vào virtual FS của TS Language Service - nhờ vậy code đang
gõ "biết" các type/export đó tồn tại (autocomplete + type-check thấy được)
mà không cần đọc file thật trên đĩa.

- Chạy `typescript` (đã có sẵn ở devDependencies, giờ cần chạy được ở
  runtime browser) qua `ts.createLanguageService` trong **Web Worker** -
  type-check nặng, không được chặn main thread.
- Virtual FS tối thiểu cần: lib.d.ts liên quan (dom, es2020...), types của
  `preact` (JSX namespace riêng, không dùng React types), file đang gõ, và
  các extra file được truyền vào qua prop.
- Cần debounce request lên worker (không type-check/suggest mỗi keystroke).

### 3. Bắt lỗi syntax: dùng `typescript` parser, KHÔNG dùng Sucrase

Trả lời câu hỏi gốc trong plan: Sucrase không dùng được cho việc này.
Sucrase là transform tốc độ cao dựa trên quét token, không dựng AST/binder
thật, không phân tích ngữ nghĩa - không phải validator, có thể transform sai
lệch âm thầm với code không hợp lệ thay vì báo lỗi. Sucrase chỉ hợp cho bước
"transpile để chạy preview nhanh" (tương tự `@babel/standalone` mà
`EditableDemo` đang dùng), không hợp cho bắt lỗi syntax hay suggestion type.

Bắt lỗi syntax dùng chính `ts.createSourceFile` + đọc `.parseDiagnostics`
của source file đó - rẻ hơn nhiều so với chạy full semantic diagnostics của
language service, dùng ngay trong cùng Worker ở mục 2.

### 4. Tailwind class suggestion: chỉ tailwind thuần, không tự sinh gì thêm

Không dùng danh sách class tự chế. Cài `@tailwindcss/browser` (package
chính thức Tailwind v4 dành cho chạy trong browser, compile qua WASM) và lấy
**full theme mặc định** cho v1 - chưa cần khớp `tailwind.config`/`@theme`
thật của site người dùng. Cơ chế đọc theme thật của từng site để sau, làm
riêng.

**Đã chốt lại phạm vi, bỏ rủi ro "tự sinh candidate" từng nêu ở bản trước**:
chỉ hỗ trợ suggestion cho class Tailwind thuần/mặc định của package (utility
class có sẵn), không tự sinh biến thể/candidate đặc biệt nào (không tự ghép
arbitrary value dạng `w-[137px]`, không tự suy luận custom variant...). Nhờ
vậy không cần tự đọc `theme` object rồi tự tổng hợp danh sách như lo ngại
trước - chỉ cần lấy đúng danh sách utility class package expose sẵn.

### 5. Demo page riêng

Theo đúng pattern `RichTextDemo.tsx` đang có (route lazy-load riêng, không
kéo theo Showcase khi không cần):
- Route riêng kiểu `/code-editer-demo`, lazy import trong `routers/App.tsx`.
- Có nút quay lại Showcase (như RichTextDemo).
- Nội dung demo: gõ TSX tự do, thấy suggestion type + suggestion Tailwind
  class + báo lỗi syntax trực tiếp; có thể hiện luôn `EditerResult` (mục
  Mục tiêu) dạng raw để dễ kiểm tra khi build.

### 6. Styling: full panel kiểu VSCode, Shadow DOM thật ngay từ đầu

- Editer là **full panel lấp đầy container cha** (giống panel code trong
  VSCode) - không border-radius, không tự vẽ border/card bao quanh; kích
  thước/vị trí do nơi đặt nó quyết định, Editer không tự "đóng khung" mình.
- **Quyết định: dùng Shadow DOM thật ngay từ đầu**, không chỉ reset CSS suông
  - theo đúng pattern đã có ở `RichTextField` (`useRichTextEditor.ts` +
  `content-shadow-styles.ts`):
  - Chỉ vùng soạn code thật (text/highlight/gutter) nằm trong shadow root;
    phần chrome xung quanh (nếu có toolbar, panel liệt kê `errors` từ
    `EditerResult`, dropdown suggestion...) vẫn ở light DOM dùng style
    chung của app - giống RichTextField chỉ shadow `.richtext-content`,
    không shadow toolbar/menu/dialog.
  - `attachShadow({ mode: "open" })` trên 1 mount element riêng, rồi tự viết
    1 file style constant kiểu `content-shadow-styles.ts` (TS string, không
    file `.css` riêng - đúng convention RichText đang dùng) tiêm vào qua
    `<style>` trong shadow root.
  - Vẫn giữ dòng đầu tiên của stylesheet đó là
    `*, *::before, *::after { all: unset }` (hoặc `all: initial`) - vì
    Shadow DOM chỉ chặn được **rule CSS ngoài nhắm theo selector**, còn các
    property có tính kế thừa (font, color, line-height...) vẫn xuyên qua
    ranh giới shadow từ computed style của host element, nên vẫn cần reset
    ở dòng đầu để chặn luôn phần đó - 2 việc bổ trợ nhau, không thay thế.
  - **Bẫy HMR cần nhớ** (đã gặp thật ở RichTextField): shadow root là vĩnh
    viễn với 1 host element - gọi `attachShadow()` lần 2 trên cùng element
    sẽ throw. Vite HMR có thể remount hook trên cùng host element, nên
    phải viết kiểu `mountEl.shadowRoot ?? mountEl.attachShadow(...)` rồi
    `shadowRoot.replaceChildren()` trước khi mount lại, không gọi thẳng
    `attachShadow()` mỗi lần.

## Ngoài phạm vi (plan khác lo)

- API ghi file thật cho bất kỳ nơi gọi nào cần (đăng ký component tuỳ biến
  hay tương tự) - tự thiết kế riêng khi plan lại nơi gọi đó.
- Đọc `tailwind.config`/`@theme` thật theo từng site (v1 dùng full theme
  mặc định).
- Cross-file auto-discovery không qua prop tường minh.
