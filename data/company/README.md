# C-03 — Công ty mô phỏng CANDORA

Owner: M2 — Nguyễn Tấn Phát. Fixture version `1.0.0`, dành cho SE373.

`candora.json` là nguồn dữ liệu công ty, phòng ban, tài khoản và hồ sơ nhân viên.
Toàn bộ danh tính là hư cấu. Không có số điện thoại, CCCD, tài khoản ngân hàng
hay dữ liệu khách hàng thật. Tenant riêng: `candora-se373-c03`.

| Mã phòng ban gateway | Số nhân viên | Tài khoản đại diện |
|---|---:|---|
| EXEC | 2 | exec.01@candora.example |
| FINANCE | 6 | finance.01@candora.example |
| SALES | 8 | sales.01@candora.example |
| HR | 4 | hr.01@candora.example |
| OPS | 6 | ops.01@candora.example |
| WAREHOUSE | 6 | warehouse.01@candora.example |
| Tổng | 32 | |

Các tài khoản còn lại theo mẫu `<phòng ban viết thường>.02`, `.03`… cùng miền.
Role, chức danh và `reportsTo` của từng người được khai báo trong JSON.
Chức danh Kế toán trưởng/Giám đốc là dữ liệu tổ chức; seed không cấp quyền duyệt
theo chức danh và không sửa hạn mức hiện tại của gateway. M1 review ánh xạ role;
quy tắc hạn mức 20 triệu được xử lý riêng tại task 004-11.

## Chạy

Tại thư mục gốc repo, cài dependencies và áp dụng migrations trên DB phát triển:

```sh
npm run seed:company          # dry-run, không kết nối/ghi DB
npm run seed:company:apply    # ghi tenant CANDORA riêng
npm run check:company         # ghi hai lần, kiểm 6 phòng/32 user/32 employee
npm test -- --runTestsByPath tests/company-seed.test.js
```

Hai lệnh ghi cần `DATABASE_URL` từ `.env`; từ chối `NODE_ENV=production`.
Mật khẩu ban đầu cho tài khoản demo: `CandoraDemo!2026`; có thể đặt
`CANDORA_DEMO_PASSWORD` trước lần seed đầu. Không dùng mật khẩu thật. Lần chạy
sau giữ hash cũ, không reset mật khẩu. Seed không tạo tài khoản super-admin.
Đăng nhập bằng API/giao diện login hiện có, dùng tài khoản đã xác minh email.
Không gửi email thật tới miền `.example`.

## Idempotency và giới hạn

- ID ổn định từ namespace `se373:c03`; module `scripts/seed/company/seed.js`
  export `fixtureId` và `tenantId` cho các fixture UC sau dùng chung.
- Tạo đúng Department/User/Employee theo schema hiện có; không thêm migration.
  Cả User.department và Employee.departmentId khớp bộ nhận diện của gateway.
- Mọi ghi nằm trong một transaction với advisory lock. Kiểm tra toàn bộ định danh
  trước khi ghi; đụng ID/email/mã nhân viên của dữ liệu khác thì rollback.
- Chỉ cập nhật record thuộc fixture, ghi audit khi tạo/sửa User. Không gọi seed
  tổng `prisma/seed.js`, không truncate, không xóa hay reset dữ liệu khác.
- `check:company` kiểm cả hai lượt; lượt hai phải có `writes: 0` và các User
  (bao gồm hash mật khẩu, updatedAt) giữ nguyên. Output không chứa hash/password.
- Chạy kiểm chứng sẽ giữ tenant mô phỏng để demo. Không cung cấp lệnh xóa cascade.
- Chưa tạo subscription, PO, GRN, hóa đơn hoặc KB: các owner domain cung cấp sau.
  Seed này cung cấp identity; không xác nhận mọi màn hình trả phí đã được mở.

## Impact analysis

Bằng chứng chạy DB hai lần và 5 test đạt được lưu tại `verification.json`.
M1 còn review mapping identity/role; chưa xác nhận login HTTP hay subscription.

Chỉ thêm fixture/script mới và ba npm scripts; không sửa symbol production,
schema, auth, policy, gateway hay seed mặc định. Hàm mới chưa có caller ngoài
CLI và test C-03. GitNexus MCP/index không có trong môi trường triển khai này.
