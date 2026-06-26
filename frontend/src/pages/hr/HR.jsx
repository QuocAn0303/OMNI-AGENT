/**
 * Page: hr/HR — Quản lý nhân sự (main entry)
 *
 * Tổng quan:
 * - Component điều hướng chính cho module Nhân sự
 * - 3 tabs: Nhân viên (EmployeeList), Chấm công (Attendance), Bảng lương (Payroll)
 * - Mỗi tab là một component riêng biệt trong cùng thư mục
 * - Sử dụng PageHeader và Ant Design Tabs
 *
 * Exports:
 * - HR: React functional component (default export)
 */
import { useState } from 'react';
import { Tabs } from 'antd';
import PageHeader from '../../components/layout/PageHeader';
import EmployeeList from './EmployeeList';
import Attendance from './Attendance';
import Payroll from './Payroll';


/**
 * HR — Quản lý nhân sự (main entry)
 *
 * Tabs:
 *   - employees: danh sách + thông tin nhân viên
 *   - attendance: chấm công (check-in/out, ca)
 *   - payroll: tính lương theo kỳ
 *
 * Lưu ý: Đã tách từ HR.jsx (580 dòng) thành folder này.
 *        Mỗi tab là một file riêng để dễ maintain.
 */
export default function HR() {
  const [activeTab, setActiveTab] = useState('employees');

  return (
    <>
      <PageHeader
        title="Nhân sự & Lương"
        subtitle="Quản lý nhân viên, chấm công, tính lương"
      />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'employees',  label: 'Nhân viên',  children: <EmployeeList /> },
          { key: 'attendance', label: 'Chấm công',  children: <Attendance /> },
          { key: 'payroll',    label: 'Bảng lương', children: <Payroll /> },
        ]}
      />
    </>
  );
}
