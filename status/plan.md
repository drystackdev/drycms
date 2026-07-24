# Thư viện drycms dành riêng cho astro

- Dựa trên thư viện preact
- css gobal nằm bên trong class="dry" ở body
- css dựa trên các thẻ các attr thuộc tính để css (gióng cách picocss làm nhưng phong cách gióng UI của shacdn/ui)

# Cách dùng với astro (chỉ astro)

- ở file `astro.config.mjs` dùng integrations: [dry()]
- có option để cài dạng 
```
type DryOption {
    path?: string = "/dry"
}
```
- Khi vào trang `/dry` (dựa trên path) tự động di chuyển đến `/dry/dashboard`