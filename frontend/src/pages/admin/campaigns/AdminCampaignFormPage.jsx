/**
 * Frontend: pages/admin/campaigns/AdminCampaignFormPage.jsx — Tạo/Sửa chiến dịch CRM
 *
 * Tổng quan:
 * - Form tạo hoặc chỉnh sửa chiến dịch (tên, kênh, gói target, tiêu đề, nội dung, lịch gửi)
 * - Chế độ edit load dữ liệu từ API theo id trên URL
 * - API: POST /admin/campaigns (tạo), PUT /admin/campaigns/:id (sửa)
 * - State: form, loading; isEdit = !!id
 *
 * Components/Hooks/Exports:
 * - AdminCampaignFormPage: Component chính (xuất mặc định)
 */
import { useState, useEffect } from "react";
import { Card, Form, Input, Select, Button, DatePicker, Typography, message, Checkbox } from "antd";
import dayjs from "dayjs";
import { FundOutlined } from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../../api/axios";

const { Title } = Typography;
const { TextArea } = Input;

const ALL_PLANS = ["free", "pro", "business", "enterprise"];

export default function AdminCampaignFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const isEdit = !!id;

  useEffect(() => {
    if (isEdit) {
      api.get(`/admin/campaigns/${id}`).then((res) => {
        const data = res.data.data;
        form.setFieldsValue({
          ...data,
          scheduledAt: data.scheduledAt ? dayjs(data.scheduledAt) : null,
        });
      }).catch(() => message.error("Không thể tải chiến dịch"));
    }
  }, [id, isEdit, form]);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const payload = {
        ...values,
        scheduledAt: values.scheduledAt?.toISOString() || null,
      };
      if (isEdit) {
        await api.put(`/admin/campaigns/${id}`, payload);
        message.success("Cập nhật chiến dịch thành công");
      } else {
        await api.post("/admin/campaigns", payload);
        message.success("Tạo chiến dịch thành công");
      }
      navigate("/admin/campaigns");
    } catch (err) {
      message.error(err.response?.data?.message || "Lỗi lưu chiến dịch");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="super-admin-page">
      <div className="page-header">
        <Title level={3}><FundOutlined /> {isEdit ? "Sửa chiến dịch" : "Tạo chiến dịch mới"}</Title>
      </div>
      <Card style={{ maxWidth: 720 }}>
        <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ channel: "EMAIL", targetPlans: [], status: "DRAFT" }}>
          <Form.Item name="name" label="Tên chiến dịch" rules={[{ required: true }]}>
            <Input placeholder="VD: Khuyến mãi tháng 6" />
          </Form.Item>

          <Form.Item name="channel" label="Kênh" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="EMAIL">Email</Select.Option>
              <Select.Option value="SMS">SMS</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="targetPlans" label="Gói target" rules={[{ required: true, message: "Chọn ít nhất 1 gói" }]}>
            <Checkbox.Group>
              {ALL_PLANS.map((p) => (
                                <Checkbox key={p} value={p} style={{ marginLeft: 0, marginBottom: 8, display: "block" }}>
                                  {p.charAt(0).toUpperCase() + p.slice(1)}
                                </Checkbox>
                              ))}
            </Checkbox.Group>
          </Form.Item>

          <Form.Item name="subject" label="Tiêu đề" rules={[{ required: true }]}>
            <Input placeholder="Tiêu đề email / SMS" />
          </Form.Item>

          <Form.Item name="content" label="Nội dung" rules={[{ required: true }]}>
            <TextArea rows={6} placeholder="Nội dung chiến dịch..." />
          </Form.Item>

          <Form.Item name="scheduledAt" label="Lên lịch gửi (tùy chọn)">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>
              {isEdit ? "Cập nhật" : "Tạo chiến dịch"}
            </Button>
            <Button style={{ marginLeft: 12 }} onClick={() => navigate("/admin/campaigns")}>
              Hủy
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}