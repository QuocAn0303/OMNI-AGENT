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
import { useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider, Spin, theme as antTheme } from "antd";
import viVN from "antd/locale/vi_VN";
import useAuthStore from "./stores/authStore";
import ProtectedRoute from "./components/ProtectedRoute";
import RequireRole from "./components/RequireRole";
import AppShell from "./components/layout/AppShell";
import Profile from "./pages/Profile";

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
const Returns = lazy(() => import("./pages/Returns"));
const CycleCount = lazy(() => import("./pages/CycleCount"));
const ProductEdit = lazy(() => import("./pages/ProductEdit"));
const Analytics = lazy(() => import("./pages/Analytics"));
const HR = lazy(() => import("./pages/hr/HR"));
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
const AgentAnalytics = lazy(() => import("./pages/AgentAnalytics"));
const StoreCredits = lazy(() => import("./pages/StoreCredits"));
const SerialNumbers = lazy(() => import("./pages/SerialNumbers"));

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

function App() {
  const appTheme = useAuthStore((s) => s.theme);

  useEffect(() => {
    if (appTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [appTheme]);

  const antConfig = {
    ...erpThemeTokens,
    algorithm:
      appTheme === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
  };

  return (
    <ConfigProvider theme={antConfig} locale={viVN}>
      <BrowserRouter>
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
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/403" element={<Forbidden />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/pricing" element={<Pricing />} />

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
              <Route path="/subscription" element={<Subscription />} />
              <Route path="/products" element={<Products />} />
              <Route path="/products/create" element={<ProductEdit />} />
              <Route path="/products/:id/edit" element={<ProductEdit />} />
              <Route path="/pos" element={<Pos />} />
              <Route path="/orders" element={<Orders />} />
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

              {/* ADMIN + MANAGER */}
              <Route element={<RequireRole roles={["ADMIN", "MANAGER"]} />}>
                <Route path="/agent-analytics" element={<AgentAnalytics />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/returns" element={<Returns />} />
                <Route path="/hr" element={<HR />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/vendors" element={<Vendors />} />
                <Route path="/purchase-orders" element={<PurchaseOrders />} />
                <Route
                  path="/purchase-orders/new"
                  element={<PurchaseOrderNew />}
                />
                <Route
                  path="/purchase-orders/:id"
                  element={<PurchaseOrderDetail />}
                />
                <Route
                  path="/financial-reports"
                  element={<FinancialReports />}
                />
                <Route path="/debts" element={<Debts />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/finance" element={<Finance />} />
                <Route path="/accounting-reports" element={<AccountingReports />} />
                <Route path="/einvoice" element={<EInvoice />} />
                <Route path="/tax-reports" element={<TaxReports />} />
                <Route path="/bank-reco" element={<BankReco />} />
                <Route path="/fixed-assets" element={<FixedAssets />} />
                <Route path="/currency" element={<Currency />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/lot-tracking" element={<LotTracking />} />
                <Route path="/report-builder" element={<ReportBuilder />} />
                <Route path="/workflows" element={<Workflows />} />
              </Route>

              {/* ADMIN / SUPER_ADMIN */}
              <Route element={<RequireRole roles={["ADMIN", "SUPER_ADMIN"]} />}>
                <Route path="/users" element={<Users />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="/journal" element={<Journal />} />
                <Route path="/integrations" element={<Integrations />} />
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
                <Route path="/admin/upgrade-requests" element={<AdminUpgradeRequests />} />
              </Route>
            </Route>

            <Route path="*" element={<RoleRedirect />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
