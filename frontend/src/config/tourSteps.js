export const getDashboardTour = (_t) => [
  {
    target: '.stat-grid',
    content: 'Đây là các chỉ số kinh doanh quan trọng: doanh thu hôm nay, số đơn hàng, khách hàng, và hàng sắp hết.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.dashboard-grid',
    content: 'Biểu đồ doanh thu 7 ngày giúp bạn thấy xu hướng. Nếu đường đi lên — bạn đang làm tốt!',
    placement: 'bottom',
  },
  {
    target: '.table-card',
    content: 'Đây là danh sách sản phẩm sắp hết. Nhấn vào để nhập thêm hàng.',
    placement: 'top',
  },
  {
    target: '.stat-grid > div:first-child',
    content: 'Mẹo: Nhấn vào mỗi thẻ KPI để xem chi tiết.',
    placement: 'bottom',
  },
];

export const getPosTour = (_t) => [
  {
    target: '.pos-products__search',
    content: 'Tìm kiếm sản phẩm bằng tên hoặc quét mã vạch để thêm vào giỏ hàng.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.pos-products__grid',
    content: 'Nhấn vào sản phẩm để thêm vào đơn hàng. Bạn có thể thay đổi số lượng sau.',
    placement: 'right',
  },
  {
    target: '.pos-cart',
    content: 'Đây là giỏ hàng hiện tại. Kiểm tra lại trước khi thanh toán.',
    placement: 'left',
  },
  {
    target: '.pos-cart',
    content: 'Sau khi kiểm tra xong, nhấn "Thanh toán" và chọn phương thức: tiền mặt hoặc chuyển khoản.',
    placement: 'left',
  },
];

export const getProductsTour = (_t) => [
  {
    target: '.page-header',
    content: 'Quản lý tất cả sản phẩm của bạn tại đây. Nhấn "Thêm sản phẩm" để tạo mới.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.filters-bar',
    content: 'Lọc sản phẩm theo danh mục, tìm kiếm theo tên hoặc mã SKU.',
    placement: 'bottom',
  },
  {
    target: '.table-card',
    content: 'Nhấn vào từng dòng để xem chi tiết và chỉnh sửa sản phẩm.',
    placement: 'top',
  },
];

export const getOrdersTour = (_t) => [
  {
    target: '.page-header',
    content: 'Tất cả đơn hàng hiển thị ở đây. Trạng thái: Chờ xử lý → Đã xác nhận → Đang giao → Hoàn thành.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.filters-bar',
    content: 'Lọc đơn hàng theo trạng thái hoặc khoảng thời gian.',
    placement: 'bottom',
  },
  {
    target: '.table-card',
    content: 'Nhấn vào mã đơn để xem chi tiết, cập nhật trạng thái hoặc in hóa đơn.',
    placement: 'top',
  },
];

export const getInventoryTour = (_t) => [
  {
    target: '.page-header',
    content: 'Xem tồn kho và lịch sử nhập/xuất hàng.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.ant-tabs-nav',
    content: 'Chuyển giữa tab Tồn kho (xem số lượng) và Giao dịch (xem lịch sử nhập/xuất).',
    placement: 'bottom',
  },
];

export const getCustomersTour = (_t) => [
  {
    target: '.page-header',
    content: 'Quản lý danh sách khách hàng của bạn. Nhấn "Thêm khách hàng" để tạo mới.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '.table-card',
    content: 'Nhấn vào từng khách hàng để xem lịch sử mua hàng, công nợ, và ghi chú.',
    placement: 'top',
  },
];

/**
 * Onboarding tour - shows on dashboard after first login
 */
export const getOnboardingTour = (_t) => [
  {
    target: '.sidebar__menu',
    content: 'Đây là menu chính. Khi mới bắt đầu, bạn chỉ thấy các mục cơ bản. Bấm "Chế độ Đơn giản" để mở rộng.',
    placement: 'right',
    disableBeacon: true,
  },
  {
    target: '.stat-grid',
    content: 'Đây là Trang chủ — nơi bạn thấy tình hình kinh doanh mỗi ngày.',
    placement: 'bottom',
  },
  {
    target: '.sidebar__menu',
    content: 'Bắt đầu bằng cách vào "Bán hàng" để tạo đơn đầu tiên, hoặc "Sản phẩm" để thêm hàng.',
    placement: 'right',
  },
  {
    target: '.topbar__right',
    content: 'Chuông thông báo và tài khoản của bạn ở góc trên bên phải.',
    placement: 'bottom',
  },
];
