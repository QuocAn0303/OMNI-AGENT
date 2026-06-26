/**
 * Frontend: src/components/CameraScanner.jsx — CameraScanner
 * 
 * Tổng quan:
 * - Modal quét mã QR/barcode bằng camera thiết bị thông qua thư viện html5-qrcode.
 * - Tự động thử camera sau trước → bất kỳ → camera trước.
 * - Xử lý lỗi quyền camera, không tìm thấy camera.
 * 
 * Props:
 * - open: boolean — mở/đóng modal
 * - onClose: function — callback đóng modal
 * - onDetect: function(text) — callback khi phát hiện mã
 * 
 * Hàm/Exports:
 * - CameraScanner: Component quét mã QR/barcode bằng camera
 */
import { useEffect, useRef, useState } from "react";
import { Modal, Alert, Spin, Button } from "antd";
import { Html5Qrcode } from "html5-qrcode";

const SCANNER_ELEMENT_ID = "camera-scanner-region";

export default function CameraScanner({ open, onClose, onDetect }) {
  const scannerRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [domReady, setDomReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
      setDomReady(false);
      setLoading(false);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !domReady) return;

    let stopped = false;
    setLoading(true);
    setError(null);

    const startWith = (constraints) =>
      new Promise((resolve, reject) => {
        const html5QrCode = new Html5Qrcode(SCANNER_ELEMENT_ID, { verbose: false });
        scannerRef.current = html5QrCode;
        html5QrCode
          .start(
            constraints,
            {
              fps: 10,
              qrbox: (vw, vh) => {
                const size = Math.min(vw, vh) * 0.7;
                return { width: size, height: size };
              },
            },
            (decodedText) => {
              if (stopped) return;
              stopped = true;
              onDetect?.(decodedText);
            },
            () => {}
          )
          .then(resolve)
          .catch((err) => {
            scannerRef.current = null;
            reject(err);
          });
      });

    const startTimer = setTimeout(() => {
      if (stopped) return;
      // Try back camera first, then any camera, then front
      startWith({ facingMode: { exact: "environment" } })
        .catch(() => startWith({ facingMode: "environment" }))
        .catch(() => startWith({ facingMode: "user" }))
        .then(() => {
          if (!stopped) setLoading(false);
        })
        .catch((err) => {
          const msg = err?.message || String(err);
          if (/permission|denied|notallowed/i.test(msg)) {
            setError(
              "Trình duyệt chưa được cấp quyền camera. Vào Cài đặt → Safari → Camera → Cho phép, rồi tải lại trang."
            );
          } else if (/notfound|devicesnotfound/i.test(msg)) {
            setError("Không tìm thấy camera trên thiết bị này");
          } else {
            setError(`Không thể khởi động camera: ${msg}`);
          }
          setLoading(false);
        });
    }, 150);

    return () => {
      stopped = true;
      clearTimeout(startTimer);
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner?.isScanning) {
        scanner.stop().then(() => scanner.clear()).catch(() => {});
      }
    };
  }, [open, domReady, onDetect]);

  return (
    <Modal
      title="Quét mã sản phẩm"
      open={open}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          Đóng
        </Button>,
      ]}
      destroyOnClose
      width={420}
      styles={{ body: { padding: 16 } }}
    >
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}

      <style>{`
        #${SCANNER_ELEMENT_ID} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          display: block !important;
          transform: none !important;
        }
        #${SCANNER_ELEMENT_ID} {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
        }
      `}</style>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              zIndex: 2,
              color: "#fff",
            }}
          >
            <Spin tip="Đang khởi động camera..." />
          </div>
        )}
        <div
          id={SCANNER_ELEMENT_ID}
          ref={(el) => {
            if (el && !domReady) setDomReady(true);
          }}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted, #888)" }}>
        Đưa mã vạch hoặc QR code vào khung quét.
      </div>
    </Modal>
  );
}
