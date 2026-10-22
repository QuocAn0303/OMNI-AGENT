# Hướng dẫn người điều phối (đọc trước khi mời người thử)

> `BLOCKER-HUMAN`: đội phải tự tuyển và tự chạy. Agent không được liên hệ người thật.

---

## 1. Mục tiêu đo (đừng đổi)

1. **Thời gian thao tác** — mỗi người thử mất bao lâu cho mỗi điều kiện (chính).
2. **Mức lệch với hệ thống** — quyết định tay của họ xa số đề xuất của hệ thống bao
   xa (chỉ số phụ, không phải chỉ số chính).
3. **Họ có dùng hệ thống hằng ngày không** — câu hỏi tự khai, trả lời nguyên văn.

**Không** đo: "ý kiến về giao diện", "có thích AI không", "sẽ trả bao nhiêu".

## 2. Counterbalance — không được lệch

Mỗi người thử làm **cả hai** điều kiện, nhưng thứ tự ngược nhau để không ai luôn gặp
bài "đối chứng" trước (người học nhanh sẽ mang kinh nghiệm sang bài sau):

| Nhóm | Bài 1 (không hệ thống) | Bài 2 (có hệ thống) | Số người |
|---|---|---|---:|
| **AB** | bộ SKU **A** | bộ SKU **B** | 3 |
| **BA** | bộ SKU **B** | bộ SKU **A** | 3 |

Với 6 người: `P01, P03, P05` vào nhóm AB · `P02, P04, P06` vào nhóm BA.
Với người thứ 7 (nếu có): xen kẳ, nhưng **vẫn cân bằng tổng số AB = số BA**.

Hai bộ SKU **tương đương về phân phối** và **không trùng mã SKU** (kiểm chứng: số SKU
trùng mã in trong `sku-sets.md` phải bằng **0**).

## 3. Cột nào cho ai

| Cột trong `sku-sets.md` | Bài 1 | Bài 2 |
|---|:---:|:---:|
| SKU, Tên | ✅ | ✅ |
| Tồn khả dụng (ATP) | ✅ | ✅ |
| Nhu cầu/ngày | ✅ | ✅ |
| Thời gian nhận hàng | ✅ | ✅ |
| Giá vốn | ✅ | ✅ |
| **Hệ thống đề xuất** | ❌ **KHÔNG** | ✅ |
| Tồn kho an toàn (SS), Điểm đặt lại (ROP) | ❌ | ✅ |
| Đang trên đường (`onOrder`), `minStock`, Ước tính tiền | tuỳ chọn | tuỳ chọn |

Nếu bài 1 mà lọt cột "Hệ thống đề xuất" thì **phiên đó hỏng, làm lại từ đầu**.

## 4. Bấm giờ

- Dùng [`timer-sheet.md`](timer-sheet.md) hoặc đồng hồ điện thoại.
- Bắt đầu khi đọc xong câu "**bắt đầu**"; dừng khi người thử nói "xong" hoặc hết 20 phút.
- Ghi **số giây** (không làm tròn phút) vào `seconds`.
- Người thử dừng giữa chừng vì lý do riêng (con nhỏ, cửa hàng bận): ghi số giây đã làm
  và ghi chú lý do; **không** xoá phiếu đó khỏi tổng hợp, cứ để script xử lý.

## 5. Văn phong

- Ngồi **im**, không gật đầu "đúng rồi", không nhìn bảng của họ.
- Trả lời câu hỏi phiếu bằng **nguyên văn**: "Người thử nói: …".
- Không giải thích hệ thống, không giải thích công thức. Người thử hỏi "cái này
  tính thế nào?" thì trả lời: *"Bạn cứ đoán xem họ tính thế nào, rồi so với ý bạn."*
- Nếu người thử bỏ bài giữa chừng: vẫn hỏi Phần 3, vẫn ghi phiếu.

## 6. Sau phiên (5 phút)

1. Điền `seconds`, `confidence_before/after`, `would_use`, `note` vào
   [`results/tasks.template.csv`](../results/tasks.template.csv).
2. Chép số lượng từ giấy vào `decisions.csv` theo `participant_id, set_key, sku, manual_qty`.
   **Không** sửa lại số của họ, kể cả khi có vẻ sai. Sai là dữ liệu.
3. Ghi lại `group` (AB/BA) và `set_key` đúng như đã thực hiện.
4. Phiếu giấy gốc: cất, không chụp ảnh tải lên nơi công khai. Không ghi tên vào bất kỳ
   tệp nào.

## 7. Kiểm tra trước khi mời người thử

- [ ] `node scripts/usertest/build-scenario.js` chạy lại được, `sku-sets.md` có 2 bảng
      20 dòng, **số SKU trùng mã = 0**.
- [ ] In bài 1 **không** có cột đề xuất; in bài 2 **có**.
- [ ] Phiếu đồng ý in sẵn (`consent-form.md`).
- [ ] Sẵn sàng câu trả lời "nếu họ hỏi đề xuất có đúng không": *"Tôi không có câu trả lời
      cho bạn hôm nay — tôi cũng đang ở trong vai người thử."*
- [ ] Bút chì + giấy nháp + đồng hồ.
