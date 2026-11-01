-- STK nhận tiền chuẩn của nhà cung cấp (master data).
--
-- Vì sao thêm cột này: UC-004 đối chiếu 3 bên PO–GRN–Invoice phải so STK trên
-- hoá đơn với STK gốc trong master data. Không có cột thì không có nguồn sự thật
-- nào để so, và đề nghị thanh toán buộc phải lấy STK từ chính hoá đơn — đúng
-- đường mà kẻ chèn lệnh muốn.
--
-- Nullable: dữ liệu NCC cũ chưa có STK. Agent coi "master chưa có STK" là
-- fail-closed (không tạo đề nghị thanh toán), không đoán.
ALTER TABLE "vendors" ADD COLUMN "bankAccount" TEXT;
