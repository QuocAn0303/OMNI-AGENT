/**
 * Frontend: src/App.jsx — Root component + Routing chính
 *
 * Tổng quan:
 * - Định nghĩa toàn bộ routing của ứng dụng ERP dùng react-router-dom
 * - Sử dụng lazy loading cho tất cả page components
 * - Cấu hình Ant Design Theme tokens (màu sắc, borderRadius, components)
 * - Hỗ trợ dark mode qua theme token + class dark trên <html>
 * - Phân quyền route dựa trên ProtectedRoute + RequireRole
 * - Route cho cả user thường (AppShell) và SUPER_OMEGA_ULTRA_ADMIN (SuperAdminLayout)
 *
 * Components/Hooks/Exports:
 * - RoleRedirect: Component chuyển hướng dựa trên role (admin → /admin, others → /dashboard)
 * - erpThemeTokens: Object cấu hình theme Ant Design
 * - App: Component chính, bọc ConfigProvider + BrowserRouter + Suspense + Routes
 */
import { useEffect, lazy, Suspense, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ConfigProvider, Spin, theme as antTheme } from "antd";
import viVN from "antd/locale/vi_VN";
import useAuthStore from "./stores/authStore";
import { subscribeToPush, isPushSupported, isSubscribed } from "./utils/pushSubscribe";
import ProtectedRoute from "./components/ProtectedRoute";
import RequireRole from "./components/RequireRole";
import AppShell from "./components/layout/AppShell";
import Profile from "./pages/Profile";
import ProfileSecurity from "./pages/ProfileSecurity";
import ErrorBoundary from "./components/shared/ErrorBoundary";

const Login = lazy(() => import("./pages/Login"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Reports = lazy(() => import("./pages/Reports"));
const Audit = lazy(() => import("./pages/Audit"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetail = lazy(() => import("./pages/CustomerDetail"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Segments = lazy(() => import("./pages/Segments"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const TagManagement = lazy(() => import("./pages/TagManagement"));
const Products = lazy(() => import("./pages/Products"));
const Orders = lazy(() => import("./pages/Orders"));
const Pos = lazy(() => import("./pages/Pos"));
const Floor = lazy(() => import("./pages/fnb/Floor"));
const Kds = lazy(() => import("./pages/fnb/Kds"));
const AiForecast = lazy(() => import("./pages/fnb/AiForecast"));
const OrderInbox = lazy(() => import("./pages/fnb/OrderInbox"));
const Returns = lazy(() => import("./pages/Returns"));
const CycleCount = lazy(() => import("./pages/CycleCount"));
const ProductEdit = lazy(() => import("./pages/ProductEdit"));
const Analytics = lazy(() => import("./pages/Analytics"));
const HR = lazy(() => import("./pages/hr/HR"));
const Documents = lazy(() => import("./pages/Documents"));
const MyDocuments = lazy(() => import("./pages/MyDocuments"));
const Users = lazy(() => import("./pages/Users"));
const Finance = lazy(() => import("./pages/Finance"));
const AccountingReports = lazy(() => import("./pages/AccountingReports"));
const Expenses = lazy(() => import("./pages/Expenses"));
const Vendors = lazy(() => import("./pages/Vendors"));
const PurchaseOrders = lazy(() => import("./pages/PurchaseOrders"));
const PurchaseOrderNew = lazy(() => import("./pages/PurchaseOrderNew"));
const PurchaseOrderDetail = lazy(() => import("./pages/PurchaseOrderDetail"));
const FinancialReports = lazy(() => import("./pages/FinancialReports"));
const Journal = lazy(() => import("./pages/Journal"));
const Debts = lazy(() => import("./pages/Debts"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const Forbidden = lazy(() => import("./pages/Forbidden"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Landing = lazy(() => import("./pages/Landing"));
const Help = lazy(() => import("./pages/Help"));
const ChurnAlerts = lazy(() => import("./pages/ChurnAlerts"));
const GoodsReceiptNotes = lazy(() => import("./pages/GoodsReceiptNotes"));
const PurchaseInvoiceMatching = lazy(() => import("./pages/PurchaseInvoiceMatching"));
const VendorKraljic = lazy(() => import("./pages/VendorKraljic"));
const Import = lazy(() => import("./pages/Import"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Register = lazy(() => import("./pages/Register"));
const SuperAdminDashboard = lazy(
  () => import("./pages/admin/SuperAdminDashboard"),
);
const PlansManagement = lazy(() => import("./pages/admin/PlansManagement"));
const TenantSubscriptionManager = lazy(() => import("./pages/admin/TenantSubscriptionManager"));
const InvoiceManagement = lazy(() => import("./pages/admin/InvoiceManagement"));
const AdminUpgradeRequests = lazy(() => import("./pages/admin/AdminUpgradeRequestsPage"));
const AdminBackups = lazy(() => import("./pages/admin/AdminBackups"));
const AdminCampaignList = lazy(() => import("./pages/admin/campaigns/AdminCampaignListPage"));
const AdminCampaignForm = lazy(() => import("./pages/admin/campaigns/AdminCampaignFormPage"));
const AdminCampaignDetail = lazy(() => import("./pages/admin/campaigns/AdminCampaignDetailPage"));
const TenantListPage = lazy(() => import("./pages/admin/tenants/TenantListPage"));
const SuperAdminLayout = lazy(() => import("./layouts/SuperAdminLayout"));
const Subscription = lazy(() => import("./pages/Subscription"));
const Projects = lazy(() => import("./pages/projects/Projects"));
const ProjectDetail = lazy(() => import("./pages/projects/ProjectDetail"));
const Production = lazy(() => import("./pages/production/Production"));
const WorkOrderDetail = lazy(
  () => import("./pages/production/WorkOrderDetail"),
);
const EInvoice = lazy(() => import("./pages/EInvoice"));
const TaxReports = lazy(() => import("./pages/TaxReports"));
const BankReco = lazy(() => import("./pages/BankReco"));
const FixedAssets = lazy(() => import("./pages/FixedAssets"));
const Currency = lazy(() => import("./pages/Currency"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const LotTracking = lazy(() => import("./pages/LotTracking"));
const ReportBuilder = lazy(() => import("./pages/ReportBuilder"));
const Workflows = lazy(() => import("./pages/Workflows"));
const Integrations = lazy(() => import("./pages/Integrations"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const AgentAnalytics = lazy(() => import("./pages/AgentAnalytics"));
const StoreCredits = lazy(() => import("./pages/StoreCredits"));
const SerialNumbers = lazy(() => import("./pages/SerialNumbers"));
const SmartGuide = lazy(() => import("./pages/SmartGuide"));
const Sessions = lazy(() => import("./pages/Sessions"));
const Promotions = lazy(() => import("./pages/Promotions"));
const ModifierGroups = lazy(() => import("./pages/ModifierGroups"));
const Combos = lazy(() => import("./pages/Combos"));
const Recipes = lazy(() => import("./pages/Recipes"));
const DeliveryManagement = lazy(() => import("./pages/DeliveryManagement"));
const Invoices = lazy(() => import("./pages/Invoices"));
const LoyaltyRules = lazy(() => import("./pages/LoyaltyRules"));
const StampCards = lazy(() => import("./pages/StampCards"));
const Printers = lazy(() => import("./pages/Printers"));
const QrOrderingSetup = lazy(() => import("./pages/QrOrderingSetup"));
const QrOrderingPage = lazy(() => import("./pages/QrOrderingPage"));
const PortalSettings = lazy(() => import("./pages/PortalSettings"));
const Permissions = lazy(() => import("./pages/Permissions"));

/** Catch-all redirect: SUPER_OMEGA_ULTRA_ADMIN → /admin, others → /dashboard */
function RoleRedirect() {
  const { user, isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role === "SUPER_OMEGA_ULTRA_ADMIN") return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
}

const erpThemeTokens = {
  token: {
    colorPrimary: "#0d9488",
    colorPrimaryHover: "#0f766e",
    borderRadius: 10,
    fontFamily: "'Geist', 'Inter', system-ui, -apple-system, sans-serif",
    colorBgContainer: "#ffffff",
    colorBgLayout: "#f8fafc",
    colorBorder: "#e2e8f0",
    colorText: "#0f172a",
    colorTextSecondary: "#475569",
    colorTextTertiary: "#94a3b8",
    colorSuccess: "#059669",
    colorWarning: "#d97706",
    colorError: "#dc2626",
    colorInfo: "#0284c7",
    fontSize: 14,
    controlHeight: 40,
    lineWidth: 1,
    motionDurationMid: "0.2s",
    motionDurationSlow: "0.3s",
  },
  components: {
    Table: {
      headerBg: "#f1f5f9",
      headerColor: "#94a3b8",
      rowHoverBg: "#f1f5f9",
      borderColor: "#f1f5f9",
    },
    Card: { paddingLG: 24 },
    Button: {
      primaryShadow: "none",
      defaultShadow: "none",
      dangerShadow: "none",
    },
    Menu: {
      darkItemBg: "#0f172a",
      darkSubMenuItemBg: "#1e293b",
      darkItemSelectedBg: "#0d9488",
      darkItemHoverBg: "#1e293b",
    },
    Input: { activeShadow: "0 0 0 3px rgba(13, 148, 136, 0.15)" },
    Select: { optionSelectedBg: "#ccfbf1" },
    DatePicker: { activeShadow: "0 0 0 3px rgba(13, 148, 136, 0.15)" },
    Modal: { borderRadiusLG: 14 },
    Tag: { borderRadiusSM: 6 },
  },
};

// Routes bị chặn khi công ty ở chế độ HKD (SIMPLIFIED_HKD — kế toán đơn giản, không double-entry)
const HKD_DENY_PATHS = [
  "/accounting-reports",
  "/financial-reports",
  "/tax-reports",
  "/einvoice",
  "/bank-reco",
  "/fixed-assets",
  "/currency",
  "/journal",
];

// HKD gate: chặn truy cập thẳng URL vào trang double-entry khi chế độ HKD bật
function HkdGate({ children }) {
  const accountingMode = useAuthStore((s) => s.accountingMode);
  const { pathname } = useLocation();
  const denied = useMemo(
    () => accountingMode === "SIMPLIFIED_HKD" && HKD_DENY_PATHS.some((p) => pathname.startsWith(p)),
    [accountingMode, pathname],
  );
  if (denied) return <Navigate to="/403" replace />;
  return children;
}

function App() {
  const appTheme = useAuthStore((s) => s.theme);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loadSettings = useAuthStore((s) => s.loadSettings);
  const initAuth = useAuthStore((s) => s.initAuth);
  const [authInitialized, setAuthInitialized] = useState(false);

  // M7+ (security): access token chỉ trong memory → mỗi lần load trang phải
  // khôi phục phiên qua refresh cookie (httpOnly). Chờ xong mới render routes
  // để ProtectedRoute không redirect về /login nhấp nháy.
  useEffect(() => {
    initAuth().finally(() => setAuthInitialized(true));
  }, [initAuth]);

  useEffect(() => {
    if (appTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [appTheme]);

  // Load businessTemplate từ settings khi đã đăng nhập (để Sidebar tự ẩn/hiện menu F&B)
  useEffect(() => {
    if (isAuthenticated) loadSettings();
  }, [isAuthenticated, loadSettings]);

  // Web Push (PWA): hỏi quyền thông báo 1 lần (chỉ khi chưa từng hỏi), auto-subscribe
  useEffect(() => {
    if (!isAuthenticated || !isPushSupported()) return undefined;
    if (isSubscribed() || Notification.permission === "denied") return undefined;
    if (localStorage.getItem("push_prompted")) return undefined;

    const timer = setTimeout(() => {
      localStorage.setItem("push_prompted", "1");
      const register = () => subscribeToPush();
      if (Notification.permission === "granted") {
        register();
      } else if (Notification.permission === "default") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") register();
        });
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [isAuthenticated]);

  const antConfig = {
    ...erpThemeTokens,
    algorithm:
      appTheme === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
  };

  return (
    <ConfigProvider theme={antConfig} locale={viVN}>
      <BrowserRouter>
        {/* M7+: chờ khôi phục phiên (initAuth) trước khi render routes */}
        {!authInitialized ? (
          <Spin
            size="large"
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100vh",
            }}
          />
        ) : (
        <Suspense
          fallback={
            <Spin
              size="large"
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100vh",
              }}
            />
          }
        >
          <ErrorBoundary>
          <HkdGate>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/403" element={<Forbidden />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/pricing" element={<Pricing />} />
            {/* QR self-ordering PWA — KHÁCH HÀNG, không cần đăng nhập */}
            <Route path="/q/:qrToken" element={<QrOrderingPage />} />
            <Route path="/qr/:qrToken" element={<QrOrderingPage />} />

            {/* Các trang yêu cầu đăng nhập và có Sidebar */}
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              {/* Tất cả role */}
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/security" element={<ProfileSecurity />} />
              <Route path="/profile/sessions" element={<RequireRole roles={["ADMIN", "MANAGER"]}><Sessions /></RequireRole>} />
              <Route path="/subscription" element={<Subscription />} />
              {/* Settings — company info, business template (ADMIN+MANAGER can view, ADMIN can edit) */}
              <Route element={<RequireRole roles={["ADMIN", "MANAGER"]} />}>
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="/products" element={<Products />} />
              <Route path="/products/create" element={<ProductEdit />} />
              <Route path="/products/:id/edit" element={<ProductEdit />} />
              <Route path="/pos" element={<Pos />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/floor" element={<Floor />} />
              <Route path="/kds" element={<Kds />} />
              <Route path="/ai-forecast" element={<AiForecast />} />
              <Route path="/order-inbox" element={<OrderInbox />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/crm/tasks" element={<Tasks />} />
              {/* ADMIN  và MANAGER */}
              <Route element={<RequireRole roles={["ADMIN", "MANAGER"]} />}>
                <Route path="/crm/segments" element={<Segments />} />
                <Route path="/crm/campaigns" element={<Campaigns />} />
                <Route path="/crm/campaigns/:id" element={<CampaignDetail />} />
                <Route path="/tags" element={<TagManagement />} />
                <Route path="/store-credits" element={<StoreCredits />} />
              </Route>
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/help" element={<Help />} />

              {/* ADMIN + MANAGER + ACCOUNTANT — Accounting/Tài chính */}
              <Route element={<RequireRole roles={["ADMIN", "MANAGER", "ACCOUNTANT"]} />}>
                <Route path="/finance" element={<Finance />} />
                <Route path="/accounting-reports" element={<AccountingReports />} />
                <Route path="/financial-reports" element={<FinancialReports />} />
                <Route path="/debts" element={<Debts />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/vendors" element={<Vendors />} />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route path="/purchase-orders/new" element={<PurchaseOrderNew />} />
                <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
                {/* SRM (Mục 6): nhận hàng từ PO + đối soát 3-way hoá đơn NCC (dung sai ±1%) */}
                <Route path="/grn" element={<GoodsReceiptNotes />} />
                <Route path="/purchase-invoices" element={<PurchaseInvoiceMatching />} />
                {/* SRM (Mục 5): ma trận Kraljic — phân loại NCC theo lợi nhuận / rủi ro */}
                <Route path="/vendors/kraljic" element={<VendorKraljic />} />
                <Route path="/einvoice" element={<EInvoice />} />
                <Route path="/tax-reports" element={<TaxReports />} />
                <Route path="/bank-reco" element={<BankReco />} />
                <Route path="/fixed-assets" element={<FixedAssets />} />
                <Route path="/currency" element={<Currency />} />
                <Route path="/report-builder" element={<ReportBuilder />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/marketplace" element={<Marketplace />} />
              </Route>

              {/* ADMIN + MANAGER — Management features (ACCOUNTANT excluded) */}
              <Route element={<RequireRole roles={["ADMIN", "MANAGER"]} />}>
                <Route path="/agent-analytics" element={<AgentAnalytics />} />
                <Route path="/smart-guide" element={<SmartGuide />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/returns" element={<Returns />} />
                <Route path="/hr" element={<HR />} />
                <Route path="/lot-tracking" element={<LotTracking />} />
                <Route path="/churn-alerts" element={<ChurnAlerts />} />
                <Route path="/workflows" element={<Workflows />} />
                <Route path="/documents" element={<Documents />} />
              </Route>
              {/* ADMIN + MANAGER — Marketing & F&B management */}
              <Route element={<RequireRole roles={["ADMIN", "MANAGER"]} />}>
                <Route path="/promotions" element={<Promotions />} />
                <Route path="/modifier-groups" element={<ModifierGroups />} />
                <Route path="/combos" element={<Combos />} />
                <Route path="/recipes" element={<Recipes />} />
                <Route path="/delivery" element={<DeliveryManagement />} />
                <Route path="/invoices" element={<Invoices />} />
                <Route path="/loyalty-rules" element={<LoyaltyRules />} />
                <Route path="/stamp-cards" element={<StampCards />} />
                <Route path="/printers" element={<Printers />} />
                <Route path="/qr-ordering" element={<QrOrderingSetup />} />
                <Route path="/portal-settings" element={<PortalSettings />} />
              </Route>
              {/* Tất cả role — Tài liệu */}
              <Route path="/documents/my" element={<MyDocuments />} />

              {/* ADMIN / SUPER_ADMIN */}
              <Route element={<RequireRole roles={["ADMIN", "SUPER_ADMIN"]} />}>
                <Route path="/users" element={<Users />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/integrations" element={<Integrations />} />
                <Route path="/permissions" element={<Permissions />} />
              </Route>

              {/* SUPER_ADMIN / SUPER_OMEGA_ULTRA_ADMIN — in AppShell (removed, use SuperAdminLayout instead) */}

              {/* ADMIN + MANAGER — Import */}
              <Route element={<RequireRole roles={["ADMIN", "MANAGER"]} />}>
                <Route path="/import" element={<Import />} />
              </Route>

              {/* ADMIN + MANAGER + WAREHOUSE */}
              <Route
                element={
                  <RequireRole roles={["ADMIN", "MANAGER", "WAREHOUSE"]} />
                }
              >
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/cycle-count" element={<CycleCount />} />
                <Route path="/serial-numbers" element={<SerialNumbers />} />
                <Route path="/production" element={<Production />} />
                <Route
                  path="/production/work-orders/:id"
                  element={<WorkOrderDetail />}
                />
              </Route>
            </Route>

            {/* SUPER_OMEGA_ULTRA_ADMIN — SuperAdminLayout (dark sidebar, Image 2) */}
            <Route element={<ProtectedRoute><RequireRole roles={["SUPER_OMEGA_ULTRA_ADMIN"]} /></ProtectedRoute>}>
              <Route element={<SuperAdminLayout />}>
                <Route path="/admin" element={<SuperAdminDashboard />} />
                <Route path="/admin/plans" element={<PlansManagement />} />
                <Route path="/admin/subscriptions" element={<TenantSubscriptionManager />} />
                <Route path="/admin/invoices" element={<InvoiceManagement />} />
                <Route path="/admin/campaigns" element={<AdminCampaignList />} />
                <Route path="/admin/campaigns/new" element={<AdminCampaignForm />} />
                <Route path="/admin/campaigns/:id/edit" element={<AdminCampaignForm />} />
                <Route path="/admin/campaigns/:id" element={<AdminCampaignDetail />} />
                <Route path="/admin/tenants" element={<TenantListPage />} />
                <Route path="/admin/audit" element={<Audit />} />
                <Route path="/admin/backups" element={<AdminBackups />} />
                <Route path="/admin/upgrade-requests" element={<AdminUpgradeRequests />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </HkdGate>
          </ErrorBoundary>
        </Suspense>
        )}
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
