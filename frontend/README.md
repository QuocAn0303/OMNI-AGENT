# 🎨 ERP Frontend Redesign — Phase 1 & 2

**Palette:** Slate Emerald  
**Font:** Geist (Vercel)  
**Phase completed:** Foundation + Layout + Login + Dashboard (9/~30 pages)

---

## 📦 15 file đã tạo

```
src/
├── main.jsx                        [THAY THẾ]   ConfigProvider + AntD theme
├── styles/
│   ├── variables.css               [MỚI]        Design tokens
│   ├── global.css                  [MỚI]        Reset + font + scrollbar
│   ├── layout.css                  [MỚI]        AppShell, Sidebar, TopBar
│   └── pages.css                   [MỚI]        Shared components styles
├── components/
│   ├── layout/
│   │   ├── AppShell.jsx            [MỚI]        ⚠️ Thay thế MainLayout.jsx
│   │   ├── Sidebar.jsx             [MỚI]        Menu phân nhóm + phân quyền
│   │   ├── TopBar.jsx              [MỚI]        Breadcrumb + avatar dropdown
│   │   └── PageHeader.jsx          [MỚI]        Reusable page title
│   └── shared/
│       ├── StatCard.jsx            [MỚI]        KPI card
│       ├── StatusTag.jsx           [MỚI]        Badge thống nhất
│       ├── MoneyDisplay.jsx        [MỚI]        Format VND
│       └── EmptyState.jsx          [MỚI]        Placeholder no-data
└── pages/
    ├── Login.jsx                   [THAY THẾ]   Split layout
    └── Dashboard.jsx               [THAY THẾ]   Stat cards + charts mới
```

---

## 🚀 Các bước tích hợp

### Bước 1: Xóa file không cần

```bash
rm src/App.css                      # boilerplate Vite, không dùng
# Giữ lại index.css nếu bạn muốn, nhưng nội dung sẽ bị override
```

### Bước 2: Copy 15 file vào đúng vị trí

Paste theo đúng cấu trúc thư mục trên.

### Bước 3: Cập nhật `src/App.jsx`

Tìm đoạn import MainLayout và đổi thành AppShell:

```jsx
// CŨ
import MainLayout from "./components/MainLayout";

// MỚI
import AppShell from "./components/layout/AppShell";
```

Sau đó trong routes, thay `<MainLayout>` bằng `<AppShell>`:

```jsx
<Route
  element={
    <ProtectedRoute>
      <AppShell />
    </ProtectedRoute>
  }
>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/products" element={<Products />} />
  {/* ... */}
</Route>
```

### Bước 4: Xóa file MainLayout cũ

```bash
rm src/components/MainLayout.jsx
```

### Bước 5: Chạy thử

```bash
npm run dev
```

Kiểm tra:

- [x] Login page: split layout, brand trái + form phải
- [x] Sau khi login: sidebar đen với menu phân nhóm
- [x] Dashboard: 4 StatCard + 2 charts + bảng low stock
- [x] Toggle collapse sidebar (nút bên phải sidebar)
- [x] Responsive < 1024px: sidebar ẩn

---

## ⚠️ Lưu ý quan trọng

### 1. API endpoints

File `Dashboard.jsx` mới dùng 2 endpoint:

- `GET /dashboard/overview` — trả về `{ monthRevenue, monthOrders, totalCustomers, lowStockCount, orderStatusBreakdown, lowStock, revenueTrend, ordersTrend }`
- `GET /dashboard/revenue` — trả về `{ series: [{ date, revenue }] }`

**Nếu backend của bạn trả shape khác**, cần map lại trong `Dashboard.jsx` ở phần `useEffect`. Tôi code theo shape trong file `frontend-redesign.md` của bạn — nếu lệch, cho tôi biết để chỉnh.

### 2. Schema authStore

File `Sidebar.jsx` và `TopBar.jsx` đọc `user` từ `useAuthStore()` với các trường:

- `user.fullName` (hoặc fallback `user.username`)
- `user.role` (`'ADMIN' | 'MANAGER' | 'STAFF'`)

Nếu authStore của bạn đặt tên khác, cần đổi ở 2 file trên.

### 3. Ant Design version

Code theo **AntD v5 syntax** (tương thích v6 khi ra mắt). Nếu bạn đang dùng v4 thì một số props sẽ cần đổi:

- `theme.token` → phải dùng v5+
- `Menu items` dạng array (v5 style) — đã dùng

Check phiên bản: `npm list antd`

### 4. Dependency cần có

Ngoài các thư viện đã có trong file md, đảm bảo có:

```json
{
  "antd": "^5.0.0",
  "@ant-design/icons": "^5.0.0",
  "react-router-dom": "^6.0.0",
  "recharts": "^2.0.0 || ^3.0.0",
  "dayjs": "^1.11.0"
}
```

---

## 🎯 Phase tiếp theo (chưa làm)

Khi bạn confirm Phase 1-2 chạy OK, tôi sẽ code tiếp:

- [ ] **Phase 3a:** `Products.jsx` + `ProductEdit.jsx` + `Orders.jsx`
- [ ] **Phase 3b:** `Pos.jsx` (major redesign 2-column)
- [ ] **Phase 3c:** `Inventory.jsx` (tabs)
- [ ] **Phase 4:** `Customers.jsx`, `Users.jsx`, `Reports.jsx`, `Analytics.jsx`, `Audit.jsx`
- [ ] **Phase 5:** Tách `HR.jsx` → folder `hr/` + `ERPAssistantWidget` theme update

---

## 🎨 Design tokens summary

| Token              | Value               | Chỗ dùng                    |
| ------------------ | ------------------- | --------------------------- |
| `--primary`        | `#0f766e` Teal 700  | Buttons, links, active menu |
| `--bg-sidebar`     | `#0f172a` Slate 900 | Sidebar background          |
| `--bg-primary`     | `#f8fafc` Slate 50  | Page background             |
| `--text-primary`   | `#0f172a` Slate 900 | Headings                    |
| `--text-secondary` | `#475569` Slate 600 | Body text                   |
| `--radius-lg`      | `14px`              | Cards, modals               |
| `--radius-md`      | `10px`              | Inputs, buttons             |
| `--header-height`  | `64px`              | TopBar                      |
| `--sidebar-width`  | `260px`             | Sidebar expanded            |

---

## 💬 Nếu có lỗi

Các lỗi thường gặp:

1. **"useAuthStore is not a function"** → check đường dẫn import trong Sidebar.jsx/TopBar.jsx/Login.jsx, có thể path của bạn khác.
2. **Menu không hiển thị** → check `user.role` có đúng `'ADMIN'/'MANAGER'/'STAFF'` không (case-sensitive).
3. **Icons báo not found** → AntD v5 đổi tên một số icon, check lại `@ant-design/icons`.
4. **Geist font không load** → Geist có trên Google Fonts nhưng cần mạng; nếu mạng chậm thì fallback 'Inter' → system-ui vẫn đẹp.

---

# 🎨 ERP Frontend Redesign — Phase 3, 4 & 5

**Tiếp nối:** Phase 1 & 2 (đã có ở bundle trước)
**Palette:** Slate Emerald
**Phase này hoàn thành:** Toàn bộ các trang nghiệp vụ + chatbot widget

---

## 📦 15 file mới trong bundle này

```
src/
├── pages/
│   ├── Products.jsx          [THAY THẾ]   List + filter (search/category/stock)
│   ├── ProductEdit.jsx       [THAY THẾ]   Form 2 cột (info + image/actions)
│   ├── Orders.jsx            [THAY THẾ]   List + drawer detail
│   ├── Pos.jsx               [THAY THẾ]   ⭐ MAJOR redesign 2-cột
│   ├── Inventory.jsx         [THAY THẾ]   4 tabs (Stock/Import/Export/History)
│   ├── Customers.jsx         [THAY THẾ]   List + modal CRUD
│   ├── Users.jsx             [THAY THẾ]   Admin only - lock/unlock toggle
│   ├── Reports.jsx           [THAY THẾ]   Card grid + Excel/PDF/CSV export
│   ├── Analytics.jsx         [THAY THẾ]   Charts + top products/customers
│   ├── Audit.jsx             [THAY THẾ]   Admin log viewer + drawer detail
│   └── hr/                   [THAY THẾ FOLDER]   ⚠️ Tách HR.jsx 580 dòng
│       ├── HR.jsx            [MỚI]       Main entry với 3 tabs
│       ├── EmployeeList.jsx  [MỚI]       CRUD nhân viên
│       ├── Attendance.jsx    [MỚI]       Chấm công + summary
│       └── Payroll.jsx       [MỚI]       Bảng lương + tính lại + adjust
└── components/
    └── ERPAssistantWidget.jsx [THAY THẾ]  Chatbot - theme Slate Emerald
```

---

## 🚀 Các bước tích hợp

### Bước 1: Backup file cũ (an toàn)

```bash
mkdir -p src/_backup
cp src/pages/Products.jsx src/_backup/
cp src/pages/Orders.jsx src/_backup/
cp src/pages/Pos.jsx src/_backup/
cp src/pages/HR.jsx src/_backup/      # Quan trọng: file 580 dòng
# ... các file khác cần backup
```

### Bước 2: Copy file mới

Paste theo đúng cấu trúc thư mục trên. Lưu ý đặc biệt:

- `pages/HR.jsx` (file đơn cũ) → **xóa**, thay bằng `pages/hr/` (folder)

### Bước 3: ⚠️ Cập nhật import HR trong `App.jsx`

Vì HR đã chuyển từ file đơn sang folder, đường dẫn import thay đổi:

```jsx
// CŨ
import HR from "./pages/HR";

// MỚI
import HR from "./pages/hr/HR";
```

Route giữ nguyên `<Route path="/hr" element={<HR />} />`.

### Bước 4: Xóa file HR cũ

```bash
rm src/pages/HR.jsx    # File 580 dòng cũ
```

### Bước 5: Đảm bảo ERPAssistantWidget được render

Nếu trước đây bạn đã có widget này trong `AppShell.jsx` (hoặc `MainLayout.jsx` cũ), không cần làm gì. Nếu chưa, thêm vào `AppShell.jsx`:

```jsx
import ERPAssistantWidget from "../ERPAssistantWidget";

export default function AppShell() {
  return (
    <div className="app-shell">
      {/* ...existing... */}
      <ERPAssistantWidget /> {/* ← Thêm dòng này */}
    </div>
  );
}
```

### Bước 6: Chạy thử

```bash
npm run dev
```

---

## 📋 Checklist test từng trang

### 🛒 POS (`/pos`) — quan trọng nhất

- [ ] Layout 2 cột: products grid trái + cart sidebar phải
- [ ] Category pills (chip filter) ở trên grid
- [ ] Click product → vào cart, tăng qty
- [ ] Cart: nút +/− tăng/giảm, nút xóa từng item
- [ ] Discount input ở footer cart
- [ ] Click "Thanh toán" → modal chọn payment method
- [ ] Sau checkout: cart clear, products reload (stock update)

### 📦 Products (`/products`)

- [ ] Filter: search + category + stock status
- [ ] Cột tồn kho đổi màu theo trạng thái (đỏ=hết, vàng=sắp hết)
- [ ] StatusTag với chấm tròn ở đầu

### 📝 Orders (`/orders`)

- [ ] Filter: search + status + payment + date range
- [ ] Click icon mắt → drawer detail bên phải
- [ ] Drawer: thông tin khách + items + tổng tiền

### 📊 Inventory (`/inventory`)

- [ ] 4 tabs: Tồn kho / Nhập kho / Xuất kho / Lịch sử
- [ ] Tab Nhập/Xuất: form đơn giản, chỉ ai có quyền mới thấy
- [ ] Tab Lịch sử: filter theo loại giao dịch

### 👥 Customers (`/customers`)

- [ ] Avatar màu khác nhau theo ID
- [ ] Cột "Tổng chi tiêu" highlight teal (lifetime value)
- [ ] Modal CRUD đầy đủ field

### 🔐 Users (`/users`) — Admin only

- [ ] Role badge với màu (Admin tím / Manager xanh / Staff teal)
- [ ] Nút khóa/mở khóa tài khoản
- [ ] Form thêm: bắt password ≥ 6 ký tự
- [ ] Form sửa: password để trống = không đổi

### 📈 Analytics (`/analytics`)

- [ ] DateRange + groupBy (day/week/month)
- [ ] 4 stat cards với trend
- [ ] Area chart doanh thu
- [ ] Top 10 products bar chart (horizontal)
- [ ] Top customers list với rank badge

### 📋 Reports (`/reports`)

- [ ] Card grid 6 loại báo cáo với icon màu
- [ ] DateRange với presets (Hôm nay, 7 ngày, Tháng này...)
- [ ] Format: Excel/PDF/CSV
- [ ] Click "Xuất" → trigger download blob

### 📜 Audit (`/audit`) — Admin only

- [ ] Filter: action + date range
- [ ] Action có chấm màu (CREATE xanh, DELETE đỏ...)
- [ ] Click icon mắt → drawer chi tiết với JSON changes

### 👨‍💼 HR (`/hr`)

- [ ] 3 tabs: Nhân viên / Chấm công / Bảng lương
- [ ] **Nhân viên**: position badge có màu, modal đầy đủ field
- [ ] **Chấm công**: 3 stat cards (giờ/có mặt/vắng), tag "Đúng giờ/Đi muộn/Vắng"
- [ ] **Bảng lương**: chọn tháng, nút "Tính lại lương", tổng cộng ở footer
- [ ] Bảng lương: nút edit → modal điều chỉnh bonus/deduction

### 💬 ERP Assistant (floating)

- [ ] Nút tròn teal góc phải dưới
- [ ] Click mở chat panel 380×560
- [ ] Header tối với robot icon + dot xanh "Đang hoạt động"
- [ ] User bubble teal, AI bubble trắng
- [ ] Auto-scroll xuống cuối khi có message mới

---

## ⚠️ Lưu ý API endpoints

Bundle này giả định backend có các endpoints:

| Trang     | Endpoint                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Products  | `GET/POST/PUT/DELETE /products`, `GET /categories`                                                                                |
| Orders    | `GET /orders`, `GET /orders/:id`, `POST /orders`                                                                                  |
| POS       | `GET /products`, `GET /categories`, `POST /orders`                                                                                |
| Inventory | `GET /inventory`, `GET /inventory/transactions`, `POST /inventory/import`, `POST /inventory/export`                               |
| Customers | `GET/POST/PUT/DELETE /customers`                                                                                                  |
| Users     | `GET/POST/PUT /users`, `PUT /users/:id/status`                                                                                    |
| Analytics | `GET /analytics?from=&to=&groupBy=`                                                                                               |
| Reports   | `GET /reports/{sales\|orders\|inventory\|customers\|hr\|profit}` (response: blob)                                                 |
| Audit     | `GET /audit-logs`                                                                                                                 |
| HR        | `GET/POST/PUT/DELETE /hr/employees`, `GET /hr/attendance`, `GET /hr/payroll`, `POST /hr/payroll/calculate`, `PUT /hr/payroll/:id` |
| Chatbot   | `POST /assistant/chat { message, history }` → `{ reply }`                                                                         |

**Nếu shape data hoặc URL khác**, cần map lại trong từng file. Tôi code theo blueprint trong `frontend-redesign.md` — nếu lệch, gửi sample response của BE để tôi fix nhanh.

---

## 🎯 Tổng kết toàn bộ dự án redesign

Cộng cả 2 bundles:

| Bundle        | Số file | Nội dung                                                    |
| ------------- | ------- | ----------------------------------------------------------- |
| **Phase 1-2** | 15      | Foundation + Layout + Login + Dashboard + Shared components |
| **Phase 3-5** | 15      | Toàn bộ trang nghiệp vụ + HR folder + Chatbot               |
| **TỔNG**      | **30**  | Hoàn chỉnh frontend redesign                                |

---

## 🐛 Troubleshooting

### "Cannot find module './hr/HR'"

→ Bạn chưa xóa file `pages/HR.jsx` cũ HOẶC chưa update import trong App.jsx.

### POS không thanh toán được

→ Check console: có thể payload sai format. Mở DevTools → Network → check request body của `POST /orders`.

### Reports không tải được file

→ BE phải trả `Content-Type: application/octet-stream` (hoặc `application/vnd.openxmlformats...`). Code FE dùng `responseType: 'blob'` để nhận.

### Chatbot trả lời rỗng

→ Check response của `/assistant/chat` phải có field `reply` (string). Nếu BE trả `message` hay `text`, cần đổi:

```jsx
content: res.data?.reply || ...   // ← Đổi tên field này
```

### HR Payroll - cột "Thực lãnh" hiển thị 0

→ BE phải tính `netSalary = baseSalary + bonus - deduction` và trả về. FE chỉ hiển thị, không tự tính.

---

## 💡 Gợi ý tiếp theo (sau redesign)

Khi chạy ổn định, bạn có thể nâng cấp dần:

1. **Lazy load routes** — `React.lazy()` cho các trang ít dùng (Audit, Reports) để giảm bundle size
2. **React Query / SWR** — thay axios trực tiếp để có caching, refetch, optimistic update
3. **i18n** — tách string sang file dịch nếu cần đa ngôn ngữ
4. **Dark mode** — design tokens đã sẵn sàng, chỉ cần thêm `[data-theme="dark"]` overrides
5. **Skeleton loading** — thay Spin bằng skeleton screens (AntD `Skeleton` component)
6. **Empty illustrations** — thay icon đơn giản trong EmptyState bằng SVG illustrations đẹp hơn

---

_Hoàn thành toàn bộ redesign! 🎉 Hy vọng bạn sẽ thích kết quả._
