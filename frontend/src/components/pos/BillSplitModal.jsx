/**
 * Frontend: components/pos/BillSplitModal.jsx — Tách hóa đơn F&B
 *
 * Tổng quan:
 * - Mở sau khi tạo order DINE_IN, hỗ trợ 3 mode:
 *   - EVEN: chia đều cho N người (backend làm tròn, nhóm cuối bù)
 *   - ITEM: chia theo món — mỗi món chọn 1 nhóm (A/B/C...)
 *   - CUSTOM: chia theo số tiền tùy chỉnh, tổng phải bằng tổng đơn
 * - Sau khi tách: hiển thị danh sách nhóm, đánh dấu từng nhóm đã thu tiền
 *
 * Props:
 * - open, onClose
 * - order: order vừa tạo (có items: id/productId/quantity/subtotal)
 * - cart: giỏ hàng POS hiện tại ({ id: productId, name }) — để hiển thị tên món
 */
import { useState, useEffect, useMemo } from "react";
import {
  Modal,
  Segmented,
  InputNumber,
  Input,
  Select,
  Button,
  Space,
  Tag,
  List,
  message,
  Empty,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import api from "../../api/axios";
import MoneyDisplay from "../shared/MoneyDisplay";

const SPLIT_METHODS = [
  { value: "CASH", label: "Tiền mặt" },
  { value: "BANK_TRANSFER", label: "Chuyển khoản" },
  { value: "CARD", label: "Thẻ" },
];

let idSeq = 0;
const nextId = () => `g-${Date.now()}-${idSeq++}`;

export default function BillSplitModal({ open, onClose, order, cart = [] }) {
  const [step, setStep] = useState("config");
  const [mode, setMode] = useState("EVEN");
  const [n, setN] = useState(2);
  const [groups, setGroups] = useState([{ key: nextId(), label: "Nhóm 1", itemIds: [] }]);
  const [customRows, setCustomRows] = useState([{ key: nextId(), label: "Người 1", amount: 0 }]);
  const [splits, setSplits] = useState([]);
  const [splitting, setSplitting] = useState(false);
  const [collecting, setCollecting] = useState(null);

  useEffect(() => {
    if (open) {
      setStep("config");
      setMode("EVEN");
      setN(2);
      setGroups([{ key: nextId(), label: "Nhóm 1", itemIds: [] }]);
      setCustomRows([{ key: nextId(), label: "Người 1", amount: 0 }]);
      setSplits([]);
      setCollecting(null);
    }
  }, [open]);

  const orderTotal = useMemo(() => Number(order?.total || 0), [order]);

  // items có thể tách (không VOIDED)
  const splitItems = useMemo(
    () => (order?.items || []).filter((item) => item.status !== "VOIDED"),
    [order],
  );

  const customTotal = useMemo(
    () => customRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [customRows],
  );

  const getItemGroupKey = (itemId) =>
    groups.find((g) => g.itemIds.includes(itemId))?.key;

  const getItemName = (item) => {
    if (item.product?.name) return item.product.name;
    const cartItem = cart.find((c) => c.id === item.productId);
    return cartItem?.name || "Món";
  };

  const setItemGroup = (itemId, groupKey) => {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        itemIds: g.itemIds.filter((i) => i !== itemId),
      })),
    );
    if (groupKey) {
      setGroups((prev) =>
        prev.map((g) =>
          g.key === groupKey ? { ...g, itemIds: [...g.itemIds, itemId] } : g,
        ),
      );
    }
  };

  const addGroup = () => {
    setGroups((prev) => [
      ...prev,
      { key: nextId(), label: `Nhóm ${prev.length + 1}`, itemIds: [] },
    ]);
  };

  const removeGroup = (key) => {
    setGroups((prev) =>
      prev.filter((g) => g.key !== key).map((g, i) => ({ ...g, label: `Nhóm ${i + 1}` })),
    );
  };

  const updateCustomRow = (key, patch) => {
    setCustomRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addCustomRow = () => {
    setCustomRows((prev) => [
      ...prev,
      { key: nextId(), label: `Người ${prev.length + 1}`, amount: 0 },
    ]);
  };

  const buildPayload = () => {
    if (mode === "EVEN") {
      const count = Math.max(2, Number(n) || 2);
      return { mode: "EVEN", n: count };
    }
    if (mode === "ITEM") {
      const validGroups = groups.filter((g) => g.itemIds.length > 0);
      if (validGroups.length < 2) {
        message.warning("Cần ít nhất 2 nhóm có món");
        return null;
      }
      return {
        mode: "ITEM",
        splits: validGroups.map((g) => {
          const quantities = {};
          g.itemIds.forEach((itemId) => {
            const item = splitItems.find((i) => i.id === itemId);
            quantities[itemId] = item?.quantity || 1;
          });
          return { label: g.label, itemIds: g.itemIds, quantities };
        }),
      };
    }
    // CUSTOM
    const rows = customRows.filter((r) => Number(r.amount || 0) > 0);
    if (rows.length < 2) {
      message.warning("Cần ít nhất 2 người có số tiền lớn hơn 0");
      return null;
    }
    if (Math.abs(customTotal - orderTotal) > 1) {
      message.error(
        `Tổng số tiền chia (${customTotal.toLocaleString("vi-VN")} ₫) phải bằng tổng đơn (${orderTotal.toLocaleString("vi-VN")} ₫)`,
      );
      return null;
    }
    return {
      mode: "CUSTOM",
      splits: rows.map((r) => ({
        label: r.label || "Người",
        amount: Number(r.amount),
      })),
    };
  };

  const handleSplit = async () => {
    if (!order?.id) return;
    const payload = buildPayload();
    if (!payload) return;
    setSplitting(true);
    try {
      const res = await api.post(`/orders/${order.id}/split-bill`, payload);
      setSplits(res.data?.data || []);
      setStep("result");
    } catch (err) {
      message.error(err.response?.data?.message || "Tách hóa đơn thất bại");
    } finally {
      setSplitting(false);
    }
  };

  const handleCollect = async (split, method) => {
    if (!method) {
      message.warning("Chọn phương thức thanh toán");
      return;
    }
    setCollecting(split.id);
    try {
      await api.post(`/orders/${order.id}/splits/${split.id}/pay`, {
        paymentMethod: method,
      });
      setSplits((prev) =>
        prev.map((s) =>
          s.id === split.id ? { ...s, paid: true, paymentMethod: method } : s,
        ),
      );
      message.success(`Đã thu tiền ${split.label}`);
    } catch (err) {
      message.error(err.response?.data?.message || "Không thu được tiền");
    } finally {
      setCollecting(null);
    }
  };

  const allPaid = splits.length > 0 && splits.every((s) => s.paid);

  return (
    <Modal
      title="Tách hóa đơn"
      open={open}
      onCancel={onClose}
      footer={
        step === "config"
          ? [
              <Button key="cancel" onClick={onClose}>
                Đóng
              </Button>,
              <Button
                key="split"
                type="primary"
                loading={splitting}
                onClick={handleSplit}
              >
                Tách hóa đơn
              </Button>,
            ]
          : [
              <Button key="close" type="primary" onClick={onClose}>
                {allPaid ? "Hoàn tất" : "Đóng"}
              </Button>,
            ]
      }
      width={560}
      destroyOnClose
    >
      {step === "config" && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              Tổng hóa đơn: <MoneyDisplay value={orderTotal} />
            </div>
            <Segmented
              options={[
                { label: "Chia đều", value: "EVEN" },
                { label: "Theo món", value: "ITEM" },
                { label: "Theo tiền", value: "CUSTOM" },
              ]}
              value={mode}
              onChange={(value) => setMode(value)}
              block
            />
          </div>

          {mode === "EVEN" && (
            <Space align="center">
              <span>Chia cho</span>
              <InputNumber
                min={2}
                max={50}
                value={n}
                onChange={(value) => setN(value || 2)}
                style={{ width: 90 }}
              />
              <span>người</span>
            </Space>
          )}

          {mode === "ITEM" && (
            <div>
              {groups.map((group) => (
                <div
                  key={group.key}
                  style={{
                    border: "1px solid var(--border-color, #e5e7eb)",
                    borderRadius: 8,
                    padding: 8,
                    marginBottom: 8,
                  }}
                >
                  <Space style={{ marginBottom: 4 }} align="center">
                    <Input
                      value={group.label}
                      onChange={(e) =>
                        setGroups((prev) =>
                          prev.map((g) =>
                            g.key === group.key
                              ? { ...g, label: e.target.value }
                              : g,
                          ),
                        )
                      }
                      style={{ width: 140 }}
                    />
                    {groups.length > 1 && (
                      <Button
                        type="text"
                        size="small"
                        danger
                        onClick={() => removeGroup(group.key)}
                      >
                        Xóa
                      </Button>
                    )}
                  </Space>
                  {splitItems.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "2px 0",
                      }}
                    >
                      <span style={{ flex: 1 }}>
                        {getItemName(item)}
                        <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                          x{item.quantity}
                        </span>
                      </span>
                      <Select
                        size="small"
                        placeholder="Chọn nhóm"
                        style={{ width: 120 }}
                        value={getItemGroupKey(item.id)}
                        onChange={(key) => setItemGroup(item.id, key)}
                        allowClear
                        options={groups.map((g) => ({
                          value: g.key,
                          label: g.label,
                        }))}
                      />
                    </div>
                  ))}
                </div>
              ))}
              <Button size="small" icon={<PlusOutlined />} onClick={addGroup}>
                Thêm nhóm
              </Button>
            </div>
          )}

          {mode === "CUSTOM" && (
            <div>
              {customRows.map((row) => (
                <Space
                  key={row.key}
                  style={{ width: "100%", marginBottom: 8 }}
                  align="center"
                >
                  <Input
                    value={row.label}
                    onChange={(e) =>
                      updateCustomRow(row.key, { label: e.target.value })
                    }
                    style={{ width: 150 }}
                  />
                  <InputNumber
                    min={0}
                    step={1000}
                    value={row.amount}
                    onChange={(value) =>
                      updateCustomRow(row.key, { amount: value || 0 })
                    }
                    style={{ width: 150 }}
                  />
                  <Button
                    type="text"
                    danger
                    onClick={() =>
                      setCustomRows((prev) =>
                        prev.filter((r) => r.key !== row.key),
                      )
                    }
                    disabled={customRows.length === 1}
                  >
                    Xóa
                  </Button>
                </Space>
              ))}
              <Button size="small" icon={<PlusOutlined />} onClick={addCustomRow}>
                Thêm người
              </Button>
              <div
                style={{
                  marginTop: 8,
                  color:
                    Math.abs(customTotal - orderTotal) < 1
                      ? "var(--success-dark, #16a34a)"
                      : "var(--danger-dark, #dc2626)",
                }}
              >
                Đã chia: {customTotal.toLocaleString("vi-VN")} ₫ / Tổng:{" "}
                {orderTotal.toLocaleString("vi-VN")} ₫
              </div>
            </div>
          )}
        </Space>
      )}

      {step === "result" &&
        (splits.length === 0 ? (
          <Empty description="Không có nhóm nào" />
        ) : (
          <List
            dataSource={splits}
            renderItem={(split) => (
              <List.Item
                actions={
                  split.paid ? (
                    [<Tag key="paid" color="green">Đã thu</Tag>]
                  ) : (
                    [
                      <Space key="collect" size={4}>
                        <Select
                          size="small"
                          placeholder="PTTT"
                          style={{ width: 120 }}
                          value={split.paymentMethod}
                          onChange={(method) =>
                            setSplits((prev) =>
                              prev.map((s) =>
                                s.id === split.id
                                  ? { ...s, paymentMethod: method }
                                  : s,
                              ),
                            )
                          }
                          options={SPLIT_METHODS}
                        />
                        <Button
                          size="small"
                          type="primary"
                          loading={collecting === split.id}
                          onClick={() =>
                            handleCollect(split, split.paymentMethod)
                          }
                        >
                          Thu tiền
                        </Button>
                      </Space>,
                    ]
                  )
                }
              >
                <List.Item.Meta
                  title={split.label}
                  description={
                    split.items?.length
                      ? `${split.items.length} món`
                      : "Theo tiền"
                  }
                />
                <MoneyDisplay value={split.amount} />
              </List.Item>
            )}
          />
        ))}
    </Modal>
  );
}
