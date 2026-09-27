const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { authenticate, authorize } = require("../../middleware/auth.middleware");
const svc = require("./documents.service");
const { createDocumentSchema } = require("./documents.validation");
const { success, created, paginated, sendError } = require("../../utils/response");

const ALLOWED_EXT = [".pdf", ".doc", ".docx"];
const MAGIC_PDF = Buffer.from("%PDF-");
const MAGIC_DOC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
const MAGIC_DOCX = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = `uploads/documents`;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ALLOWED_EXT.includes(ext) ? ext : "";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedMimes = {
      ".pdf": "application/pdf",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    if (allowedMimes[ext] === file.mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Chỉ chấp nhận file PDF (.pdf) và Word (.doc, .docx)"));
    }
  },
});

const verifyMagicBytes = (filePath) => {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(8);
  try {
    fs.readSync(fd, buf, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
  }
  return (
    buf.subarray(0, 5).equals(MAGIC_PDF) ||
    buf.subarray(0, 4).equals(MAGIC_DOC) ||
    buf.subarray(0, 4).equals(MAGIC_DOCX)
  );
};

const safeFileName = (name) =>
  String(name || "").replace(/[\r\n\x00-\x1f]/g, "").slice(0, 150) || "document";

router.use(authenticate);

router.post(
  "/",
  authorize("ADMIN", "MANAGER"),
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          return sendError(res, err.message, 400);
        }
        return sendError(res, err.message, 400);
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        return sendError(res, "Vui lòng chọn file PDF hoặc Word", 400);
      }

      if (!verifyMagicBytes(req.file.path)) {
        fs.unlinkSync(req.file.path);
        return sendError(res, "File không đúng định dạng PDF hoặc Word", 400);
      }

      req.file.originalname = safeFileName(req.file.originalname);

      const parsed = createDocumentSchema.parse(req.body);
      const doc = await svc.createDocument(parsed, req.file, req.user.id);
      created(res, doc, "Tạo tài liệu thành công");
    } catch (err) {
      next(err);
    }
  },
);

router.get("/", authorize("ADMIN", "MANAGER"), async (req, res, next) => {
  try {
    const result = await svc.listDocuments(req.query);
    paginated(res, result.data, result.pagination);
  } catch (err) {
    next(err);
  }
});

router.get("/my", async (req, res, next) => {
  try {
    const docs = await svc.listMyDocuments(req.user.id);
    success(res, docs);
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const doc = await svc.getDocument(req.params.id);
    const isManager = ["ADMIN", "MANAGER"].includes(req.user?.role);
    if (!isManager) {
      const hasAccess = await svc.checkAccess(req.params.id, req.user.id);
      if (!hasAccess) {
        return sendError(res, "Bạn không có quyền xem tài liệu này", 403);
      }
    }
    success(res, doc);
  } catch (err) {
    next(err);
  }
});

router.get("/:id/file", async (req, res, next) => {
  try {
    const hasAccess = await svc.checkAccess(req.params.id, req.user.id);
    if (!hasAccess) {
      return sendError(res, "Bạn không có quyền xem tài liệu này", 403);
    }

    const doc = await svc.getDocument(req.params.id);
    const absolutePath = path.resolve(doc.fileUrl);

    if (!fs.existsSync(absolutePath)) {
      return sendError(res, "File không tồn tại trên hệ thống", 404);
    }

    res.setHeader("Content-Disposition", `inline; filename="${safeFileName(doc.fileName)}"`);
    res.setHeader("Content-Type", doc.fileType);
    res.sendFile(absolutePath);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authorize("ADMIN"), async (req, res, next) => {
  try {
    await svc.deleteDocument(req.params.id);
    success(res, null, "Xóa tài liệu thành công");
  } catch (err) {
    next(err);
  }
});

module.exports = router;
