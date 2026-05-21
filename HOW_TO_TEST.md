# 🧪 Test Auth API — Dev A

## Bước 1: Chạy server
```bash
npm run dev
# Server chạy tại http://localhost:3000
```

## Bước 2: Test từng endpoint bằng Postman hoặc Thunder Client

---

### ✅ Test 1 — Login thành công
```
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{
  "email": "admin@erp.com",
  "password": "admin123"
}
```
**Kết quả mong đợi:** 200 OK, có `token` trong response

---

### ❌ Test 2 — Login sai mật khẩu
```
POST http://localhost:3000/api/auth/login

{
  "email": "admin@erp.com",
  "password": "satroi"
}
```
**Kết quả mong đợi:** 401, message "Email hoặc mật khẩu không đúng"

---

### ❌ Test 3 — Login thiếu email
```
POST http://localhost:3000/api/auth/login

{
  "password": "admin123"
}
```
**Kết quả mong đợi:** 400, Zod validation error

---

### ✅ Test 4 — Lấy profile (cần token từ Test 1)
```
GET http://localhost:3000/api/auth/me
Authorization: Bearer <token_từ_test_1>
```
**Kết quả mong đợi:** 200, thông tin user (không có password)

---

### ❌ Test 5 — Gọi /me không có token
```
GET http://localhost:3000/api/auth/me
(không có Authorization header)
```
**Kết quả mong đợi:** 401, "Không có token xác thực"

---

### ❌ Test 6 — Token giả
```
GET http://localhost:3000/api/auth/me
Authorization: Bearer tokengiamao123
```
**Kết quả mong đợi:** 401, "Token không hợp lệ"

---

## Nếu tất cả 6 test pass → hôm nay DONE ✅
