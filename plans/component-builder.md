**Đây là tài liệu về component builder**
Các cái cũ là bảng nháp trước đó là sai (lỗi thời hông áp dụng cho kế hoạch này)

# Kế hoạch xây trang component

- Lưu các file code .tsx thành các file giống cơ chế lưu file của icons
- Lưu thư mục tên là .dry/components (.dry/ thêm vào gitigore)

## Trang UI 

- UI chi làm 2 row: 
    - trên là nơi preview compoennt có thể chọn màng hình để xem mobile, tablet, desktop (màng hình quá to sẽ tự đọng scale ngay thời điểm bấm thay đổi) - có button reset, + - để thay đổi kích thước
    - dưới là UI editer code tsx
- Dùng thư viện `Sucrase` để giúp review component
- compoennt sẽ là 
```tsx
export default function(){
    return <div><div>
}
```

