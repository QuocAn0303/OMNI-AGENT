/**
 * Frontend: src/components/TransferQrCode.jsx — TransferQrCode
 * 
 * Tổng quan:
 - Tạo mã QR chuyển khoản VietQR dựa trên biến môi trường VITE_BANK_ID, VITE_BANK_ACCOUNT, VITE_BANK_ACCOUNT_NAME.
 * - Hỗ trợ tuỳ chọn số tiền và nội dung chuyển khoản (sanitize bỏ dấu, ký tự đặc biệt).
 * - Xuất hàm buildVietQrImageUrl() và isTransferQrConfigured() để dùng ở nơi khác.
 * 
 * Props:
 * - amount: number — số tiền (nếu <= 0 thì không hiển thị)
 * - addInfo: string (default: "Thanh toan POS") — nội dung chuyển khoản
 * 
 * Hàm/Exports:
 * - TransferQrCode: Component hiển thị mã QR chuyển khoản
 * - buildVietQrImageUrl: Hàm xây dựng URL ảnh VietQR
 * - isTransferQrConfigured: Hàm kiểm tra đã cấu hình ngân hàng chưa
 */
import { useEffect, useMemo, useState } from "react";
import { Alert } from "antd";
import MoneyDisplay from "./shared/MoneyDisplay";

const BANK_ID = import.meta.env.VITE_BANK_ID?.trim();
const BANK_ACCOUNT = import.meta.env.VITE_BANK_ACCOUNT?.trim();
const BANK_ACCOUNT_NAME = import.meta.env.VITE_BANK_ACCOUNT_NAME?.trim();

function sanitizeAddInfo(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50);
}

export function buildVietQrImageUrl({ amount, addInfo } = {}) {
  if (!BANK_ID || !BANK_ACCOUNT) return null;

  const base = `https://img.vietqr.io/image/${BANK_ID}-${BANK_ACCOUNT}-compact2.jpg`;
  const params = new URLSearchParams();
  const roundedAmount = Math.round(Number(amount || 0));
  if (roundedAmount > 0) params.set("amount", String(roundedAmount));
  const info = sanitizeAddInfo(addInfo || "Thanh toan POS");
  if (info) params.set("addInfo", info);
  if (BANK_ACCOUNT_NAME) params.set("accountName", BANK_ACCOUNT_NAME);

  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function isTransferQrConfigured() {
  return Boolean(BANK_ID && BANK_ACCOUNT);
}

export default function TransferQrCode({ amount, addInfo = "Thanh toan POS" }) {
  const [imageError, setImageError] = useState(false);
  const qrUrl = useMemo(
    () => buildVietQrImageUrl({ amount, addInfo }),
    [amount, addInfo],
  );

  useEffect(() => {
    setImageError(false);
  }, [qrUrl]);

  if (!isTransferQrConfigured()) {
    return (
      <Alert
        type="warning"
        showIcon
        message="Chưa cấu hình QR chuyển khoản"
        description={
          <>
            Thêm <code>VITE_BANK_ID</code>, <code>VITE_BANK_ACCOUNT</code> và{" "}
            <code>VITE_BANK_ACCOUNT_NAME</code> vào file <code>frontend/.env</code>{" "}
            (xem <code>.env.example</code>), sau đó khởi động lại frontend.
          </>
        }
      />
    );
  }

  if (!qrUrl || Number(amount) <= 0) return null;

  return (
    <div className="transfer-qr">
      <style>{`
        .transfer-qr {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border-radius: 12px;
          background: var(--bg-subtle, #f5f5f5);
          border: 1px solid var(--border-color, #e8e8e8);
        }
        .transfer-qr__image {
          width: 240px;
          max-width: 100%;
          border-radius: 8px;
          background: #fff;
        }
        .transfer-qr__meta {
          width: 100%;
          font-size: 13px;
          color: var(--text-secondary, #595959);
          text-align: center;
          line-height: 1.5;
        }
        .transfer-qr__amount {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary, #141414);
        }
      `}</style>
      <div className="transfer-qr__amount">
        <MoneyDisplay value={amount} />
      </div>
      {imageError ? (
        <Alert
          type="error"
          showIcon
          message="Không tải được mã QR"
          description="Kiểm tra mã ngân hàng (VITE_BANK_ID) và số tài khoản trong file .env."
        />
      ) : (
        <img
          src={qrUrl}
          alt="Mã QR chuyển khoản VietQR"
          className="transfer-qr__image"
          onError={() => setImageError(true)}
        />
      )}
      <div className="transfer-qr__meta">
        <div>{BANK_ACCOUNT_NAME || "Tài khoản nhận"}</div>
        <div>
          {BANK_ID} · {BANK_ACCOUNT}
        </div>
        <div>Quét mã để chuyển khoản</div>
      </div>
    </div>
  );
}
