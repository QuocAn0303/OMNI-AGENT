import { useState } from "react";
import {
  Card, Collapse, Space, Typography, Input, Tag, Divider,
} from "antd";
import {
  SearchOutlined, ShoppingCartOutlined, DatabaseOutlined,
  TeamOutlined, AccountBookOutlined, QuestionCircleOutlined,
  MobileOutlined, SafetyCertificateOutlined,
} from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";

const { Text, Title, Paragraph } = Typography;

const FAQ_DATA = [
  {
    category: "Bắt đầu",
    icon: <QuestionCircleOutlined />,
    items: [
      { q: "Tôi mới mở shop, bắt đầu từ đâu?", a: "Sau khi đăng ký, hệ thống sẽ hướng dẫn bạn qua 6 bước: chọn ngành → nhập thông tin shop → tạo kho → thêm danh mục → thêm nhân viên → chọn phương thức thanh toán. Nếu không muốn làm từng bước, bạn có thể chọn 'Bỏ qua' và quay lại sau." },
      { q: "Làm sao để thêm sản phẩm đầu tiên?", a: "Vào menu 'Sản phẩm' → nhấn 'Thêm sản phẩm' → điền tên, giá bán, giá vốn, mã SKU, chọn danh mục. Bạn cũng có thể import từ file Excel tại 'Import dữ liệu'." },
      { q: "Tôi có thể dùng thử miễn phí bao lâu?", a: "Gói Miễn phí cho phép dùng vĩnh viễn với các tính năng cơ bản. Gói Chuyên nghiệp có thời gian dùng thử 30 ngày, sau đó bạn có thể nâng cấp hoặc quay về gói Miễn phí." },
    ],
  },
  {
    category: "Bán hàng",
    icon: <ShoppingCartOutlined />,
    items: [
      { q: "Làm sao để tạo đơn hàng?", a: "Vào 'Bán hàng' (POS) → chọn sản phẩm → nhập số lượng → chọn khách (nếu có) → nhấn 'Thanh toán' → chọn tiền mặt/chuyển khoản → xác nhận. Có thể in hóa đơn ngay sau khi thanh toán." },
      { q: "Tôi có thể quét mã vạch không?", a: "Có! Bạn có thể dùng máy quét mã vạch cầm tay (cắm USB, quét tự động) hoặc quét bằng camera điện thoại (nhấn nút quét trên POS). Hệ thống hỗ trợ mã EAN-13 (mã VN bắt đầu 893...), Code-128, QR Code." },
      { q: "Làm sao để in hóa đơn?", a: "Sau khi thanh toán, cửa sổ hóa đơn sẽ hiện ra. Bạn có thể: (1) In qua trình duyệt (Ctrl+P), (2) Kết nối máy in nhiệt Bluetooth (K80, Xprinter) và in trực tiếp." },
      { q: "Khách muốn trả hàng thì làm sao?", a: "Vào 'Trả hàng' → chọn đơn hàng → chọn sản phẩm cần trả → chọn lý do → chọn phương thức hoàn tiền (tiền mặt/chuyển khoản/tín dụng). Hệ thống tự động cập nhật tồn kho và công nợ." },
    ],
  },
  {
    category: "Kho & Sản phẩm",
    icon: <DatabaseOutlined />,
    items: [
      { q: "Tôi cần nhập thêm hàng — hệ thống có gợi ý không?", a: "Có! Vào 'Trợ lý KD' → tab 'Nhập hàng' — hệ thống sẽ liệt kê sản phẩm sắp hết, gợi ý số lượng cần nhập và nhà cung cấp bạn từng mua." },
      { q: "Làm sao để biết sản phẩm nào bán chạy?", a: "Vào 'Phân tích' để xem top sản phẩm bán chạy, xu hướng doanh thu theo ngày/tuần/tháng. Trang 'Tổng quan' cũng hiển thị sản phẩm sắp hết hàng." },
      { q: "Tôi có nhiều kho hàng — quản lý thế nào?", a: "Hệ thống hỗ trợ đa kho. Vào 'Kho hàng' để xem tồn kho từng kho, và 'Kiểm kê' để đối chiếu số liệu thực tế với hệ thống." },
    ],
  },
  {
    category: "Kế toán & Tài chính",
    icon: <AccountBookOutlined />,
    items: [
      { q: "Tôi không biết kế toán — hệ thống có tự làm không?", a: "Có! Hệ thống tự động ghi sổ kế toán mỗi khi có giao dịch (bán hàng, nhập hàng, thu chi). Bạn không cần làm gì cả — vào 'Sức khỏe tài chính' để xem báo cáo lời lỗ đơn giản." },
      { q: "Làm sao để xuất hóa đơn điện tử?", a: "Vào 'Hóa đơn điện tử' — chọn nhà cung cấp (VNPT) → nhập thông tin khách hàng và mã số thuế → phát hành hóa đơn. Hệ thống sẽ gửi lên cổng thuế và trả về mã CQT." },
      { q: "Tôi muốn đối chiếu sao kê ngân hàng?", a: "Vào 'Đối soát ngân hàng' → chọn tài khoản → upload file sao kê (Vietcombank/Techcombank) → nhấn 'Khớp tự động'. Hệ thống sẽ tự động so khớp giao dịch với sổ kế toán." },
    ],
  },
  {
    category: "Tài khoản & Bảo mật",
    icon: <SafetyCertificateOutlined />,
    items: [
      { q: "Làm sao để thêm nhân viên?", a: "Vào 'Tài khoản' → 'Thêm tài khoản' → nhập email + họ tên + chọn vai trò (Thu ngân/Quản lý/Kế toán/Kho). Nhân viên sẽ nhận email kích hoạt." },
      { q: "Tôi muốn thuê kế toán bên ngoài xem sổ sách?", a: "Tạo tài khoản với vai trò 'Kế toán' — họ chỉ có thể xem báo cáo, sổ sách, không thể sửa dữ liệu hay bán hàng." },
      { q: "Dữ liệu của tôi có an toàn không?", a: "Tất cả dữ liệu được mã hóa khi truyền (HTTPS) và lưu trữ an toàn trên máy chủ. Mỗi shop có cơ sở dữ liệu riêng biệt, không ai xem được dữ liệu của bạn." },
    ],
  },
  {
    category: "Điện thoại & Di động",
    icon: <MobileOutlined />,
    items: [
      { q: "Tôi có thể dùng trên điện thoại không?", a: "Có! Mở Chrome/Safari trên điện thoại, truy cập vào địa chỉ web của hệ thống. Giao diện tự động điều chỉnh cho màn hình nhỏ. Bạn cũng có thể 'Thêm vào màn hình chính' để mở như app." },
      { q: "Mất mạng có bán hàng được không?", a: "Có! Chế độ ngoại tuyến cho phép bạn tiếp tục bán hàng khi mất mạng. Đơn hàng sẽ tự động đồng bộ khi có mạng trở lại." },
    ],
  },
];

export default function Help() {
  const [search, setSearch] = useState("");

  const filtered = FAQ_DATA.map((cat) => ({
    ...cat,
    items: cat.items.filter(
      (i) =>
        !search ||
        i.q.toLowerCase().includes(search.toLowerCase()) ||
        i.a.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((cat) => cat.items.length > 0);

  return (
    <>
      <PageHeader title="Trợ giúp" subtitle="Câu hỏi thường gặp và hướng dẫn sử dụng" />
      <Input.Search
        placeholder="Tìm câu hỏi..."
        prefix={<SearchOutlined />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        size="large"
        style={{ maxWidth: 500, marginBottom: 24 }}
      />

      {filtered.map((cat) => (
        <Card
          key={cat.category}
          title={
            <Space>
              <span style={{ color: "var(--primary)", fontSize: 18 }}>{cat.icon}</span>
              <Text strong style={{ fontSize: 16 }}>{cat.category}</Text>
            </Space>
          }
          style={{ marginBottom: 16, borderRadius: 12 }}
        >
          <Collapse
            ghost
            items={cat.items.map((item, idx) => ({
              key: `${cat.category}-${idx}`,
              label: <Text strong>{item.q}</Text>,
              children: <Paragraph style={{ color: "var(--text-secondary)", lineHeight: 1.8 }}>{item.a}</Paragraph>,
            }))}
          />
        </Card>
      ))}

      {filtered.length === 0 && (
        <Card>
          <Space direction="vertical" align="center" style={{ width: "100%", padding: 32 }}>
            <QuestionCircleOutlined style={{ fontSize: 48, color: "var(--text-muted)" }} />
            <Text type="secondary">Không tìm thấy câu hỏi phù hợp. Thử từ khóa khác.</Text>
          </Space>
        </Card>
      )}

      <Divider />
      <div style={{ textAlign: "center" }}>
        <Text type="secondary">
          Vẫn cần hỗ trợ? Dùng <Text code>Trợ lý AI</Text> ở góc phải màn hình để được giải đáp ngay.
        </Text>
      </div>
    </>
  );
}
