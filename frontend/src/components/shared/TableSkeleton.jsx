/**
 * Frontend: components/shared/TableSkeleton.jsx — Skeleton loading cho bảng
 *
 * Tổng quan:
 * - Tạo bảng giả với Skeleton.Input để hiển thị khi dữ liệu đang tải
 * - Dùng Ant Design Table với columns/Data giả lập
 * - Số cột và số dòng có thể cấu hình qua props
 *
 * Props:
 *   columns: number — Số cột skeleton (default 5)
 *   rows:    number — Số dòng skeleton (default 5)
 *
 * Exports:
 *   TableSkeleton: Component chính
 */
import { Skeleton, Table } from 'antd'

export default function TableSkeleton({ columns = 5, rows = 5 }) {
  const skeletonColumns = Array.from({ length: columns }, (_, i) => ({
    title: <Skeleton.Input active size="small" style={{ width: 80 }} />,
    dataIndex: `col${i}`,
    render: () => <Skeleton.Input active size="small" style={{ width: '100%' }} />,
  }))
  const skeletonData = Array.from({ length: rows }, (_, i) => ({ key: i }))
  return <Table dataSource={skeletonData} columns={skeletonColumns} pagination={false} />
}
