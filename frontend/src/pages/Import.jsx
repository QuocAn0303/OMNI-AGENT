/**
 * Frontend: pages/Import.jsx — Import dữ liệu từ Excel
 * 
 * Tổng quan:
 * - Tabs: Import sản phẩm, khách hàng, nhà cung cấp
 * - Mỗi tab dùng Dragger để upload file .xlsx/.xls, gửi lên POST /import/{type}
 * - Tải file mẫu (GET /import/template/{type}) trước khi import
 * - Hiển thị kết quả: số bản ghi đã import, danh sách lỗi (dòng + message)
 * - State: mỗi ImportTab quản lý result/loading riêng
 * 
 * Components/Hooks/Exports:
 * - Import (default): Page chính — Tabs container
 * - ImportTab: Component con — upload + kết quả
 */
import { useState } from 'react';
import { Upload, Table, Alert, Button, Tabs, Typography, Space, Tag } from 'antd';
import { InboxOutlined, DownloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import api from '../api/axios';

const { Title, Text } = Typography;
const { Dragger } = Upload;

const TABS = [
  { key: 'products', label: 'Sản phẩm', note: 'Nếu SKU đã tồn tại sẽ cập nhật tên và giá.' },
  { key: 'customers', label: 'Khách hàng', note: 'Bỏ qua dòng có SĐT trùng.' },
  { key: 'vendors', label: 'Nhà cung cấp', note: 'Nếu mã NCC đã tồn tại sẽ cập nhật tên.' },
];

function ImportTab({ type, note }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleUpload = async (file) => {
    setLoading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/import/${type}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data.data);
    } catch (err) {
      setResult({ imported: 0, errors: [{ message: err.response?.data?.message || 'Lỗi không xác định' }] });
    } finally {
      setLoading(false);
    }
    return false;
  };

  const downloadTemplate = async () => {
    const res = await api.get(`/import/template/${type}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mau_${type}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const errorColumns = [
    { title: 'Dòng', dataIndex: 'row', width: 80, render: (v) => v ?? '-' },
    { title: 'Lỗi', dataIndex: 'message' },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Space>
        <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
          Tải file mẫu
        </Button>
        <Text type="secondary">{note}</Text>
      </Space>

      <Dragger
        accept=".xlsx,.xls"
        showUploadList={false}
        beforeUpload={handleUpload}
        disabled={loading}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">Kéo thả file Excel vào đây hoặc nhấn để chọn</p>
        <p className="ant-upload-hint">Hỗ trợ .xlsx, .xls — tối đa 10MB</p>
      </Dragger>

      {result && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Tag icon={<CheckCircleOutlined />} color="success">
              Đã import: {result.imported} bản ghi
            </Tag>
            {result.errors?.length > 0 && (
              <Tag icon={<CloseCircleOutlined />} color="error">
                Lỗi: {result.errors.length} dòng
              </Tag>
            )}
          </Space>

          {result.errors?.length > 0 && (
            <Alert
              type="error"
              message="Một số dòng không import được"
              description={
                <Table
                  size="small"
                  dataSource={result.errors.map((e, i) => ({ ...e, key: i }))}
                  columns={errorColumns}
                  pagination={false}
                  style={{ marginTop: 8 }}
                />
              }
            />
          )}
        </Space>
      )}
    </Space>
  );
}

export default function Import() {
  return (
    <div className="page-container">
      <div className="page-header">
        <Title level={4} style={{ margin: 0 }}>Import dữ liệu</Title>
      </div>

      <div className="page-body">
        <Tabs
          items={TABS.map((t) => ({
            key: t.key,
            label: t.label,
            children: <ImportTab type={t.key} note={t.note} />,
          }))}
        />
      </div>
    </div>
  );
}
