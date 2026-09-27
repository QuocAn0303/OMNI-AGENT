import { useEffect, useState, useCallback } from "react";
import { List, Card, Tag, message, Empty, Spin, Modal, Typography, Space } from "antd";
import { FileTextOutlined, EyeOutlined } from "@ant-design/icons";
import PageHeader from "../components/layout/PageHeader";
import { getMyDocuments } from "../api/documents";

const { Text } = Typography;

export default function MyDocuments() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewTitle, setPreviewTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMyDocuments();
      setDocs(data);
    } catch {
      message.error("Không thể tải danh sách tài liệu");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleView = (doc) => {
    setPreviewTitle(doc.title);
    setPreviewUrl(`/api/documents/${doc.id}/file`);
  };

  return (
    <div>
      <PageHeader title="Tài liệu nội bộ" subTitle="Các tài liệu được gửi cho bạn" />

      {loading ? (
        <div style={{ textAlign: "center", padding: 60 }}><Spin size="large" /></div>
      ) : docs.length === 0 ? (
        <Card><Empty description="Chưa có tài liệu nào được gửi cho bạn" /></Card>
      ) : (
        <List
          dataSource={docs}
          renderItem={(doc) => (
            <Card
              hoverable
              style={{ marginBottom: 12 }}
              onClick={() => handleView(doc)}
            >
              <List.Item>
                <List.Item.Meta
                  avatar={<FileTextOutlined style={{ fontSize: 24, color: "#0d9488" }} />}
                  title={<a onClick={() => handleView(doc)}>{doc.title}</a>}
                  description={
                    <Space direction="vertical" size={2}>
                      <Text type="secondary">{doc.description || ""}</Text>
                      <Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>File: {doc.fileName}</Text>
                        {doc.sendToAll && <Tag color="blue" style={{ fontSize: 11 }}>Toàn công ty</Tag>}
                        {doc.departments?.map((d) => (
                          <Tag key={d.department.id} color="green" style={{ fontSize: 11 }}>{d.department.name}</Tag>
                        ))}
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(doc.createdAt).toLocaleDateString("vi-VN")}
                        {" - "}Gửi bởi: {doc.author?.fullName}
                      </Text>
                    </Space>
                  }
                />
                <EyeOutlined style={{ fontSize: 20, color: "#0d9488" }} />
              </List.Item>
            </Card>
          )}
        />
      )}

      <Modal
        title={previewTitle}
        open={!!previewUrl}
        onCancel={() => { setPreviewUrl(null); setPreviewTitle(""); }}
        footer={null}
        width="80%"
        style={{ top: 20 }}
      >
        {previewUrl && (
          <iframe
            src={previewUrl}
            style={{ width: "100%", height: "70vh", border: "none" }}
            title={previewTitle}
          />
        )}
      </Modal>
    </div>
  );
}
