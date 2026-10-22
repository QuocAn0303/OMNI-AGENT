# Hạn mức gói Gemini miễn phí + điều khoản dữ liệu (tra 2026-10-03)

**Ngày tra:** 2026-10-03 · **Mục đích:** T14 (`NIGHT-PROMPT.md` §6) yêu cầu tra
hạn mức và điều khoản dữ liệu của gói Gemini **miễn phí** trên **trang chính thức**,
ghi URL + ngày, và **không ghi con số hạn mức khi chưa tra**.

---

## 1. Kết luận quan trọng: KHÔNG ghi con số hạn mức

**Tài liệu không công bố bảng số hạn mức tĩnh theo từng model trên trang chính thức.**
Trang chính thức nói rõ:

> "Rate limits depend on a variety of factors (such as your usage tier) and can be
> viewed in Google AI Studio. As your tier and account status change over time, your
> rate limits will automatically update."
> — <https://ai.google.dev/gemini-api/docs/rate-limits> (tra 2026-10-03)

⇒ Hạn mức thật nằm trong AI Studio theo tài khoản. Vì vậy:

- **không** ghi "15 RPM / 1M TPM / 1.500 RPD" vào bất kỳ tài liệu nào của dự án
  (con số đó xuất hiện trong bản lưu cũ của trang, đã lỗi thời — mốc thời gian
  archive 2024-05-14);
- chỉ ghi **chiều đo** và **nguyên tắc** thật, rồi ghi `BLOCKER-HUMAN` nếu cần số.

## 2. Những gì trang chính thức CÓ nói (đủ dùng)

| Điều | Trích từ trang chính thức | URL | Ngày |
|---|---|---|---|
| Hạn mức đo theo 3 chiều | RPM (requests/minute), TPM (tokens/minute, input), RPD (requests/day) | <https://ai.google.dev/gemini-api/docs/rate-limits> | 2026-10-03 |
| Tính **theo project, không theo API key** | "Rate limits are applied per project, not per API key." | như trên | 2026-10-03 |
| RPD reset lúc nào | "Requests per day (RPD) quotas reset at midnight Pacific time." | như trên | 2026-10-03 |
| Vượt hạn mức | trả về lỗi rate limit; trải nghiệm là cả 3 chiều cùng lúc ("quota") | như trên | 2026-10-03 |
| Gói **Free** và hạn mức chi tiêu | Free: spend rate limit = **N/A** (không có trần chi tiêu theo $) | như trên | 2026-10-03 |
| Nâng lên Tier 1 | phải bật billing trong AI Studio; Free = "Active project or free trial" | như trên | 2026-10-03 |

## 3. Điều khoản dữ liệu — điểm quan trọng nhất

Bảng giá chính thức có cột **"Used to improve our products"**:

| Gói | Input | Output | Dùng để cải thiện sản phẩm của Google? |
|---|---|---|---|
| **Free Tier** | Free of charge | Free of charge | **CÓ** |
| Paid Tier | theo bảng giá $/1M token | theo bảng giá | **KHÔNG** |

— <https://ai.google.dev/gemini-api/docs/pricing> (tra 2026-10-03)

⇒ **Hệ quả trực tiếp cho dự án này:** ở gói **miễn phí**, nội dung gửi lên **có thể
được dùng để cải thiện sản phẩm của Google**. Vì vậy:

1. Chế độ `live` của `src/config/llm-policy.js` **chặn** dữ liệu không gắn nhãn
   công khai: biến `LLM_DATA_TAG` phải bắt đầu bằng
   `mophong | simulated | synthetic | public | cong-khai`, nếu không sẽ trả
   `REAL_DATA_BLOCKED` và không gọi mạng.
2. Muốn gửi dữ liệu doanh nghiệp thật thì phải **bật billing** (Paid Tier) **và**
   đặt `LLM_ALLOW_REAL_DATA=1` một cách tường minh. Cả hai, không phải một.
3. Không có key ⇒ không có chế độ `live` ⇒ không có rủi ro này. Đây là lý do "chế
   độ không-LLM là mặc định" không chỉ là cho tiện mà còn là an toàn dữ liệu.

## 4. Hành vi mã đã viết theo các ràng buộc trên

| Ràng buộc từ trang chính thức | Mã tương ứng |
|---|---|
| Hạn mức theo **project**, cả 3 chiều | `LLM_THROTTLE_MS` (mặc định 1200 ms ⇒ ≤ 50 RPM một tiến trình), `backoffFactor` nhân đôi khi 429/503, trần `LLM_MAX_BACKOFF_MS` (30 000 ms) |
| 429/503 là lỗi **tạm thời** | `isTransient()` ⇒ lùi thay vì đổi mô hình nghiệp vụ; mọi lần lùi đều `logger.warn` |
| Nội dung ở gói free bị dùng để cải thiện sản phẩm | `assertPublicDataOnly()` chặn trước khi gọi mạng |

## 5. BLOCKER-HUMAN (cần con người)

Việc này **chỉ con người làm được**, vì cần đăng nhập AI Studio:

1. Mở AI Studio → xem hạn mức thật của project (RPM/TPM/RPD) **cho đúng model sẽ
   dùng**, chụp lại, rồi điền vào mục 1 của tệp này (thay dòng "không công bố").
2. Nếu sẽ chạy `mode=live` trên dữ liệu thật: bật billing (Paid Tier) trước, vì
   gói Free dùng nội dung của bạn để cải thiện sản phẩm (mục 3).

## 6. Ghi chú về phương pháp tra (minh bạch)

- `webfetch` tới `ai.google.dev` **thất bại** (transport error) ở cả 3 lần thử ⇒
  đã dừng đúng hạn mức 3 lần fetch.
- Nội dung ở mục 2–3 lấy từ **trích dẫn (snippet) của chính trang chính thức**
  `ai.google.dev` do công cụ tìm kiếm trả về, **không** phải bản HTML tải trực tiếp.
  Vì vậy các dòng này ghi nhãn nguồn là "snippet trang chính thức" chứ không phải
  "trang đã đọc đầy đủ". Trước khi đưa vào slide, người trình bày nên mở trực tiếp
  2 URL ở trên và đối chiếu.