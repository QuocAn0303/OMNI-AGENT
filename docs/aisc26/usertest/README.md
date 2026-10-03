# Bộ công cụ bài thử người dùng — OmniAgent (T15)

**Mục đích duy nhất:** đo **thời gian thao tác** và **mức độ khác biệt giữa quyết định
tay với đề xuất của hệ thống**, trên một bài toán tồn kho giống hệt luồng demo Vòng 2.

> **Đây là `BLOCKER-HUMAN`.** Agent **không** được tuyển, liên hệ, hay nhắn tin cho
> người thật (hiến pháp `NIGHT-PROMPT.md` mục 3). Tài liệu này chỉ chuẩn bị sẵn; đội
> phải tự chạy.

---

## 1. Danh mục tệp

| Tệp | Dùng để |
|---|---|
| [`README.md`](README.md) | tệp này — bản đồ bộ công cụ + nhanh 4 bước |
| [`task-script.md`](task-script.md) | **chữ đọc cho người thử**, dùng nguyên văn, không sửa |
| [`moderator-guide.md`](moderator-guide.md) | hướng dẫn người điều phối: counterbalance, bấm giờ, câu hỏi, cấm dẫn dắt |
| [`consent-form.md`](consent-form.md) | mẫu đồng ý tham gia + bảo mật ẩn danh |
| [`timer-sheet.md`](timer-sheet.md) | phiếu bấm giờ, in ra giấy, điền tay |
| [`decision-sheet.md`](decision-sheet.md) | phiếu điền số lượng đặt, 20 dòng mỗi bộ SKU |
| [`sku-sets.md`](sku-sets.md) | **hai bộ SKU 20/20** sinh tự động từ tenant demo, kèm số tham chiếu |
| [`sku-sets.json`](sku-sets.json) | tệp máy đọc (số tham chiếu + kịch bản chấm điểm), có `sha256` |
| [`grading.md`](grading.md) | cách chấm quyết định tay (P4) bằng **cùng bộ mô phỏng** với backtest |
| [`results/README.md`](results/README.md) | nơi đặt kết quả thật (không commit dữ liệu người thử thật) |
| [`results/tasks.template.csv`](results/tasks.template.csv) | mẫu CSV thời gian/tự tin |
| [`results/decisions.template.csv`](results/decisions.template.csv) | mẫu CSV quyết định |
| [`sample/`](sample/) | bộ **SAMPLE** (số bịa) để thử script, **không dùng để kết luận** |

## 2. Bốn bước

```bash
# 1) Sinh lại kịch bản (chỉ đọc DB local, không ghi gì)
npm run usertest:scenario

# 2) In bảng SKU cho từng điều kiện ra giấy (thư mục `print/` KHÔNG commit)
node scripts/usertest/print-sheets.js --out docs/aisc26/usertest/print

# 3) Thu kết quả vào results/tasks.csv + results/decisions.csv (theo mẫu)

# 4) Tổng hợp + chấm P4
npm run usertest:summarize -- \
  --tasks docs/aisc26/usertest/results/tasks.csv \
  --decisions docs/aisc26/usertest/results/decisions.csv
```

Chạy thử đường chấm mà **không cần người thử**:

```bash
npm run usertest:summarize -- --make-sample   # sinh bộ SAMPLE
npm run usertest:summarize -- --sample        # chạy, in nhãn SAMPLE ở đầu bảng
```

## 3. Quy tắc bất di bất dịch khi báo cáo kết quả

1. **Dưới 5 người thử: chỉ báo trung vị + khoảng min–max.** Không phần trăm, không
   trung bình, không p-value, **không nói "có ý nghĩa thống kê"**. Script in cảnh báo
   này và cố tình không có đường tính kiểm định thống kê.
2. **Kịch bản là dữ liệu MÔ PHỎNG.** Dựng từ UCI Online Retail II (CC BY 4.0), giá
   tính bằng sterling. Đây là số của tệp công khai, **không** phải số của doanh
   nghiệp Việt Nam nào.
3. **Chấm P4 là mô phỏng có nhìn trước.** Chân trời chấm là 14 ngày nhu cầu gần nhất
   của chính SKU đó ⇒ mọi người thử được chấm trên cùng một kịch bản, nhưng ta đã
   biết trước kịch bản. Chỉ dùng để **so tương đối tay-vs-hệ thống**, không dùng để
   tuyên bố hiệu quả.
4. **Mỗi câu trả lời tự do phải trích nguyên văn** sau khi được phép ghi; không tóm
   tắt thành "họ nói là hài lòng".
5. **Không gắn tên người thử vào bất kỳ tệp nào.** Chỉ dùng mã `P01…P06`.

## 4. Nhãn dữ liệu (điền sẵn, đừng đổi)

| Nhãn | Ý nghĩa |
|---|---|
| **SAMPLE** | số bịa sinh bằng máy để thử script. **Không bao giờ** trích ra báo cáo. |
| **MÔ PHỎNG** | số chạy trên kịch bản MÔ PHỎNG (UCI Online Retail II, CC BY 4.0). |
| **CHƯA CÓ DỮ LIỆU** | chưa chạy. Tuyệt đối không điền số ước lượng vào chỗ này. |

## 5. Khi nào coi là xong

- [ ] ≥ 6 phiếu (hoặc ghi rõ là dừng ở mấy người) trong `results/`.
- [ ] Mỗi người thử làm **cả hai** điều kiện, thứ tự counterbalance.
- [ ] `npm run usertest:summarize` chạy được, in ra bảng.
- [ ] Hạn chế mục 3 được chép nguyên văn vào báo cáo/tài liệu trình bày.
