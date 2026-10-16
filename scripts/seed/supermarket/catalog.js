/**
 * scripts/seed/supermarket/catalog.js — NGUỒN DANH MỤC HÀNG HÓA VIỆT NAM
 *
 * ============================================================================
 * NGUỒN GỐC VÀ RANH GIỚI TRUNG THỰC
 * ============================================================================
 *
 * **Tên thương hiệu** là thương hiệu có thật đang bán tại Việt Nam
 * (Vinamilk, Masan, Nestlé, Unilever, P&G, L'Oréal, Sunlight, Oliu…).
 *
 * **Tên sản phẩm** được GHÉP theo mẫu bán lẻ thật: thương hiệu + tên dòng sản
 * phẩm + thể tích/khối lượng. Ví dụ `Sữa tươi Vinamilk Homogenized 1L` là
 * **mẫu đặc trưng của siêu thị Việt Nam**, không phải tên một sản phẩm cụ thể
 * có barcode thật.
 *
 * ⇒ Đây là **dữ liệu MÔ PHỎNG có hình thức thật**, không phải dữ liệu bóc từ
 * danh mục nhà bán lẻ nào. Mã vạch EAN-13 sinh ra là **mã hợp lệ về mặt
 * chữ số kiểm tra** nhưng KHÔNG tồn tại trên thị trường — không được dùng để
 * quét mạ thật.
 *
 * Mỗi bản ghi mang `isSynthetic: true` để không ai nhầm là dữ liệu nhà sản
 * xuất cung cấp.
 * ============================================================================
 */

// ── Thương hiệu theo ngành ───────────────────────────────────────────────
// `dinh dang` là các biến thể tên dòng sản phẩm dùng để ghép.

const THUONG_HIEU = {
  'Thực phẩm tươi sống': [
    { ten: 'Vinamilk', dong: ['Sữa tươi', 'Sữa chua', 'Sữa đậu nành'], donVi: ['hộp', 'chai'], kho: [180, 270, 900] },
  ],
  'Sữa & Đồ uống': [
    { ten: 'Vinamilk', dong: ['Sữa tươi', 'Sữa đậu nành', 'Sữa chua uống'], donVi: ['hộp', 'chai'], kho: [200, 270, 450, 900] },
    { ten: 'Mộc Châu', dong: ['Sữa đậu nành', 'Sữa tươi'], donVi: ['hộp', 'chai'], kho: [360, 900] },
    { ten: 'Nestlé', dong: ['Latte', 'NESQUA', 'YLONG'], donVi: ['hộp', 'chai'], kho: [180, 270, 460] },
    { ten: 'TH true', dong: ['Sữa tươi', 'Trà sữa'], donVi: ['hộp', 'chai'], kho: [270, 360, 450] },
    { ten: 'C2', dong: ['Trà xanh', 'Trà đen'], donVi: ['chai', 'hộp'], kho: [250, 275, 360, 500] },
    { ten: 'Tea+', dong: ['Trà xanh', 'Trà sen'], donVi: ['chai', 'hộp'], kho: [275, 455] },
    { ten: 'Olong', dong: ['Trà ôlong'], donVi: ['hộp', 'chai'], kho: [275, 455] },
    { ten: 'Sting', dong: ['Năng lượng'], donVi: ['chai', 'hộp'], kho: [250, 330] },
    { ten: 'Red Bull', dong: ['Năng lượng'], donVi: ['hộp'], kho: [250, 355] },
    { ten: 'Number 1', dong: ['Nước uống đóng bình'], donVi: ['chai'], kho: [500] },
    { ten: 'Aquafina', dong: ['Nước khoáng'], donVi: ['chai'], kho: [500, 1500] },
    { ten: 'Lavazza', dong: ['Cà phê hạt rang', 'Cà phê hòa tan'], donVi: ['gói', 'hộp'], kho: [250, 500, 1000] },
    { ten: 'Trung Nguyên', dong: ['G7', 'Legend', 'Gourmet'], donVi: ['hộp', 'gói'], kho: [160, 250, 500] },
  ],
  'Thực phẩm khô & Gia vị': [
    { ten: 'Oliu', dong: ['Dầu ăn', 'Dầu nành', 'Dầu hướng'], donVi: ['can'], kho: [400, 900, 1800] },
    { ten: 'Neptune', dong: ['Dầu ăn'], donVi: ['can'], kho: [900, 1800, 2700] },
    { ten: 'Ajinomoto', dong: ['Bột ngọt', 'Bột nở'], donVi: ['gói', 'hộp'], kho: [454, 900, 1000] },
    { ten: 'Masan', dong: ['Nước mắm', 'Tương', 'Xì dầu'], donVi: ['chai', 'can'], kho: [400, 500, 750] },
    { ten: 'Vifon', dong: ['Chính vị', 'Bò hầm', 'Tôm chua cay'], donVi: ['gói'], kho: [45, 63, 90] },
    { ten: 'Mì Quảng', dong: ['Mì tôm'], donVi: ['gói'], kho: [60, 75] },
    { ten: 'Hương Sen', dong: ['Gạo'], donVi: ['bao'], kho: [1000, 2000, 5000] },
    { ten: 'Thái Bình 8', dong: ['Gạo'], donVi: ['bao'], kho: [1000, 5000] },
    { ten: 'Ta Na', dong: ['Đường', 'Muối'], donVi: ['bao', 'gói'], kho: [400, 1000] },
    { ten: 'Chinsu', dong: ['Tương', 'Nước mắm'], donVi: ['chai', 'hũ'], kho: [210, 300] },
  ],
  'Đồ ăn nhanh & Đông lạnh': [
    { ten: 'Oishi', dong: ['Popcorn', 'Tôm hùm'], donVi: ['gói'], kho: [30, 68] },
    { ten: 'Tú gọn', dong: ['Phở', 'Bún', 'Mì'], donVi: ['gói'], kho: [60, 70, 90] },
    { ten: 'Indomie', dong: ['Mì cay'], donVi: ['gói'], kho: [30, 65, 68] },
    { ten: 'Mì Quảng', dong: ['Mì gói'], donVi: ['gói'], kho: [60, 75] },
    { ten: 'Good Day', dong: ['Trà xanh'], donVi: ['hộp'], kho: [350, 455] },
    { ten: 'Duy Hanh', dong: ['Xúc xích'], donVi: ['gói'], kho: [200] },
    { ten: 'CJ', dong: ['Kim Chi', 'Tương ớt'], donVi: ['chai', 'hũ'], kho: [500, 800] },
  ],
  'Bánh kẹo & Đồ ngọt': [
    { ten: 'Kinh Đô', dong: ['Bánh trứng', 'Bánh xếp'], donVi: ['hộp', 'gói'], kho: [180, 300, 420] },
    { ten: 'Mondelez', dong: ['Oreo', 'Ritz', 'Chips Ahoy'], donVi: ['gói', 'hộp'], kho: [137, 300, 450] },
    { ten: 'Hảo Hảo', dong: ['Mì gói', 'Bánh'], donVi: ['gói'], kho: [63, 65] },
    { ten: 'Merry', dong: ['Bánh quy'], donVi: ['gói', 'hộp'], kho: [180, 300] },
    { ten: 'Nestlé', dong: ['KitKat', 'Milo'], donVi: ['gói', 'hộp'], kho: [41, 185, 300] },
  ],
  'Đồ gia dụng': [
    { ten: 'Sunlight', dong: ['Nước rửa bát', 'Nước rửa áo'], donVi: ['chai', 'can'], kho: [615, 750, 2500] },
    { ten: 'Mỹ Hảo', dong: ['Bột giặt', 'Nước giặt'], donVi: ['gói', 'hộp', 'can'], kho: [450, 800, 3000] },
    { ten: 'Ariel', dong: ['Bột giặt', 'Nước giặt'], donVi: ['gói', 'hộp'], kho: [800, 1650] },
    { ten: 'Tide', dong: ['Nước giặt'], donVi: ['can'], kho: [1400, 2000] },
    { ten: 'Vim', dong: ['Nước rửa bát'], donVi: ['chai', 'can'], kho: [450, 900] },
    { ten: 'Cif', dong: ['Tẩy rửa'], donVi: ['chai'], kho: [450, 750] },
    { ten: 'Oxit', dong: ['Bột tẩy rửa'], donVi: ['chai', 'gói'], kho: [400, 500] },
  ],
  'Chăm sóc cá nhân': [
    { ten: 'Dove', dong: ['Sữa tắm', 'Dầu gội'], donVi: ['chai'], kho: [250, 350, 900] },
    { ten: 'L’Oréal', dong: ['Dầu gội', 'Dưỡng tóc'], donVi: ['chai', 'hộp'], kho: [250, 400, 900] },
    { ten: 'Clear Men', dong: ['Dầu gội nam'], donVi: ['chai'], kho: [300, 380] },
    { ten: 'Hada Labo', dong: ['Nước rửa mặt', 'Toner'], donVi: ['chai', 'hộp'], kho: [80, 160, 350] },
    { ten: 'La Roche-Posay', dong: ['Kem chống nắng', 'Sữa rửa mặt'], donVi: ['hộp', 'chai'], kho: [50, 300] },
    { ten: 'Nivea', dong: ['Kem dưỡng', 'Sữa tắm'], donVi: ['hộp', 'chai'], kho: [100, 400, 750] },
    { ten: 'Sensodyne', dong: ['Kem đánh răng'], donVi: ['tuýp'], kho: [100, 140] },
    { ten: 'Colgate', dong: ['Kem đánh răng'], donVi: ['tuýp'], kho: [90, 125, 180] },
    { ten: 'P/S', dong: ['Bàn chải đánh răng'], donVi: ['cây'], kho: [30, 55] },
  ],
  'Mẹ & Bé': [
    { ten: 'Friso', dong: ['Sữa công thức'], donVi: ['hộp'], kho: [400, 900, 1800] },
    { ten: 'Grow', dong: ['Sữa công thức'], donVi: ['hộp'], kho: [400, 900] },
    { ten: 'Pampers', dong: ['Tã'], donVi: ['túi'], kho: [40, 54, 68] },
    { ten: 'Huggies', dong: ['Tã'], donVi: ['gói'], kho: [44, 62] },
    { ten: 'Johnson’s', dong: ['Sữa tắm bé'], donVi: ['chai'], kho: [200, 400] },
  ],
  'Đồ uống có cồn': [
    { ten: 'Bia Saigon', dong: ['Special', 'Export'], donVi: ['lon'], kho: [330] },
    { ten: '333', dong: ['Export'], donVi: ['lon'], kho: [330] },
    { ten: 'Tiger', dong: ['Crystal', 'Head'], donVi: ['lon'], kho: [330, 500] },
    { ten: 'Heineken', dong: ['Lager'], donVi: ['lon', 'bottle'], kho: [330, 650] },
  ],
  'Tạp hóa & Đồ ăn vặt': [
    { ten: 'Oishi', dong: ['Phô mai', 'Bánh'], donVi: ['gói'], kho: [43, 50] },
    { ten: 'Poca', dong: ['Snack'], donVi: ['gói'], kho: [39, 45] },
    { ten: 'Casino', dong: ['Khăn giấy', 'Mì'], donVi: ['gói', 'hộp'], kho: [50, 100, 240] },
    { ten: 'Hảo Hảo', dong: ['Khăn giấy'], donVi: ['gói'], kho: [100] },
    { ten: 'Lá Sen', dong: ['Hạt điều', 'Đậu phộng'], donVi: ['gói', 'hộp'], kho: [150, 300, 460] },
  ],
};

// ── Cây ngành hàng ───────────────────────────────────────────────────────
// Nhóm lớn → nhóm con. `khan` = hàng hóa cần hạn dùng & truy xuất lô.

const CAY_NGANH = [
  {
    nhom: 'Thực phẩm tươi sống',
    con: [
      { ten: 'Rau củ tươi', khan: true, ha: 3, gia: [4000, 25000] },
      { ten: 'Trái cây tươi', khan: true, ha: 4, gia: [8000, 60000] },
      { ten: 'Thịt heo', khan: true, ha: 2, gia: [55000, 180000] },
      { ten: 'Thịt gà', khan: true, ha: 2, gia: [45000, 150000] },
      { ten: 'Thịt bò', khan: true, ha: 2, gia: [160000, 480000] },
      { ten: 'Hải sản tươi', khan: true, ha: 2, gia: [70000, 320000] },
      { ten: 'Trứng', khan: true, ha: 10, gia: [22000, 42000] },
    ],
  },
  {
    nhom: 'Sữa & Đồ uống',
    con: [
      { ten: 'Sữa tươi', khan: true, ha: 7, gia: [12000, 32000] },
      { ten: 'Sữa đậu nành', khan: true, ha: 7, gia: [13000, 30000] },
      { ten: 'Sữa chua', khan: true, ha: 14, gia: [9000, 28000] },
      { ten: 'Nước khoáng', khan: false, ha: 365, gia: [5000, 20000] },
      { ten: 'Trà & Trà trái cây', khan: false, ha: 180, gia: [8000, 25000] },
      { ten: 'Nước uống tăng lượng', khan: false, ha: 270, gia: [12000, 30000] },
      { ten: 'Cà phê', khan: false, ha: 365, gia: [35000, 450000] },
    ],
  },
  {
    nhom: 'Thực phẩm khô & Gia vị',
    con: [
      { ten: 'Gạo & Ngũ cốc', khan: false, ha: 365, gia: [25000, 200000] },
      { ten: 'Mì & Bánh phở', khan: false, ha: 180, gia: [6000, 40000] },
      { ten: 'Dầu ăn', khan: false, ha: 540, gia: [45000, 220000] },
      { ten: 'Nước mắm & Giấm', khan: false, ha: 540, gia: [12000, 90000] },
      { ten: 'Gia vị & Phụ gia', khan: false, ha: 540, gia: [8000, 120000] },
      { ten: 'Đường & Muối', khan: false, ha: 730, gia: [6000, 45000] },
      { ten: 'Tương & Dưa gia vị', khan: false, ha: 365, gia: [15000, 70000] },
    ],
  },
  {
    nhom: 'Đồ ăn nhanh & Đông lạnh',
    con: [
      { ten: 'Mì gói & Thực phẩm sẵn', khan: true, ha: 90, gia: [3000, 35000] },
      { ten: 'Đồ ăn đông lạnh', khan: true, ha: 180, gia: [25000, 180000] },
      { ten: 'Xúc xích & Giò', khan: true, ha: 120, gia: [30000, 150000] },
      { ten: 'Bánh kẹo & Đồ ngọt', khan: false, ha: 270, gia: [8000, 90000] },
    ],
  },
  {
    nhom: 'Đồ gia dụng',
    con: [
      { ten: 'Nước rửa bát', khan: false, ha: 730, gia: [25000, 180000] },
      { ten: 'Bột giặt & Nước giặt', khan: false, ha: 730, gia: [45000, 220000] },
      { ten: 'Nước tẩy rửa & Khử mùi', khan: false, ha: 730, gia: [25000, 160000] },
      { ten: 'Giấy & Bông', khan: false, ha: 730, gia: [15000, 120000] },
      { ten: 'Dụng cụ nhà bếp', khan: false, ha: 1095, gia: [25000, 450000] },
    ],
  },
  {
    nhom: 'Chăm sóc cá nhân',
    con: [
      { ten: 'Dầu gội & Dầu xả', khan: false, ha: 730, gia: [45000, 320000] },
      { ten: 'Sữa tắm & Xà phòng', khan: false, ha: 730, gia: [35000, 280000] },
      { ten: 'Chăm sóc da', khan: false, ha: 540, gia: [60000, 550000] },
      { ten: 'Vệ sinh răng miệng', khan: false, ha: 730, gia: [25000, 180000] },
      { ten: 'Chăm sóc tóc', khan: false, ha: 730, gia: [55000, 380000] },
    ],
  },
  {
    nhom: 'Mẹ & Bé',
    con: [
      { ten: 'Sữa công thức', khan: true, ha: 540, gia: [320000, 950000] },
      { ten: 'Tã giấy', khan: false, ha: 1095, gia: [110000, 480000] },
      { ten: 'Chăm sóc bé', khan: false, ha: 730, gia: [40000, 250000] },
    ],
  },
  {
    nhom: 'Đồ uống có cồn',
    con: [
      { ten: 'Bia', khan: false, ha: 365, gia: [25000, 65000] },
      { ten: 'Rượu', khan: false, ha: 1095, gia: [120000, 1200000] },
    ],
  },
  {
    nhom: 'Tạp hóa & Đồ ăn vặt',
    con: [
      { ten: 'Đồ ăn vặt', khan: false, ha: 180, gia: [8000, 45000] },
      { ten: 'Hạt & Quả khô', khan: false, ha: 365, gia: [45000, 320000] },
      { ten: 'Gia vị mang theo', khan: false, ha: 365, gia: [12000, 80000] },
    ],
  },
];

// ── Danh tính doanh nghiệp giả định ──────────────────────────────────────
// Tên các bên KHÔNG phải của tập đoàn EMART. Dùng tên hư cấu để tránh mờ
// gọi dữ liệu mô phỏng cho một doanh nghiệp có thật.

const CONG_TY = {
  ten: 'Chuỗi Siêu Thị Minh Khai (mô phỏng)',
  diaChi: 'Số 1 Đường Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
  mst: '0312345678',
  soDienThoai: '028 3822 9999',
  email: 'info@minhkhaishop.vn',
};

module.exports = { THUONG_HIEU, CAY_NGANH, CONG_TY };
