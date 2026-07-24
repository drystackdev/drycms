# Kế hoạch thực hiện - drycms

> Nguồn yêu cầu: [plan.md](plan.md)
> Môi trường đã xác minh: Astro `7.1.3`, `preact 10.29.7`, `@astrojs/preact 6.0.1`, bun workspace, `packages/` đang trống.

## Bổ sung sau khi chốt kế hoạch

- **Icon**: Solar (Iconify) ưu tiên, Lucide dự phòng. Inline lúc build qua
  `scripts/build-icons.mjs` đọc `icons.config.json` → sinh `src/components/icons.tsx`.
  Không có runtime dependency, không gọi Iconify API. Thêm icon: sửa manifest rồi
  `bun run build:icons`.
- **Màu**: đổi từ shadcn/oklch sang palette Minimals (minimals.cc). Grey ramp,
  secondary/info/success/warning/error lấy trực tiếp từ `theme-config.ts` của repo
  `minimal-ui-kit/material-kit-react`. Primary dùng xanh `#00A76F` (preset mặc định
  của minimals.cc) chứ không phải `#1877F2` của material-kit - xem ghi chú ở dưới.
- **Trang `/dry/showcase`**: 28 demo, menu 6 nhóm có scrollspy, mỗi demo kèm code mẫu.

## Tình trạng (cập nhật 2026-07-24)

P0–P5 **đã hoàn thành**, trừ những mục ghi rõ bên dưới.

- ✅ P0 workspace, ✅ P1 integration, ✅ P2 CSS, ✅ P3 layout + dashboard
- ✅ P4: `ThemeToggle`, `SidebarToggle`, `DataTable`. **Chưa làm**: `Dialog`,
  `Toast`, `CommandPalette` - dashboard hiện không cần chúng, thêm sau khi có
  luồng chỉnh sửa nội dung thật.
- ✅ P5: 17 unit test cho `resolveOptions()` + hook `astro:config:setup`, README.
  **Chưa làm**: test render `DryLayout` bằng Container API và test e2e trình duyệt.

Phát sinh ngoài kế hoạch: `@astrojs/preact` là dependency của `drycms` nên bare
specifier của renderer không resolve được từ root project, và entrypoint của
renderer bị SSR externalize nên vite alias không có tác dụng. Đã xử lý bằng cách
resolve entrypoint thành đường dẫn tuyệt đối ngay trước khi gọi `addRenderer`
(`absolutizeRenderer` trong [integration.ts](../packages/drycms/src/integration/integration.ts)),
cộng thêm plugin lọc các mục `optimizeDeps.include` dạng `@astrojs/preact > …`.

## 1. Kiến trúc tổng thể

Tách monorepo: `packages/drycms` là thư viện được publish, repo root trở thành **app demo/playground** dùng thư viện qua `workspace:*`.

```
drycms/
├── package.json                 # thêm "workspaces": ["packages/*"], dep drycms: workspace:*
├── astro.config.mjs             # integrations: [dry()]  ← app demo
├── src/pages/index.astro        # trang landing demo
└── packages/drycms/
    ├── package.json             # name: drycms | exports: ".", "./styles.css", "./routes/*", "./components"
    ├── src/
    │   ├── index.ts             # export default dry(); export type DryOption
    │   ├── integration/
    │   │   ├── integration.ts   # AstroIntegration factory (hook astro:config:setup / :done)
    │   │   ├── options.ts       # DryOption + resolveOptions() + normalizePath()
    │   │   └── virtual.ts       # vite plugin: virtual:drycms/config
    │   ├── routes/              # .astro được injectRoute (ship raw, không build)
    │   │   ├── index.astro      # redirect → {path}/dashboard
    │   │   └── dashboard.astro
    │   ├── layouts/DryLayout.astro   # <body class="dry"> + import styles
    │   ├── components/          # island Preact (.tsx)
    │   └── styles/              # CSS design system
    └── dist/                    # chỉ build phần integration (tsc)
```

**Quyết định then chốt**

| Vấn đề                                    | Chọn                                                                                  | Lý do                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Renderer Preact                           | `dry()` tự `addRenderer` bằng cách gọi nội bộ `@astrojs/preact`, có guard chống trùng | User chỉ cần khai báo `dry()` đúng như spec     |
| File `.astro`/`.tsx` trong `node_modules` | Ship raw + `vite.ssr.noExternal: ['drycms']`                                          | Vite phải compile chúng, không được externalize |
| Redirect `/dry` → `/dry/dashboard`        | `updateConfig({ redirects })`                                                         | Hoạt động cả static lẫn SSR, không cần adapter  |
| Truyền `path` xuống route                 | Virtual module `virtual:drycms/config`                                                | Route inject không nhận props được              |
| Scope CSS                                 | Native CSS nesting trong `.dry { … }`                                                 | Không cần build step PostCSS riêng              |

## 2. Các giai đoạn

### P0 - Scaffold workspace

- Thêm `workspaces` vào `package.json` root, tạo `packages/drycms/package.json` (`peerDependencies: astro >=7, preact >=10`; `dependencies: @astrojs/preact`).
- `exports` map: `"."` → `dist/index.js`, `"./styles.css"` → `src/styles/index.css`, `"./routes/*"`, `"./layouts/*"`, `"./components"`.
- Script build: `tsc -p tsconfig.build.json` (chỉ `src/integration` + `src/index.ts`), `files: ["dist", "src"]`.
- Root `package.json` thêm `"drycms": "workspace:*"`, chạy `bun install`.

**DoD:** `bun install` link được symlink, `import dry from 'drycms'` resolve OK.

### P1 - Integration core

```ts
export interface DryOption {
  path?: string;
} // default "/dry"
```

Trong `astro:config:setup`:

1. `resolveOptions()` - chuẩn hóa `path`: ép leading `/`, bỏ trailing `/`, lowercase; throw lỗi rõ ràng nếu `path` rỗng hoặc chứa ký tự route param.
2. `addRenderer` Preact - dò `config.integrations.some(i => i.name === '@astrojs/preact')` trước khi tự đăng ký để tránh double-render.
3. `injectRoute({ pattern: `${path}/dashboard`, entrypoint: 'drycms/routes/dashboard.astro' })`.
4. `updateConfig({ redirects: { [path]: `${path}/dashboard` } })` - spec mục "vào `/dry` tự chuyển tới `/dry/dashboard`".
5. `updateConfig({ vite: { plugins: [dryVirtualConfig(resolved)], ssr: { noExternal: ['drycms'] } } })`.
6. `astro:config:done` → `injectTypes()` khai báo module `virtual:drycms/config`.

**DoD:** `astro dev --background`; `/dry` → 302 tới `/dry/dashboard`; trang render; `astro build` (static) không lỗi.

### P2 - Design system CSS (khối lượng lớn nhất)

Toàn bộ selector nằm trong `.dry`, style theo **thẻ + attribute** (kiểu Pico) nhưng ngôn ngữ thị giác **shadcn/ui**.

- `tokens.css` - biến shadcn: `--background --foreground --card --popover --primary --secondary --muted --accent --destructive --border --input --ring --radius`, ở `.dry` (light) và `.dry[data-theme="dark"]` + `@media (prefers-color-scheme: dark)`.
- `base.css` - reset nhẹ, typography `h1–h6, p, a, small, code, pre, kbd, hr, blockquote, ul/ol`, `table/thead/tbody/th/td`.
- `forms.css` - `input, select, textarea, label, fieldset, legend` + trạng thái `[aria-invalid]`, `[disabled]`, `[readonly]`, `:focus-visible` (ring theo `--ring`), `[type="checkbox"] [type="radio"] [type="range"] [type="file"]`.
- `components.css` - API attribute:
  - `button`, `a[role="button"]` + `[variant="default|secondary|destructive|outline|ghost|link"]`, `[size="sm|default|lg|icon"]`, `[aria-busy]`
  - `[data-card] > header/footer`, `[data-badge][variant]`, `[data-alert][variant]`, `[data-separator]`, `[data-skeleton]`, `[data-avatar]`
  - `dialog`, `details/summary` (accordion), `nav`, `[role="tablist"] > [role="tab"][aria-selected]`, `[data-tooltip]`
- `index.css` - `@layer dry.tokens, dry.base, dry.forms, dry.components, dry.utilities` để consumer dễ override.

**DoD:** trang `/dry/kitchen-sink` (chỉ dev) render mọi thẻ/biến thể; kiểm tra tương phản AA light + dark; xác nhận CSS không rò rỉ ra ngoài `.dry`.

### P3 - Layout & dashboard shell

- `DryLayout.astro`: `<body class="dry" data-theme={...}>`, `import 'drycms/styles.css'`, slot `sidebar`/`header`/`default`, đọc `path` từ `virtual:drycms/config` để sinh link đúng khi user đổi `path`.
- `dashboard.astro`: sidebar nav + topbar + grid stat card, dùng thuần CSS ở P2.

**DoD:** đổi `dry({ path: '/admin' })` → mọi link nội bộ và redirect vẫn đúng, không hardcode `/dry`.

### P4 - Preact islands

Chỉ island hóa phần thật sự tương tác: `ThemeToggle`, `SidebarToggle` (mobile), `Dialog`, `Toast`, `DataTable` (sort/filter/paginate), `CommandPalette`. Dùng `client:load`/`client:idle` hợp lý; state qua `@preact/signals` (đã là dep của `@astrojs/preact`).

**DoD:** island hydrate được trong app demo; SSR không cảnh báo mismatch.

### P5 - Kiểm thử & DX

- Vitest + Astro Container API: unit test `resolveOptions()`, snapshot render `DryLayout`.
- Test tích hợp: build app demo với `path` mặc định và `path` tùy chỉnh, assert route/redirect tồn tại trong `dist`.
- `packages/drycms/README.md` + cập nhật `AGENTS.md` (lệnh build package).

## 3. Rủi ro đã lường trước

1. **`.astro` trong `node_modules`** - nếu quên `ssr.noExternal`, build SSR sẽ vỡ. Chốt ngay ở P1.
2. **Trùng renderer Preact** khi user đã có `@astrojs/preact` - xử lý bằng guard ở P1 bước 2.
3. **Redirect ở static build** phát ra HTML meta-refresh; nếu cần 302 thật thì phải có adapter. Ghi rõ trong README.
4. **CSS nesting** cần trình duyệt/target hiện đại - Vite 8 xử lý được, nhưng nếu cần hỗ trợ cũ hơn thì thêm lightningcss.
5. **`path` xung đột** với route sẵn có của user - log cảnh báo qua `logger.warn`.

## 4. Câu hỏi cần chốt trước P4

- **drycms quản trị cái gì?** Content Collections của Astro (đọc/ghi file MD) hay DB riêng? Việc này quyết định có cần adapter SSR + API routes hay không.
- **Xác thực** cho `/dry`: bỏ ngỏ cho user tự làm middleware, hay thư viện cung cấp sẵn?
- **Dark mode**: theo `prefers-color-scheme` hay bắt buộc chọn qua `data-theme`?

P0–P3 không phụ thuộc các câu trả lời này nên có thể triển khai ngay.
