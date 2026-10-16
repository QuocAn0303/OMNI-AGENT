# Hướng dẫn chạy demo — AISC'26

> Đã push nhánh `round2/p0-hardening` lên GitHub (`github/round2/p0-hardening`).
> Nhánh này **102 commit trước `main`**, nên khi clone về hãy checkout đúng nhánh.

---

## 0. Lấy code

```bash
git clone -b round2/p0-hardening https://github.com/QuocAn0303/OMNI-AGENT.git
cd OMNI-AGENT
npm install
```

> **Chỉ cần backend để demo.** Phần đo LLM và các lệnh `check:`/`smoke:` đều là
> script Node, không cần frontend.

---

## 1. Cần có gì trước khi bắt đầu

| Thứ | Bắt buộc? | Ghi chú |
|---|---|:-:|
| Node 25.x | ✅ | máy này dùng 25.6.1 |
| PostgreSQL | ✅ | `C:\Program Files\PostgreSQL\18\bin` |
| Redis | ❌ | không có cũng chạy, chỉ mất realtime |
| **Mạng UIT** | ⚠️ | chỉ cần nếu demo phần LLM (mục 5) |

**Khởi động PostgreSQL** — Windows Service cần quyền admin:

```powershell
Get-Service postgresql-x64-18 | Start-Service
```

Nếu không có quyền admin, chạy trực tiếp:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" `
  -D "C:\Program Files\PostgreSQL\18\data" -l "$env:TEMP\pg.log" start
```

**Kiểm tra kết nối trước khi làm gì khác:**

```powershell
node -e "require('dotenv').config();const p=require('./src/config/prisma');p.llmUsageLog.count().then(n=>{console.log('DB OK, llm_usage_logs='+n);return p.\$disconnect()}).catch(e=>{console.log('DB LOI: '+e.message.slice(0,80));process.exit(1)})"
```

Phải in `DB OK` thì mới đi tiếp.

---

## 2. Tạo dữ liệu demo

```bash
npm run db:migrate        # tạo bảng
npm run demo:setup        # dữ liệu tối thiểu cho demo
npm run demo:login        # bật đăng nhập + gói business (idempotent)
```

Tài khoản demo (tạo ở bước `demo:login`):

| | |
|---|---|
| Email | `demo-mo-phong@local.invalid` |
| Mật khẩu | `Demo123456` |
| Tenant | `omni-demo-mo-phong` |

> **Không chạy `npm run db:seed`** nếu database đã có dữ liệu — lệnh đó ghi đè.

---

## 3. Demo chính — một luồng, 8 bước

```bash
npm run demo:run
```

In ra 6 khối: chọn SKU → tạo đơn → CDC → human-gate → duyệt → tạo PO.

**Đây là luồng duy nhất của dự án** — từ đơn bán đến bút toán. Không có luồng
thứ hai; đây là chủ ý thu hẹp phạm vi sau phàn nàn vòng 1.

---

## 4. Kiểm chứng — đây là phần giám khảo hỏi nhiều nhất

Mỗi lệnh in ra một bảng khẳng định / tổng số. **Chạy trước khi demo**, để không
bị hỏi "số đó từ đâu ra" mà không có câu trả lời.

```bash
npm run demo:check          # 25/25 — kiểm toàn bộ luồng demo
npm run smoke:demo-flow     # 17/17 — luồng trên DB thật
npm run check:accounting    # 57 GRN / 57 bút toán / 0 thiếu
npm run check:tenant        # 11/11 + 4/4 + 4/4 — cách ly tenant
npm run check:modules       # 220 module load được
```

### Bảng "10 lỗi thật đã tìm ra" — mỗi lỗi có một lệnh

| Lỗi | Trước | Nay | Lệnh kiểm |
|---|---:|---:|---|
| PO đã nhận hàng mà không vào sổ cái | **39 PO** | **0** | `npm run check:accounting` |
| Bút toán `tenantId` NULL | 18 dòng | **0** | `npm run check:tenant` |
| Màn hình đề xuất nhập ẩn gần hết SKU | **458/468** | **0** | `npm run measure:evidence` |
| Lead time đo được chết âm thầm | **0/20 PO** | **57/57** | `npm run demo:check` |

> Bốn dòng đầu là lỗi **đo được bằng số**. Đây là phần đáng giá nhất khi trình
> bày, vì nó trả lời câu *"chỉ số của các bạn lấy từ đâu?"* mà không cần con số
> nào không kiểm chứng được.

---

## 5. Demo phần LLM — chỉ khi trong mạng UIT

API `llm.uit.edu.vn` **chỉ truy cập được trong mạng nội bộ trường**. Ngoài mạng
thì bị redirect, và code báo đúng nguyên nhân đó chứ không báo nhầm "key sai".

### 5a. Cấu hình key

Trong `.env`:

```
LLM_PROVIDER=uit
LLM_UIT_API_KEY=<key của trường>
LLM_UIT_THINKING=0
```

### 5b. Kiểm tra kết nối — gọi thật 1 lần

```bash
npm run check:llm
```

Kết quả đúng phải có `✓ Phản hồi: ...`. Không có thì dừng, đừng chạy tiếp.

### 5c. Đo LLM — 60 cặp kiểm định

```bash
npm run llm:eval -- --mode live
```

Mất **khoảng 17 giây**. In ra:

```
BASELINE fuzzy khong-LLM : P=0.8269 R=0.8776 F1=0.8515 chuyen_nguoi=13.33%
HYBRID (fuzzy + LLM)     : P=0.8136 R=1 F1=0.8972 chuyen_nguoi=1.67%
  do chinh xac tho: 48/56 = 85.71%  | tu ap dung sai: 7
  do chinh xac tho: 48/56 = 85.71%  | tu ap dung sai: 8
bootstrap F1(hybrid-fuzzy): 0.0457 CI95 [0.0008, 0.0969] => KHONG chua 0
LLM goi: 8 | tra loi chac chan: 7 | truot: 0
TOKEN THAT : 6172 tok tren 13 lenh goi · do tre TB 725 ms
```

**Chạy lại 3–5 lần.** Trên UIT, 5/5 lần cho kết quả **giống hệt nhau** (khác
Gemini dao động). Đây là lý do chọn UIT.

### 5d. Bằng chứng từng ca — mở ra khi bị hỏi

```bash
code docs/aisc26/notes/sku-eval-cases.csv
```

60 dòng, mỗi dòng một ca: tên sản phẩm · 5 ứng viên · điểm công thức · LLM chọn ·
điểm tin cậy · nhãn đúng · kết quả `DUNG`/`SAI`/`CHAN_NGUOI`/`CHUA_CO_NHAN`.

> **Đây là câu trả lời sẵn cho câu hỏi khó nhất.** Giám khảo hỏi "số đó từ đâu" →
> mở file này, chỉ vào từng dòng.

### 5e. ⚠️ Điều phải nói trước khi trình bày

Trong 8 ca bị đánh dấu SAI, **7 ca là người gán sai, không phải hệ thống sai**:

| Ca | Tên trên sàn | Hệ thống chọn | Người gán |
|---|---|---|---|
| SKU-084 | `ALARM CLOCK BAKELIKE RED` | `ALARM CLOCK BAKELIKE RED` **(trùng khít)** | `...BAKELIKE PINK` |
| SKU-104 | `ASSORTED COLOURS SILK FAN` | `ASSORTED COLOURS SILK FAN` **(trùng khít)** | `ASSORTED FLOWER COLOUR "LEIS"` |
| SKU-112 | `Area Patrolled Metal Sign` | `AREA PATROLLED METAL SIGN` **(trùng khít)** | `TOILET METAL SIGN` |

**Không có ca nào hệ thống sai mà nhãn đúng.** Nghĩa là **85,71 % là mức thấp
của độ đúng thật**, và:

- **Đừng công bố độ chính xác nào cho tới khi có Cohen κ.** Sửa nhãn rồi báo
  lại = bịa kết quả.
- **Đừng hạ ngưỡng chuyển câu hỏi lúc này.** Tinh chỉnh trên tập nhãn hỏng là
  tối ưu vào sai chỗ.
- **Chủ động nêu chuyện này trước khi giám khảo hỏi.** Tự phát hiện lỗi trong dữ
  liệu của chính mình là điểm cộng; để giám khảo phát hiện thì mất điểm.

Chi tiết đầy đủ: `docs/aisc26/slides/llm-sku-matching.md`

---

## 6. Cần người, không làm bằng code được

| Việc | Lệnh / đường dẫn | Tình trạng |
|---|---|---|
| **Người gán thứ hai** → có Cohen κ | `npm run llm:labels:b -- --export`<br>→ file `data/aisc26/skus/labels/label-sheet-B.csv` (107 cặp, 14 cặp biên)<br>→ điền xong: `npm run llm:labels:b -- --load` | **chặn** mọi con số độ đúng |
| 6 người dùng thử | `npm run usertest:scenario` (dựng bộ ca thử)<br>`node scripts/usertest/print-sheets.js` (in bảng để phát cho người thử)<br>`npm run usertest:summarize` (tổng hợp kết quả) | 0/6 người |
| Phỏng vấn sâu 3–5 cửa hàng | 8 câu ở `docs/aisc26/06-business.md` §4 | chưa làm |

---

## 7. Nếu có frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Backend phải chạy song song (`npm run dev` ở thư mục gốc). Backend tự ghi
`frontend/.env` với `VITE_API_URL` khi khởi động.

---

## 8. Danh sách lệnh kiểm chứng đầy đủ

```bash
npm test                          # 4499/4504
npm run check:modules             # 220 module
npm run check:swagger             # 136/136
npm run demo:check                # 25/25
npm run smoke:demo-flow           # 17/17
npm run check:accounting          # 57 GRN / 57 bút toán
npm run check:tenant              # 11/11 + 4/4 + 4/4
npm run check:i18n                # khoá dịch khớp vi/en
npm run check:evidence            # kiểm chứng qua HTTP thật
```

Tất cả trừ `llm:eval` đều cần PostgreSQL.
