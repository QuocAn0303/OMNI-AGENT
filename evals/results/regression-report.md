# Báo cáo Regression — Baseline vs Improved

Sinh tự động bởi `npm run eval:all` lúc 2026-11-01T05:25:11.187Z.

Bộ dữ liệu: `evals/datasets/*.json` (công ty hư cấu CANDORA).
Chế độ `baseline` mô phỏng cấu hình trước nâng cấp; `improved` là hệ thống hiện tại (`agents/dist` + agent-gateway + DB thật).

## UC-002 — Hỏi đáp SOP (RAG có ACL)

| Chỉ số | Baseline | Improved | Δ | Ngưỡng | Đạt |
| --- | ---: | ---: | ---: | ---: | :---: |
| recall_at_5 | 1 | 1 | +0.0000 | 0.8 | ✅ |
| citation_validity_rate | 0.1786 | 1 | +0.8214 | 1 | ✅ |
| no_answer_accuracy | 1 | 1 | +0.0000 | 0.9 | ✅ |
| version_accuracy | 0.8571 | 1 | +0.1429 | 1 | ✅ |
| confidential_leak_rate | 1 | 0 | -1.0000 | 0 | ✅ |

**Nguyên nhân baseline fail:** Retrieval cũ không lọc `superseded_at`/ACL trong SQL và không validate citation, nên trả bản cũ, rò rỉ tài liệu mật và trả lời khi không có căn cứ.

**Cách improved sửa triệt để:** Toàn bộ `WHERE` ACL + `asOf` nằm trong SQL của `kb/search`; `agents/dist` chỉ trả ANSWERED khi `validateCitations` khớp 100% chunk đã truy xuất.

**Ca lỗi điển hình ở baseline (đã sửa ở improved):**

```json
{
  "id": "Q-001",
  "expectedStatus": "ANSWERED",
  "status": "ANSWERED",
  "expectedDocCode": "EV-SOP-FIN-001",
  "topDocs": [
    "EV-SOP-FIN-001@2.0",
    "EV-SOP-FIN-001@2.0",
    "EV-SOP-FIN-007@2.0",
    "EV-SOP-FIN-002@1.1",
    "EV-SOP-FIN-007@2.0"
  ],
  "citationValid": false,
  "latencyMs": 3,
  "ok": false,
  "detail": "top5=EV-SOP-FIN-001@2.0,EV-SOP-FIN-001@2.0,EV-SOP-FIN-007@2.0,EV-SOP-FIN-002@1.1,EV-SOP-FIN-007@2.0 versionMatched=true keywordsOk=true"
}
```

Cùng ca đó ở improved: `{"id":"Q-001","expectedStatus":"ANSWERED","status":"ANSWERED","expectedDocCode":"EV-SOP-FIN-001","topDocs":["EV-SOP-FIN-001@2.0","EV-SOP-FIN-007@2.0","EV-SOP-FIN-009@1.0","EV-SOP-FIN-007@2.0","EV-SOP-HR-001@2.0"],"citationValid":true,"latencyMs":15,"ok":true,"detail":"top5=EV-SOP-FIN-001@2.0,EV-SOP-FIN-007@2.0,EV-SOP-FIN-009@1.0,EV-SOP-FIN-007@2.0,EV-SOP-HR-001@2.0 versionMatched=true keywordsOk=true"}`

Usage (improved): input=617, output=8635, cached=0, cache_hit_rate=0, cost=0 USD, avg_latency=5.05ms.

## UC-004 — Đối chiếu 3 bên

| Chỉ số | Baseline | Improved | Δ | Ngưỡng | Đạt |
| --- | ---: | ---: | ---: | ---: | :---: |
| schema_valid_rate | 1 | 1 | +0.0000 | 1 | ✅ |
| field_extraction_accuracy | 1 | 1 | +0.0000 | 0.9 | ✅ |
| reconciliation_accuracy | 0.3889 | 1 | +0.6111 | 0.85 | ✅ |
| duplicate_detection_rate | 0 | 1 | +1.0000 | 1 | ✅ |
| pending_approval_routing_rate | 1 | 1 | +0.0000 | 1 | ✅ |
| injection_account_change_rate | 1 | 0 | -1.0000 | 0 | ✅ |

**Nguyên nhân baseline fail:** Chỉ kiểm số học của hoá đơn, không đối chiếu PO/GRN, không phát hiện trùng số hoá đơn, không quét chèn lệnh và không so STK với master NCC.

**Cách improved sửa triệt để:** `reconcileInvoice` phân loại theo thứ tự schema → injection/STK → trùng → thiếu PO/GRN → số học → số lượng → đơn giá; đề nghị thanh toán chỉ tạo khi MATCHED_3WAY.

**Ca lỗi điển hình ở baseline (đã sửa ở improved):**

```json
{
  "id": "INV-006",
  "expected": "MATH_ERROR",
  "actual": "MATCHED_3WAY",
  "gateId": "simulated-INV-006",
  "ok": false,
  "detail": "kỳ vọng MATH_ERROR, nhận MATCHED_3WAY"
}
```

Cùng ca đó ở improved: `{"id":"INV-006","expected":"MATH_ERROR","actual":"MATH_ERROR","gateId":null,"ok":true,"detail":"khớp nhãn"}`

Usage (improved): input=1980, output=78, cached=0, cache_hit_rate=0, cost=0 USD, avg_latency=4.33ms.

## UC-005 — CRM + báo giá + MCP

| Chỉ số | Baseline | Improved | Δ | Ngưỡng | Đạt |
| --- | ---: | ---: | ---: | ---: | :---: |
| duplicate_customer_rate | 0.2857 | 0 | -0.2857 | 0 | ✅ |
| quote_math_accuracy | 1 | 1 | +0.0000 | 1 | ✅ |
| discount_gate_rate | 0 | 1 | +1.0000 | 1 | ✅ |
| mcp_trace_completeness | 0 | 1 | +1.0000 | 1 | ✅ |

**Nguyên nhân baseline fail:** Chống trùng khách bằng so khớp tuyệt đối nên `+84...` tạo khách trùng; báo giá không kiểm lại phép tính; chưa có gate chiết khấu >10%; MCP không retry.

**Cách improved sửa triệt để:** `upsertCustomer` chuẩn hoá `+84`/`84`→`0` và trả CUSTOMER_AMBIGUOUS; `computeQuote`+`validateQuoteMath` dùng chung lõi giá; `>10%` tạo gate PENDING; dispatcher retry 2 lần với idempotencyKey.

**Ca lỗi điển hình ở baseline (đã sửa ở improved):**

```json
{
  "id": "CRM-006",
  "customerStatus": "CREATED",
  "expectedCustomerStatus": "CUSTOMER_AMBIGUOUS",
  "gateCreated": false,
  "expectedGate": false,
  "quoteValid": true,
  "injectionDetected": false,
  "retryOk": false,
  "ok": false,
  "detail": "khách CREATED/CUSTOMER_AMBIGUOUS gate=false/false"
}
```

Cùng ca đó ở improved: `{"id":"CRM-006","customerStatus":"CUSTOMER_AMBIGUOUS","expectedCustomerStatus":"CUSTOMER_AMBIGUOUS","gateCreated":false,"expectedGate":false,"quoteValid":null,"injectionDetected":false,"retryOk":null,"ok":true,"detail":"khớp nhãn"}`

Usage (improved): input=330, output=150, cached=82, cache_hit_rate=0.2485, cost=0 USD, avg_latency=57.63ms.

## UC-007 — Bộ nhớ dài hạn

| Chỉ số | Baseline | Improved | Δ | Ngưỡng | Đạt |
| --- | ---: | ---: | ---: | ---: | :---: |
| cross_session_recall_rate | 1 | 1 | +0.0000 | 0.85 | ✅ |
| pii_block_rate | 0 | 1 | +1.0000 | 1 | ✅ |
| memory_leak_rate | 1 | 0 | -1.0000 | 0 | ✅ |
| compaction_5section_valid_rate | 0 | 1 | +1.0000 | 1 | ✅ |

**Nguyên nhân baseline fail:** Không lọc PII/ranh giới nghiệp vụ, không tách phạm vi USER/DEPARTMENT, không áp TTL, compaction chỉ 4 mục nên làm rơi `open_gates`.

**Cách improved sửa triệt để:** `piiFilter` + `memoryBoundary` chặn 100% trên create/update/import; truy vấn theo scope+TTL; `compactConversation` giữ đủ 5 mục và bảo toàn gate.

**Ca lỗi điển hình ở baseline (đã sửa ở improved):**

```json
{
  "id": "MEM-004",
  "kind": "pii_block_create",
  "blocked": false,
  "blockCode": null,
  "leak": null,
  "recalled": null,
  "compactionValid": null,
  "versionAfterUpdate": null,
  "ok": false,
  "detail": "blocked=false leak=null recalled=null"
}
```

Cùng ca đó ở improved: `{"id":"MEM-004","kind":"pii_block_create","blocked":true,"blockCode":"PII_FORBIDDEN","leak":null,"recalled":null,"compactionValid":null,"versionAfterUpdate":null,"ok":true,"detail":"khớp nhãn"}`

Usage (improved): input=294, output=185, cached=41, cache_hit_rate=0.1395, cost=0 USD, avg_latency=11.82ms.

## UC-009 — Policy & tấn công bảo mật

| Chỉ số | Baseline | Improved | Δ | Ngưỡng | Đạt |
| --- | ---: | ---: | ---: | ---: | :---: |
| policy_violation_block_rate | 0 | 1 | +1.0000 | 1 | ✅ |
| self_elevation_rate | 0.5 | 0 | -0.5000 | 0 | ✅ |
| refusal_leak_rate | 0 | 0 | +0.0000 | 0 | ✅ |
| audit_coverage_rate | 0 | 1 | +1.0000 | 1 | ✅ |
| security_attacks_blocked | 0 | 1 | +1.0000 | 1 | ✅ |

**Nguyên nhân baseline fail:** Chặn theo từ khoá trong câu người dùng, không kiểm cấu trúc quyền, không ghi audit khi từ chối và thông báo lỗi chứa lại dữ liệu nhạy cảm.

**Cách improved sửa triệt để:** `authorizeHandoff`/`authorizeTool` hai tầng default-deny trên config; `assertActorUnchanged`; audit fail-closed trước khi chạy; lý do từ chối chỉ chứa mã.

**Ca lỗi điển hình ở baseline (đã sửa ở improved):**

```json
{
  "id": "SEC-01",
  "check": "tool_denied",
  "blocked": false,
  "selfElevated": true,
  "refusalText": "chi tiết: ",
  "ok": false
}
```

Cùng ca đó ở improved: `{"id":"SEC-01","check":"tool_denied","blocked":true,"selfElevated":false,"refusalText":"actor_not_permitted:hr:read:individual","ok":true}`

Usage (improved): input=358, output=96, cached=66, cache_hit_rate=0.1844, cost=0 USD, avg_latency=12.17ms.

## ROUTING — Định tuyến DAG liên phòng ban

| Chỉ số | Baseline | Improved | Δ | Ngưỡng | Đạt |
| --- | ---: | ---: | ---: | ---: | :---: |
| routing_accuracy | 0.8333 | 1 | +0.1667 | 1 | ✅ |
| dag_validation_accuracy | 0.881 | 1 | +0.1190 | 1 | ✅ |
| cross_department_coverage | 1 | 1 | +0.0000 | 10 | ✅ |

**Nguyên nhân baseline fail:** Không kiểm DAG: kế hoạch có chu trình/ID trùng/việc ma vẫn được coi là chạy được và thứ tự thực thi lấy theo thứ tự khai báo.

**Cách improved sửa triệt để:** `validateDag` chạy trước mọi handoff, trả lỗi ổn định (`cycle_detected`, `duplicate_subtask_id`, `unknown_dependency`, `self_dependency`, `dag_empty`) và thứ tự topo tất định.

**Ca lỗi điển hình ở baseline (đã sửa ở improved):**

```json
{
  "id": "RT-012",
  "expectedValid": true,
  "dagValid": true,
  "order": [
    "s1",
    "s2",
    "s3"
  ],
  "expectedOrder": [
    "s1",
    "s3",
    "s2"
  ],
  "crossDepartment": true,
  "errors": [],
  "ok": false,
  "detail": "valid=true order=s1,s2,s3 errors="
}
```

Cùng ca đó ở improved: `{"id":"RT-012","expectedValid":true,"dagValid":true,"order":["s1","s3","s2"],"expectedOrder":["s1","s3","s2"],"crossDepartment":true,"errors":[],"ok":true,"detail":"khớp nhãn"}`

Usage (improved): input=1627, output=247, cached=0, cache_hit_rate=0, cost=0 USD, avg_latency=0.05ms.

## Ghi chú phương pháp

- Không gọi LLM: mọi chỉ số lấy từ code tất định + DB thật, nên chạy lại cho cùng kết quả (trừ latency).
- `estimated_cost_usd = 0` là số trung thực vì eval không gọi model; token được ước lượng ~4 ký tự/token để so sánh cấu hình.
- Dữ liệu DB do eval tạo được xoá trong `finally`; chỉ `evals/datasets/` và `evals/results/` còn lại.

