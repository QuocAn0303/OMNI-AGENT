/**
 * Component: layout/Sidebar — Menu điều hướng trái toàn hệ thống
 *
 * Tổng quan:
 * - Component chính để hiển thị sidebar menu dạng dọc, phân nhóm theo chức năng
 * - Props: collapsed (bool), onToggleCollapse (func), mobileOpen (bool), onMobileClose (func)
 * - Logic chính: lấy user role từ authStore, lọc menu hiển thị theo role
 *   ADMIN/MANAGER/CASHIER/WAREHOUSE/SUPER_ADMIN/SUPER_OMEGA_ULTRA_ADMIN
 * - Hỗ trợ chế độ SUPER_OMEGA_ULTRA_ADMIN với menu nền tảng riêng
 * - Hiển thị avatar user & nút logout ở footer
 *
 * Exports:
 * - Sidebar: React functional component (default export)
 */
import { useMemo } from "react";
import { Menu } from "antd";
import aduduLogo from "../../assets/Adudu.png";
import { useLocation, useNavigate } from "react-router-dom";
import { CRM_PIPELINE_ROLES, CRM_MANAGER_ROLES } from "../crm/roles";
import {
  DashboardOutlined,
  LineChartOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  UndoOutlined,
  ShoppingOutlined,
  DatabaseOutlined,
  ReconciliationOutlined,
  TeamOutlined,
  UserOutlined,
  ShopOutlined,
  SolutionOutlined,
  FileExcelOutlined,
  AuditOutlined,
  LeftOutlined,
  RightOutlined,
  LogoutOutlined,
  BankOutlined,
  WalletOutlined,
  AccountBookOutlined,
  ContainerOutlined,
  PieChartOutlined,
  FundOutlined,
  SwapOutlined,
  UploadOutlined,
  CheckSquareOutlined,
  ClusterOutlined,
  ApiOutlined,
  NotificationOutlined,
  ProjectOutlined,
  ExperimentOutlined,
  SettingOutlined,
  TagOutlined,
  CrownOutlined,
  ArrowUpOutlined,
  BarcodeOutlined,
  BulbOutlined,
  QuestionCircleOutlined,
  TableOutlined,
  FireOutlined,
  InboxOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  FolderOpenOutlined,
  AppstoreOutlined,
  ApartmentOutlined,
  ContactsOutlined,
  RiseOutlined,
  FunnelPlotOutlined,
  PartitionOutlined,
  HeartOutlined,
} from "@ant-design/icons";
import useAuthStore from "../../stores/authStore";
import PermissionGate from "../shared/PermissionGate";

/**
 * Sidebar — Menu điều hướng trái, phân nhóm theo chức năng
 *
 * Phân quyền: lọc menu theo role từ authStore
 *   - ADMIN:            toàn bộ menu
 *   - MANAGER:          ẩn Users, Reports, Audit
 *   - CASHIER/WAREHOUSE: chỉ Dashboard, POS, Orders, Products, Customers
 *
 * Vertical: lọc thêm theo businessTemplate (F&B vs Retail)
 *   - Item/group có `verticals: ['FNB']` → chỉ hiện cho F&B (cafe/nhà hàng/fast-food/bar)
 *   - `verticals: ['RETAIL']` → chỉ hiện cho retail (không phải F&B)
 *   - Không có `verticals` → hiện cho mọi vertical
 */
//chỉnh cho super_admin có quyền như admin nhưng có thêm quyền quản lý user và xem audit log, báo cáo
const ALL_ROLES = [
  "ADMIN",
  "MANAGER",
  "ACCOUNTANT",
  "CASHIER",
  "WAREHOUSE",
  "SUPER_ADMIN",
  "SUPER_OMEGA_ULTRA_ADMIN",
];

// Danh sách template F&B — đồng bộ với authStore.FNB_TEMPLATES
const FNB_TEMPLATES = ["cafe", "nha_hang", "do_an_nhanh", "bar_pub"];

// ----- Menu dành riêng cho SUPER_OMEGA_ULTRA_ADMIN (khu vực quản trị hệ thống) -----
const SUPER_ADMIN_MENU_GROUPS = [
  {
    key: "platform",
    label: "NỀN TẢNG",
    roles: ["SUPER_OMEGA_ULTRA_ADMIN"],
    items: [
      {
        key: "/admin",
        icon: <DashboardOutlined />,
        label: "Dashboard tổng quan",
      },
      {
        key: "/admin/tenants",
        icon: <ShopOutlined />,
        label: "Quản lý Tenants",
      },
    ],
  },
  {
    key: "billing",
    label: "BILLING",
    roles: ["SUPER_OMEGA_ULTRA_ADMIN"],
    items: [
      { key: "/admin/plans", icon: <CrownOutlined />, label: "Gói dịch vụ" },
      {
        key: "/admin/subscriptions",
        icon: <TeamOutlined />,
        label: "Thuê bao",
      },
      {
        key: "/admin/invoices",
        icon: <FileTextOutlined />,
        label: "Hóa đơn hệ thống",
      },
    ],
  },
  {
    key: "admin-system",
    label: "HỆ THỐNG",
    roles: ["SUPER_OMEGA_ULTRA_ADMIN"],
    items: [
      {
        key: "/admin/upgrade-requests",
        icon: <ArrowUpOutlined />,
        label: "Yêu cầu nâng gói",
      },
      {
        key: "/admin/campaigns",
        icon: <FundOutlined />,
        label: "Chiến dịch Upsell",
      },
    ],
  },
];

// ----- Beginner Menu (chỉ hiển thị core features) -----
const BEGINNER_MENU_GROUPS = [
  {
    key: "overview",
    label: "TỔNG QUAN",
    roles: ALL_ROLES,
    items: [
      { key: "/dashboard", icon: <DashboardOutlined />, label: "Trang chủ" },
      { key: "/smart-guide", icon: <BulbOutlined />, label: "Trợ lý KD" },
    ],
  },
  {
    key: "sales",
    label: "BÁN HÀNG",
    roles: ALL_ROLES,
    items: [
      { key: "/pos", icon: <ShoppingCartOutlined />, label: "Bán hàng" },
      { key: "/orders", icon: <FileTextOutlined />, label: "Đơn hàng" },
    ],
  },
  {
    key: "inventory",
    label: "SẢN PHẨM & KHO",
    roles: ALL_ROLES,
    items: [
      { key: "/products", icon: <ShoppingOutlined />, label: "Sản phẩm" },
      {
        key: "/inventory",
        icon: <DatabaseOutlined />,
        label: "Tồn kho",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
      },
    ],
  },
  {
    key: "customers",
    label: "KHÁCH HÀNG",
    roles: ALL_ROLES,
    items: [
      { key: "/customers", icon: <TeamOutlined />, label: "Khách hàng" },
    ],
  },
  {
    key: "account",
    label: "TÀI KHOẢN",
    roles: ALL_ROLES,
    items: [
      { key: "/help", icon: <QuestionCircleOutlined />, label: "Trợ giúp" },
    ],
  },
];

// ----- F&B Menu (chỉ hiển thị cho vertical F&B: cafe/nhà hàng/fast-food/bar) -----
// Các mục này là placeholder — sẽ được kích hoạt ở Phase 2 (Sơ đồ bàn),
// Phase 4 (KDS), Phase 6 (QR ordering). Hiện disabled để báo hiệu "sắp ra mắt".
const FNB_MENU_GROUPS = [
  {
    key: "fnb",
    label: "F&B",
    roles: ALL_ROLES,
    verticals: ["FNB"],
    items: [
      { key: "/floor", icon: <TableOutlined />, label: "Sơ đồ bàn" },
      { key: "/kds", icon: <FireOutlined />, label: "Màn hình bếp (KDS)", roles: ["ADMIN", "MANAGER", "CASHIER", "WAREHOUSE"] },
      { key: "/order-inbox", icon: <InboxOutlined />, label: "Đơn đa kênh", roles: ["ADMIN", "MANAGER", "CASHIER"] },
      { key: "/modifier-groups", icon: <TagOutlined />, label: "Nhóm tùy chọn", roles: ["ADMIN", "MANAGER"] },
      { key: "/combos", icon: <ClusterOutlined />, label: "Combo", roles: ["ADMIN", "MANAGER"] },
      { key: "/recipes", icon: <ExperimentOutlined />, label: "Công thức món", roles: ["ADMIN", "MANAGER"] },
      { key: "/qr-ordering", icon: <BarcodeOutlined />, label: "QR Đặt món", roles: ["ADMIN", "MANAGER"] },
      { key: "/printers", icon: <FileTextOutlined />, label: "Máy in", roles: ["ADMIN", "MANAGER"] },
      { key: "/ai-forecast", icon: <ThunderboltOutlined />, label: "AI Dự báo", roles: ["ADMIN", "MANAGER"] },
    ],
  },
];

// ----- Full menu -----
const MENU_GROUPS = [
  {
    key: "overview",
    label: "TỔNG QUAN",
    roles: ALL_ROLES,
    items: [
      { key: "/dashboard", icon: <DashboardOutlined />, label: "Tổng quan" },
      { key: "/smart-guide", icon: <BulbOutlined />, label: "Trợ lý KD" },
      {
        key: "/analytics",
        icon: <LineChartOutlined />,
        label: "Phân tích",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    key: "ai",
    label: "TRỢ LÝ AI",
    roles: ALL_ROLES,
    items: [
      {
        key: "/agent-analytics",
        icon: <FundOutlined />,
        label: "AI Phân tích",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        // T12 — màn hình duyệt đề xuất nhập hàng của agent (human-gate).
        key: "/agent-approvals",
        icon: <AuditOutlined />,
        label: "Duyệt đề xuất nhập",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        // KPI chuỗi cung ứng: tồn kho, vòng quay, tồn chết, giao hàng NCC.
        key: "/supply",
        icon: <DashboardOutlined />,
        label: "Chỉ số chuỗi cung ứng",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE", "ACCOUNTANT"],
      },
      {
        // RFQ: hỏi giá nhiều NCC rồi so sánh chốt (Odoo Request for Quotation).
        key: "/rfq",
        icon: <FileTextOutlined />,
        label: "So sánh báo giá NCC",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        // Quy tắc nhập hàng theo SKU×kho (Odoo Reordering Rules).
        key: "/replenishment-rules",
        icon: <SettingOutlined />,
        label: "Quy tắc nhập hàng",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
      },
      {
        // Bằng chứng backtest: ROP vs ngưỡng cố định, kèm nguồn + giới hạn.
        key: "/evidence",
        icon: <ExperimentOutlined />,
        label: "Bằng chứng thực nghiệm",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    key: "sales",
    label: "BÁN HÀNG",
    roles: ALL_ROLES,
    items: [
      { key: "/pos", icon: <ShoppingCartOutlined />, label: "Bán hàng" },
      { key: "/orders", icon: <FileTextOutlined />, label: "Đơn hàng" },
      {
        key: "/returns",
        icon: <UndoOutlined />,
        label: "Trả hàng",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/promotions",
        icon: <CrownOutlined />,
        label: "Khuyến mãi",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/invoices",
        icon: <FileTextOutlined />,
        label: "Hóa đơn",
        roles: ["ADMIN", "MANAGER", "CASHIER"],
      },
      {
        key: "/delivery",
        icon: <ContainerOutlined />,
        label: "Giao hàng",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/loyalty-rules",
        icon: <CrownOutlined />,
        label: "Điểm thưởng",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/stamp-cards",
        icon: <CheckSquareOutlined />,
        label: "Thẻ tích điểm",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/portal-settings",
        icon: <SolutionOutlined />,
        label: "Cổng khách hàng",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    key: "inventory",
    label: "KHO & SẢN PHẨM",
    roles: ALL_ROLES,
    items: [
      { key: "/products", icon: <ShoppingOutlined />, label: "Sản phẩm" },
      {
        key: "/inventory",
        icon: <DatabaseOutlined />,
        label: "Kho hàng",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/cycle-count",
        icon: <ReconciliationOutlined />,
        label: "Kiểm kê",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
      },
      {
        key: "/serial-numbers",
        icon: <BarcodeOutlined />,
        label: "Số sê-ri",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
      },
    ],
  },
  {
    key: "crm",
    label: "QUAN HỆ",
    roles: ALL_ROLES,
    items: [
      { key: "/customers", icon: <TeamOutlined />, label: "Khách hàng" },
      {
        key: "/crm/tasks",
        icon: <CheckSquareOutlined />,
        label: "Nhiệm vụ CSKH",
      },
      {
        key: "/crm/segments",
        icon: <ClusterOutlined />,
        label: "Phân khúc KH",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/crm/campaigns",
        icon: <NotificationOutlined />,
        label: "Chiến dịch",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/store-credits",
        icon: <WalletOutlined />,
        label: "Tín dụng KH",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/churn-alerts",
        icon: <WarningOutlined />,
        label: "Cảnh báo rời bỏ",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/tags",
        icon: <TagOutlined />,
        label: "Quản lý Tag",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
  {
    // CRM Sales Pipeline (Frappe-style): lead → deal → đơn hàng.
    // KHÔNG thêm key vào MENU_PERMISSION_MAP: bảng đó chỉ có `customers.view`,
    // thêm key mới sẽ phải sửa cả 5 mảng role trong ROLE_PERMS_FALLBACK.
    key: "crmPipeline",
    label: "PIPELINE BÁN HÀNG",
    roles: ALL_ROLES,
    items: [
      { key: "/crm/leads", icon: <FunnelPlotOutlined />, label: "Lead tiềm năng", roles: CRM_PIPELINE_ROLES },
      { key: "/crm/deals", icon: <RiseOutlined />, label: "Deal", roles: CRM_PIPELINE_ROLES },
      { key: "/crm/deals/board", icon: <AppstoreOutlined />, label: "Kanban deal", roles: CRM_PIPELINE_ROLES },
      {
        key: "/crm/organizations",
        icon: <ApartmentOutlined />,
        label: "Tổ chức",
        roles: CRM_MANAGER_ROLES,
      },
      {
        key: "/crm/contacts",
        icon: <ContactsOutlined />,
        label: "Liên hệ",
        roles: CRM_MANAGER_ROLES,
      },
      {
        key: "/crm/dashboard",
        icon: <PieChartOutlined />,
        label: "Dashboard pipeline",
        roles: CRM_MANAGER_ROLES,
      },
      {
        key: "/crm/pipeline-settings",
        icon: <SettingOutlined />,
        label: "Cấu hình pipeline",
        roles: CRM_MANAGER_ROLES,
      },
      {
        // CRM Phase 4 — Sales hierarchy (cây báo cáo)
        key: "/crm/hierarchy",
        icon: <PartitionOutlined />,
        label: "Cây báo cáo",
        roles: CRM_MANAGER_ROLES,
      },
      {
        // CRM Phase 4 — RFM/CLV/churn (mục 1)
        key: "/crm/insights",
        icon: <HeartOutlined />,
        label: "Phân khúc & CLV",
        roles: CRM_MANAGER_ROLES,
      },
      {
        // PRM — đối tác đầu ra. Mở cho CASHIER vì nhân viên cần xem hiệu quả đối tác
        // khi gọi khách lấn theo mã giới thiệu. Việc SỬA cấu hình đối tác (tỷ lệ hoa
        // hồng) bị backend chặn — `PRM_MANAGE_ROLES` không có CASHIER.
        key: "/prm/partners",
        icon: <TeamOutlined />,
        label: "Đối tác",
        roles: CRM_PIPELINE_ROLES,
      },
      {
        key: "/prm/roi",
        icon: <RiseOutlined />,
        label: "Lợi nhuận đối tác",
        roles: CRM_PIPELINE_ROLES,
      },
    ],
  },
  {
    key: "hr",
    label: "NHÂN SỰ",
    roles: ["ADMIN", "MANAGER"],
    items: [      { key: "/hr", icon: <SolutionOutlined />, label: "Nhân sự & Lương" }],
  },
  {
    key: "docs",
    label: "TÀI LIỆU",
    roles: ALL_ROLES,
    items: [
      { key: "/documents/my", icon: <FileTextOutlined />, label: "Tài liệu của tôi" },
      { key: "/documents", icon: <FolderOpenOutlined />, label: "Quản lý tài liệu", roles: ["ADMIN", "MANAGER"] },
    ],
  },
  {
    key: "projects",
    label: "DỰ ÁN",
    roles: ["ADMIN", "MANAGER"],
    items: [{ key: "/projects", icon: <ProjectOutlined />, label: "Dự án" }],
  },
  {
    key: "production",
    label: "SẢN XUẤT",
    roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
    items: [
      { key: "/production", icon: <ExperimentOutlined />, label: "Sản xuất" },
      {
        key: "/lot-tracking",
        icon: <DatabaseOutlined />,
        label: "Lô / Hạn dùng",
        roles: ["ADMIN", "MANAGER", "WAREHOUSE"],
      },
    ],
  },
  {
    key: "accounting",
    label: "KẾ TOÁN & TÀI CHÍNH",
    roles: ["ADMIN", "MANAGER", "ACCOUNTANT"],
    items: [
      { key: "/finance", icon: <FundOutlined />, label: "Sức khỏe tài chính" },
      { key: "/accounting-reports", icon: <FileTextOutlined />, label: "Sổ sách kế toán", hkdHidden: true },
      {
        key: "/debts",
        icon: <SwapOutlined />,
        label: "Công nợ",
        roles: ["ADMIN", "MANAGER", "ACCOUNTANT"],
      },
      { key: "/expenses", icon: <WalletOutlined />, label: "Chi phí" },
      { key: "/vendors", icon: <BankOutlined />, label: "Nhà cung cấp" },
      {
        key: "/vendors/kraljic",
        icon: <ClusterOutlined />,
        label: "Phân loại NCC (Kraljic)",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/purchase-orders",
        icon: <ContainerOutlined />,
        label: "Mua hàng",
      },
      {
        key: "/grn",
        icon: <InboxOutlined />,
        label: "Phiếu nhận hàng (GRN)",
      },
      {
        key: "/purchase-invoices",
        icon: <AuditOutlined />,
        label: "Hoá đơn NCC (3-way)",
      },
      {
        key: "/financial-reports",
        icon: <PieChartOutlined />,
        label: "Báo cáo tài chính",
        hkdHidden: true,
      },
      {
        key: "/tax-reports",
        icon: <FileExcelOutlined />,
        label: "Báo cáo thuế",
        hkdHidden: true,
      },
      {
        key: "/einvoice",
        icon: <FileTextOutlined />,
        label: "Hóa đơn điện tử",
        hkdHidden: true,
      },
      {
        key: "/bank-reco",
        icon: <ReconciliationOutlined />,
        label: "Đối soát ngân hàng",
        hkdHidden: true,
      },
      {
        key: "/fixed-assets",
        icon: <BankOutlined />,
        label: "Tài sản cố định",
        hkdHidden: true,
      },
      { key: "/currency", icon: <SwapOutlined />, label: "Tỷ giá ngoại tệ", hkdHidden: true },
      {
        key: "/marketplace",
        icon: <ShoppingCartOutlined />,
        label: "Sàn TMĐT",
      },
      {
        key: "/report-builder",
        icon: <PieChartOutlined />,
        label: "Tạo báo cáo",
      },
      { key: "/workflows", icon: <FundOutlined />, label: "Quy trình" },
      {
        key: "/journal",
        icon: <AccountBookOutlined />,
        label: "Sổ kế toán",
        roles: ["ADMIN", "ACCOUNTANT"],
        hkdHidden: true,
      },
    ],
  },
  {
    key: "system",
    label: "HỆ THỐNG",
    roles: ["ADMIN", "MANAGER", "SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"],
    items: [
      {
        key: "/users",
        icon: <UserOutlined />,
        label: "Tài khoản",
        roles: ["ADMIN", "SUPER_ADMIN", "SUPER_OMEGA_ULTRA_ADMIN"],
      },
      {
        key: "/reports",
        icon: <FileExcelOutlined />,
        label: "Báo cáo",
        roles: ["ADMIN", "ACCOUNTANT"],
      },
      {
        key: "/audit",
        icon: <AuditOutlined />,
        label: "Nhật ký",
        roles: ["ADMIN"],
      },
      {
        key: "/import",
        icon: <UploadOutlined />,
        label: "Import dữ liệu",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/integrations",
        icon: <ApiOutlined />,
        label: "Tích hợp & khóa API",
        roles: ["ADMIN"],
      },
      // Admin routes moved to SuperAdminLayout (dark sidebar) — not shown here
    ],
  },
  {
    key: "account",
    label: "TÀI KHOẢN",
    roles: ALL_ROLES,
    items: [
      { key: "/help", icon: <QuestionCircleOutlined />, label: "Trợ giúp" },
      {
        key: "/subscription",
        icon: <CrownOutlined />,
        label: "Gói dịch vụ",
      },
      {
        key: "/settings",
        icon: <SettingOutlined />,
        label: "Cài đặt",
        roles: ["ADMIN", "MANAGER"],
      },
      {
        key: "/profile",
        icon: <UserOutlined />,
        label: "Hồ sơ",
      },
      {
        key: "/profile/sessions",
        icon: <TableOutlined />,
        label: "Phiên đăng nhập",
        roles: ["ADMIN", "MANAGER"],
      },
    ],
  },
];

const MENU_PERMISSION_MAP = {
  "/products": "products.view",
  "/inventory": "inventory.view",
  "/cycle-count": "inventory.view",
  "/serial-numbers": "inventory.view",
  "/customers": "customers.view",
  "/orders": "orders.view",
  "/hr": "hr.view",
  "/finance": "accounting.view",
  "/accounting-reports": "accounting.reports",
  "/financial-reports": "accounting.reports",
  "/expenses": "accounting.expenses",
  "/reports": "reports.view",
  "/users": "settings.view",
  "/integrations": "settings.edit",
};

const ROLE_PERMS_FALLBACK = {
  SUPER_OMEGA_ULTRA_ADMIN: "*",
  SUPER_ADMIN: "*",
  ADMIN: [
    "products.view", "orders.view", "customers.view", "inventory.view",
    "hr.view", "accounting.view", "accounting.reports", "accounting.expenses",
    "settings.view", "settings.edit", "reports.view",
  ],
  MANAGER: [
    "products.view", "orders.view", "customers.view", "inventory.view",
    "hr.view", "accounting.view", "accounting.reports", "accounting.expenses",
    "settings.view", "reports.view",
  ],
  ACCOUNTANT: [
    "accounting.view", "accounting.reports", "accounting.expenses",
    "reports.view",
  ],
  CASHIER: [
    "products.view", "orders.view", "customers.view", "inventory.view",
  ],
  WAREHOUSE: [
    "inventory.view",
  ],
};

function hasMenuPermission(userRole, path) {
  const permKey = MENU_PERMISSION_MAP[path];
  if (!permKey) return true;
  const perms = ROLE_PERMS_FALLBACK[userRole];
  if (!perms) return false;
  if (perms === "*") return true;
  return perms.includes(permKey);
}

function buildMenuItems(userRole, menuGroups, isFnB = false, isHkd = false) {
  const items = [];
  for (const group of menuGroups) {
    if (group.roles && !group.roles.includes(userRole)) continue;

    // Lọc theo vertical: 'FNB' = chỉ F&B, 'RETAIL' = chỉ không phải F&B
    if (group.verticals) {
      const showForFnB = group.verticals.includes("FNB");
      const showForRetail = group.verticals.includes("RETAIL");
      if (showForFnB && !isFnB) continue;
      if (showForRetail && isFnB) continue;
    }

    const visibleItems = group.items.filter((it) => {
      if (it.roles && !it.roles.includes(userRole)) return false;
      if (!hasMenuPermission(userRole, it.key)) return false;
      if (it.verticals) {
        const showForFnB = it.verticals.includes("FNB");
        const showForRetail = it.verticals.includes("RETAIL");
        if (showForFnB && !isFnB) return false;
        if (showForRetail && isFnB) return false;
      }
      // HKD mode (SIMPLIFIED_HKD): ẩn kế toán double-entry, chỉ giữ Thu/Chi
      if (isHkd && it.hkdHidden) return false;
      return true;
    });
    if (visibleItems.length === 0) continue;

    // SUPER_OMEGA_ULTRA_ADMIN: đổi nhãn CRM thành Marketing Hệ Thống
    let groupLabel = group.label;
    if (userRole === "SUPER_OMEGA_ULTRA_ADMIN" && group.key === "crm") {
      groupLabel = "MARKETING HỆ THỐNG";
    }
    // HKD mode: nhóm kế toán chỉ còn Thu/Chi
    if (isHkd && group.key === "accounting") {
      groupLabel = "THU CHI & TÀI CHÍNH";
    }

    items.push({
      type: "group",
      key: group.key,
      label: groupLabel,
      children: visibleItems.map(({ key, icon, label, disabled, comingSoon }) => {
        // Đổi "Chiến dịch" → "Chiến dịch Upsell" cho SUPER_OMEGA_ULTRA_ADMIN
        if (
          userRole === "SUPER_OMEGA_ULTRA_ADMIN" &&
          (key === "/crm/campaigns" || label === "Chiến dịch")
        ) {
          return { key, icon, label: "Chiến dịch Upsell" };
        }
        // Coming soon → suffix + disabled
        if (comingSoon) {
          return { key, icon, label: `${label} (sắp ra mắt)`, disabled: true };
        }
        return { key, icon, label, disabled };
      }),
    });
  }
  return items;
}

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, originalToken, beginnerMode, setBeginnerMode, businessTemplate, accountingMode } = useAuthStore();

  const userRole = user?.role || "CASHIER";

  const isSuperAdmin = userRole === "SUPER_OMEGA_ULTRA_ADMIN";
  const isSupportMode = !!originalToken;
  const isFnB = FNB_TEMPLATES.includes(businessTemplate);
  const isHkd = accountingMode === "SIMPLIFIED_HKD";

  // In beginner mode (and not super admin), show simplified menu
  const isBeginner = beginnerMode && !isSuperAdmin && !isSupportMode;

  const activeMenuGroups = useMemo(() => {
    if (isSuperAdmin && !isSupportMode) return SUPER_ADMIN_MENU_GROUPS;
    if (isBeginner) return BEGINNER_MENU_GROUPS;
    // Full menu: chèn group F&B (nếu vertical F&B) ngay sau group "sales"
    if (isFnB) {
      const salesIdx = MENU_GROUPS.findIndex((g) => g.key === "sales");
      if (salesIdx >= 0) {
        return [...MENU_GROUPS.slice(0, salesIdx + 1), ...FNB_MENU_GROUPS, ...MENU_GROUPS.slice(salesIdx + 1)];
      }
    }
    return MENU_GROUPS;
  }, [isSuperAdmin, isSupportMode, isBeginner, isFnB]);

  const menuItems = useMemo(
    () => buildMenuItems(userRole, activeMenuGroups, isFnB, isHkd),
    [userRole, activeMenuGroups, isFnB, isHkd],
  );

  const selectedKey = useMemo(() => {
    const allKeys = activeMenuGroups.flatMap((g) => g.items.map((i) => i.key));
    // Sắp key dài trước để trang con luôn thắng key cha:
    // /crm/deals/board phải highlight "Kanban deal" chứ không phải "Deal",
    // /vendors/kraljic phải highlight "Phân loại NCC" chứ không phải "Nhà cung cấp".
    const matched = allKeys
      .filter((k) => location.pathname === k || location.pathname.startsWith(k + "/"))
      .sort((a, b) => b.length - a.length)[0];
    return matched || location.pathname;
  }, [location.pathname, activeMenuGroups]);

  const userInitials = (user?.fullName || user?.username || "U")
    .split(" ")
    .slice(-2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <>
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onMobileClose}
          role="presentation"
          onKeyDown={(e) => e.key === "Escape" && onMobileClose()}
        />
      )}
      <aside
        className={`sidebar ${collapsed ? "sidebar--collapsed" : ""} ${mobileOpen ? "sidebar--mobile-open" : ""}`}
      >
        {/* Toggle button */}
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
        >
          {collapsed ? (
            <RightOutlined style={{ fontSize: 10 }} />
          ) : (
            <LeftOutlined style={{ fontSize: 10 }} />
          )}
        </button>

        {/* Logo */}
        <div className="sidebar__logo">
          <img
            src={aduduLogo}
            alt="Aduu ERP Logo"
            style={{
              height: 32,
              width: 32,
              objectFit: "contain",
              borderRadius: 6, // Bo góc nhẹ cho logo thêm mềm mại
              marginRight: 10,
            }}
          />
          <div
            className="sidebar__logo-text"
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            Aduu ERP
            {isSuperAdmin && !isSupportMode && (
              <span className="sidebar__admin-badge">SA</span>
            )}
          </div>
        </div>

        {/* Menu */}
        <div className="sidebar__menu">
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            inlineCollapsed={collapsed}
            style={{ background: "transparent", borderRight: 0 }}
          />
        </div>

        {/* Beginner mode toggle — always visible (icon-only when collapsed) */}
        {!isSuperAdmin && !isSupportMode && (
          collapsed ? (
            <div
              onClick={() => setBeginnerMode(!beginnerMode)}
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '10px 0',
                borderTop: '1px solid var(--border-dark)',
                cursor: 'pointer',
              }}
              title={beginnerMode ? 'Mở chế độ đầy đủ' : 'Bật chế độ đơn giản'}
            >
              <BulbOutlined style={{
                color: beginnerMode ? 'var(--primary)' : 'var(--text-inverse-muted)',
                fontSize: 18,
              }} />
            </div>
          ) : (
            <div
              className="sidebar__beginner-toggle"
              style={{
                padding: '8px 16px',
                borderTop: '1px solid var(--border-dark)',
                borderBottom: '1px solid var(--border-dark)',
              }}
            >
              <div
                onClick={() => {
                  setBeginnerMode(!beginnerMode);
                  if (!beginnerMode) navigate('/dashboard');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: beginnerMode ? 'rgba(13, 148, 136, 0.15)' : 'transparent',
                  transition: 'background 0.2s',
                  fontSize: 13,
                  color: 'var(--text-inverse-muted)',
                }}
              >
                <BulbOutlined style={{ color: beginnerMode ? 'var(--primary)' : undefined, fontSize: 14 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: beginnerMode ? 'var(--primary)' : 'var(--text-inverse-muted)', fontWeight: 500 }}>
                    Chế độ Đơn giản
                  </div>
                  {!beginnerMode && (
                    <div style={{ fontSize: 11, marginTop: 1 }}>
                      Bật để ẩn menu nâng cao
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        )}

        {/* User footer */}
        <div className="sidebar__footer">
          <div
            className="sidebar__user"
            onClick={logout}
            title="Đăng xuất"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && logout()}
          >
            <div className="sidebar__user-avatar">{userInitials}</div>
            <div className="sidebar__user-info">
              <div className="sidebar__user-name">
                {user?.fullName || user?.username}
              </div>
              <div className="sidebar__user-role">{user?.role}</div>
            </div>
            {!collapsed && (
              <LogoutOutlined
                style={{ color: "var(--text-inverse-muted)", fontSize: 14 }}
              />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
