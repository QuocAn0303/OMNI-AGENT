/**
 * Frontend: src/components/crm/DealItemsEditor.jsx — Bảng dòng sản phẩm của Deal
 *
 * Tổng quan:
 * - Sửa danh sách `CrmDealItem` theo kiểu PUT (thay toàn bộ) — đúng semantics
 *   `PUT /crm/deals/:id/items` của backend.
 * - Mỗi dòng: chọn sản phẩm (search server-side) HOẶC nhập mô tả tự do,
 *   số lượng, đơn giá, chiết khấu (SỐ TIỀN, không phải %).
 * - `amount = quantity × unitPrice − discount` — công thức giống hệt
 *   `deals.service.js:calcItemAmount` để preview khớp với server.
 * - Backend chỉ tính lại `CrmDeal.value` khi deal đang có `value = 0`
 *   (chưa gán giá tay) → UI hiển thị cảnh báo nhỏ trong trường hợp đó.
 *
 * Props:
 *   items:        CrmDealItem[] — danh sách hiện tại
 *   onSave:       (items) => Promise<void>
 *   disabled:     boolean — deal đã tạo đơn hàng thì không sửa được
 *   currency:     string
 *
 * Exports:
 *   DealItemsEditor (default)
 */
import { useEffect, useMemo, useState } from "react";
import {
  Table, Button, Input, InputNumber, Select, Space, message, Popconfirm, Spin,
} from "antd";
import { useTranslation } from "react-i18next";
import { PlusOutlined, DeleteOutlined, SaveOutlined, SearchOutlined } from "@ant-design/icons";
import axios from "../../api/axios";
import MoneyDisplay from "../shared/MoneyDisplay";
import useDebounce from "../../hooks/useDebounce";

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const calcAmount = (row) => {
  const gross = round2((Number(row.quantity) || 0) * (Number(row.unitPrice) || 0));
  return round2(gross - Math.min(gross, Number(row.discount) || 0));
};

const emptyRow = () => ({
  _key: `new-${Math.random().toString(36).slice(2, 9)}`,
  productId: null,
  product: null,
  description: null,
  quantity: 1,
  unitPrice: 0,
  discount: 0,
});

/** Chuẩn hoá 1 dòng từ API về state cục bộ (luôn có `_key` cho React key) */
const toRow = (it) => ({
  _key: it.id || `row-${it.productId || Math.random().toString(36).slice(2, 9)}`,
  productId: it.productId || null,
  product: it.product || null,
  description: it.description || null,
  quantity: Number(it.quantity) || 0,
  unitPrice: Number(it.unitPrice) || 0,
  discount: Number(it.discount) || 0,
});

export default function DealItemsEditor({ items = [], onSave, disabled = false, currency = "VND" }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(() => items.map(toRow));
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const debouncedSearch = useDebounce(search, 250);

  // Nạp lại rows khi server trả về danh sách khác (sau khi lưu / đổi deal)
  useEffect(() => {
    setRows(items.map(toRow));
  }, [items]);

  // Search sản phẩm (server-side) — luôn giữ sản phẩm đang chọn trong options
  useEffect(() => {
    let active = true;
    setLoadingOptions(true);
    axios
      .get("/products", {
        params: { page: 1, limit: 20, ...(debouncedSearch ? { search: debouncedSearch } : {}) },
      })
      .then((res) => {
        if (active) setOptions(res.data?.data || []);
      })
      .catch(() => {
        if (active) setOptions([]);
      })
      .finally(() => {
        if (active) setLoadingOptions(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedSearch]);

  const productOptions = useMemo(
    () =>
      options.map((p) => ({
        value: p.id,
        label: p.sku ? `${p.name} (${p.sku})` : p.name,
        price: Number(p.price) || 0,
        unit: p.unit || "",
      })),
    [options],
  );

  const total = useMemo(() => rows.reduce((s, r) => s + calcAmount(r), 0), [rows]);

  const patchRow = (key, patch) =>
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (key) => setRows((prev) => prev.filter((r) => r._key !== key));

  const onPickProduct = (key, productId) => {
    const p = options.find((o) => o.id === productId);
    if (!p) {
      patchRow(key, { productId: null, product: null });
      return;
    }
    // Chọn sản phẩm → điền sẵn đơn giá theo giá bán hiện tại (người dùng sửa được)
    patchRow(key, { productId: p.id, product: p, unitPrice: p.price });
  };

  const save = async () => {
    const payload = rows
      .filter((r) => r.productId || (r.description || "").trim())
      .map((r) => ({
        productId: r.productId || null,
        description: r.productId ? null : (r.description || "").trim(),
        quantity: Number(r.quantity) || 0,
        unitPrice: Number(r.unitPrice) || 0,
        discount: Number(r.discount) || 0,
      }))
      .filter((r) => r.quantity > 0);

    if (!payload.length) {
      message.warning(t("crmPipeline.items.needRow"));
      return;
    }
    try {
      setSaving(true);
      await onSave(payload);
      message.success(t("crmPipeline.items.saveSuccess"));
    } catch (err) {
      message.error(err?.response?.data?.message || t("crmPipeline.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: t("crmPipeline.fields.product"),
      dataIndex: "productId",
      width: 280,
      render: (_, row) => (
        <Select
          showSearch
          filterOption={false}
          value={row.productId}
          onChange={(v) => onPickProduct(row._key, v)}
          onSearch={setSearch}
          loading={loadingOptions}
          allowClear
          disabled={disabled}
          placeholder={t("crmPipeline.items.pickProduct")}
          suffixIcon={loadingOptions ? <Spin size="small" /> : <SearchOutlined />}
          style={{ width: "100%" }}
          options={productOptions}
        />
      ),
    },
    {
      title: t("crmPipeline.fields.description"),
      dataIndex: "description",
      render: (_, row) => (
        <Input
          value={row.description}
          onChange={(e) => patchRow(row._key, { description: e.target.value })}
          disabled={disabled || !!row.productId}
          placeholder={row.productId ? "—" : t("crmPipeline.items.descriptionPlaceholder")}
        />
      ),
    },
    {
      title: t("crmPipeline.fields.quantity"),
      dataIndex: "quantity",
      width: 90,
      align: "right",
      render: (_, row) => (
        <InputNumber
          value={row.quantity}
          onChange={(v) => patchRow(row._key, { quantity: v })}
          min={0}
          step={1}
          disabled={disabled}
          style={{ width: "100%" }}
        />
      ),
    },
    {
      title: t("crmPipeline.fields.unitPrice"),
      dataIndex: "unitPrice",
      width: 130,
      align: "right",
      render: (_, row) => (
        <InputNumber
          value={row.unitPrice}
          onChange={(v) => patchRow(row._key, { unitPrice: v })}
          min={0}
          step={1000}
          disabled={disabled}
          style={{ width: "100%" }}
        />
      ),
    },
    {
      title: t("crmPipeline.fields.discount"),
      dataIndex: "discount",
      width: 120,
      align: "right",
      render: (_, row) => (
        <InputNumber
          value={row.discount}
          onChange={(v) => patchRow(row._key, { discount: v })}
          min={0}
          step={1000}
          disabled={disabled}
          style={{ width: "100%" }}
        />
      ),
    },
    {
      title: t("crmPipeline.fields.amount"),
      width: 130,
      align: "right",
      render: (_, row) => (
        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          <MoneyDisplay value={calcAmount(row)} showCurrency={false} />
        </span>
      ),
    },
    {
      title: "",
      width: 44,
      align: "center",
      render: (_, row) =>
        disabled ? null : (
          <Popconfirm
            title={t("crmPipeline.common.confirmDelete")}
            onConfirm={() => removeRow(row._key)}
            okText={t("common.delete")}
            cancelText={t("common.cancel")}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ),
    },
  ];

  return (
    <div>
      <Table
        columns={columns}
        dataSource={rows}
        rowKey="_key"
        size="small"
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{ emptyText: t("crmPipeline.items.empty") }}
      />

      <div className="crm-items__total">
        <Button icon={<PlusOutlined />} onClick={addRow} disabled={disabled}>
          {t("crmPipeline.items.addRow")}
        </Button>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--text-muted)" }}>{t("crmPipeline.items.totalLabel")}</span>
        <span className="crm-items__total-value">
          <MoneyDisplay value={total} />
        </span>
        {!disabled && (
          <Space>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              {t("crmPipeline.items.save")}
            </Button>
          </Space>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
        {t("crmPipeline.items.hint", { currency })}
      </div>
    </div>
  );
}
