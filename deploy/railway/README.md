# Aduu ERP trên Railway

Bộ cấu hình cho một Railway project, cùng environment, gồm bốn service tên chính xác:
`frontend`, `backend`, `Postgres`, `Redis`. Chỉ `frontend` cần public domain.
Chưa có tài nguyên nào được tạo trên Railway bởi bộ file này.

## 1. Tạo PostgreSQL và Redis

Trong project Railway, chọn New → Database → PostgreSQL; lặp lại với Redis.
Giữ volume dữ liệu mà template tạo. Không cần bật TCP proxy public cho hai DB.
Các biến bên dưới tham chiếu tên `Postgres` và `Redis`; đổi tên thì phải đổi tham chiếu.

## 2. Backend

Tạo service từ repo GitHub `QuocAn0303/OMNI-AGENT`, đặt tên `backend`.
Root Directory để `/` (repo root). Chọn branch đã push các file cấu hình này.
Settings → Config File Path: `/deploy/railway/backend.toml`.
Để trống Start Command và Pre-deploy Command: Docker CMD tự chạy migration rồi server.

Nhập Variables bằng Raw Editor (thay các giá trị trong dấu <...>):

```dotenv
NODE_ENV=production
PORT=4000
TRUST_PROXY=true
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_SECRET=<chuỗi ngẫu nhiên riêng ít nhất 32 ký tự>
JWT_EXPIRES_IN=15m
ENCRYPTION_KEY=<chuỗi ngẫu nhiên khác ít nhất 32 ký tự, lưu giữ lâu dài>
CORS_ORIGIN=https://<domain-public-của-frontend>
CLIENT_URL=https://<domain-public-của-frontend>
SEED_ON_START=0
```

Sinh mỗi secret bằng `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"`
trên máy cá nhân, nhập trực tiếp vào Variables; không commit giá trị thật.
Không thay ENCRYPTION_KEY khi redeploy vì khóa này giải mã dữ liệu đã lưu.

Đặt 1 replica backend: app có cron trong tiến trình, Redis chưa ngăn cron chạy lặp khi nhiều replica.
Backend tự nghe PORT; không cấp public domain để tránh truy cập bỏ qua proxy frontend.
Health check hiện tại chỉ kiểm tra tiến trình HTTP; không chứng minh DB/Redis hoạt động.

## 3. Frontend

Tạo service từ cùng repo, tên `frontend`, Root Directory `/`.
Config File Path: `/deploy/railway/frontend.toml`.
Settings → Networking → Generate Domain, target port **8080**.
Nhập Variables:

```dotenv
PORT=8080
BACKEND_HOST=${{backend.RAILWAY_PRIVATE_DOMAIN}}
BACKEND_PORT=4000
VITE_API_URL=https://<domain-public-của-frontend>/api
```

VITE_API_URL được nhúng lúc build: dùng domain HTTPS thật vừa tạo, không thêm dấu `/` cuối.
Sau khi có domain, cập nhật CORS_ORIGIN và CLIENT_URL ở backend cho trùng origin đó.
Deploy backend trước, rồi frontend. Nếu lần build đầu thiếu domain/biến, nhập đủ và redeploy.
Nginx nhận HTTP trong container; Railway cung cấp HTTPS bên ngoài nên không mount chứng chỉ.
API và Socket.IO đi qua frontend, giúp refresh cookie SameSite=Lax hoạt động cùng origin.

## 4. Tài khoản và email

Database mới chưa có tài khoản. Không chạy toàn bộ seed mẫu lên public: seed hiện có tài khoản
mật khẩu `123456` và có thể xóa dữ liệu. Tạo tenant mới qua Đăng ký trên giao diện.
Trước đó cấu hình SMTP thật ở backend theo `.env.example`: SMTP_HOST, SMTP_PORT,
SMTP_USER, SMTP_PASS, SMTP_FROM và SMTP_SECURE theo nhà cung cấp để nhận thư xác minh.
Các tính năng Cloudinary, LLM và thanh toán cần biến riêng nếu sử dụng; không bắt buộc cho việc
phục vụ frontend/API cơ bản. Ollama không nằm trong bộ bốn service này.

## 5. Kiểm chứng sau deploy

1. Mở `https://<frontend>/healthz`: `ok`.
2. Mở `https://<frontend>/api/health`: JSON `status: ok`.
3. Vào một route như `/login`, refresh trang để kiểm tra SPA fallback.
4. Đăng ký tenant, xác minh email, đăng nhập; reload và kiểm tra refresh phiên.
5. Xem backend logs: kết nối PostgreSQL/Redis, không lỗi migration hay xác thực Redis.
6. Kiểm tra Socket.IO trong DevTools → Network và thông báo realtime giữa hai tab.

Migration chạy bằng `prisma migrate deploy`, không chạy `migrate dev` hoặc seed tự động.
Bật backup PostgreSQL phù hợp với gói Railway trước khi nhập dữ liệu khách hàng thật.
Deploy không tự cấp quyền API Shopee/TikTok; cần hoàn tất đăng ký developer và luồng OAuth riêng.

## Kiểm thử container trên máy

Chạy từ repo root khi Docker Desktop Linux engine đang hoạt động:

```powershell
docker build -f deploy/railway/backend.Dockerfile -t aduu-railway-backend:test .
docker build -f deploy/railway/frontend.Dockerfile --build-arg VITE_API_URL=http://localhost:18080/api -t aduu-railway-frontend:test .
docker compose -p aduu-railway-smoke -f deploy/railway/compose.smoke.yml up -d
docker compose -p aduu-railway-smoke -f deploy/railway/compose.smoke.yml logs backend
```

Mở `http://localhost:18080/healthz`, `/api/health` và `/login`.
Chờ log backend báo server chạy ở cổng 4000, rồi chạy `node deploy/railway/smoke.cjs`
để kiểm tra tám bước HTTP/Engine.IO tự động.
Database smoke dùng tmpfs riêng, mất dữ liệu khi dừng container; không kết nối DB dự án.
Các secret trong compose.smoke.yml chỉ dùng local. HTTP local không kiểm chứng được
refresh cookie Secure của production; phần đó cần kiểm tra lại qua HTTPS trên Railway.

Dọn đúng môi trường smoke sau kiểm thử:

```powershell
docker compose -p aduu-railway-smoke -f deploy/railway/compose.smoke.yml down
```

## Kết quả container smoke — 06/11/2026

- Build thành công cả backend Node 22 và frontend Nginx 1.28.
- PostgreSQL 16: chạy thành công 42 migration từ DB trống; lần khởi động tiếp theo không còn migration chờ.
- Redis 7 có mật khẩu: PONG; backend gắn Socket.IO Redis adapter thành công.
- `nginx -t`: hợp lệ; `node deploy/railway/smoke.cjs`: 8 bước PASS.
- Đã sửa hai lỗi đóng gói phát hiện qua test: shadow database trùng DB chính
  (dùng prisma.config.ts riêng cho Railway), và thiếu evals/lib/core (bổ sung evals vào image).
- Log backend có cảnh báo không ghi được `/app/frontend/.env`: frontend build riêng nên
  sử dụng VITE_API_URL đã cấu hình lúc build, không phụ thuộc tệp này.
- Chưa kiểm chứng đăng nhập thành công/refresh cookie qua HTTPS, SMTP thật,
  WebSocket upgrade/realtime có xác thực và API Shopee/TikTok. Engine.IO polling handshake đã qua.
- Container/DB tạm được dọn sau test; image được giữ để tận dụng cache.

## Tài liệu nền tảng

- https://docs.railway.com/config-as-code/reference
- https://docs.railway.com/variables
- https://docs.railway.com/networking/private-networking
- https://docs.railway.com/deployments/healthchecks
