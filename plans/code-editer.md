# Xây dựng Editer từ prism-code-editor (https://prism-code-editor.netlify.app/)

## Mục tiêu

Chỉ tập trung xây **1 component Editer** (editor TSX/Preact + type-check +
suggestion). Không quan tâm nơi gọi dùng nó để làm gì (ghi file, preview...)
- việc đó là chuyện của nơi gọi, plan riêng khi tới lúc.

### API bề mặt (props)

- `value: string` - code hiện tại (controlled).
- `onChange: (result: EditerResult) => void` - xem shape bên dưới.
- `extraFiles?: Record<string, string>` - path -> nội dung `.tsx`/`.ts`
  khác, nạp vào virtual FS (xem mục 2).

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
- `errors` **chỉ tính cho file đang gõ (`value`), không tính cho
  `extraFiles`**: `extraFiles` chỉ đóng vai trò ambient reference nạp vào
  virtual FS (mục 2), không tự sinh diagnostics riêng hiển thị ra ngoài -
  cần chốt rõ vì `EditerDiagnostic` không có field `file` để phân biệt lỗi
  thuộc file nào, nếu tính cả `extraFiles` sẽ mơ hồ ngay.
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

### 4. Tailwind class suggestion: dùng thẳng `tailwindcss` core, không phải `@tailwindcss/browser`

**Đã sửa lại sau khi đọc thật type definitions của package (bản nháp trước
chọn nhầm)**: `@tailwindcss/browser` (đã gỡ khỏi deps) chỉ là 1 bundle IIFE
tự chạy (`index.global.js`, không export gì) - việc chính của nó là tự
theo dõi `document` bằng `MutationObserver` rồi tự tiêm `<style>`, không hề
có API enumerate/validate class name nào cả. Không phải công cụ đúng cho
suggestion.

Công cụ đúng là chính package `tailwindcss` core (v4, đã cài) qua API
`__unstable__loadDesignSystem(css, opts): Promise<DesignSystem>` - đây
chính là API mà Tailwind CSS IntelliSense (extension VSCode chính thức)
dùng để build autocomplete. `DesignSystem.getClassList(): [string,
ClassMetadata][]` trả ra thẳng danh sách toàn bộ utility class hợp lệ -
đúng thứ suggestion cần, không phải tự tổng hợp/generate gì thêm:
- Gọi 1 lần: `__unstable__loadDesignSystem('@import "tailwindcss";')` để
  lấy **full theme mặc định** cho v1 (chưa khớp `tailwind.config`/`@theme`
  thật của site người dùng - để sau, làm riêng).
- `getClassList()` cho ngay danh sách class thuần/mặc định để filter theo
  prefix đang gõ - không cần tự sinh arbitrary value hay custom variant gì
  thêm (`getVariants()` cũng có sẵn nếu sau này cần suggest cả biến thể
  `hover:`/`focus:`...).
- Chạy hoàn toàn programmatic (Promise-based), không đụng `document` -
  dùng thẳng trong Worker ở mục 2 luôn được, không cần DOM/host ẩn nào,
  không có rủi ro multi-instance như bản nháp @tailwindcss/browser trước
  lo ngại.

**Không cần xuất CSS thật ra ngoài**: chỉ cần danh sách class cho
suggestion, không compile CSS thật cho code đang gõ - việc đó (nếu cần)
thuộc build pipeline thật của site sau này, không phải việc của Editer.

### 5. Demo page riêng, KHÔNG gắn vào Showcase

Chỉ mượn kỹ thuật route lazy-load riêng của `RichTextDemo.tsx` (không kéo
theo Showcase khi không cần), **không** gắn vào Showcase theo cách nào cả -
không thêm tab/mục trong Showcase, không có nút qua lại giữa 2 trang:
- Route riêng kiểu `/code-editer-demo`, lazy import trong `routers/App.tsx`,
  độc lập hoàn toàn với Showcase.
- Nội dung demo: gõ TSX tự do, thấy suggestion type + suggestion Tailwind
  class + báo lỗi syntax trực tiếp; có thể hiện luôn `EditerResult` (mục
  Mục tiêu) dạng raw để dễ kiểm tra khi build.

### 6. Styling: full panel kiểu VSCode, Shadow DOM thật ngay từ đầu

- Editer là **full panel lấp đầy container cha** (giống panel code trong
  VSCode) - không border-radius, không tự vẽ border/card bao quanh; kích
  thước/vị trí do nơi đặt nó quyết định, Editer không tự "đóng khung" mình.
  Đây là style của **element host ở light DOM** (do Editer tự dựng, size
  100%/100%), khác với shadow root ở dưới.
- **Đã sửa lại sau khi đọc thật source của `prism-code-editor` (bản nháp
  trước định tự tay làm, thừa)**: `prism-code-editor/setups`'s
  `basicEditor()`/`minimalEditor()` **đã tự mount vào Shadow DOM sẵn** -
  `el.shadowRoot || el.attachShadow({ mode: "open" })`, đúng ngay cái bẫy
  HMR đã lo (an toàn khi gọi lại), tự load layout+theme CSS async và tiêm
  `<style>` vào trong shadow root đó. Không cần tự viết
  `attachShadow`/`content-shadow-styles.ts` như RichTextField nữa - dùng
  thẳng `basicEditor(container, { theme, language: "tsx", value, ... })`.
- Vẫn theo đúng tinh thần "chỉ vùng soạn code nằm trong shadow root, chrome
  xung quanh ở light DOM" - vì đó chính xác là cách `basicEditor` hoạt động
  (nó chỉ shadow hoá `editor.container`, panel `errors`/toolbar do Editer
  tự dựng bên ngoài vẫn ở light DOM, dùng style chung của app).

## Ngoài phạm vi (plan khác lo)

- API ghi file thật cho bất kỳ nơi gọi nào cần (đăng ký component tuỳ biến
  hay tương tự) - tự thiết kế riêng khi plan lại nơi gọi đó.
- Đọc `tailwind.config`/`@theme` thật theo từng site (v1 dùng full theme
  mặc định).
- Cross-file auto-discovery không qua prop tường minh.
