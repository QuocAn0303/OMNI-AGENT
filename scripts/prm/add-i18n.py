# -*- coding: utf-8 -*-
"""
scripts/prm/add-i18n.py — Chèn khoá dịch `prm.*` vào locales/vi.json và en.json

Chạy từ thư mục gốc:  python scripts/prm/add-i18n.py

Vì sao bằng script chứ không sửa tay:
- `vi.json` và `en.json` phải có CÙNG MỘT BỘ KHOÁ. Thêm một bên mà quên bên kia thì
  giao diện rơi vào chuỗi khoá trần và không ai thấy lỗi build.
- Script kiểm tra hai chiều và BÁO LỆCH nếu có, nên lần chạy sau cũng không làm hỏng.
- Không dùng json.dump lại toàn file: `json.dump` sắp xếp lại thứ tự khoá và thay đổi
  chỗ thụt dòng của hàng nghìn dòng không liên quan, làm diff nhoáy.
"""
import json
import io
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

VI = {
    "type": {
        "AFFILIATE": "Đối tác liên kết",
        "MARKETING_CHANNEL": "Kênh quảng cáo",
        "REFERRER": "Khách giới thiệu",
        "SALES_AGENT": "Nhân viên giới thiệu",
    },
    "commissionType": {
        "PERCENT_OF_CLV": "Theo tỷ lệ giá trị khách",
        "FIXED_PER_CUSTOMER": "Cố định mỗi khách",
    },
    "funnel": {
        "NEW": "Mới",
        "CONTACTED": "Đã liên hệ",
        "QUALIFIED": "Đủ điều kiện",
        "CUSTOMER": "Thành khách",
        "DEAD": "Loại bỏ",
    },
    "partnersTitle": "Đối tác",
    "partnersSubtitle": "{{count}} đối tác",
    "partnerDetail": "Chi tiết đối tác",
    "roiTitle": "Hiệu quả đối tác",
    "roiSubtitle": "Xếp hạng theo lợi nhuận ròng và phễu chuyển đổi",
    "addPartner": "Thêm đối tác",
    "editPartner": "Sửa đối tác",
    "addReferral": "Ghi nhận lượt giới thiệu",
    "deactivate": "Ngừng hoạt động",
    "restore": "Khoá lại",
    "inactive": "Đã ngừng",
    "confirmedDeactivate": "Ngừng hoạt động đối tác này?",
    "confirmedDeactivateDesc": "Bản ghi vẫn còn để tính hoa hồng, đối tác sẽ không nhận thêm lượt giới thiệu mới.",
    "onlyActive": "Đang hoạt động",
    "onlyInactive": "Đã ngừng",
    "allStatus": "Tất cả",
    "filterType": "Loại đối tác",
    "searchPlaceholder": "Tìm theo tên hoặc mã đối tác",
    "empty": "Chưa có dữ liệu đối tác",
    "notFound": "Không tìm thấy đối tác",
    "loading": "Đang tải…",
    "required": "Thiếu thông tin bắt buộc",
    "perCustomer": "mỗi khách",
    "autoCode": "tự sinh",
    "autoCodeHint": "Để trống để hệ thống sinh mã ĐT-YYYYMM-XXXX",
    "predictedShort": "dự báo",
    "actualShort": "thực tế",
    "coverage": "Độ phủ",
    "converted": "Đã chuyển đổi",
    "notConverted": "Chưa chuyển đổi",
    "unattached": "Chưa gắn khách",
    "contested": "Bị tranh chấp",
    "noConverted": "Đối tác này chưa có khách chuyển đổi",
    "funnelOfPrev": "so với mốc trước",
    "back": "Quay lại",
    "customerSoftDeleted": "Khách đã xoá mềm",
    "metric": {
        "predicted": "Giá trị vòng đời dự báo",
        "actual": "Giá trị thực tế đã thu",
    },
    "sort": {
        "profit": "Lợi nhuận ròng",
        "revenue": "Giá trị khách",
        "conversion": "Tỷ lệ chuyển đổi",
        "referrals": "Số khách chuyển đổi",
    },
    "col": {
        "rank": "#",
        "code": "Mã",
        "name": "Tên",
        "type": "Loại",
        "commission": "Hoa hồng",
        "commissionPaid": "Hoa hồng phải trả",
        "referrals": "Lượt giới thiệu",
        "converted": "Chuyển đổi",
        "conversionRate": "Tỷ lệ chuyển đổi",
        "predictedValue": "Giá trị khách (dự báo)",
        "actualValue": "Đã chi thực tế",
        "netProfit": "Lợi nhuận ròng",
        "customer": "Khách hàng",
        "segment": "Phân khúc",
        "churn": "Rủi ro rời bỏ",
        "convertedAt": "Ngày chuyển đổi",
        "referredName": "Người được giới thiệu",
        "referredPhone": "Số điện thoại",
        "referralDate": "Ngày giới thiệu",
        "status": "Trạng thái",
        "roiValue": "Giá trị ({{metric}})",
    },
    "field": {
        "commissionPercent": "Tỷ lệ hoa hồng",
        "fixedCommission": "Hoa hồng mỗi khách",
        "phone": "Số điện thoại",
        "contactName": "Người liên hệ",
        "notes": "Ghi chú",
        "referredName": "Người được giới thiệu",
        "referredPhone": "Số điện thoại",
        "referredEmail": "Thư điện tử",
    },
    "kpi": {
        "activePartners": "Đối tác đang hoạt động",
        "totalPartners": "Tổng đối tác",
        "converted": "Khách chuyển đổi",
        "netProfit": "Lợi nhuận ròng",
        "conversionRate": "Tỷ lệ chuyển đổi",
        "predictedValue": "Giá trị khách",
        "commission": "Hoa hồng phải trả",
        "overallConversion": "Chuyển đổi toàn hệ thống",
        "roiOnCommission": "Lợi nhuận trên hoa hồng",
        "roiValue": "Giá trị khách ({{metric}})",
    },
    "card": {
        "info": "Thông tin đối tác",
        "funnel": "Phễu giới thiệu",
        "funnelAll": "Phễu giới thiệu — tất cả đối tác",
        "convertedCustomers": "Khách đã chuyển đổi",
        "referrals": "Lượt giới thiệu",
        "ranking": "Xếp hạng đối tác",
    },
    "tooltip": {
        "predictedValue": "Đây là giá trị vòng đời DỰ BÁO của khách, không phải doanh thu đã thu. Xem cột ‘Đã chi thực tế’ để có tiền thật.",
        "coverage": "Phần khách đã chuyển đổi có đủ lịch sử mua để dự báo giá trị vòng đời. Cột giá trị chỉ phủ phần này.",
        "insufficientData": "Khách chưa có tối thiểu 2 đơn hoàn tất nên chưa có giá trị vòng đời dự báo. Không phải giá trị bằng 0.",
        "percentInput": "Nhập PHẦN TRĂM: 10 nghĩa là 10%.",
        "referredPhone": "Không bắt buộc. Nếu nhập và đối tác đã giới thiệu số này rồi thì hệ thống sẽ báo trùng.",
        "unattached": "Lượt giới thiệu đã chuyển đổi nhưng chưa gắn được mã khách hàng, nên chưa tính vào giá trị khách.",
        "contested": "Có khách bị nhiều đối tác cùng giới thiệu. Hệ thống chỉ gán giá trị cho đối tác ghi nhận đầu tiên — cần kiểm tra để tránh trả hoa hồng hai lần.",
    },
    "alert": {
        "predicted": "Đang đo theo giá trị vòng đời DỰ BÁO",
        "predictedDesc": "Con số này là ước tính trước khi khách chi tiêu, phù hợp để so sánh giữa các đối tác khi số khách chuyển đổi còn ít. Chuyển sang ‘Giá trị thực tế đã thu’ để xem tiền đã thu.",
        "contested": "Có {{count}} khách bị nhiều đối tác cùng giới thiệu",
        "contestedDesc": "Hệ thống chỉ gán giá trị cho đối tác ghi nhận đầu tiên. Kiểm tra lại trước khi trả hoa hồng để tránh trả trùng.",
        "coverage": "Chỉ {{coverage}}% khách đã chuyển đổi có đủ dữ liệu để dự báo giá trị",
        "coverageDesc": "Giá trị dự báo chỉ phủ phần khách đủ lịch sử mua. Xem cột ‘Đã chi thực tế’ để so sánh trên toàn bộ khách.",
    },
}

EN = {
    "type": {
        "AFFILIATE": "Affiliate partner",
        "MARKETING_CHANNEL": "Marketing channel",
        "REFERRER": "Customer referral",
        "SALES_AGENT": "Sales agent",
    },
    "commissionType": {
        "PERCENT_OF_CLV": "Percentage of customer value",
        "FIXED_PER_CUSTOMER": "Fixed per customer",
    },
    "funnel": {
        "NEW": "New",
        "CONTACTED": "Contacted",
        "QUALIFIED": "Qualified",
        "CUSTOMER": "Converted",
        "DEAD": "Dead",
    },
    "partnersTitle": "Partners",
    "partnersSubtitle": "{{count}} partners",
    "partnerDetail": "Partner detail",
    "roiTitle": "Partner performance",
    "roiSubtitle": "Ranked by net profit, with conversion funnel",
    "addPartner": "Add partner",
    "editPartner": "Edit partner",
    "addReferral": "Record referral",
    "deactivate": "Deactivate",
    "restore": "Reactivate",
    "inactive": "Inactive",
    "confirmedDeactivate": "Deactivate this partner?",
    "confirmedDeactivateDesc": "Records are kept for commission calculation, but the partner stops receiving new referrals.",
    "onlyActive": "Active",
    "onlyInactive": "Inactive",
    "allStatus": "All",
    "filterType": "Partner type",
    "searchPlaceholder": "Search by name or code",
    "empty": "No partner data yet",
    "notFound": "Partner not found",
    "loading": "Loading…",
    "required": "Required field is missing",
    "perCustomer": "per customer",
    "autoCode": "auto-generated",
    "autoCodeHint": "Leave blank to let the system generate a code like DT-202610-0001",
    "predictedShort": "predicted",
    "actualShort": "actual",
    "coverage": "Coverage",
    "converted": "Converted",
    "notConverted": "Not converted",
    "unattached": "Not linked",
    "contested": "Contested",
    "noConverted": "This partner has no converted customers yet",
    "funnelOfPrev": "vs previous",
    "back": "Back",
    "customerSoftDeleted": "Soft-deleted customer",
    "metric": {
        "predicted": "Predicted lifetime value",
        "actual": "Actual value received",
    },
    "sort": {
        "profit": "Net profit",
        "revenue": "Customer value",
        "conversion": "Conversion rate",
        "referrals": "Converted customers",
    },
    "col": {
        "rank": "#",
        "code": "Code",
        "name": "Name",
        "type": "Type",
        "commission": "Commission",
        "commissionPaid": "Commission payable",
        "referrals": "Referrals",
        "converted": "Converted",
        "conversionRate": "Conversion rate",
        "predictedValue": "Customer value (predicted)",
        "actualValue": "Actual spend",
        "netProfit": "Net profit",
        "customer": "Customer",
        "segment": "Segment",
        "churn": "Churn risk",
        "convertedAt": "Converted at",
        "referredName": "Referred person",
        "referredPhone": "Phone",
        "referralDate": "Referral date",
        "status": "Status",
        "roiValue": "Value ({{metric}})",
    },
    "field": {
        "commissionPercent": "Commission rate",
        "fixedCommission": "Commission per customer",
        "phone": "Phone",
        "contactName": "Contact person",
        "notes": "Notes",
        "referredName": "Referred person",
        "referredPhone": "Phone",
        "referredEmail": "Email",
    },
    "kpi": {
        "activePartners": "Active partners",
        "totalPartners": "Total partners",
        "converted": "Converted customers",
        "netProfit": "Net profit",
        "conversionRate": "Conversion rate",
        "predictedValue": "Customer value",
        "commission": "Commission payable",
        "overallConversion": "System-wide conversion",
        "roiOnCommission": "Profit on commission",
        "roiValue": "Customer value ({{metric}})",
    },
    "card": {
        "info": "Partner information",
        "funnel": "Referral funnel",
        "funnelAll": "Referral funnel — all partners",
        "convertedCustomers": "Converted customers",
        "referrals": "Referrals",
        "ranking": "Partner ranking",
    },
    "tooltip": {
        "predictedValue": "This is PREDICTED lifetime value, not received revenue. See the 'Actual spend' column for actual money.",
        "coverage": "Share of converted customers with enough purchase history to predict lifetime value. The value column covers only this share.",
        "insufficientData": "Customer has fewer than 2 completed orders, so no lifetime value is predicted. This is not zero.",
        "percentInput": "Enter a PERCENTAGE: 10 means 10%.",
        "referredPhone": "Optional. If entered and this partner already referred this phone number, the system will report a duplicate.",
        "unattached": "Referral marked converted but not linked to a customer, so it does not count toward customer value.",
        "contested": "Some customers were referred by more than one partner. The system credits only the first recorded partner — verify before paying commission to avoid paying twice.",
    },
    "alert": {
        "predicted": "Measuring by PREDICTED lifetime value",
        "predictedDesc": "This figure is an estimate made before the customer spends, useful for comparing partners when few customers have converted yet. Switch to 'Actual value received' to see real money.",
        "contested": "{{count}} customers referred by more than one partner",
        "contestedDesc": "The system credits only the first recorded partner. Verify before paying commission to avoid paying twice.",
        "coverage": "Only {{coverage}}% of converted customers have enough data to predict value",
        "coverageDesc": "Predicted value covers only customers with enough purchase history. Use the 'Actual spend' column to compare across all customers.",
    },
}


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key + "."))
        else:
            out[key] = v
    return out


def main():
    vi_path = os.path.join(ROOT, "frontend", "src", "locales", "vi.json")
    en_path = os.path.join(ROOT, "frontend", "src", "locales", "en.json")

    vi_data = json.load(io.open(vi_path, encoding="utf-8"))
    en_data = json.load(io.open(en_path, encoding="utf-8"))

    vi_existing = flatten(vi_data.get("prm", {}))
    en_existing = flatten(en_data.get("prm", {}))

    new_vi = {k: v for k, v in flatten(VI).items() if k not in vi_existing}
    new_en = {k: v for k, v in flatten(EN).items() if k not in en_existing}

    vi_data.setdefault("prm", {}).update(new_vi)
    en_data.setdefault("prm", {}).update(new_en)

    # Ghi lại file. `indent=2` khớp với định dạng sẵn có của hai tệp này.
    for path, data in ((vi_path, vi_data), (en_path, en_data)):
        with io.open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")

    # Báo cáo lệch. Tệp đã nạp lại từ đĩa nên kiểm tra trên dữ liệu vừa ghi.
    vi_flat = flatten(json.load(io.open(vi_path, encoding="utf-8")).get("prm", {}))
    en_flat = flatten(json.load(io.open(en_path, encoding="utf-8")).get("prm", {}))

    only_vi = sorted(set(vi_flat) - set(en_flat))
    only_en = sorted(set(en_flat) - set(vi_flat))
    placeholders_mismatch = [
        k for k in set(vi_flat) & set(en_flat)
        if set(re.findall(r"\{\{(\w+)\}\}", vi_flat[k])) != set(re.findall(r"\{\{(\w+)\}\}", en_flat[k]))
    ]

    print(f"vi.json: +{len(new_vi)} khoá")
    print(f"en.json: +{len(new_en)} khoá")
    print(f"Tổng khoá prm: vi={len(vi_flat)} en={len(en_flat)}")
    if only_vi:
        print(f"LỆCH — chỉ có trong vi: {only_vi}")
    if only_en:
        print(f"LỆCH — chỉ có trong en: {only_en}")
    if placeholders_mismatch:
        print(f"LỆCH — placeholder khác nhau: {placeholders_mismatch}")
    if not (only_vi or only_en or placeholders_mismatch):
        print("Hai tệp khớp nhau.")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())