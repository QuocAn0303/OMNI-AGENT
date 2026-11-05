# Phần 4 — Tài chính, KPI, xuất dữ liệu và demo

## Mở demo

Đăng nhập ADMIN / MANAGER / WAREHOUSE / ACCOUNTANT, mở **/vn-supply-chain-demo**. Trang dùng Ant Design 6 và Axios chung. Backend mount **/api/vn-supply-chain**; không thay dữ liệu ERP thật.

Bấm Nhận & QC rồi Lên kệ trong bước 1 để thấy Q=200 chuyển thành on-hand/ATP=198, còn 2 lỗi. Bước 2 tạo ba đơn từ Shopee/TikTok/Website, reserved=9. Bước 3 xuất 9 đơn vị, còn 189. Bước 4 hai kiện giao thành công, một kiện COD thất bại ba lần, hoàn A=1/B=1/C=1: tồn bán được 191, lỗi 3. Bước 5 hiển thị báo cáo cùng nút mô phỏng hai tình huống.

State demo riêng theo tenant **và** user, giữ trong bộ nhớ, hết hạn sau 30 phút không hoạt động; tối đa 20 phiên/worker. Không có lưu bền/liên tiến trình. Mỗi bước đã hoàn tất có thể gọi lại mà không lặp nghiệp vụ. Khởi tạo lại chỉ ảnh hưởng phiên của chính người dùng.

## Một nguồn dữ liệu

- `metrics-finance.service.js`: tính từ nhật ký Phần 1, cộng chứng từ OMS/WMS của phiên demo qua `services/finance-normalizer.js`.
- Demo đóng băng giao dịch trong ngày 18–27/12/2026, nằm trong khoảng báo cáo 01/11–30/12. Giao dịch demo là phần bổ sung, không thay seed.
- Báo cáo có `reportId` tính từ nội dung. API, UI và mọi định dạng xuất lấy cùng một report snapshot; export có reportId cũ trả 409.
- Ngày cuối là 30/12: **60 ngày = 8 tuần + 4 ngày**, trình bày 8 tuần đầy đủ và dòng 4 ngày cuối kỳ. Không kéo dài tuần 8 thành 11 ngày, không bỏ 4 ngày.

## Chính sách tài chính công khai

Doanh thu ghi khi có kết quả giao. Gross revenue gồm giá trị được giao/thử giao trong kỳ, giảm trừ RTS và hàng đã hoàn; đơn còn vận chuyển chưa ghi doanh thu/COGS. COGS dùng FIFO theo từng hub/SKU, nhập lô theo giá PO thực tế nên bao gồm chênh giá NCC dự phòng. Hàng hoàn đạt QC quay lại FIFO theo giá vốn gốc; hàng lỗi ghi write-off, không cộng vào tồn bán được.

Tiền trả trước thu ngày xuất, COD chỉ thu ngày settlementDate T+3/T+5. COD chưa đối soát giữ trong receivable; không thu tiền đơn COD giao thất bại.

Theo chính sách mô phỏng Phần 4: **30% đặt cọc ngày PO, 70% Net 30 với chính / Net 15 với dự phòng**, tính từ ngày PO. Đây là điều khoản của mô hình tài chính, thay cho Net30/Prepaid ban đầu trong seed; nguồn PO gốc giữ nguyên. Lịch này tạo các dòng journal có sourceId, kể cả khoản đến hạn ngoài kỳ. Không gọi ngân hàng hoặc sửa công nợ ERP.

Đóng gói mặc định 3.000 VNĐ/đơn vị; tân trang seed 2.000 VNĐ/đơn vị hoàn đạt QC; chứng từ demo dùng phí tân trang thực ghi 5.000 VNĐ cho loại B. Chiều về GHN/GHTK giả định 50% cước đi mỗi đơn vị, các hãng khác 100%, hoặc lấy phí từ ReturnOrder. Chi phí vận hành và hoàn tiền trả trước giả định chi ngay ngày phát sinh. Số dư đầu kỳ 500 triệu VNĐ, sửa được bằng policy API JS. Không tính VAT, thuế thu nhập, lãi vay hay khấu hao.

P&L:
- netRevenue = grossRevenue − returnsValue
- grossProfit = netRevenue − cogs
- operatingProfit = grossProfit − vận chuyển hai chiều − lưu kho − nhặt/đóng gói − tân trang − hao hụt

Cash:
- closing = opening + prepaid + COD − refunds − deposit − supplier balance − cash operating expenses
- Write-off là chi phí phi tiền mặt, không trừ tiền lần nữa.
- Chi mua hàng khác COGS; không trừ COGS thêm trong Cash Flow.

Holding tính số hàng bán được cuối mỗi ngày × holdingCostPerDay. Báo cáo là toàn kỳ giả định không có thay đổi nào khác sau các sự kiện demo; lịch hợp đồng trong kỳ được xem đã thực hiện. Đây là dòng tiền mô phỏng lịch hợp đồng, không phải sao kê thanh toán thực.

## KPI

1. Customer Service: OTIF = đơn vị giao đúng SLA / đơn vị đã có kết quả giao; Fill Rate = lượng xuất / cầu; Cycle Time bình quân gia quyền lượng giao thành công; RTS/Returns = lượng thất bại hoặc khách hoàn / lượng có kết quả. Đơn đang giao hiển thị riêng. Seed dùng SLA mô phỏng, demo dùng kết quả thực của OMS theo clock mô phỏng.
2. Internal: bình quân tồn khả dụng theo giá FIFO; turnover = COGS / tồn bình quân; DOI = 60 / turnover; tỷ lệ logistics, gross margin; operating asset return = EBIT / (tồn khả dụng + COD phải thu bình quân).
3. Flexibility: thời gian nguồn backup về, sản lượng cấp thêm so với cầu nền 14 ngày và lượng khôi phục so với tình huống chưa xử lý, SLA trong giai đoạn đỉnh. Đây là mức đạt được với cấu hình nguồn lực của kịch bản, **không phải nghiệm tối ưu công suất không giới hạn**.
4. Product Development: doanh thu và tỷ trọng SKU SEASONAL; PO-to-shelf lấy ngày PO đến GRN đạt QC/lên kệ.

**ROA đầy đủ và Time-to-Market trả null có giải thích** vì nguồn chưa có tổng tài sản hoặc ngày bắt đầu phát triển mẫu. Không bịa dữ liệu hay coi 0 là chưa có. PO-to-shelf là chỉ số thay thế riêng, không đổi tên thành Time-to-Market.

## REST

Các endpoint mới có authenticate + authorize:
- GET /demo: phiên, trạng thái kho và report.
- POST /demo/step: `{step:1..5, phase?:'receive'|'putaway'}`.
- POST /demo/reset: `{}`.
- GET /metrics: cùng report trong demo.
- POST /scenarios: `{scenario:'delay'|'surge'}`, trả reportId và bảng trước–sau.
- GET /export?format=json|csv|xlsx&reportId=...: tải tệp, header X-Report-Id.
- Giữ tương thích /catalog, /operations, /audit, /shipping-quote từ Phần 1.

## Xuất bảng tính

Endpoint XLSX dùng **ExcelJS sẵn có của ứng dụng** để chạy được trên server triển khai, không phụ thuộc đường dẫn runtime của máy phát triển. Có Summary, PnL, CashFlow, KPI, EOQ_ROP, Scenarios, FinanceDaily, Journal, InventoryValue, toàn bộ bảng nguồn và Policy/Notes.

PnL có công thức doanh thu thuần/lợi nhuận; cash roll-forward liên kết kỳ trước; EOQ/ROP có SQRT/CEILING/ROUNDUP. Các công thức có kết quả cache bằng đúng API, bật fullCalcOnLoad. Công thức báo cáo dựa trên các cột đầu vào trong bảng xuất; sổ FIFO được tính server, không phải mô hình Excel tự tái lập mọi giao dịch khi sửa raw source. Muốn đổi chính sách/case phải tính lại server và xuất lại.

CSV dạng dài `table,row,field,value`, UTF-8 BOM, giữ đủ tất cả bảng trong một tệp, có escape chống formula injection. JSON là toàn bộ report. Tệp XLSX xuất được kiểm tra mở lại bằng ExcelJS và đối chiếu mọi số với report.

## Chạy kiểm tra

```powershell
npm test
cd frontend
npm run build
```

`tests/metrics-finance.test.js` có E2E HTTP thật qua Express → demo → OMS/WMS → tài chính → JSON/XLSX; kiểm tra phân quyền, phân tách tenant/user, idempotency, tiền COD, lịch NCC, FIFO dự phòng và đủ 60 ngày.
