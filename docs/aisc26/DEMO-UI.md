# DEMO GIAO DIỆN — bấm từng bước

> Không mở terminal trong lúc trình bày. Mọi thứ dưới đây thực hiện được bằng
> chuột trên trình duyệt.
>
> Chuẩn bị (làm **trước** khi lên sân khấu, không làm trước mặt khán giả):
> backend + frontend đang chạy, đã đăng nhập, và **đã dựng sẵn ít nhất 1 đề xuất
> chờ duyệt** ở bước 2.

---

## Bước 0 — Đăng nhập (làm trước)

Mở `http://localhost:5173`

| | |
|---|---|
| Tài khoản | `demo-mo-phong@local.invalid` |
| Mật khẩu | `Demo123456` |

> Dán email thì khoảng trắng dính cũng được — hệ thống tự cắt.
> Thấy `Đăng nhập thành công` là vào thẳng `/dashboard`.

---

## Bước 1 — Mở đề xuất chờ duyệt (quan trọng nhất)

**Menu trái → nhóm `TRỢ LÝ AI` → bấm `Duyệt đề xuất nhập`**

Thấy tiêu đề **"Đề xuất cần bạn duyệt"** và danh sách thẻ đề xuất.

> **Nếu thấy "Không có đề xuất nào đang chờ"** → hệ thống chưa có gì để duyệt.
> Dựng trước bằng `npm run demo:run`, hoặc vào `Trợ lý KD` (`/smart-guide`) để tạo
> một đề xuất rồi quay lại đây.

**Trên thẻ đề xuất, bấm nút: `AI Giải thích và Soạn tin NCC`**

Chờ vài giây. Màn hình hiện ra ba khối:

| Khối | Nội dung |
|---|---|
| **Giải thích đề xuất** | Lý do đề xuất số lượng này — do LLM viết |
| **Tin nhắn đặt hàng gửi nhà cung cấp** | Nội dung tin nhắn sẽ gửi NCC |
| **Hàng rào số — assertNumbersUnchanged** | Trạng thái chặn số |

Có thẻ nhỏ ở góc trên bên phải nói nguồn: **`nguồn: LLM`** hoặc
**`nguồn: mẫu (LLM không khả dụng)`**. Nói rõ cái nào hiện đang là gì.

> **Cách nói:** *"AI được phép giải thích, không được phép đổi số."*

---

## Bước 2 — Chứng minh hàng rào thật sự chặn (không phải hình vẽ)

**Bấm nút: `Test Chốt chặn AI sửa số`**

Hệ thống cố tình làm lệch một con số trong lời giải thích, rồi chạy lại hàng rào.

Kết quả mong đợi: khối **"Hàng rào số"** chuyển sang báo **bị chặn**.

> **Đây là bước đáng trình bày nhất.** Nó chứng minh hàng rào chạy thật chứ không
> phải chỉ ghi chú. Nếu hàng rào báo chặn, hãy bấm lại nút một lần nữa để trả
> về trạng thái thường trước khi chuyển sang màn khác.

---

## Bước 3 — Duyệt đề xuất

**Tích ô: `Tôi xem diff ở trên và vẫn mua đúng số lượng này`**
(ô này chỉ hiện khi đề xuất có lệch so với công thức)

**Bấm: `Duyệt`**

Hộp xanh hiện lên: **"Đã tạo PO PO-…-… (…đ)"**

> Nếu thấy *"Đã duyệt nhưng PO chưa tạo được (trạng thái lơ lửng)"* → có nút
> **`Thử lại tạo PO`**. Bấm lại. Đây là hành vi có chủ ý: PO là hành động tài
> chính nên hệ thống không tự làm thay.

---

## Bước 4 — Thấy PO thật trong danh sách

**Menu trái → nhóm `KẾ TOÁN & TÀI CHÍNH` → bấm `Mua hàng`**

Danh sách đơn mua hàng, có PO vừa tạo ở trên.

**Bấm vào đơn đó** → trang chi tiết. Nếu chưa nhập kho, bấm nút **`Duyệt`**.

> Số PO nói ra: trước đợt sửa lỗi có **39 PO đã nhận hàng mà không vào sổ cái**.

---

## Bước 5 — Nhập kho

**Menu trái → `KẾ TOÁN & TÀI CHÍNH` → `Phiếu nhận hàng (GRN)`**

Danh sách phiếu nhận kho. Mở một phiếu có bút toán đi kèm.

> 93 phiếu trong bộ dữ liệu demo.

---

## Bước 6 — Xem bút toán (mắt xích đã đóng)

**Menu trái → `KẾ TOÁN & TÀI CHÍNH` → `Sổ kế toán`**

Mở một bút toán sinh ra từ phiếu nhập kho. Chỉ vào dòng bút toán:

```
Nợ 156   Tồn kho
Nợ 1331  Công nợ nhà cung cấp
      Có 331
```

> **Câu nói:** *"Nhập kho một lần, hệ thống tự ghi hai bút toán — tồn kho và công nợ
> NCC. Trước đây 39 đơn nhập hàng không sinh bút toán, tức là tiền hàng về kho
> mà sổ cái không biết."*

---

## Bước 7 — So sánh báo giá nhà cung cấp

**Menu trái → `TRỢ LÝ AI` → `So sánh báo giá NCC`**

So nhiều báo giá của các NCC khác nhau cho cùng một mã hàng.

---

## Bước 8 — Chỉ số chuỗi cung ứng

**Menu trái → `TRỢ LÝ AI` → `Chỉ số chuỗi cung ứng`**

Bảng KPI: tồn kho, vòng quay tồn kho, tồn chết, giao hàng cho NCC.

> Lần trước tính lead time từ dữ liệu PO: **0/20 đơn có số liệu**. Sau khi sửa:
> **57/57**. Đây là màn hình thể hiện điều đó.

---

## Bước 9 — Bằng chứng thực nghiệm

**Menu trái → `TRỢ LÝ AI` → `Bằng chứng thực nghiệm`**

Backtest có số đo, kèm nguồn và giới hạn.

> Khi bị hỏi *"số này từ đâu?"* → **mọi con số trên màn này có một lệnh kiểm tra
> tương ứng**. Nói tên lệnh ra được (`npm run check:supply`, `npm run
> measure:evidence`, `npm run demo:check`).

---

## Bước 10 — Trợ lý kinh doanh

**Menu trái → `Phân tích` → `Trợ lý KD`**

Gợi ý giá bán, gợi ý nhập hàng, sức khỏe doanh nghiệp — đều kèm nguồn số liệu.

---

## Ba chỗ nên dừng lâu

| Bước | Vì sao |
|---|---|
| **1 và 2** | Trả lời trực tiếp phàn nàn *"vai trò thật sự của LLM chưa rõ"* của vòng 1 |
| **6** | Con số 39 PO là lỗi **đo được trước/sau**, không phải cam kết |
| **9** | Cách duy nhất để trả lời *"chỉ số của các bạn lấy từ đâu?"* mà không bịa |

---

## Nếu giám khảo hỏi

| Câu hỏi | Trả lời bằng gì |
|---|---|
| "AI làm gì, công thức không làm được?" | Bước 1. Phần còn lại (ROP, BOM, tồn tối thiểu) **cố ý làm bằng công thức** |
| "Có phải AI tự quyết không?" | **Không.** Bước 3 — phải tick ô xác nhận và bấm Duyệt |
| "Hàng rào có chạy thật không?" | Bước 2 — bấm nút, hàng rào chuyển sang báo chặn |
| "Độ chính xác bao nhiêu?" | **Chưa công bố được.** 85,71 % nhưng đo trên nhãn mà ta biết sai 7/8 ca. Nói thẳng, đừng sửa rồi báo lại |
| "Có người dùng thật chưa?" | **0/6.** Không bịa |
| "Sao không dùng model mạnh hơn?" | Ba model khác hàng cho cùng kết quả — nút cần siết không phải nút model |
