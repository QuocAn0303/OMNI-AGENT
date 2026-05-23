Mở đầu - Vấn đề (30 giây): "Doanh nghiệp SMB Việt Nam đang dùng rời rạc 5-7 phần mềm: MISA cho kế toán, KiotViet cho POS, file Excel cho lương, riêng phần thuế HTKK và hóa đơn điện tử lại phải nhập tay 2 lần. Mỗi tháng kế toán mất 3-5 ngày chỉ để ráp số liệu."

Giải pháp - Aduu (1 phút): Hệ thống ERP All-in-One, 7 module nền tảng + 4 phase mở rộng, được thiết kế cho đặc thù VN ngay từ đầu.

Demo flow (3-4 phút) - chạy theo thứ tự nghiệp vụ thật:

Đăng nhập admin@erp.com → Dashboard tổng quan
POS: quét barcode → tính khuyến mãi tự động → tích điểm loyalty → in hóa đơn PDF
Đơn hàng vừa tạo → /einvoice → bấm "Phát hành" → ra mã CQT của VNPT
Kho: xem tồn theo lot/serial/hạn dùng → tạo phiếu chuyển kho
Sản xuất: BOM đa cấp explode ra nguyên liệu lá → Work Order start/complete → kho tự trừ NL, cộng thành phẩm
Kế toán: mọi giao dịch ở trên đã tự động hạch toán double-entry → xem ngay P&L, Balance Sheet
/tax-reports → chọn tháng → xuất XML 01/GTGT đúng schema HTKK → nộp được luôn
/integrations (mới) → cấu hình VNPT/SMTP/SMS bằng UI, không cần redeploy
Điểm khác biệt (1 phút):

Tuân thủ thuế VN end-to-end: HTKK XML, PIT 7 bậc, BHXH D02-LT, VNPT e-invoice
Đối soát ngân hàng tự động từ sao kê VCB/TCB
Tài sản cố định: cron khấu hao tự động + autopost
Đa tenant, multi-currency, real-time (Socket.IO + Redis)
An toàn: Audit log, JWT + refresh, AES-256-GCM cho secrets
Tech stack (30s): Node.js + Express + Prisma 7 + PostgreSQL + React 19 + Ant Design 6, Docker + Railway, Sentry monitoring.

Tổng kết (30s): ~50 models, 30+ module nghiệp vụ, sẵn sàng deploy production. Đã hoàn thành 4 phases mở rộng và mới tích hợp Integration Center cho phép quản trị viên đổi VNPT/SMTP key qua UI mà không cần SSH server.
