import { useEffect, useRef, useState } from "react";
import { Modal, Alert, Spin, Select } from "antd";
import { Html5Qrcode } from "html5-qrcode";

const SCANNER_ELEMENT_ID = "camera-scanner-region";

export default function CameraScanner({ open, onClose, onDetect }) {
  const scannerRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(null);

  // Get list of cameras when modal opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (!devices || devices.length === 0) {
          setError("Không tìm thấy camera trên thiết bị này");
          return;
        }
        setCameras(devices);
        // Prefer back camera on mobile
        const back = devices.find((d) => /back|rear|environment/i.test(d.label));
        setSelectedCamera(back?.id || devices[0].id);
      })
      .catch((err) => {
        setError(
          err?.message?.includes("Permission")
            ? "Vui lòng cấp quyền truy cập camera"
            : `Không thể truy cập camera: ${err?.message || err}`
        );
      });
  }, [open]);

  // Start/stop scanner when camera selection or open changes
  useEffect(() => {
    if (!open || !selectedCamera) return;

    let stopped = false;
    setLoading(true);

    const html5QrCode = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = html5QrCode;

    html5QrCode
      .start(
        selectedCamera,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (stopped) return;
          stopped = true;
          onDetect?.(decodedText);
        },
        () => {
          // ignore per-frame scan errors
        }
      )
      .then(() => setLoading(false))
      .catch((err) => {
        setError(`Không thể khởi động camera: ${err?.message || err}`);
        setLoading(false);
      });

    return () => {
      stopped = true;
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [open, selectedCamera, onDetect]);

  return (
    <Modal
      title="Quét mã sản phẩm"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      width={420}
    >
      {error && <Alert type="error" message={error} style={{ marginBottom: 12 }} />}

      {cameras.length > 1 && (
        <Select
          value={selectedCamera}
          onChange={setSelectedCamera}
          style={{ width: "100%", marginBottom: 12 }}
          options={cameras.map((c) => ({ value: c.id, label: c.label || `Camera ${c.id.slice(0, 6)}` }))}
        />
      )}

      <div style={{ position: "relative", minHeight: 280 }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 2 }}>
            <Spin tip="Đang khởi động camera..." />
          </div>
        )}
        <div id={SCANNER_ELEMENT_ID} style={{ width: "100%" }} />
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted, #888)" }}>
        Đưa mã vạch hoặc QR code vào khung quét.
      </div>
    </Modal>
  );
}
