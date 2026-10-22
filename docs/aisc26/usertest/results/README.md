# Thư mục `results/` — nơi đặt kết quả thật

> **Không commit dữ liệu người thử thật vào repo.** Tệp được track trong git chỉ là
> **mẫu** (`*.template.csv`) với các cột số để trống.

## Quy ước đặt tên

| Tệp | Nội dung |
|---|---|
| `tasks.csv` | 1 dòng / 1 người thử / 1 điều kiện — thời gian, tự tin, câu trả lời nguyên văn |
| `decisions.csv` | 1 dòng / 1 người thử / 1 SKU — số lượng họ chọn |
| `raw/` | ảnh phiếu giấy (nếu đội muốn lưu) — **để ngoài repo** |

## Mẫu cột

`tasks.template.csv`

```
participant_id,consent,group,condition,set_key,seconds,confidence_before,confidence_after,would_use,note
```

- `participant_id` — `P01`…`P06`, **không** tên thật.
- `consent` — `yes` / `no`. Dòng `no` bị loại khỏi mọi phân tích.
- `group` — `AB` hoặc `BA` (counterbalance).
- `condition` — `COND1_NO_SYSTEM` hoặc `COND2_WITH_SYSTEM`.
- `set_key` — `A` hoặc `B`: bộ SKU **đã in** cho phiên đó.
- `seconds` — số **giây** nguyên, không làm tròn.
- `would_use` — `yes` / `no` / `maybe`.
- `note` — trích **nguyên văn** câu 2 và câu 3, trong một ô, dùng ` | ` làm dấu tách.

`decisions.template.csv`

```
participant_id,set_key,sku,manual_qty,note
```

- Ô không làm tới ⇒ **không** tạo dòng (đừng điền 0).
- `note` để trống, hoặc ghi `CHUA CO DU LIEU` cho dòng mẫu.

## Chạy chấm

```bash
npm run usertest:summarize -- \
  --tasks docs/aisc26/usertest/results/tasks.csv \
  --decisions docs/aisc26/usertest/results/decisions.csv
```

## Hiện trạng

**CHƯA CÓ DỮ LIỆU** — chưa có người thử nào chạy. Mọi ô trong `*.template.csv` để
trống có chủ đích; xem [`../FILL-IN.md`](../../FILL-IN.md) mục người thử.
