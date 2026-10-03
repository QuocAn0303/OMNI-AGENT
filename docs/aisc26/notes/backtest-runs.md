# Sổ ghi mọi lần chạy backtest (S11)

**Không xoá dòng nào.** Lần chạy bị thay thế giữ nguyên và đánh dấu `superseded`.
Cột "commit giao thức" là commit của `docs/aisc26/03-evaluation-protocol.md`.

| run_id | thời điểm | commit mã | commit giao thức | dataset + sha256 | lệnh | positionMode | seed | slice | chỉ số chính (TB cửa sổ) | ghi chú |
|---|---|---|---|---|---|---|---|---|---|---|
| BT-20261003044518 | 2026-10-03T04:45:18.580Z | 977a40b | 1f1a402 | daily_sku.csv `82f068efa759` | `npm run backtest -- --slice=test --windows=3 --lead-times=7 --branches=A` | withOnOrder | 20261003 | test | P1=2.8962 P2=2.4156 P3=2.5330 P4=2.1674 | smoke kien thuc (lead-times=7, branches=A) - KHONG phai lan chay giao thuc chinh |
