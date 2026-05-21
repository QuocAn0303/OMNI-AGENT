import { useEffect, useRef, useState } from "react";
import { Modal, Alert, Spin, Select, Button } from "antd";
import { Html5Qrcode } from "html5-qrcode";

const SCANNER_ELEMENT_ID = "camera-scanner-region";

export default function CameraScanner({ open, onClose, onDetect }) {
  const scannerRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [domReady, setDomReady] = useState(false);

  // Request camera permission + list cameras when modal opens
  useEffect(() => {
    if (!open) {
      setError(null);
      setCameras([]);
      setSelectedCamera(null);
      setDomReady(false);
      return;
    }

    setError(null);

    // First request camera permission via getUserMedia (iOS Safari needs this)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        // Stop the test stream immediately, html5-qrcode will start its own
        stream.getTracks().forEach((t) => t.stop());

        return Html5Qrcode.getCameras();
      })
      .then((devices) => {
        if (!devices || devices.length === 0) {
          setError("Không tìm thấy camera trên thiết bị này");
          return;
        }
        setCameras(devices);
        const back = devices.find((d) => /back|rear|environment/i.test(d.label));
        setSelectedCamera(back?.id || devices[0].id);
      })
      .catch((err) => {
        const msg = err?.message || String(err);
        if (/permission|denied|notallowed/i.test(msg)) {
          setError("Vui lòng cấp quyền truy cập camera trong cài đặt trình duyệt");
        } else {
          setError(`Không thể truy cập camera: ${msg}`);
        }
      });
  }, [open]);

  // Start scanner when DOM is ready and camera is selected
  useEffect(() => {
    if (!open || !selectedCamera || !domReady) return;

    let stopped = false;
    setLoading(true);

    const startTimer = setTimeout(() => {
      if (stopped) return;
      const html5QrCode = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = html5QrCode;

      html5QrCode
        .start(
          selectedCamera,
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
        .then(() => {
          if (!stopped) setLoading(false);
        })
        .catch((err) => {
          setError(`Không thể khởi động camera: ${err?.message || err}`);
          setLoading(false);
        });
    }, 100);

    return () => {
      stopped = true;
      clearTimeout(startTimer);
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [open, selectedCamera, domReady, onDetect]);

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

      {cameras.length > 1 && (
        <Select
          value={selectedCamera}
          onChange={setSelectedCamera}
          style={{ width: "100%", marginBottom: 12 }}
          options={cameras.map((c) => ({
            value: c.id,
            label: c.label || `Camera ${c.id.slice(0, 6)}`,
          }))}
        />
      )}

      <style>{`
        #${SCANNER_ELEMENT_ID} video {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          display: block !important;
        }
        #${SCANNER_ELEMENT_ID} { display: block !important; }
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
