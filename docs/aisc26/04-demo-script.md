# 04 — Kịch bản trình diễn 5 phút (+ phương án dự phòng)

**Ngày:** 2026-10-03 · **Nhánh:** `round2/p0-hardening` · **Bám theo:** T16

> **Nhãn dữ liệu xuyên suốt:** dữ liệu trên màn hình là **MÔ PHỎNG**, dựng từ
> **UCI Online Retail II (CC BY 4.0)** — xem `02-data.md`. Giá tính bằng **sterling của
> tệp dữ liệu**, **không** quy đổi. **Không** phải dữ liệu khách hàng thật.
> **Không** được nói "khách hàng của chúng tôi", "shop của họ", "tiết kiệm được X%".

**Hai người:** **A** thuyết trình (đứng, nói), **B** thao tác (ngồi cạnh máy).
Nếu chỉ một người: A nói, A thao tác, nhưng **phải** nói trước khi bấm: *"Tôi sẽ bấm
một cái, xem màn hình."*

---

## 0. Trước khi lên sân khấu (30 phút) — checklist bắt buộc

Chạy hết, **thấy xanh hết** mới lên. Không có "chạy thử lúc lên".

```bash
# 0. DB local + migration
npx prisma migrate status          # 0 migration chờ
npm run tenant:null -- --scan      # MỒ CÔI-TENANT 0 · TRÙNG 0

# 1. Dữ liệu demo đủ dùng
npm run data:import -- --reset --apply --days 34 --max-orders 6000
npm run smoke:import-demo          # 9/9

# 2. Luồng demo chạy được, và chạy lại được nhiều lần không rác
npm run smoke:demo-flow            # 12/12, 2 lần liên tiếp: 0 bảng thay đổi

# 3. HTTP thật (cần backend đang chạy ở cổng 4000)
npm run check:humangate            # 11/11

# 4. LLM: mặc định là KHÔNG dùng LLM. Xác nhận rồi đừng đụng
npm run llm:policy                 # chỉ in chế độ + có/không key, KHÔNG in key

# 5. Giao diện
cd frontend && npm run lint && npm run build && cd ..
```

| Mục | Đạt | Cách kiểm | Nếu hỏng |
|---|:---:|---|---|
| PostgreSQL local chạy | ☐ | `npm run tenant:null -- --scan` | dừng cài lại Postgres |
| 0 migration chờ | ☐ | `npx prisma migrate status` | `npx prisma migrate deploy` (**không** `db:migrate`) |
| Tenant demo có 500 SKU + ≥ 2.400 đơn | ☐ | trang `/products` | `npm run data:import -- --reset --apply …` |
| `smoke:demo-flow` 12/12 | ☐ | lệnh trên | đọc `STATE.md` giả định A4/A5 |
| `check:humangate` 11/11 | ☐ | cần `npm run dev` | xem mục dự phòng B |
| LLM **tắt** (mặc định) | ☐ | `npm run llm:policy` | không cần làm gì thêm |
| Đăng nhập được vào tenant demo | ☐ | `/login` | xem `AGENTS.md` (tài khoản seed) |
| Mở sẵn 2 tab: `/pos`, `/agent-approvals` | ☐ | trình duyệt | — |
| **Chạy `npm run demo:run` 1 lần để có bản in dự phòng** | ☐ | xem mục 4 | — |
| Câu hỏi dự phòng đã đọc | ☐ | `07-qa-prep.md` | — |

**Sau buổi trình bày:** `Get-Process node | Stop-Process -Force` — **không** để lại
tiến trình nền.

---

## 1. Kịch bản 5 phút

| Giờ | Màn hình | Ai nói gì (nguyên văn) | Ai làm |
|---|---|---|---|
| 0:00–0:30 | — (đứng) | A: "Đây là một trong ba món quy trình chúng tôi có: **cảnh báo sắp hết hàng → hệ thống tính số lượng cần đặt → người có quyền duyệt → tạo đơn nhập**. Năm phút. Toàn bộ số liệu trên màn hình là **dữ liệu mô phỏng** từ một tập dữ liệu công khai tên UCI Online Retail II, giấy phép CC BY 4.0; tiền tính bằng sterling của tệp đó, chúng tôi không quy đổi." | — |
| 0:30–1:10 | tab 2: `/products` | A: "Ba chỗ tôi muốn nói trước. Một: **số lượng đặt do công thức quyết định, không phải AI** — AI không được phép chạm vào bất kỳ con số nào của quyết định đặt hàng. Hai: **không có AI thì luồng vẫn chạy trọn**, hôm nay tôi sẽ tắt AI. Ba: **không ai có thể bỏ qua bước duyệt** — không duyệt thì không có đơn nhập nào tồn tại." | B giữ tab |
| 1:10–2:10 | tab 1: `/pos` | A: "Tôi bán 6 cái *[B: chọn SKU, số 6, bấm thanh toán]*. Tồn khả dụng của món này rơi từ 10 xuống 4." | **B** tạo đơn (nói trước khi bấm) |
| 2:10–3:05 | tab 3: `/agent-approvals` | A: "Hệ thống vừa tự sinh một đề xuất. Nhìn bốn thứ: **tồn khả dụng**, **điểm đặt lại ROP**, **số ngày còn đủ bán**, và **số lượng đề xuất**. Số lượng này là `[2.510]` — công thức tính ra, không phải AI. *[B: bấm Duyệt]*. Hệ thống **kiểm tra lại từ DB lúc tôi bấm**: dữ liệu đã đổi thì nó chặn và bắt tôi xem khác biệt." | **B** bấm Duyệt |
| 3:05–3:35 | tab 4: `/purchase-orders/…` | A: "Và đây là đơn nhập `[PO-…-0001]`, tạo **đúng một cái**, có ghi ai duyệt, lúc nào, ghi chú gì." | B mở PO |
| 3:35–4:20 | — (quay lại `/agent-approvals`) | A: "Giờ phần đo được. Chúng tôi **không** bán câu 'AI chính xác hơn'. Chúng tôi bán: **đề xuất có cổng duyệt bắt buộc, và sai số đo được bằng backtest công khai**."<br>"Kết quả thí nghiệm 1 — nguyên văn, kể cả phần xấu: chỉ số chính ưu tiên ROP hơn ngưỡng cố định, **nhưng** cái đổi lại là bán ít hơn 9,5%, mất bán nhiều hơn 31,5%, và tỉ lệ lấp đủ yêu cầu rơi từ 76,81% xuống 69,51%. Chúng tôi **không** kết luận 'ROP tốt hơn'."<br>"Thí nghiệm 2 — **post-hoc**, chạy sau khi đã thấy số: ở **cùng mức phục vụ**, ROP trói ít vốn hơn ngưỡng cố định: chênh −954,63/ngày trên 132/500 SKU, khoảng tin cậy 95% không chứa 0, 99,24% SKU thắng. Ràng buộc 95% **không khả thi** — cao nhất đạt 88,66% — nên chúng tôi **không** trả lời được câu 'ở mức 95% thì sao'." | — |
| 4:20–4:50 | — | A: "So với KiotViet, Sapo, CMBcore: ở đúng luồng này, tôi **không tìm thấy** ở họ cổng duyệt bắt buộc, chặn lệch số liệu, hay chỉ số sai số. `❌` trong bảng của tôi nghĩa là *không tìm thấy trong nguồn tôi đã đọc*, không phải *chắc chắn họ không có*."<br>"**Và chúng tôi không làm gì ở Vòng 2:** không POS, không đồng bộ sàn, không hóa đơn điện tử, không chấm công. Chỗ nào đối thủ mạnh hơn thì nói thẳng." | — |
| 4:50–5:00 | — | A: "Còn ba thứ **chúng tôi chưa có dữ liệu**: kết quả LLM thật, thời gian người dùng, và phỏng vấn khách. Tôi ghi 'chưa có dữ liệu' thay vì điền số. Cảm ơn." | — |

**Cấm nói:** "chính xác hơn KiotViet/Sapo" · "tiết kiệm X%" · "AI thông minh" ·
"đa kênh" (luồng demo lấy đơn từ **tệp xuất mô phỏng**, không phải tích hợp thời gian
thực) · bất kỳ số LLM nào (chưa đo).

---

## 2. Diễn tập (bắt buộc 2 lần)

1. **Lần 1 — với đồng hồ.** Chạy đúng bảng ở trên, đo từng đoạn. Mục tiêu: **≤ 5:30**,
   không có đoạn nào quá 45 giây mà không ai thao tác.
2. **Lần 2 — phá thứ có thể phá.** Diễn tập với:
   - **Cổng 4000 không chạy** ⇒ phải chuyển sang phương án B trong 15 giây.
   - **Không có mạng** ⇒ luồng không-LLM vẫn phải chạy (mặc định là vậy).
   - **Đơn hàng đã tồn tại** / **PO trùng** ⇒ chạy lại `npm run demo:run` trước khi lên.

**Cách nói chuyển phương án (dùng nguyên văn):** *"Giao diện đang không trả lời. Tôi
chạy lại luồng này ở chế độ không giao diện — cùng một đường mã, số liệu đọc thẳng từ
cơ sở dữ liệu."*

---

## 3. Nếu hỏi "số 2.510 lấy ra sao?"

Nói đúng công thức, không nói "AI tính":

> Tồn khả dụng trừ điểm đặt lại (ROP), ROP bằng **nhu cầu mỗi ngày × thời gian nhập +
> tồn kho an toàn**. Tồn kho an toàn thì gắn với một mức phục vụ chọn trước. Nếu hàng
> đã có trên đường thì trừ luôn. Rồi làm tròn theo bao bì của nhà cung cấp.
>
> Chi tiết: `01-llm-role.md` §1 và `src/modules/replenishment/replenishment.calc.js`.

Nếu hỏi tiếp "sao thời gian nhập lại là ước lượng?":

> Vì cửa hàng mới dùng hệ thống chưa đủ lịch sử nhận hàng để đo. Hệ thống **đánh dấu
> cờ ước lượng** thay vì giả vờ đó là số đo. Đây là điểm phải nói thẳng.

---

## 4. Phương án dự phòng (theo thứ tự dùng)

### A. `npm run demo:run` — không cần giao diện (30 giây)

Cùng `runDemoFlow()` với `smoke:demo-flow` ⇒ **bản trình diễn và bản nghiệm thu là một
đường mã**, không thể lệch nhau. In ra: từng bước kèm thời gian thật (ms), ATP trước/sau,
ROP, số lượng đề xuất, mã gate, mã PO, bằng chứng không sinh đề xuất trùng, và danh
sách "bỏ qua có chủ đích".

```bash
npm run demo:run              # tự dọn sau khi chạy
npm run demo:run -- --keep    # giữ lại PO để mở giao diện xem sau
```

Dùng khi: cổng 4000 chết · frontend build hỏng · trình bày ở máy không cài Postgres.
**Bản in đã lưu** nằm ở `docs/aisc26/print/demo-run.txt` (nếu có) — in sẵn ra giấy.

### B. `check:humangate` — chứng minh phần HTTP (nếu bị hỏi)

11 assertion qua HTTP thật (đăng nhập → chat → gate → duyệt), cần backend đang chạy.
Không dùng làm bản trình diễn chính; dùng để trả lời câu "phần HTTP có chạy thật không".

### C. Bản in/snapshot dự phòng

Chuẩn bị **một** bản in của `npm run demo:run` **và** 4 ảnh chụp màn hình
(`/pos`, `/agent-approvals` trước duyệt, sau duyệt, `/purchase-orders/…`), đặt trong
một thư mục ngoài repo. Nếu mất hết, nói:

> "Tôi không trình diễn được lúc này vì môi trường không khởi động. Những gì tôi vừa
> nói vẫn đúng, và đây là bản in của cùng một đường mã chạy lúc [thời điểm]."

### D. Chế độ không-LLM — **mặc định, không phải dự phòng**

`resolveMode()` trả `'off'` trừ khi có key. Hôm nay **nói "AI tắt" là đúng** và là một
điểm mạnh: *"Chi phí AI trên luồng này bằng 0, vì số lượng do công thức quyết định; AI
chỉ làm hai việc phụ và tắt đi thì luồng vẫn chạy."*
Không được bật LLM lúc trình bày. Nếu bật, mọi con số LLM phải tắt (`CHƯA ĐO`).

---

## 5. Kịch bản thay thế 90 giây (khi bị cắt thời gian)

1. **15s** — "Số lượng đặt do công thức tính, AI không chạm vào số; AI tắt là mặc định;
   không duyệt thì không có đơn nhập."
2. **40s** — `npm run demo:run` in ra 6 bước, đọc thẳng ATP → ROP → đề xuất → gate → PO.
3. **20s** — kết luận backtest trung thực (thí nghiệm 1 xấu + thí nghiệm 2 post-hoc).
4. **15s** — "không làm gì ở Vòng 2" + ba chỗ chưa có dữ liệu.
