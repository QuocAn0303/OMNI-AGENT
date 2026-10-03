# Hướng dẫn gán nhãn khớp SKU (đội làm tay)

**Cập nhật:** 2026-10-03 · **Nguồn phiếu:** `npm run llm:labels` → `data/aisc26/skus/labels/label-sheet.csv`

---

## 1. Vì sao cần bước này

Vai trò LLM #1 (khớp tên hàng trên sàn → SKU nội bộ) chỉ được công bố độ chính xác khi
có **nhãn tay**, theo `03-evaluation-protocol.md` §9 (S10). Không có nhãn tay thì mọi
con số precision/recall là **vô nghĩa** — `npm run llm:eval` sẽ in
`BLOCKER-HUMAN` và từ chối ra số.

**Cấm tuyệt đối:** dùng nhãn do LLM sinh, hoặc tự điền cột `label_sku` bằng cách
chạy thử hệ thống rồi chép lại kết quả. Làm vậy thì đo được "hệ thống khớp với
chính nó", và số đó sẽ đẹp một cách vô nghĩa.

## 2. File cần biết

| File | Ai được mở | Nội dung |
|---|---|---|
| `label-sheet.csv` | **Cả hai người gán** | 120 cặp. Cột nhãn **để trống**. |
| `truth.simulated.csv` | **Chỉ sau khi gán xong**, khi đối chiếu | Đáp án của bộ sinh tệp xuất đơn. **MÔ PHỎNG**, không phải thực tế. |

## 3. Cách gán (2 người, độc lập, mù)

Mỗi người làm một bản sao riêng của `label-sheet.csv`.

1. **Không xem kết quả của người kia** cho tới khi cả hai xong.
2. Với mỗi dòng, đọc `external_name` và 5 ứng viên `cand1..cand5`.
   - Ứng viên đã được **xáo trộn** (seed cố định) nên **không** mang thứ tự điểm của
     mô hình — cứ chọn theo hiểu biết của bạn.
3. Điền **`label_sku`**:
   - mã hàng đúng nhất trong 5 ứng viên; hoặc
   - để **trống** nếu **không ứng viên nào** đúng (đây là câu trả lời hợp lệ và
     quan trọng — đừng ép chọn để "cho đủ").
4. Điền **`label_confidence`**: `cao` | `trung bình` | `thấp`.
   Hết 5 ứng viên ⇒ bắt buộc `thấp`.
5. Điền **`label_note`** khi cần: ví dụ `tên trùng màu, cần ảnh`; `2 cái giống tên`.
6. Ghi tên/ngày của mình vào **`labeler_a`** (người A) và **`labeler_b`** (người B),
   mỗi người điền **cột của mình** ở bản gửi lại.

### Các ca phải gán `low` / `label_sku` trống

| Dấu hiệu | Vì sao |
|---|---|
| Tên trên sàn nói **chủng khác** với mọi ứng viên (ví dụ "hộp" vs "áo") | Ca này phải vào hàng đợi người, không phải đo bằng LLM |
| Hai ứng viên giống nhau đến mức không phân biệt được bằng tên | Nhãn bắt buộc `low` |
| Tên có quà/bảo hành kèm: `"2 TUÝ (HOT)"`, `"[CHUYEN SI]"`, `"- SALE"` | Vẫn khớp được, nhưng ghi `note` |
| Sai chính tự/đơn vị: `"dau goi 500ml"` vs `DAU-GOI-500` | Khớp được nếu chủng loại trùng |

### Không được làm

- Mở Google tìm tên sản phẩm rồi chọn theo kết quả tìm kiếm. Nhãn phải là quan niệm
  "tên này ứng với mã nào trong catalog ERP", không phải "tên này bán ở đâu".
- Bỏ dòng nào khó. Bỏ dòng = chọn điểm dễ = đo sai (S11 cấm loại SKU sau khi biết
  mô hình sai).
- Tự ý sửa `external_name` hoặc tên ứng viên.

## 4. Bất đồng thì làm gì

Sau khi cả hai gán xong, đối chiếu từng dòng:

| Tình huống | Cách xử lý |
|---|---|
| `label_sku` giống nhau | Chấp nhận. |
| Một người để trống, một người chọn | Người **thứ ba** phân xử; ghi kết quả vào `label_sku`, giữ cả 2 nhãn gốc ở `labeler_a`/`labeler_b`. |
| Chọn 2 mã khác nhau | Người thứ ba phân xử. Không lấy "đa số". |
| `label_confidence` lệch nhau | Giữ mức **thấp hơn** (thận trọng hơn). |

Độ đồng thuận đo bằng **Cohen's κ** và `npm run llm:eval` in ra. Quy tắc đã ký: **κ < 0,6
⇒ nhãn chưa đủ tin cậy**, phải báo kèm cảnh báo cạnh mọi con số.

## 5. Chạy đánh giá

```bash
# sau khi đã điền label_sku (một bản đã hợp nhất)
npm run llm:eval
```

Harness in ra (theo S10, không tự đổi):

- `precision / recall / F1` ở ngưỡng chốt trước **0,85**, trên tập **test**;
- `fallbackRate` (tỉ lệ chuyển người xác nhận) — luôn báo **cùng** độ chính xác;
- thời gian xử lý 1 cặp của đường lai và của baseline fuzzy;
- bootstrap F1(hybrid − fuzzy) seed `20261003`, 1000 lần; **chỉ nói "LLM tốt hơn" khi
  CI không chứa 0**;
- Cohen's κ của hai người gán;
- số lần gọi LLM, số lần dùng được, token/cặp (token chỉ có số khi đã chạy `live`).

Muốn chỉ kiểm tra máy chạy được (không công bố số): `npm run llm:eval -- --simulated`.

## 6. Nhãn phạm vi (bắt buộc nhớ)

Các cặp trong phiếu lấy từ **tệp xuất đơn mô phỏng theo định dạng Shopee**
(`docs/aisc26/notes/marketplace-format.md`), danh mục từ dataset công khai UCI Online
Retail II. Vì vậy:

- kết quả trên bộ này chứng minh **cơ chế** (đo được, tái lập được, so sánh được với
  đối chứng), **không** chứng minh độ chính xác trên dữ liệu sàn thật của Việt Nam;
- mọi bảng/slide phải ghi nhãn **MÔ PHỎNG** cạnh con số;
- nếu sau này có CSV xuất thật (đã đọc giấy phép cho phép), dùng cùng quy trình này
  và **ghi số riêng**, không trộn với số của bộ mô phỏng.

## 7. Nỗ lực ước lượng

| Việc | Thời gian |
|---|---|
| 120 cặp, mỗi người | ~45–60 phút |
| Đối chiếu + phân xử bất đồng | ~30 phút |
| Chạy `npm run llm:eval` và đọc kết quả | ~5 phút |