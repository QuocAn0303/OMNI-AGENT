# 📘 Hướng dẫn tự xử lý — Aduu ERP

> File này gom tất cả lệnh hay dùng + cách fix khi sai. Mở bằng VS Code, đọc theo mục lục bên trái. **Đừng học thuộc, cứ copy-paste**.

**Repo**: <https://github.com/QuocAn0303/IS207.Q22>
**Deploy**: Railway auto-deploy mỗi khi push lên branch `main`
**Tài khoản mặc định**: `admin@erp.com` / `admin123`

---

## 📑 Mục lục

1. [Quy trình chuẩn mỗi lần sửa code](#1-quy-trình-chuẩn-mỗi-lần-sửa-code)
2. [Migrate database](#2-migrate-database)
3. [Push lên Git an toàn](#3-push-lên-git-an-toàn)
4. [Lỡ tay sai? Cách rollback](#4-lỡ-tay-sai-cách-rollback)
5. [Debug Railway deploy](#5-debug-railway-deploy)
6. [Bug thường gặp & cách fix](#6-bug-thường-gặp--cách-fix)
7. [Cheatsheet lệnh hay dùng](#7-cheatsheet-lệnh-hay-dùng)
8. [Khi cần thêm tính năng mới](#8-khi-cần-thêm-tính-năng-mới)

---

## 1. Quy trình chuẩn mỗi lần sửa code

**Trước khi bắt đầu**:

```bash
# 1. Đảm bảo đang ở main và mới nhất
git status                  # phải sạch (nothing to commit)
git pull origin main        # kéo về phiên bản mới nhất
```

**Trong khi sửa**:

```bash
# 2. Chạy backend dev (terminal 1)
npm run dev

# 3. Chạy frontend dev (terminal 2)
cd frontend
npm run dev

# 4. Mở: http://localhost:5173
```

**Sau khi sửa xong**:

```bash
# 5. Xem mình đã đổi gì
git status                  # liệt kê file thay đổi
git diff                    # xem nội dung thay đổi

# 6. Stage + commit (xem mục 3 bên dưới)
# 7. Push (xem mục 3 bên dưới)
```

> ⚠️ **KHÔNG BAO GIỜ** chạy `git push --force` lên main. Dòng đó xóa hết lịch sử của người khác.

---

## 2. Migrate database

### 2.1. Khi nào cần migrate?

- Khi sửa file `prisma/schema.prisma` (thêm/xóa/đổi field, model)
- Khi `git pull` về có migration mới trong `prisma/migrations/`

### 2.2. Tạo migration mới (sau khi sửa schema)

```bash
# Tạo file migration + apply vào DB local
npx prisma migrate dev --name them_field_xyz
# (đặt tên ngắn gọn: them_truong_so_dien_thoai_customer, sua_lai_index_order, ...)
```

Lệnh này sẽ:
1. So sánh `schema.prisma` với DB hiện tại
2. Sinh file SQL trong `prisma/migrations/YYYYMMDDHHMMSS_them_field_xyz/`
3. Chạy SQL đó vào DB
4. Regenerate Prisma Client

### 2.3. Apply migration đã có (sau khi `git pull`)

```bash
# Local (DB local)
npm run db:migrate          # giống npx prisma migrate dev

# Production (Railway) — KHÔNG CẦN LÀM TAY
# Railway tự chạy "npx prisma migrate deploy" qua prisma/startup.js mỗi lần deploy.
```

### 2.4. Reset DB local nếu loạn (chỉ DB LOCAL, không phải Railway)

```bash
# ⚠️ Lệnh này XÓA SẠCH DB local rồi migrate + seed lại từ đầu
npx prisma migrate reset

# Trả lời "y" khi nó hỏi xác nhận
# Sau khi xong: admin@erp.com / admin123
```

### 2.5. Lệnh hữu ích khác

```bash
npm run db:studio           # mở GUI xem dữ liệu DB (http://localhost:5555)
npm run db:seed             # nạp lại dữ liệu mẫu
npx prisma generate         # regenerate Prisma Client (sau khi pull schema)
npx prisma validate         # kiểm tra schema có hợp lệ không
```

---

## 3. Push lên Git an toàn

### 3.1. Quy trình chuẩn (KHÔNG SAI BAO GIỜ)

```bash
# Bước 1: xem mình đã đổi gì
git status

# Bước 2: stage CHÍNH XÁC file mình muốn commit (KHÔNG dùng git add .)
git add src/modules/foo/foo.service.js
git add prisma/schema.prisma
git add prisma/migrations/20260524_them_foo
# (liệt kê từng file để tránh add nhầm .env, log, file rác)

# Bước 3: kiểm tra lại đã stage đúng chưa
git status                  # phải thấy "Changes to be committed" đúng list mình muốn

# Bước 4: commit với message rõ ràng
git commit -m "feat: them tinh nang foo"
# hoặc: fix: sua loi bar
# hoặc: docs: cap nhat README

# Bước 5: push
git push origin main
```

### 3.2. Quy ước commit message (theo dự án)

| Prefix | Khi nào dùng | Ví dụ |
|---|---|---|
| `feat:` | Tính năng mới | `feat: them module bao cao thue` |
| `fix:` | Sửa bug | `fix: order tinh sai tien thue` |
| `fix(scope):` | Sửa bug trong 1 module cụ thể | `fix(auth): export requireRole alias` |
| `docs:` | Sửa README/tài liệu | `docs: cap nhat huong dan` |
| `refactor:` | Đổi code không đổi behavior | `refactor: tach service` |
| `chore:` | Việc lặt vặt (deps, config) | `chore: nang prisma len 7.5` |

### 3.3. ⚠️ Tuyệt đối không commit

- `.env` (chứa password DB, JWT secret) — đã có trong `.gitignore`
- `node_modules/` — quá to
- `logs/` — file log runtime
- `uploads/` — file user upload tạm
- File ảnh/video to (>10MB) — dùng Cloudinary

Kiểm tra trước khi commit:
```bash
git diff --staged           # xem nội dung sẽ commit
git diff --staged --stat    # chỉ xem tên file + số dòng đổi
```

### 3.4. Push xong → Railway tự deploy

1. Push lên `main` → Railway phát hiện thay đổi
2. Railway build Docker image (~2-4 phút)
3. Railway chạy `node prisma/startup.js`:
   - Clean migration bị stuck
   - `npx prisma migrate deploy`
   - Start app
4. Vào dashboard Railway xem log → đợi `[server] listening on http://0.0.0.0:3000`

---

## 4. Lỡ tay sai? Cách rollback

### 4.1. Đã sửa file nhưng chưa commit → muốn quay về như cũ

```bash
# Bỏ thay đổi 1 file cụ thể
git checkout -- src/file/da/lo.js

# Bỏ TẤT CẢ thay đổi chưa commit (CẨN THẬN!)
git checkout -- .

# Hoặc cách an toàn hơn: cất tạm vào stash để lấy lại được
git stash                   # cất
git stash pop               # lấy ra lại
git stash drop              # xóa hẳn cái đã cất
git stash list              # xem các stash đang có
```

### 4.2. Đã commit nhưng CHƯA push → muốn sửa commit

```bash
# Xem commit gần nhất
git log --oneline -5

# Cách 1: Sửa nội dung commit (file/message)
# Sửa file thêm → git add → rồi:
git commit --amend          # gộp vào commit cũ

# Cách 2: Bỏ commit cuối, giữ lại thay đổi để sửa
git reset --soft HEAD~1     # commit bị bỏ, code vẫn còn ở staging

# Cách 3: Bỏ commit cuối VÀ bỏ thay đổi (CẨN THẬN!)
git reset --hard HEAD~1     # MẤT CODE — chỉ làm khi chắc chắn
```

### 4.3. Đã push lên main nhưng commit có vấn đề

**KHÔNG dùng `git push --force` lên main.** Cách an toàn:

```bash
# Cách 1: Tạo commit MỚI để hoàn tác (revert)
git log --oneline -5
git revert <commit_hash>    # tạo commit ngược lại với commit cũ
git push origin main        # push commit revert
```

```bash
# Cách 2: Sửa lại + commit mới
# Cứ sửa code, commit, push như bình thường
# Lịch sử git sẽ thấy bug + fix → đỡ rủi ro hơn force push
```

### 4.4. Railway deploy hỏng → rollback nhanh

Vào **Railway dashboard** → tab **Deployments** → tìm deploy cũ chạy được → bấm **Redeploy**.
Không cần làm gì với git, Railway sẽ build lại từ commit cũ đó.

---

## 5. Debug Railway deploy

### 5.1. Xem log realtime

1. Mở Railway dashboard → chọn service → tab **Logs**
2. Tìm các dòng:
   - `[startup] DATABASE_URL set: true` → DB connect OK
   - `[startup] cleaned X stuck migration row(s)` → đã clean migration cũ
   - `[startup] migrations applied — starting app` → migrate xong
   - `[server] listening on http://0.0.0.0:3000` → app chạy

### 5.2. Lỗi build (chưa qua được Docker)

Triệu chứng: log không có dòng `[startup]`, chỉ có Docker build fail.

Nguyên nhân thường gặp:
- Thiếu dependency → kiểm tra `package.json`, chạy `npm install` local trước khi push
- Syntax error → chạy `npm run dev` local trước khi push, đảm bảo không lỗi

### 5.3. Lỗi migration trên Railway

Triệu chứng log: `Error: P3009: migrate found failed migrations`

**Cách fix** (script đã tự lo từ commit `a1208c7`, nhưng nếu vẫn lỗi):
1. Vào Railway dashboard → service Postgres → tab **Data**
2. Mở bảng `_prisma_migrations`
3. Xóa các row có `finished_at = NULL`
4. Redeploy

Hoặc dùng `railway run` (cài Railway CLI):
```bash
railway login
railway link
railway run npx prisma migrate status      # xem trạng thái
railway run npx prisma migrate resolve --rolled-back "ten_migration_loi"
```

### 5.4. Lỗi runtime sau khi deploy

- **502 Bad Gateway**: app crash, xem log Railway tìm stack trace
- **CORS error trên frontend**: kiểm tra biến `CORS_ORIGIN` trong Railway Variables (phải khớp URL frontend)
- **Login fail 401**: kiểm tra `JWT_SECRET` trong Railway, phải set + ≥ 32 ký tự

---

## 6. Bug thường gặp & cách fix

### 6.1. `P1001: Can't reach database server`

**Local**: Postgres chưa chạy.
```bash
docker-compose up -d        # khởi động lại Postgres container
docker ps                   # kiểm tra container đang chạy
```

**Khi chạy migrate từ máy local**: `DATABASE_URL` trong `.env` đang trỏ tới Railway (`postgres.railway.internal`) → URL này chỉ truy cập được TỪ TRONG Railway. Muốn migrate local cần đổi sang Postgres local:
```env
DATABASE_URL="postgresql://postgres:uit@localhost:5432/erp_db?schema=public"
```

### 6.2. `P3009: migrate found failed migrations`

```bash
# Local: reset toàn bộ
npx prisma migrate reset

# Hoặc xóa migration lỗi thủ công
docker exec -it erp-postgres psql -U postgres -d erp_db
# Trong psql:
DELETE FROM _prisma_migrations WHERE finished_at IS NULL;
\q
# Rồi migrate lại
npm run db:migrate
```

### 6.3. `connect ECONNREFUSED 127.0.0.1:6379` (spam liên tục)

Redis chưa chạy. App vẫn chạy được nhưng real-time bị giới hạn.
```bash
docker start erp-redis
# Nếu chưa có container:
docker run -d --name erp-redis -p 6379:6379 redis:7-alpine
```

### 6.4. Port 3000 hoặc 5173 đã bị chiếm

```powershell
# Windows PowerShell — tìm tiến trình chiếm port 3000
netstat -ano | findstr :3000
# Kill theo PID
taskkill /PID <pid_o_cot_cuoi> /F
```

Hoặc đổi port:
- Backend: sửa `PORT=3001` trong `.env`
- Frontend: sửa `frontend/vite.config.js` → `server.port`

### 6.5. Login trả 401 ngay sau seed

`JWT_SECRET` rỗng hoặc đổi giữa các lần restart. Set một chuỗi cố định trong `.env`:
```env
JWT_SECRET=chuoi_co_dinh_it_nhat_32_ky_tu_khong_doi_giua_cac_lan_chay
```

### 6.6. Frontend báo Network Error / CORS

Kiểm tra:
1. Backend đang chạy: `http://localhost:3000/api-docs` mở được không?
2. `CORS_ORIGIN` trong `.env` backend = URL của frontend (vd: `http://localhost:5173`)
3. `VITE_API_URL` trong `frontend/.env` = URL của backend (vd: `http://localhost:3000`)

### 6.7. Prisma Client lỗi `unknown field` sau khi pull code mới

Schema đã đổi nhưng Prisma Client local chưa regenerate:
```bash
npx prisma generate
```

### 6.8. `Cannot find module '@socket.io/redis-adapter'` (hoặc module nào đó)

```bash
npm install
# Nếu vẫn lỗi 1 package cụ thể:
npm install @socket.io/redis-adapter ioredis
```

### 6.9. Migration tạo ra nhưng không có file SQL

Xảy ra khi schema không có thay đổi thực sự. Kiểm tra:
```bash
git diff prisma/schema.prisma   # có thật sự đổi gì không?
npx prisma migrate status        # so sánh DB với schema
```

### 6.10. Lỗi `LF will be replaced by CRLF` khi git add

Đây là **CẢNH BÁO không phải lỗi** — Windows dùng CRLF, Git auto convert. Bỏ qua được. Nếu muốn tắt:
```bash
git config --global core.autocrlf true
```

### 6.11. Railway hết quota / app sleep

Trial Railway có giới hạn. Vào dashboard kiểm tra **Usage**. Nếu hết → nâng cấp plan hoặc tạm dừng service không cần thiết.

---

## 7. Cheatsheet lệnh hay dùng

### Git

```bash
git status                          # xem trạng thái
git log --oneline -10               # 10 commit gần nhất
git diff                            # xem thay đổi chưa stage
git diff --staged                   # xem thay đổi đã stage
git add <file>                      # stage 1 file
git commit -m "message"             # commit
git push origin main                # push
git pull origin main                # kéo về
git stash                           # cất tạm thay đổi
git stash pop                       # lấy ra
git branch                          # xem branch hiện tại
git log --all --graph --oneline    # xem cây commit
```

### Prisma / DB

```bash
npm run db:migrate                  # migrate DB local
npm run db:seed                     # nạp dữ liệu mẫu
npm run db:studio                   # mở GUI DB
npx prisma migrate status           # trạng thái migration
npx prisma migrate reset            # reset toàn bộ DB local
npx prisma generate                 # regenerate Prisma Client
npx prisma validate                 # kiểm tra schema
npx prisma format                   # format file schema.prisma
```

### Docker

```bash
docker-compose up -d                # khởi động Postgres
docker-compose down                 # dừng (giữ data)
docker-compose down -v              # dừng + XÓA data ⚠️
docker ps                           # list container đang chạy
docker logs erp-postgres            # xem log Postgres
docker start erp-redis              # khởi động Redis
docker exec -it erp-postgres psql -U postgres -d erp_db   # vào psql
```

### Node / NPM

```bash
npm install                         # cài deps backend
npm run dev                         # chạy backend dev
npm start                           # chạy production
npm test                            # chạy Jest

cd frontend
npm install                         # cài deps frontend
npm run dev                         # chạy Vite (port 5173)
npm run build                       # build production
```

---

## 8. Khi cần thêm tính năng mới

### 8.1. Thêm 1 module backend mới (vd: `loaning`)

```bash
# 1. Tạo cấu trúc
mkdir src/modules/loaning
# Tạo 2 file:
# - src/modules/loaning/loaning.routes.js
# - src/modules/loaning/loaning.service.js
```

**`loaning.routes.js`** mẫu:
```javascript
const router = require("express").Router();
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const service = require("./loaning.service");

router.get("/", authenticate, async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.list() });
  } catch (e) { next(e); }
});

module.exports = router;
```

**Mount vào `src/app.js`** (gần các route khác):
```javascript
const loaningRoutes = require("./modules/loaning/loaning.routes");
// ...
app.use("/api/loaning", loaningRoutes);
```

### 8.2. Thêm 1 trang frontend mới (vd: `Loaning.jsx`)

1. Tạo `frontend/src/pages/Loaning.jsx`
2. Vào `frontend/src/App.jsx`:
   ```javascript
   const Loaning = lazy(() => import("./pages/Loaning"));
   // ...
   <Route path="/loaning" element={<Loaning />} />
   ```
3. Vào `frontend/src/components/layout/Sidebar.jsx` thêm vào `MENU_GROUPS`:
   ```javascript
   { key: '/loaning', icon: <DollarOutlined />, label: 'Cho vay', roles: ['ADMIN', 'MANAGER'] },
   ```

### 8.3. Thêm 1 bảng DB mới

1. Sửa `prisma/schema.prisma` → thêm `model XYZ { ... }`
2. Tạo migration:
   ```bash
   npx prisma migrate dev --name them_bang_xyz
   ```
3. Migration sẽ tự apply local; trên Railway sẽ apply khi push.

### 8.4. Cấu hình tích hợp (VNPT/Cloudinary/SMS/SMTP)

**KHÔNG sửa `.env` trên Railway nữa** — vào UI: `https://<railway-domain>/integrations` (cần ADMIN).
Lý do: giá trị được mã hóa AES-256-GCM, đổi không cần redeploy. Xem chi tiết ở README mục "13. Trung tâm tích hợp".

---

## 🆘 Khi không biết phải làm gì

1. **Đọc log**: 90% bug đều ghi rõ lý do trong log. Đọc kỹ stack trace.
2. **Đọc file CLAUDE.md + README.md** trong repo.
3. **Search trên Google**: copy nguyên message lỗi, paste vào Google.
4. **Hỏi ChatGPT/Claude**: dán nguyên log + file code liên quan, nói "tôi đang làm gì + lỗi gì".
5. **Rollback Railway**: vào dashboard → Deployments → Redeploy phiên bản cũ chạy được.

---

## ✅ Checklist trước khi push (in ra dán lên màn hình)

- [ ] `git status` — đã đổi đúng file mình muốn?
- [ ] `git diff` — code mình viết có đúng không?
- [ ] `npm run dev` chạy local — không lỗi?
- [ ] Test feature trên `http://localhost:5173` — chạy được không?
- [ ] Nếu sửa schema: đã chạy `npx prisma migrate dev --name xxx`?
- [ ] Nếu thêm file mới: đã `git add` file đó?
- [ ] Commit message rõ ràng (feat/fix/docs/...) ?
- [ ] `git push origin main` — chỉ dùng `push`, không bao giờ `push --force`?
- [ ] Vào Railway xem log build có lỗi không?

---

_File này sinh ra để tự tin push code. Có gì khó khăn cứ mở lại — copy paste là chạy._
