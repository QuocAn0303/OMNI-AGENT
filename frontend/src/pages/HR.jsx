/**
 * Frontend: pages/HR.jsx — Quản lý Nhân sự & Lương (phiên bản cũ)
 *
 * Tổng quan:
 * - Trang quản lý nhân viên: xem danh sách, chỉnh sửa tiền ca, số ca, số lỗi,
 *   thêm/xoá vi phạm, thêm ca làm, bulk edit hàng loạt.
 * - API calls:
 *   - GET  /hr/employees                  — danh sách nhân viên + preview lương
 *   - PATCH /hr/employees/:id             — cập nhật shiftMoney
 *   - PATCH /hr/employees/:id/counts      — cập nhật shiftCount / violationCount
 *   - PATCH /hr/employees/bulk/counts     — bulk edit số ca/lỗi hàng loạt
 *   - POST  /hr/violations                — thêm vi phạm
 *   - PATCH /hr/violations/:id            — sửa vi phạm
 *   - POST  /hr/shifts                    — thêm ca làm
 * - State / logic chính:
 *   - data: danh sách nhân viên
 *   - editValues / countsEdit: lưu giá trị tạm khi chỉnh sửa inline
 *   - isAdmin: kiểm tra quyền để ẩn/hiện nút chỉnh sửa
 *   - bulk edit: chọn nhiều nhân viên → cập nhật đồng loạt
 *
 * Exports:
 * - HR (default): Component chính
 *
 * Lưu ý: Đây là phiên bản cũ, đã được tách thành hr/HR.jsx (tab EmployeeList + Attendance + Payroll).
 */
import React, { useEffect, useState } from "react";
import axios from "../api/axios";
import useAuthStore from "../stores/authStore";
import {
  Table,
  Card,
  Spin,
  InputNumber,
  Button,
  message,
  Modal,
  Form,
  Select,
  DatePicker,
  Input,
  Space,
} from "antd";

export default function HR() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [countsEdit, setCountsEdit] = useState({});
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const [bulkForm] = Form.useForm();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN";

  const [violationModalVisible, setViolationModalVisible] = useState(false);
  const [shiftModalVisible, setShiftModalVisible] = useState(false);
  const [viewViolationsVisible, setViewViolationsVisible] = useState(false);
  const [currentEmployee, setCurrentEmployee] = useState(null);
  const [formViolation] = Form.useForm();
  const [formShift] = Form.useForm();
  const [editViolationModalVisible, setEditViolationModalVisible] =
    useState(false);
  const [editingViolation, setEditingViolation] = useState(null);
  const [formEditViolation] = Form.useForm();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get("/hr/employees");
        setData(res.data.data || []);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    load();
  }, []);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/hr/employees");
      setData(res.data.data || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  if (loading) return <Spin />;

  const columns = [
    {
      title: "Tên nhân viên",
      dataIndex: ["employee", "user", "fullName"],
      key: "name",
    },
    {
      title: "Lương cơ bản",
      dataIndex: ["employee", "baseSalary"],
      key: "base",
    },
    {
      title: "Tiền ca",
      dataIndex: ["preview", "shiftMoney"],
      key: "shiftMoney",
      render: (val, record) => (
        <InputNumber
          min={0}
          value={editValues[record.employee.id] ?? val}
          onChange={(v) =>
            setEditValues((prev) => ({ ...prev, [record.employee.id]: v }))
          }
        />
      ),
    },
    {
      title: "Số ca (tháng)",
      dataIndex: "shiftCount",
      key: "shifts",
      render: (val, record) =>
        isAdmin && record.employee?.user?.role !== "ADMIN" ? (
          <InputNumber
            min={0}
            value={countsEdit[record.employee.id]?.shiftCount ?? val}
            onChange={(v) =>
              setCountsEdit((prev) => ({
                ...prev,
                [record.employee.id]: {
                  ...(prev[record.employee.id] || {}),
                  shiftCount: v,
                },
              }))
            }
          />
        ) : (
          val
        ),
    },
    {
      title: "Số lỗi (tháng)",
      key: "violations",
      render: (val, record) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isAdmin && record.employee?.user?.role !== "ADMIN" ? (
            <InputNumber
              min={0}
              value={
                countsEdit[record.employee.id]?.violationCount ??
                (record.violations?.length || 0)
              }
              onChange={(v) =>
                setCountsEdit((prev) => ({
                  ...prev,
                  [record.employee.id]: {
                    ...(prev[record.employee.id] || {}),
                    violationCount: v,
                  },
                }))
              }
            />
          ) : (
            <span>{record.violations?.length || 0}</span>
          )}
          <Button
            type="link"
            onClick={() => {
              setCurrentEmployee({
                ...record.employee,
                violations: record.violations,
              });
              setViewViolationsVisible(true);
            }}
          >
            Xem
          </Button>
        </div>
      ),
    },
    {
      title: "Phạt",
      dataIndex: ["preview", "penalties"],
      key: "penalties",
      render: (val) => val || 0,
    },
    {
      title: "Dự tính nhận",
      dataIndex: ["preview", "finalSalary"],
      key: "final",
    },
    {
      title: "Hành động",
      key: "action",
      render: (val, record) => (
        <Space>
          <Button
            type="primary"
            onClick={async () => {
              const id = record.employee.id;
              const value = editValues[id];
              if (value === undefined) {
                message.info("Không có thay đổi");
                return;
              }
              try {
                await axios.patch(`/hr/employees/${id}`, {
                  shiftMoney: Number(value),
                });
                message.success("Cập nhật tiền ca thành công");
                await reload();
              } catch (e) {
                message.error(e?.response?.data?.message || "Lỗi khi cập nhật");
              }
            }}
          >
            Lưu
          </Button>

          {isAdmin && record.employee?.user?.role !== "ADMIN" && (
            <>
              <Button
                onClick={() => {
                  setCurrentEmployee(record.employee);
                  formViolation.resetFields();
                  setViolationModalVisible(true);
                }}
              >
                Thêm lỗi
              </Button>
              <Button
                onClick={() => {
                  setCurrentEmployee(record.employee);
                  formShift.resetFields();
                  setShiftModalVisible(true);
                }}
              >
                Thêm ca
              </Button>
              <Button
                onClick={async () => {
                  const id = record.employee.id;
                  const counts = countsEdit[id] || {};
                  if (
                    counts.shiftCount === undefined &&
                    counts.violationCount === undefined
                  ) {
                    message.info("Không có thay đổi số ca/lỗi");
                    return;
                  }
                  try {
                    await axios.patch(`/hr/employees/${id}/counts`, {
                      shiftCount: counts.shiftCount,
                      violationCount: counts.violationCount,
                    });
                    message.success("Cập nhật số ca/lỗi thành công");
                    // clear local edits for this employee
                    setCountsEdit((prev) => {
                      const next = { ...prev };
                      delete next[id];
                      return next;
                    });
                    await reload();
                  } catch (e) {
                    message.error(
                      e?.response?.data?.message || "Lỗi khi cập nhật số",
                    );
                  }
                }}
              >
                Lưu số
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  const rows = data.map((r) => ({
    key: r.employee.id,
    employee: r.employee,
    shiftCount: r.shiftCount,
    preview: r.preview,
    violations: r.violations,
  }));

  return (
    <div>
      <h2>HR & Payroll</h2>
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div>
            {isAdmin && (
              <>
                <Button
                  type="primary"
                  disabled={!selectedRowKeys.length}
                  onClick={() => setBulkModalVisible(true)}
                  style={{ marginRight: 8 }}
                >
                  Bulk Edit
                </Button>
                <Button
                  onClick={() => setSelectedRowKeys([])}
                  disabled={!selectedRowKeys.length}
                >
                  Clear selection
                </Button>
              </>
            )}
            <span style={{ marginLeft: 12 }}>
              {selectedRowKeys.length
                ? `${selectedRowKeys.length} selected`
                : ""}
            </span>
          </div>
        </div>
        <Table
          dataSource={rows}
          columns={columns}
          rowKey="key"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: (record) => ({
              disabled: record.employee?.user?.role === "ADMIN",
            }),
          }}
        />

        {/* Violation modal */}
        <Modal
          title={`Thêm lỗi cho ${currentEmployee?.user?.fullName || ""}`}
          open={violationModalVisible}
          onCancel={() => setViolationModalVisible(false)}
          footer={null}
        >
          <Form
            form={formViolation}
            layout="vertical"
            onFinish={async (values) => {
              try {
                await axios.post("/hr/violations", {
                  employeeId: currentEmployee.id,
                  type: values.type,
                  note: values.note,
                });
                message.success("Thêm lỗi thành công");
                setViolationModalVisible(false);
                await reload();
              } catch (e) {
                message.error(e?.response?.data?.message || "Lỗi khi thêm lỗi");
              }
            }}
          >
            <Form.Item
              name="type"
              label="Loại lỗi"
              rules={[{ required: true }]}
            >
              <Select>
                <Select.Option value="LATE">Đi trễ (LATE)</Select.Option>
                <Select.Option value="EARLY">Về sớm (EARLY)</Select.Option>
                <Select.Option value="PACKING_ERROR">
                  Sai đóng gói (PACKING_ERROR)
                </Select.Option>
                <Select.Option value="DAMAGED_GOODS">
                  Hư hỏng (DAMAGED_GOODS)
                </Select.Option>
                <Select.Option value="UNAUTHORIZED_ABSENCE">
                  Vắng không phép (UNAUTHORIZED_ABSENCE)
                </Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="note" label="Ghi chú">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">
                Ghi nhận lỗi
              </Button>
            </Form.Item>
          </Form>
        </Modal>

        {/* Shift modal */}
        <Modal
          title={`Thêm ca cho ${currentEmployee?.user?.fullName || ""}`}
          open={shiftModalVisible}
          onCancel={() => setShiftModalVisible(false)}
          footer={null}
        >
          <Form
            form={formShift}
            layout="vertical"
            onFinish={async (values) => {
              try {
                const payload = {
                  employeeId: currentEmployee.id,
                  type: values.type,
                };
                if (values.date) payload.date = values.date.toISOString();
                await axios.post("/hr/shifts", payload);
                message.success("Thêm ca thành công");
                setShiftModalVisible(false);
                await reload();
              } catch (e) {
                message.error(e?.response?.data?.message || "Lỗi khi thêm ca");
              }
            }}
          >
            <Form.Item name="type" label="Loại ca" rules={[{ required: true }]}>
              <Select>
                <Select.Option value="MORNING">Sáng (MORNING)</Select.Option>
                <Select.Option value="AFTERNOON">
                  Chiều (AFTERNOON)
                </Select.Option>
                <Select.Option value="NIGHT">Ca tối (NIGHT)</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="date" label="Ngày (tùy chọn)">
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">
                Ghi nhận ca
              </Button>
            </Form.Item>
          </Form>
        </Modal>

        {/* View violations modal */}
        <Modal
          title={`Các vi phạm của ${currentEmployee?.user?.fullName || ""}`}
          open={viewViolationsVisible}
          onCancel={() => setViewViolationsVisible(false)}
          footer={
            <Button onClick={() => setViewViolationsVisible(false)}>
              Đóng
            </Button>
          }
        >
          <Table
            dataSource={currentEmployee ? currentEmployee.violations || [] : []}
            rowKey={(r) => r.id}
            pagination={false}
          >
            <Table.Column title="Loại" dataIndex="type" key="type" />
            <Table.Column title="Ghi chú" dataIndex="note" key="note" />
            <Table.Column
              title="Phạt"
              dataIndex="penalty"
              key="penalty"
              render={(v) => v || 0}
            />
            <Table.Column
              title="Ngày"
              dataIndex="date"
              key="date"
              render={(v) => new Date(v).toLocaleString()}
            />
            {isAdmin && currentEmployee?.user?.role !== "ADMIN" && (
              <Table.Column
                title="Hành động"
                key="act"
                render={(v, record) => (
                  <Button
                    onClick={() => {
                      setEditingViolation(record);
                      formEditViolation.setFieldsValue({
                        type: record.type,
                        note: record.note,
                        penalty: record.penalty,
                      });
                      setEditViolationModalVisible(true);
                    }}
                  >
                    Sửa
                  </Button>
                )}
              />
            )}
          </Table>
        </Modal>

        {/* Edit Violation modal (admin) */}
        <Modal
          title={`Sửa vi phạm`}
          open={editViolationModalVisible}
          onCancel={() => setEditViolationModalVisible(false)}
          footer={null}
        >
          <Form
            form={formEditViolation}
            layout="vertical"
            onFinish={async (values) => {
              try {
                await axios.patch(
                  `/hr/violations/${editingViolation.id}`,
                  values,
                );
                message.success("Cập nhật vi phạm thành công");
                setEditViolationModalVisible(false);
                setEditingViolation(null);
                await reload();
              } catch (e) {
                message.error(e?.response?.data?.message || "Lỗi khi cập nhật");
              }
            }}
          >
            <Form.Item name="type" label="Loại lỗi">
              <Select>
                <Select.Option value="LATE">Đi trễ (LATE)</Select.Option>
                <Select.Option value="EARLY">Về sớm (EARLY)</Select.Option>
                <Select.Option value="PACKING_ERROR">
                  Sai đóng gói (PACKING_ERROR)
                </Select.Option>
                <Select.Option value="DAMAGED_GOODS">
                  Hư hỏng (DAMAGED_GOODS)
                </Select.Option>
                <Select.Option value="UNAUTHORIZED_ABSENCE">
                  Vắng không phép (UNAUTHORIZED_ABSENCE)
                </Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="note" label="Ghi chú">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name="penalty" label="Phạt">
              <InputNumber style={{ width: "100%" }} min={0} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">
                Lưu
              </Button>
            </Form.Item>
          </Form>
        </Modal>

        {/* Bulk Edit modal */}
        <Modal
          title={`Bulk edit cho ${selectedRowKeys.length} nhân viên`}
          open={bulkModalVisible}
          onCancel={() => setBulkModalVisible(false)}
          footer={null}
        >
          <Form
            form={bulkForm}
            layout="vertical"
            onFinish={async (values) => {
              try {
                const payload = {
                  employeeIds: selectedRowKeys,
                  shiftCount: values.shiftCount,
                  violationCount: values.violationCount,
                  month: values.month,
                  year: values.year,
                };
                await axios.patch("/hr/employees/bulk/counts", payload);
                message.success("Cập nhật hàng loạt thành công");
                setBulkModalVisible(false);
                setSelectedRowKeys([]);
                bulkForm.resetFields();
                await reload();
              } catch (e) {
                message.error(
                  e?.response?.data?.message || "Lỗi khi cập nhật bulk",
                );
              }
            }}
          >
            <Form.Item name="shiftCount" label="Số ca (áp dụng cho tất cả)">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="violationCount"
              label="Số lỗi (áp dụng cho tất cả)"
            >
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="month" label="Tháng (tùy chọn)">
              <InputNumber min={1} max={12} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="year" label="Năm (tùy chọn)">
              <InputNumber min={2000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">
                Áp dụng
              </Button>
            </Form.Item>
          </Form>
        </Modal>
      </Card>
    </div>
  );
}
