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
