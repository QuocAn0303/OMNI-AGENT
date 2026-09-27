const prisma = require("../../config/prisma");
const path = require("path");
const fs = require("fs");

const UPLOAD_DIR = "uploads/documents";

const createDocument = async (payload, file, userId) => {
  const { title, description, sendToAll, departmentIds } = payload;

  const fileUrl = file.path;
  const doc = await prisma.internalDocument.create({
    data: {
      title,
      description: description || null,
      fileName: file.originalname,
      fileUrl,
      fileType: file.mimetype,
      fileSize: file.size,
      createdBy: userId,
      sendToAll: sendToAll === true || sendToAll === "true",
      departments: {
        create: (departmentIds || []).map((deptId) => ({
          departmentId: deptId,
        })),
      },
    },
    include: {
      author: { select: { id: true, fullName: true, email: true } },
      departments: { include: { department: true } },
    },
  });

  return doc;
};

const listDocuments = async ({ page = 1, limit = 20, search, sendToAll }) => {
  const skip = (Math.max(1, page) - 1) * Math.min(limit, 100);
  const take = Math.min(limit, 100);

  const where = {};
  if (search) {
    where.title = { contains: search, mode: "insensitive" };
  }
  if (sendToAll !== undefined) {
    where.sendToAll = sendToAll === "true" || sendToAll === true;
  }

  const [docs, total] = await Promise.all([
    prisma.internalDocument.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, fullName: true, email: true } },
        departments: { include: { department: true } },
      },
    }),
    prisma.internalDocument.count({ where }),
  ]);

  return {
    data: docs,
    pagination: {
      page: Math.max(1, page),
      limit: take,
      total,
      totalPages: Math.ceil(total / take),
    },
  };
};

const listMyDocuments = async (userId) => {
  const employee = await prisma.employee.findUnique({
    where: { userId },
    select: { departmentId: true },
  });

  if (!employee) {
    return [];
  }

  const where = {
    OR: [{ sendToAll: true }],
  };

  if (employee.departmentId) {
    where.OR.push({
      departments: { some: { departmentId: employee.departmentId } },
    });
  }

  const docs = await prisma.internalDocument.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      author: { select: { id: true, fullName: true } },
      departments: { include: { department: { select: { id: true, name: true } } } },
    },
  });

  return docs;
};

const getDocument = async (id) => {
  const doc = await prisma.internalDocument.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, fullName: true, email: true } },
      departments: { include: { department: true } },
    },
  });

  if (!doc) {
    throw { status: 404, message: "Không tìm thấy tài liệu" };
  }

  return doc;
};

const checkAccess = async (docId, userId) => {
  const doc = await prisma.internalDocument.findUnique({
    where: { id: docId },
    select: { id: true, sendToAll: true },
  });

  if (!doc) {
    return false;
  }

  if (doc.sendToAll) {
    return true;
  }

  const employee = await prisma.employee.findUnique({
    where: { userId },
    select: { departmentId: true },
  });

  if (!employee || !employee.departmentId) {
    return false;
  }

  const link = await prisma.internalDocumentDepartment.findFirst({
    where: {
      documentId: docId,
      departmentId: employee.departmentId,
    },
  });

  return !!link;
};

const deleteDocument = async (id) => {
  const doc = await prisma.internalDocument.findUnique({
    where: { id },
    select: { fileUrl: true },
  });

  if (!doc) {
    throw { status: 404, message: "Không tìm thấy tài liệu" };
  }

  if (doc.fileUrl && fs.existsSync(doc.fileUrl)) {
    fs.unlinkSync(doc.fileUrl);
  }

  await prisma.internalDocument.delete({ where: { id } });

  return { deleted: true };
};

module.exports = {
  createDocument,
  listDocuments,
  listMyDocuments,
  getDocument,
  checkAccess,
  deleteDocument,
};
