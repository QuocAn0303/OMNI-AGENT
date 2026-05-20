import { useEffect, useState } from 'react';
import { Form, Input, InputNumber, Select, Button, Upload, message, Card, Spin } from 'antd';
import { SaveOutlined, ArrowLeftOutlined, UploadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import axios from '../api/axios';
import PageHeader from '../components/layout/PageHeader';

/**
 * ProductEdit — Form thêm/sửa sản phẩm
 * Route: /products/create  (id = undefined)
 *        /products/:id/edit
 */
export default function ProductEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [originalQuantity, setOriginalQuantity] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const catRes = await axios.get('/categories');
        setCategories(Array.isArray(catRes.data) ? catRes.data : (catRes.data?.data || []));

        if (isEdit) {
          const productRes = await axios.get(`/products/${id}`);
          const p = productRes.data?.data ?? productRes.data;
          const currentQty = p.inventory?.quantity ?? 0;
          setOriginalQuantity(currentQty);
          form.setFieldsValue({
            name: p.name,
            sku: p.sku,
            categoryId: p.categoryId,
            description: p.description,
            costPrice: p.costPrice,
            price: p.price,
            unit: p.unit,
            quantity: currentQty,
            minStock: p.inventory?.minStock,
          });
        }
      } catch (err) {
        message.error('Không tải được dữ liệu');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit, form]);

  const handleSubmit = async (values) => {
    setSaving(true);
    try {
      const { minStock, quantity, importQty, ...productFields } = values;
      if (isEdit) {
        await axios.put(`/products/${id}`, productFields);
        const inventoryUpdates = {};
        if (minStock !== undefined) inventoryUpdates.minStock = minStock;
        if (importQty && importQty > 0) inventoryUpdates.delta = importQty;
        if (Object.keys(inventoryUpdates).length > 0) {
          await axios.patch(`/products/${id}/inventory`, inventoryUpdates);
        }
        message.success('Đã cập nhật sản phẩm');
      } else {
        await axios.post('/products', { ...productFields, initialStock: quantity ?? 0 });
        message.success('Đã tạo sản phẩm mới');
      }
      navigate('/products');
    } catch (err) {
      message.error(err?.response?.data?.message || 'Lưu thất bại');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={isEdit ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}
        subtitle={isEdit ? `ID: ${id}` : 'Điền thông tin sản phẩm mới'}
        actions={
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')}>
            Quay lại
          </Button>
        }
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        size="large"
        initialValues={{
          quantity: 0,
          minStock: 5,
          price: 0,
          cost: 0,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
          {/* LEFT: Main info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Thông tin cơ bản">
              <Form.Item
                label="Tên sản phẩm"
                name="name"
                rules={[{ required: true, min: 2, message: 'Tối thiểu 2 ký tự' }]}
              >
                <Input placeholder="VD: Áo thun cotton trắng size M" />
              </Form.Item>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Form.Item
                  label="SKU"
                  name="sku"
                  rules={[{ required: true, message: 'Vui lòng nhập SKU' }]}
                  tooltip="Mã định danh duy nhất, dùng để quét barcode"
                >
                  <Input placeholder="ATC-W-M-001" style={{ fontFamily: 'var(--font-mono)' }} />
                </Form.Item>

                <Form.Item
                  label="Danh mục"
                  name="categoryId"
                  rules={[{ required: true, message: 'Chọn danh mục' }]}
                >
                  <Select
                    placeholder="Chọn danh mục"
                    options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  />
                </Form.Item>
              </div>

              <Form.Item label="Mô tả" name="description">
                <Input.TextArea rows={4} placeholder="Mô tả ngắn về sản phẩm..." />
              </Form.Item>
            </Card>

            <Card title="Giá & Tồn kho">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Form.Item
                  label="Giá vốn"
                  name="costPrice"
                  rules={[{ required: true, message: 'Nhập giá vốn' }, { type: 'number', min: 0, message: 'Giá trị phải >= 0' }]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    step={1000}
                    formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={(v) => v.replace(/,/g, '')}
                    addonAfter="₫"
                  />
                </Form.Item>

                <Form.Item
                  label="Giá bán"
                  name="price"
                  rules={[{ required: true, message: 'Nhập giá bán' }, { type: 'number', min: 0, message: 'Giá trị phải >= 0' }]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    step={1000}
                    formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={(v) => v.replace(/,/g, '')}
                    addonAfter="₫"
                  />
                </Form.Item>

                {isEdit ? (
                  <>
                    <Form.Item label="Tồn kho hiện tại">
                      <InputNumber
                        style={{ width: '100%' }}
                        value={originalQuantity}
                        disabled
                      />
                    </Form.Item>
                    <Form.Item
                      label="Nhập thêm số lượng"
                      name="importQty"
                      tooltip="Số lượng nhập thêm vào kho (để trống nếu không thay đổi)"
                    >
                      <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
                    </Form.Item>
                  </>
                ) : (
                  <Form.Item label="Số lượng ban đầu" name="quantity">
                    <InputNumber style={{ width: '100%' }} min={0} />
                  </Form.Item>
                )}

                <Form.Item
                  label="Tồn tối thiểu"
                  name="minStock"
                  tooltip="Cảnh báo khi tồn kho dưới mức này"
                >
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
              </div>
            </Card>
          </div>

          {/* RIGHT: Image + actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card title="Ảnh sản phẩm">
              <Form.Item name="imageUrl" noStyle>
                <Input placeholder="URL ảnh hoặc upload" />
              </Form.Item>
              <Upload.Dragger
                name="file"
                multiple={false}
                showUploadList={false}
                style={{ marginTop: 12, background: 'var(--bg-tertiary)' }}
                beforeUpload={() => {
                  message.info('Upload ảnh chưa được tích hợp — dùng URL tạm');
                  return false;
                }}
              >
                <p style={{ fontSize: 24, color: 'var(--text-muted)', margin: 0 }}>
                  <UploadOutlined />
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '8px 0 0' }}>
                  Kéo thả hoặc click để chọn ảnh
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  PNG, JPG tối đa 2MB
                </p>
              </Upload.Dragger>
            </Card>

            <Card title="Thao tác">
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={saving}
                block
                size="large"
              >
                {isEdit ? 'Lưu thay đổi' : 'Tạo sản phẩm'}
              </Button>
              <Button
                style={{ marginTop: 8 }}
                onClick={() => navigate('/products')}
                block
              >
                Hủy
              </Button>
            </Card>
          </div>
        </div>
      </Form>
    </>
  );
}
