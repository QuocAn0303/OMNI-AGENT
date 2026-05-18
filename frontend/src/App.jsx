import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import AppShell from "./components/layout/AppShell";
import Reports from "./pages/Reports";
import Audit from "./pages/Audit";
import Inventory from "./pages/Inventory";
import Customers from "./pages/Customers";
import Products from "./pages/Products";
import Orders from "./pages/Orders";
import Pos from "./pages/Pos";
import Returns from "./pages/Returns";
import CycleCount from "./pages/CycleCount";
import ProductEdit from "./pages/ProductEdit";
import Analytics from "./pages/Analytics";
import HR from "./pages/hr/HR";
import Users from "./pages/Users";
import Finance from "./pages/Finance";
import Expenses from "./pages/Expenses";
import Vendors from "./pages/Vendors";
import PurchaseOrders from "./pages/PurchaseOrders";
import PurchaseOrderNew from "./pages/PurchaseOrderNew";
import PurchaseOrderDetail from "./pages/PurchaseOrderDetail";
import FinancialReports from "./pages/FinancialReports";
import Journal from "./pages/Journal";
import Debts from "./pages/Debts";
import NotificationsPage from "./pages/NotificationsPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Các trang yêu cầu đăng nhập và có Sidebar */}
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/create" element={<ProductEdit />} />
          <Route path="/products/:id/edit" element={<ProductEdit />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/cycle-count" element={<CycleCount />} />
          <Route path="/pos" element={<Pos />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/hr" element={<HR />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/users" element={<Users />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/purchase-orders" element={<PurchaseOrders />} />
          <Route path="/purchase-orders/new" element={<PurchaseOrderNew />} />
          <Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} />
          <Route path="/debts" element={<Debts />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/financial-reports" element={<FinancialReports />} />
          <Route path="/journal" element={<Journal />} />
          {/* Thêm các route khác ở đây */}
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
