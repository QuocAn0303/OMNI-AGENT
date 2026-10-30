# BÀN GIAO CHO AI KẾ TIẾP — AISC26-0058 / Aduu ERP

File này viết để **một AI khác đọc lần đầu là đủ hiểu tình trạng và đưa ra
quyết định đúng**. Đọc file này + `STATE.md` + `corrections.md` là đủ, không
cần đọc lịch sử hội thoại.

**Phạm vi bắt buộc khi đọc:** mọi số liệu dữ liệu trong repo này thuộc **DB phát
triển cục bộ**. **Môi trường thật/staging chưa từng được quét.** Không suy ra
bất kỳ kết luận nào về môi trường thật từ số ở đây.

---

## 1. Bài toán

Đội OmniAgent (3 người) dự thi **AISC26 vòng 2**, mã hồ sơ **AISC26-0058**.
Đề tài: *Hệ thống Multi-Agent Tự hành Khai thác Dữ liệu Đa kênh Tối ưu hóa
Tồn kho và Chuỗi cung ứng Doanh nghiệp Bán lẻ*.

Repo: **Aduu ERP** — Node.js/Express/Prisma 7/PostgreSQL/Redis/Socket.IO,
frontend React 19 + Vite + Ant Design 6. Multi-tenant bằng Prisma `$extends` +
`AsyncLocalStorage`.

**Phản hồi Ban Tổ chức:** phạm vi quá rộng so với 3 người; các con số cam kết
(−90% thao tác, hết hàng 8%→1,5%, chính xác 98,5%) không có căn cứ; vai trò
LLM chưa rõ. Vòng 2 phải: thu hẹp một luồng demo, thay số bằng số đo được,
làm rõ LLM vs công thức, dùng dữ liệu có nguồn, nói rõ khác biệt so với
KiotViet/Sapo và góc nhìn kinh doanh.

**Luồng demo duy nhất đã chốt:**
`Cảnh báo sắp hết hàng → đề xuất đặt hàng → duyệt (human-gate) → tạo PO`,
≈50–500 SKU, kênh sàn = **tệp xuất đơn (import file), không phải realtime**.

---

## 2. Đọc trạng thái trong 3 lệnh

```bash
git log --oneline -15          # lịch sử gần đây
git status --short             # việc dở dang (phải sạch)
ls docs/aisc26 scripts         # tài liệu + script kiểm chứng
```

Ba tài liệu then chốt:

| File | Vai trò |
|---|---|
| `docs/aisc26/STATE.md` | tiến độ, số liệu đã ký, lệnh dựng lại môi trường |
| `docs/aisc26/corrections.md` | **5 phát biểu đã sai của chính tôi** — đọc để không lặp lại |
| `docs/aisc26/00b-gate-design.md` | thiết kế gate phương án A′ (quyết định đã có hiệu lực) |

---

## 3. Nhánh và commit

| Nhánh | Commit | Nội dung |
|---|---|---|
| `round2/p0-hardening` | `761ea52` | P0-1 chặn ghi qua `db-agent` |
| | `64b7541` | module `replenishment` hàm thuần |
| | `d813e68` | P0-2 + sửa 3 lỗi unit-test-mock-che |
| | `5842fe2` | merge hotfix `ai_documents` |
| | `5ffeec0` | công cụ 5 nhóm + sửa lỗi backfill |
| | `0c4d26a` | sửa teardown smoke + chốt chặn "phải sạch" |
| | **`2532f17`** | **dọn xong DB local + `STATE.md` + `corrections.md`** |
| `hotfix/tenant-nested-write` | `8eb320f` | sửa ghi lồng extension Prisma + fail-fast + 3004 test |
| | `959ab30` | SQL thô `ai_documents` |

**Chưa đẩy remote. Tuyệt đối không đẩy `main`.**

---

## 4. Trạng thái kiểm chứng (đo đúng số, không làm tròn)

| Lệnh | Kết quả | Loại kiểm chứng |
|---|---|---|
| `npm test` | 3992/3997 pass, 67 suites | mock |
| `npm run smoke:po-gate` | 18/18, teardown tự chứng minh sạch | **DB thật** |
| `npm run check:tenant-isolation` | 11/11 | **DB thật** |
| `npm run check:tenant-gaps` | 4/4 | **DB thật** |
| `npm run check-tenant-aidocs` | 9/9 | **DB thật** |
| `npm run check:modules` | 203 module | — |
| `npm run check:humangate` | 11/11 (cần backend + DB) | **HTTP thật** |
| `npm run check:tenant:null` | **FAIL có chủ đích** | **DB thật** |

**Quy tắc của đội:** chỉ có unit test mock **không** được coi là bằng chứng
hoàn thành. Luồng quan trọng (tạo PO, gate, cách ly tenant, import) **phải** có
smoke trên DB thật. Chính smoke đã bắt được lỗi cách ly tenant mà toàn bộ mock
bỏ sót.

---

## 5. DB local sau khi dọn (đã xong)

| Chỉ số | Trước | Sau |
|---|---|---|
| Số tenant | 9 | **2** (`CANDORY SCENT`, `Á đù`) |
| Dòng `tenantId` mồ côi (tenant không tồn tại) | 297 | **0** |
| `users` NULL | 10 | **1** (tài khoản nền tảng `super_omega_ultra_admin@gmail.com`) |
| `company_settings` NULL | 38 | **0** |
| `company_settings` trùng 1-1 | 1 | 1 (CANDORY — việc #2) |
| `audit_logs` NULL | 124 | 124 (**không rõ chủ**) |
| `CANDORY SCENT` | 82 đơn / 158 dòng hàng / 89.862.000 VND | **không đổi** |

Còn **134/139 bảng scoped không có khoá ngoại tới `tenants`** — đây là nguyên
nhân gốc của lớp lỗi mồ côi, là **vấn đề thiết kế**, ghi backlog, không sửa ở
Vòng 2.

---

## 6. Quyết định còn treo — CẦN AI KẾ TIẾP/ĐỘI QUYẾT

### D1. 124 dòng `audit_logs` NULL không rõ chủ

**Bằng chứng:** cả 124 dòng có `userId` trỏ tới user **không còn tồn tại** (user
đã bị xoá), nên không thể suy ra `tenantId` từ đâu. Không dòng nào thuộc tenant
đang tồn tại.

**Hiện trạng:** `check:tenant` **FAIL** vì đây được phân loại LỖI. Tôi cố ý
**không** xếp sang CỐ Ý để làm số xanh.

**Ba lựa chọn:**

| | Cách làm | Đánh giá |
|---|---|---|
| **A** | Chấp nhận `check:tenant` FAIL như hiện tại, ghi rõ trong báo cáo | Trung thực nhất, nhưng gate đỏ vĩnh viễn khó chứng minh "sạch" |
| **B** | Ký quy tắc: *audit log của user đã xoá = lưu trữ, không cần tenant* → xếp CỐ Ý | Hợp lý về nghiệp vụ (log sống lâu hơn user), nhưng **cần ký** vì nó là quyết định nghiệp vụ chứ không kỹ thuật |
| **C** | Cho phép `tenantId` NULL có kiểm soát trên `audit_logs` (partial index, chỉ dành cho log của user đã xoá) | Kỹ thuật đúng nhất nhưng **cần migration** — vượt phạm vi Vòng 2 |

**Khuyến nghị:** B, kèm điều kiện bắt buộc — quy tắc phải kiểm được
(`userId` không tồn tại **AND** `userId IS NOT NULL`), không được đổi thành
"cho phép NULL". Nếu chọn C thì cần đưa vào backlog migration cùng đợt.

### D2. 36 dòng `company_settings` của `CANDORY SCENT`

**Bằng chứng đã có:** tenant demo này có **36 dòng** settings thay vì 1. Mã đọc
`companySettings.findFirst()` **không có `orderBy`** ⇒ nhận một dòng bất kỳ ⇒
**hành vi luồng duyệt PO phụ thuộc vào thứ tự vật lý**.

**Chưa làm:** chưa biết dòng nào `findFirst()` thực sự trả về; chưa tìm đường mã
sinh trùng; chưa xuất 35 dòng dư ra file.

**Quyết định cần đưa ra trong lúc làm:** giữ dòng nào làm dòng chính?
- Nếu 36 dòng **giống hệt nhau về giá trị** → giữ đúng dòng mà `findFirst()` đang
  trả về (để hành vi không đổi), xoá 35 dòng còn lại.
- Nếu **có dòng khác biệt** → dừng, báo đội, không tự quyết.

**Điểm cần nhấn mạnh khi trình bày:** đây là lỗi *đọc không xác định*, tác động
trực tiếp hành vi nghiệp vụ — mạnh hơn nhiều so với "dữ liệu bẩn". Sửa bằng
`orderBy` + xử lý thiếu dòng bằng mặc định 5tr.

---

## 7. Việc còn lại, theo đúng thứ tự đã chốt

| # | Việc | Ghi chu |
|---|---|---|
| 1 | ~~Dọn dữ liệu local~~ | **XONG** (`2532f17`) |
| 2 | Điều tra 36 dòng `company_settings`, `orderBy` xác định + mặc định 5tr khi thiếu, giữ đúng một dòng | Xem D2 |
| 3 | `ai_documents`: `ON CONFLICT ... WHERE tenant_id = EXCLUDED.tenant_id` — **không** "chuyển quyền sở hữu"; lỗi rõ ràng + log bảo mật khi xung đột tenant khác; đổi test; rà endpoint có cho client cấp `entityId` không | Commit riêng, nhánh hotfix |
| 4 | Rà/sửa mọi tài liệu từng trích số sai; viết lại câu chuyện vấn đáp | `corrections.md` đã tạo |
| 5 | Lệnh dọn rác theo tiền tố; cập nhật runbook (thử khởi động trên staging, kế hoạch hoàn tác, xử lý MỒ CÔI-TENANT và TRÙNG 1-1); gói `review-hotfix-tenant.md` + `review-p0-3.md` | |
| 6 | **D6**: `MISSING_COST` + `409` ở `executeGate`; hiệu năng `checkAutoReorder` (chỉ SKU của đơn vừa hoàn tất + debounce); test `COST_DRIFT` | |
| 7 | Sửa YAML Swagger `analytics.routes.js:18` (xác nhận `/api-docs` mở được); D7 đẩy nhánh | Chỉ khi deploy-chỉ-`main` + quét secret đều sạch |
| 8 | **Sửa giao thức S1–S12** | **TRƯỚC mọi backtest** |
| 9 | Chọn dataset công khai + sha256 → `02-data.md` | Đội đã ủy quyền, không cần chờ |
| 10 | Pha 5 `05-differentiation.md` (KiotViet, Sapo + 1–2 đối thủ, URL + ngày) | |
| 11 | Pha 6 `06-business.md` (khách hàng mục tiêu, 2–3 phương án giá gắn cơ chế gói, kinh tế đơn vị bằng số đo thật) | |
| 12 | Script backtest + mô phỏng tồn kho (test tính tay, chặn `slice != test`, sổ ghi lần chạy) | Sau #8, #9 |
| 13 | Frontend: bắt buộc lý do từ chối, hiển thị diff + tuổi đề xuất, `DRIFT_WARN`, cảnh báo trạng thái lơ lửng | |
| 14 | Migration `LlmUsageLog` riêng | Trước code LLM |
| 15 | Hai vai trò LLM + chế độ không-LLM/replay/live + đánh giá khớp SKU | Cần key |
| 16 | Bộ tác vụ + phiếu ghi cho 6 người thử | |
| 17 | Kịch bản demo 5 phút + phương án dự phòng, diễn tập | |
| 18 | `07-pitch-outline.md` + `07-qa-prep.md` | |

**Đóng băng tính năng:** ngay khi demo chạy end-to-end trên dataset đã chọn
(sau #13) **không thêm tính năng mới**.

---

## 8. Quyết định đang có hiệu lực — KHÔNG bàn lại

### Gate và PO
- Hai lớp duyệt tách biệt: *gate* = có cho AI tạo PO không; *`PO_ABOVE`* = PO có
  cần duyệt tài chính tiếp không. Demo dùng PO dưới ngưỡng.
- Người duyệt: `ADMIN`/`MANAGER`/`SUPER_OMEGA_ULTRA_ADMIN`. **`ACCOUNTANT` không
  duyệt.** Cho phép tự duyệt (SME thường một chủ) nhưng audit **bắt buộc** ghi
  `selfApproved`.
- **Phương án A′, không atomic**: để lại trạng thái lơ lửng
  `APPROVED + resultRef IS NULL`. Mốc nhận diện PO trùng nằm trong
  `PurchaseOrder.note` dạng `[gate:<id>]`, và `findPoByGate()` **xác minh** khớp
  NCC/dòng hàng/người duyệt/thời điểm trước khi liên kết.
- **Không** dùng transaction vì `withCodeRetry` không chạy được trong tx (lỗi
  `25P02`), `auditService.log` và `workflowService.trigger` dùng `prisma` toàn
  cục (ngoài tx), `entityId` không có FK.
- Thiếu giá vốn → cờ `missingCost`; `executeGate` trả **`409 MISSING_COST`**
  (**D6, chưa làm**).
- Ngưỡng drift: `QTY_DRIFT_TOL` 25%, `COST_DRIFT_TOL` 10% — **mặc định chưa
  hiệu chỉnh, không có căn cứ thực nghiệm.**

### LLM
- ROP/safety stock/EOQ/BOM = **công thức**, LLM **không được tính số**.
- Hai vai trò LLM thật và đo được: **(1)** khớp SKU giữa file kênh và ERP
  (JSON + Zod, điểm tin cậy, dưới ngưỡng chuyển người, **bắt buộc có baseline
  fuzzy không-LLM**); **(2)** giải thích đề xuất + soạn tin nhắn NCC (chỉ soạn,
  không gửi).
- Một đường LLM duy nhất `config/llm.js`. Có **chế độ không-LLM chạy trọn vẹn**
  và chế độ `replay`/`live`. Demo phải chạy được khi LLM tắt.
- Key Gemini gói miễn phí: đội tự đặt vào `.env`. **Không đọc/in/ghi key**, không
  gửi dữ liệu thật hay thông tin cá nhân qua key này. Hạn mức/điều khoản dữ
  liệu: **tra trang chính thức, ghi URL + ngày**, không dựa trí nhớ. Chi phí LLM =
  token đo thật × đơn giá công khai, **không phải chi phí đã trả**; chưa đo thì
  ghi "chưa đo".

### Dữ liệu và đánh giá
- Dataset công khai do bạn chọn (đã ủy quyền): daily SKU×ngày, có giá, ≥ 18 tháng,
  có SKU bán thưa, giấy phép cho phép, không PII, 50–500 SKU sau lọc. **Phải mở
  và đọc thật**, ghi sha256, báo lựa chọn nhưng không cần chờ phản hồi.
- Dataset công khai **không có tồn kho/lead time/kênh** ⇒ mọi chỉ số tồn kho là
  **mô phỏng**, không tuyên bố hiệu quả "đa kênh".
- Giao thức backtest phải sửa theo **S1–S12 trước khi viết script/chạy**. Sau
  lần chạy đầu: **cấm chỉnh tham số sau khi thấy số** (nếu phải sửa thì báo cả
  hai kết quả).
- 6 người thử (tối thiểu 5), không tính 3 thành viên đội. Dưới 5 người thì chỉ
  báo trung vị + khoảng min–max.
- Sau khi import dataset vào demo ERP: `tenant-null --scan` phải bằng **0** cho
  tenant demo.

### Trung thực số liệu
- **Ba con số cũ (−90%, 8%→1,5%, 98,5%) không được dùng.**
- Không có số hiệu quả nào không kèm nguồn, cách đo, cỡ mẫu.
- Mọi bảng kết quả ghi rõ *thật / công khai / mô phỏng*, tenant/môi trường nào.
- Phát biểu bị đính chính phải vào `corrections.md`.

---

## 9. Quy tắc bất di bất dịch

- **Bảo mật:** không in/ghi/commit key, `.env`, mật khẩu. Không `git add -f`. Repo
  coi như **công khai** cho tới khi đội nói khác ⇒ **không** đưa chi tiết khai
  thác lỗ hổng chưa vá vào tài liệu được track.
- **Migration:** chỉ `npm run db:migrate:deploy`; `db:migrate` chỉ khi tạo mới và
  không trên DB có bảng RAG vector. **Không sửa migration đã áp dụng.** Trước
  `db:migrate:deploy` phải liệt kê migration đang chờ. Không `npm run db:seed`
  trên DB cần giữ dữ liệu (lệnh TRUNCATE).
- **Ghi dữ liệu:** chỉ DB local, có `assert-local-db`, dump trước, dry-run mặc
  định, số kỳ vọng lấy từ `COUNT` chạy lại, một transaction, hủy toàn bộ nếu lệch.
  **Không tự sửa số kỳ vọng — chờ đội ký.** Môi trường khác: chỉ in lệnh/runbook.
- **Mọi hành động có tác dụng phụ đi qua human-gate.** Không nới gate cho demo mượt.
- Model mới có `tenantId` → phải thêm vào `TENANT_SCOPED_MODELS`.
- Sau thay đổi chạy: `npm test`, `check:modules`, `check:tenant`; thêm
  `check:humangate` (cần backend) và `smoke:po-gate` khi đụng agent/gate/PO.
  **Dọn mọi tiến trình nền đã khởi động.**
- **Bẫy môi trường:** PowerShell hay hỏng file tiếng Việt khi dùng `-replace` /
  `Set-Content` — dùng thẻ `edit`/`write` cho file nhiều dấu. `pg_dump` không
  nhận tham số Prisma `?schema=` trong `DATABASE_URL`, phải tách `-h -p -U -d`.

---

## 10. Những chỗ AI trước đã sai — đừng lặp lại

| Sai | Nguyên nhân |
|---|---|
| "+47% doanh thu", "gần một nửa doanh thu" | Đếm cả đơn **mồ côi**; không gắn nhãn phạm vi |
| "9 user rác trôi nổi" | Chỉ lọc `tenantId IS NULL`, **không rà tham chiếu** trước khi kết luận |
| "8 tenant DBG" | Đọc từ bảng liệt kê **bị cắt bớt dòng** thay vì chạy `COUNT` |
| Ký 36/69 warehouses/audit_logs | Số **lỗi thời**: chính script smoke còn rò dữ liệu trong lúc đo |

**Bài học chung:** số phải lấy từ `COUNT` chạy lại **ngay trước lúc ghi**, và
chạy công cụ đã vá **trước khi đo**. Khi bị chặn bởi điều kiện dừng: **báo rồi
chuyển ngay sang việc độc lập kế tiếp, đừng đứng chờ.**

---

## 11. Hạn chế phải nói thẳng khi trình bày

1. A′ để lại trạng thái lơ lửng (at-most-once, không phải nguyên tử).
2. Kênh sàn là import file; adapter Shopee/Lazada/TikTok vẫn là stub.
3. AI agent chỉ hiểu intent mẫu, không hội thoại tự do.
4. Dữ liệu backtest là công khai/mô phỏng nếu chưa có dữ liệu thật.
5. 6 người thử ⇒ thăm dò, không đại diện.
6. Ngưỡng drift và độ tin cậy khớp SKU là mặc định chưa hiệu chỉnh.
7. Hai ngưỡng duyệt PO còn mâu thuẫn ngoài đường demo.
8. 134/139 bảng scoped chưa có FK tới `tenants`.
9. **Môi trường thật chưa được quét NULL/mồ côi.**

Câu chuyện vấn đáp về lỗi cách ly tenant nói đúng mức: *đó là **lỗi mã nghiêm
trọng**, bằng chứng là 84/242 dòng `order_items` trên DB phát triển, mà unit
test mock không thấy; nhưng **toàn bộ dữ liệu bị ảnh hưởng là dữ liệu kiểm
thử**, tenant thật duy nhất không bị mất dữ liệu, và **môi trường thật chưa
quét**.* Không nói "chúng tôi đã mất dữ liệu khách hàng", cũng không nói "không
có lỗ hổng".
