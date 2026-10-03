# Sổ ghi mọi lần chạy backtest (S11)

**Không xoá dòng nào.** Lần chạy bị thay thế giữ nguyên và đánh dấu `superseded`.
Cột "commit giao thức" là commit của `docs/aisc26/03-evaluation-protocol.md`.

| run_id | thời điểm | commit mã | commit giao thức | dataset + sha256 | lệnh | positionMode | seed | slice | chỉ số chính (TB cửa sổ) | ghi chú |
|---|---|---|---|---|---|---|---|---|---|---|
| BT-20261003044518 | 2026-10-03T04:45:18.580Z | 977a40b | 1f1a402 | daily_sku.csv `82f068efa759` | `npm run backtest -- --slice=test --windows=3 --lead-times=7 --branches=A` | withOnOrder | 20261003 | test | P1=2.8962 P2=2.4156 P3=2.5330 P4=2.1674 | smoke kien thuc (lead-times=7, branches=A) - KHONG phai lan chay giao thuc chinh |
| BT-20261003045045 | 2026-10-03T04:50:46.854Z | 43db39b | 1f1a402 | daily_sku.csv `82f068efa759` | `npm run backtest -- --slice=test` | undefined | 20261003 | test | P1=3.0905 P2=2.5796 P3=2.6649 P4=2.3505 | LAN CHAY GIAO THUC DAU - commit ma 43db39b, protocol 1f1a402 + §13.1 |
| BT-20261003045340 | 2026-10-03T04:53:40.524Z | 43db39b | 1f1a402 | daily_sku.csv `82f068efa759` | `npm run backtest -- --slice=test` | undefined | 20261003 | test | P1=3.0905 P2=2.5796 P3=2.6649 P4=2.3505 | KIEM TRA TAI LAP: chay lai tu sach, ket qua phai giong het run BT-20261003045045 |

> **GHI CHÚ (2026-10-03, viết sau khi chạy):** hai dòng `BT-20261003045045` và
> `BT-20261003045340` in ra cột `positionMode` là `undefined`. Đây là **lỗi hiển thị**
> của chính script sinh sổ (đọc `opts.positionMode` trong khi mã đã đổi thành
> `opts.positionModes`), **không phải lỗi dữ liệu**: cả hai lần chạy đều dùng
> `positionModes = withOnOrder,atpOnly`, đúng bằng giá trị mà dòng
> `BT-20261003044518` chạy trước đó đã in ra, và đúng bằng giá trị nằm trong báo cáo
> (`03-evaluation-results.md`, dòng "Lead time / positionMode"). Mã đã sửa **sau**
> lần chạy cuối; mọi **số chỉ số** trong hai dòng trên là đúng. Không sửa dòng đã ghi
> (S11).
