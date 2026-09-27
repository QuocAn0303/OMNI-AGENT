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
import { useEffect, useReducer, useRef } from "react";
import { Modal, Alert, Spin, Button } from "antd";
import { Html5Qrcode } from "html5-qrcode";

const SCANNER_ELEMENT_ID = "camera-scanner-region";

export default function CameraScanner({ open, onClose, onDetect }) {
  const scannerRef = useRef(null);
  const [error, errorDispatch] = useReducer((_, action) => action, null);
  const [loading, loadingDispatch] = useReducer(() => true, false);
  const [domReady, domReadyDispatch] = useReducer((_, action) => {
    if (action === 'RESET') return false;
    return true;
  }, false);

  useEffect(() => {
    if (!open) {
      errorDispatch(null);
      domReadyDispatch('RESET');
      loadingDispatch();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !domReady) return;

    let stopped = false;

    loadingDispatch();
    errorDispatch(null);

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
              formatsToSupport: [
                'ean_13',
                'ean_8',
                'code_128',
                'code_39',
                'upc_a',
                'upc_e',
                'qr_code',
              ],
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
      startWith({ facingMode: { exact: "environment" } })
        .catch(() => startWith({ facingMode: "environment" }))
        .catch(() => startWith({ facingMode: "user" }))
        .then(() => {
          if (!stopped) loadingDispatch();
        })
        .catch((err) => {
          const msg = err?.message || String(err);
          if (/permission|denied|notallowed/i.test(msg)) {
            errorDispatch(
              "Trình duyệt chưa được cấp quyền camera. Vào Cài đặt → Safari → Camera → Cho phép, rồi tải lại trang."
            );
          } else if (/notfound|devicesnotfound/i.test(msg)) {
            errorDispatch("Không tìm thấy camera trên thiết bị này");
          } else {
            errorDispatch(`Không thể khởi động camera: ${msg}`);
          }
          loadingDispatch();
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
            if (el && !domReady) domReadyDispatch('SET');
          }}
          style={{ width: "100%", height: "100%" }}
        />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted, #888)" }}>
        Đưa mã vạch hoặc QR vào khung quét. Hỗ trợ EAN-13 (mã VN 893...), Code-128, QR Code.
      </div>
    </Modal>
  );
}
