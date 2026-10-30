# STATE-P5 — trạng thái gói P5 (T10: backtest + mô phỏng)

> File trạng thái **song song** của gói P5. Không sửa `STATE.md` / `DECISIONS.md` /
> `MORNING-REPORT.md` (đang có phiên khác dùng). Quyết định: `DECISIONS-P5.md`.

- **Ngày:** 2026-10-03 · **Nhánh:** `round2/p0-hardening` (không đổi nhánh, không push)
- **Hành vi đã xong trước đó:** T0–T4 (P1), T5 (P2), T7/T8 (P3), T6 (P2).

## RESUME HERE — gói tiếp theo: P6 (T11 demo end-to-end + T12 giao diện duyệt)

**Việc P5 đã xong hết. Việc tiếp theo là P6.**

Cần biết trước khi làm P6:

1. **P4 (T9) CHƯA CHẠY.** Không có `docs/aisc26/parallel/STATE-P4.md`. P6 (T11) cần
   dữ liệu **đã nạp vào ERP demo**, nên **P4 là điều kiện tiên quyết của P6** — hãy
   làm P4 trước P6 (xem mục "Bất thường phát hiện" bên dưới).
2. Bảng kết quả backtest đã có, **đừng chạy lại `npm run backtest`** nếu không cần:
   sẽ sinh thêm dòng trong sổ lần chạy và ghi đè `03-evaluation-results.md`.
3. Đóng băng tính năng **sau P6** (theo `PACKAGES.md`).

## Kết quả P5

| # | Việc của T10 | Trạng thái | Bằng chứng |
|---|---|---|---|
| 1 | Mô phỏng tồn kho đúng 8 quy tắc S4 | **DONE-VERIFIED** | `scripts/backtest/lib/simulate.js` |
| 2 | **Test tính tay** (không lấy đầu ra của chính nó) | **DONE-VERIFIED** | `tests/backtest-simulate.test.js` **20/20**; kịch bản 8 ngày × 2 cách đọc ngưỡng |
| 3 | Script `npm run backtest` | **DONE-VERIFIED** | `scripts/backtest/run.js` + `report.js`; chạy 6–10 s |
| 4 | Sổ lần chạy S11 (`backtest-runs.md` + `.jsonl`) | **DONE-VERIFIED** | 3 dòng, **không xoá dòng nào** |
| 5 | Chặn `slice != test` cho mọi hàm báo cáo (§3.2) | **DONE-VERIFIED** | `lib/metrics.js` `assertSlice` |
| 6 | 3 cửa sổ trượt S6 · LT 3/7/14 S4 · censored A/B S3 | **DONE-VERIFIED** | báo cáo, 6 bảng |
| 7 | Chỉ số chính S5 + số tuyệt đối bắt buộc | **DONE-VERIFIED** | `03-evaluation-results.md` |
| 8 | WAPE + bootstrap theo SKU S7 (seed `20261003`, 1000) | **DONE-VERIFIED** | `n = 471`, loại 27 SKU |
| 9 | Baseline `naive` + `seasonal-naive` S8 | **DONE-VERIFIED** | naive 130,55% · seasonal-naive 117,22% |
| 10 | **P5 (hành vi quan sát)** | **SKIPPED** | dataset không có dữ liệu mua/PO/GRN — D-P5-10 |
| 11 | Chạy lại từ sạch cho cùng kết quả | **DONE-VERIFIED** | `BT-20261003045340` giống hệt `BT-20261003045045` |
| 12 | Thí nghiệm có ràng buộc mức dịch vụ | **CHƯA LÀM** | xem "Việc người phải quyết" |

## Kết luận đã chốt (trích từ `03-evaluation-results.md`)

- **Bền:** P2 (ROP) thắng P1 (minStock cố định) — hiệu số **−0,4973**, CI 95%
  **[−0,6172; −0,3982]**, SKU thắng **80,04%**. Giữ ở cả 3 lead time và cả 2 nhánh censored.
- **Xấu, phải nói:** chỉ số chính **không có sàn dịch vụ** nên thưởng bán ít — bộ tinh
  chỉnh chọn `z = 0,80` (mức thấp nhất) ở cả 3 cửa sổ; P2 bán ít hơn P1 9,5%, mất bán
  nhiều hơn 31,5%, fill rate 69,51% vs 76,81%. **Không được tuyên bố "ROP tốt hơn".**
- **P2-vs-P4 đổi chiều giữa nhánh A và B** ⇒ phải ghi *"chưa vững — phụ thuộc cách xử lý
  ngày hết hàng"* (protocol §4.1).
- **WAPE > 100% cho mọi mô hình** — khả thi với chuỗi ngày nhiều ngày 0, không phải lỗi
  tính (có test). Dự báo nhu cầu vẫn thắng cả hai baseline dự báo.

## Bất thường phát hiện (quan trọng cho phiên sau)

1. **P4 chưa chạy** nhưng có tệp P4 **đang được tạo trong worktree** (thấy lúc 04:50:
   `scripts/dataset/import-erp-demo.js`, `scripts/dataset/gen-marketplace-orders.js`,
   `src/modules/import/sku-matcher.js`, `tests/sku-matcher.test.js`, `docs/aisc26/notes/
   marketplace-format.md` — tất cả **untracked**). P5 **không** chạm vào, **không**
   commit chúng. Trước khi làm P6 phải xác nhận P4 đã commit xong.
2. **`crostonDemandPerDay(qtySeries, alpha)` nhận `alpha` nhưng KHÔNG dùng** — tự suy
   `a = 1/(k+1)`. Đây là **lỗi tiềm ẩn của mã sản phẩm** (`replenishment.calc.js`).
   P5 không sửa (đổi hành vi đang chạy). **Backlog, nên sửa ở gói sau** — kèm test.
3. **Protocol §1 trích `automation.service.js:49,209` cho công thức P1 nhưng mã đó không
   còn công thức đó** (P0-4 đã thay bằng ROP qua `planReplenishment`). Nghĩa là "hiện
   trạng" trong thực tế **đã là ROP**, còn P1 của giao thức là một ngưỡng cố định
   **không còn tồn tại trong mã**. Cần nói khi trình bày; chưa sửa tài liệu (ngoài phạm vi).
4. `Z_BY_SERVICE_LEVEL` **đã bổ sung** `0.80 → 0.842`, `0.85 → 1.036` (cộng thêm, không
   đổi hành vi mức cũ). Cần có trong báo cáo "công thức dùng chung với sản phẩm".
5. `notes/backtest-runs.md` có **ghi chú về lỗi hiển thị** cột `positionMode` ở 2 dòng —
   đọc trước khi trích sổ.

## Việc con người phải quyết (BLOCKED-HUMAN)

| Việc | Vì sao không tự quyết được | Cách làm |
|---|---|---|
| ~~Có **tiền-đăng ký** hàm mục tiêu có ràng buộc dịch vụ…~~ | **ĐÃ LÀM Ở P5b (2026-10-03)** — xem "P5b" bên dưới | `§13.2` commit `69a7ba2` → `npm run backtest:exp2` → `BT2-20261003065054` |
| Duyệt CC BY 4.0 đủ cho mục đích trình bày | Quyết định pháp lý (đã ghi ở `02-data.md` §7) | https://creativecommons.org/licenses/by/4.0/ |
| Có chạy **thí nghiệm 3 tiền-đăng ký** với lưới rộng hơn (`z` → 0,99, `DOC` → 42) để trả lời *"ở ≥ 95% thì sao?"* không | Tốn thêm một `run_id` + một vòng đăng ký; thí nghiệm 2 đã cho thấy ràng buộc 95% **không khả thi** với lưới hiện có | `03-evaluation-results.md` §5.7 |

## P5b (2026-10-03) — thí nghiệm 2, post-hoc

| Việc | Trạng thái | Bằng chứng |
|---|---|---|
| `§13.2` đăng ký **trước** lần chạy | **DONE-VERIFIED** | commit `69a7ba2` |
| Mã thí nghiệm 2 (không ghi đè thí nghiệm 1) | **DONE-VERIFIED** | `scripts/backtest/run-exp2.js`, commit `60a2d84` |
| Chạy đúng **một lần**, ghi sổ S11 | **DONE-VERIFIED** | `BT2-20261003065054` trong `notes/backtest-runs.md` + `.jsonl` |
| Báo cáo 1 và 2 cạnh nhau | **DONE-VERIFIED** | `03-evaluation-results.md` §5 (mục 1–4 của thí nghiệm 1 **không sửa**) |
| Đính chính `automation.service.js:49,209` + backlog `crostonDemandPerDay` | **DONE-VERIFIED** | `03-evaluation-protocol.md` §13.2.5 |
| Thí nghiệm 1 không đổi hành vi | **DONE-VERIFIED** | chạy lại `--log=false`: mọi số tổng/mất bán/tồn dư **giống hệt**; `npx jest` 4058/4063 |

**Kết quả cần nhớ:** ràng buộc fill rate ≥ 95% **không khả thi** với cả 4 phương án.
Quy tắc dự phòng đã chọn mức dịch vụ cao nhất trong lưới. Ở cùng mức dịch vụ, ROP trói
ít vốn hơn P1 (CI loại 0, 99,24% SKU thắng, n = 132/500) — nhưng đó là **khám phá
post-hoc**, và câu hỏi "ở ≥ 95% thì sao" **vẫn chưa được trả lời**.

## Kiểm chứng P5 (2026-10-03)

| Lệnh | Kết quả | Loại |
|---|---|---|
| `npx jest tests/backtest-simulate.test.js` | **20/20** | mock (thuần, không DB) |
| `npx jest` (toàn bộ) | **4058/4063 pass** (71 suite, 5 skip) | mock |
| `npm run check:modules` | 203 module load được | — |
| `npm run backtest -- --slice=test` | `BT-20261003045045`, 6,3 s | dữ liệu công khai, **không DB** |
| chạy lại từ sạch | `BT-20261003045340` — **mọi bảng giống hệt** | idem |

**P5 không chạm DB, không chạm backend, không đụng cổng 4000.**

## Tệp P5 tạo/sửa

```
scripts/backtest/run.js                 CLI + điều phối
scripts/backtest/report.js              gộp cửa sổ, dựng bảng, ghi sổ S11
scripts/backtest/lib/dataset.js         nạp CSV → mảng dày (trục lịch 739 ngày)
scripts/backtest/lib/demand.js          censored A/B, Croston alpha tường minh
scripts/backtest/lib/simulate.js        8 quy tắc S4 + chỉ số chính S5
scripts/backtest/lib/policies.js        P1–P4 (P5 = SKIPPED)
scripts/backtest/lib/metrics.js         assertSlice, WAPE, bootstrap theo SKU
scripts/backtest/lib/windows.js         3 cửa sổ trượt S6
tests/backtest-simulate.test.js         test tính tay (20 assertion)
docs/aisc26/03-evaluation-protocol.md   + §13.1 (11 điểm diễn giải, TRƯỚC lần chạy)
docs/aisc26/03-evaluation-results.md    KẾT QUẢ (bảng sinh tự động + phần tay)
docs/aisc26/notes/backtest-runs.md      sổ S11 (3 dòng, không xoá)
docs/aisc26/notes/backtest-runs.jsonl   sổ S11 dạng máy
docs/aisc26/parallel/STATE-P5.md        file này
docs/aisc26/parallel/DECISIONS-P5.md    7 quyết định tự quyết
src/modules/replenishment/replenishment.calc.js   + z 0.80 / 0.85
package.json                            + script `backtest`
```

## Hash P5

| Commit | Nội dung |
|---|---|
| `43db39b` | mã backtest + test + §13.1 protocol + DECISIONS-P5 + sổ lần chạy (ghi **trước** lần chạy) |
| commit tiếp theo | kết quả `03-evaluation-results.md` + STATE-P5 này |

## Nếu phải chạy lại backtest

```bash
# KHÔNG đụng DB. Chạy lại sẽ THÊM một dòng vào notes/backtest-runs.md (S11: không xoá).
$env:BACKTEST_NOTE="ly do chay lai"; npm run backtest -- --slice=test

# Chạy nhanh để kiểm tra, KHÔNG ghi sổ:
node scripts/backtest/run.js --slice=test --log=false

# Chỉ một phương án / một lead time (tiết kiệm thời gian khi sửa lỗi):
node scripts/backtest/run.js --slice=test --log=false --lead-times=7 --branches=A
```

Phần tay trong `03-evaluation-results.md` nằm giữa hai MARKER
(`<!-- PHAN-TAY-BAT-DAU -->` / `<!-- PHAN-TAY-KET-THUC -->`) và **được giữ lại**
khi chạy lại. Phần bảng là sinh tự động — muốn đổi thì sửa giao thức rồi chạy lại,
đừng sửa tay.
