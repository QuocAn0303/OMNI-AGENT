/**
 * Frontend: src/api/crm.js — API module CRM (Marketing + Sales Pipeline)
 *
 * Tổng quan:
 * - Gộp TOÀN BỘ endpoint CRM của 2 nhóm:
 *   1. CRM giao dịch (đã có từ trước, đang gọi inline trong page):
 *      notes, tags, tasks, segments, campaigns.
 *   2. Sales Pipeline (Phase 3): stages, leads, deals, organizations, contacts,
 *      dashboard, timeline.
 * - Mọi hàm unwrap response qua `res.data?.data ?? res.data` (helper export từ
 *   api/accounting) — KHÔNG tạo axios instance riêng, dùng chung `api/axios.js`
 *   để không mất interceptor attach JWT + refresh 401.
 *
 * Lưu ý quan trọng về `pagination`:
 * - Backend trả `{ success, data, pagination }` cho endpoint phân trang.
 * - `unwrap` CHỈ lấy `data` → mất `pagination`. Vì vậy các hàm phân trang trả
 *   về object đầy đủ gồm cả `pagination` (dùng `.then((r) => r.data)` giống
 *   mẫu `Tasks.jsx:91`). Hàm không phân trang vẫn `.then(unwrap)` cho gọn.
 *
 * Phân quyền (xem `src/modules/crm/scope.js`) — FE dùng để ẩn nút sửa/xoá:
 * - MANAGER/ADMIN/SUPER_ADMIN: thấy toàn tenant.
 * - CASHIER: chỉ thấy lead/deal mình làm chủ; mọi endpoint trả 403 nếu đọc/sửa
 *   bản ghi của người khác. `dashboard.scope` trả "TENANT" | "OWN" cho biết.
 *
 * Mã lỗi nghiệp vụ cần xử lý ở FE:
 * - 409: đã convert / đã có đơn / trùng tên tổ chức / còn lead-deal ở stage.
 * - 400: thiếu lý do thua, deal chưa thắng, deal chưa có sản phẩm.
 * - 403: không có quyền trên record này. 404: không tồn tại.
 */
import axios from "./axios";
import { unwrap } from "./accounting";

/** Trả về cả `data` + `pagination` cho endpoint phân trang. */
const withPagination = (res) => ({ data: res.data?.data ?? res.data, pagination: res.data?.pagination });

// ==================== CrmPipelineStage ====================
// listStages(entityType, includeInactive) → { entityType, stages }
// Lần gọi đầu tiên của tenant sẽ lazy-seed 9 stage mặc định.
export const listStages = (entityType = "DEAL", includeInactive = false) =>
  axios.get("/crm/stages", { params: { entityType, ...(includeInactive && { includeInactive: 1 }) } }).then(unwrap);
export const createStage = (data) => axios.post("/crm/stages", data).then(unwrap);
export const updateStage = (id, data) => axios.patch(`/crm/stages/${id}`, data).then(unwrap);
export const deleteStage = (id) => axios.delete(`/crm/stages/${id}`).then(unwrap);
// reorderStages([{ id, sortOrder }]) — kéo-thả trong Pipeline Settings
export const reorderStages = (stages) => axios.post("/crm/stages/reorder", { stages }).then(unwrap);

// ==================== CrmLead ====================
// listLeads(params) → { data: leads[], pagination } — filter: status/stageId/
//   leadOwnerId/source/organizationId/search/overdue(=1)/page/limit
export const listLeads = (params) => axios.get("/crm/leads", { params }).then(withPagination);
export const getLeadFields = () => axios.get("/crm/leads/fields").then(unwrap);
export const getLead = (id) => axios.get(`/crm/leads/${id}`).then(unwrap);
export const createLead = (data) => axios.post("/crm/leads", data).then(unwrap);
export const updateLead = (id, data) => axios.patch(`/crm/leads/${id}`, data).then(unwrap);
export const deleteLead = (id) => axios.delete(`/crm/leads/${id}`).then(unwrap);
// changeLeadStage(id, { stageId, status?, lastContactedAt? }) — endpoint drag-drop kanban
export const changeLeadStage = (id, data) => axios.patch(`/crm/leads/${id}/stage`, data).then(unwrap);
// convertLead(id, payload) → { deal, lead } — 409 nếu đã convert trước đó
export const convertLead = (id, data) => axios.post(`/crm/leads/${id}/convert`, data).then(unwrap);
// importLeads(leads[]) → { createdCount, skipped[], total } — tự bỏ qua trùng SĐT/email
export const importLeads = (leads) => axios.post("/crm/leads/import", { leads }).then(unwrap);

// ==================== CrmDeal ====================
// listDeals(params) → { data: deals[], pagination } — filter: kind/stageId/
//   dealOwnerId/organizationId/contactId/leadId/customerId/converted/search
export const listDeals = (params) => axios.get("/crm/deals", { params }).then(withPagination);
export const getDeal = (id) => axios.get(`/crm/deals/${id}`).then(unwrap);
export const createDeal = (data) => axios.post("/crm/deals", data).then(unwrap);
export const updateDeal = (id, data) => axios.patch(`/crm/deals/${id}`, data).then(unwrap);
export const deleteDeal = (id) => axios.delete(`/crm/deals/${id}`).then(unwrap);
// changeDealStage(id, { stageId, lostReason? }) — 400 nếu chuyển sang Thua mà
//   thiếu lý do; 409 nếu deal đã tạo đơn hàng.
export const changeDealStage = (id, data) => axios.patch(`/crm/deals/${id}/stage`, data).then(unwrap);
// getDealBoard(includeClosed) → { columns[], summary } — cột đã QUA normalizeDealBoard
//
// CONTRACT: backend `dealsService.getBoard` trả cột LỒNG
//   `{ stage: { id, label, color, kind, probability }, count, totalValue, weightedValue, deals[] }`
// còn `KanbanBoard` cần shape PHẲNG `{ id, label, color, kind, totalValue, weightedValue, items[] }`.
// Việc map đặt ở ĐÂY (biên API) chứ không rải trong component — đổi shape BE chỉ
// phải sửa 1 chỗ. `normalizeDealBoard` export ra để test contract dùng lại được.
export const normalizeDealBoard = (raw) => {
  const board = raw || {};
  return {
    ...board,
    columns: (board.columns || []).map((col) => {
      const stage = col.stage || {};
      return {
        // `stage.id` có thể null (cột "Chưa phân giai đoạn") → colKey() ở constants.jsx xử lý
        id: stage.id ?? null,
        label: stage.label ?? "",
        color: stage.color ?? null,
        kind: stage.kind ?? "ONGOING",
        probability: stage.probability ?? 0,
        count: col.count ?? 0,
        totalValue: col.totalValue ?? 0,
        weightedValue: col.weightedValue ?? 0,
        items: col.deals ?? col.items ?? [],
      };
    }),
    // CRM audit M3/L4: backend cắt ngang dữ liệu ở `take` → phải nói với người dùng
    // là KPI chỉ tính trên phần đã tải, tránh tưởng đã xem hết pipeline.
    truncated: board.truncated === true,
    limits: board.limits || null,
    summary: board.summary || {},
  };
};

export const getDealBoard = (includeClosed = false) =>
  axios
    .get("/crm/deals/board", { params: includeClosed ? { includeClosed: 1 } : {} })
    .then((r) => normalizeDealBoard(unwrap(r)));
// getDealForecast(months) → { summary, byStage[], byMonth[], lostReasons[] }
export const getDealForecast = (months = 6) => axios.get("/crm/deals/forecast", { params: { months } }).then(unwrap);
// saveDealItems(id, items[]) — PUT semantics, thay toàn bộ dòng sản phẩm
export const saveDealItems = (id, items) => axios.put(`/crm/deals/${id}/items`, { items }).then(unwrap);
// convertDealToOrder(id, payload) → { deal, order } — chỉ chạy được khi kind=WON
export const convertDealToOrder = (id, data) => axios.post(`/crm/deals/${id}/convert-to-order`, data).then(unwrap);

// ==================== CrmOrganization ====================
// listOrganizations(params) → { data, pagination } — filter: search/industry/includeInactive
export const listOrganizations = (params) => axios.get("/crm/organizations", { params }).then(withPagination);
export const getOrganization = (id) => axios.get(`/crm/organizations/${id}`).then(unwrap);
export const createOrganization = (data) => axios.post("/crm/organizations", data).then(unwrap);
export const updateOrganization = (id, data) => axios.patch(`/crm/organizations/${id}`, data).then(unwrap);
export const deleteOrganization = (id) => axios.delete(`/crm/organizations/${id}`).then(unwrap);

// ==================== CrmContact ====================
// listContacts(params) → { data, pagination } — filter: search/organizationId/includeInactive
export const listContacts = (params) => axios.get("/crm/contacts", { params }).then(withPagination);
export const getContact = (id) => axios.get(`/crm/contacts/${id}`).then(unwrap);
export const createContact = (data) => axios.post("/crm/contacts", data).then(unwrap);
export const updateContact = (id, data) => axios.patch(`/crm/contacts/${id}`, data).then(unwrap);
export const setPrimaryContact = (id) => axios.post(`/crm/contacts/${id}/primary`).then(unwrap);
export const deleteContact = (id) => axios.delete(`/crm/contacts/${id}`).then(unwrap);

// ==================== Unified Timeline (CrmCommunication) ====================
// listLeadTimeline(leadId, params) → { data: timeline[], pagination }
// listDealTimeline(dealId, params) → { data: timeline[], pagination }
// type=SYSTEM là sự kiện hệ thống (đổi stage/gán owner/convert) — không tạo/xoá tay.
export const listLeadTimeline = (leadId, params) =>
  axios.get(`/crm/leads/${leadId}/timeline`, { params }).then(withPagination);
export const addLeadTimeline = (leadId, data) => axios.post(`/crm/leads/${leadId}/timeline`, data).then(unwrap);
export const listDealTimeline = (dealId, params) =>
  axios.get(`/crm/deals/${dealId}/timeline`, { params }).then(withPagination);
export const addDealTimeline = (dealId, data) => axios.post(`/crm/deals/${dealId}/timeline`, data).then(unwrap);

// ==================== CRM Dashboard ====================
// getCrmDashboard(months) → { scope, months, kpi{}, funnel{}, leadByStatus[], leadBySource[],
//   leadByMonth[], dealByStage[], dealByMonth[], lostReasons[], recentDeals[] }
export const getCrmDashboard = (months = 6) => axios.get("/crm/dashboard", { params: { months } }).then(unwrap);
export const getCrmFunnel = () => axios.get("/crm/dashboard/funnel").then(unwrap);

// ==================== CRM giao dịch (nhóm cũ — gom về đây) ====================

// --- Ghi chú (CustomerNote) ---
export const listNotes = (customerId) => axios.get(`/crm/notes/customer/${customerId}`).then(unwrap);
export const createNote = (customerId, data) => axios.post(`/crm/notes/customer/${customerId}`, data).then(unwrap);
export const updateNote = (id, data) => axios.put(`/crm/notes/${id}`, data).then(unwrap);
export const deleteNote = (id) => axios.delete(`/crm/notes/${id}`).then(unwrap);

// --- Tag (CustomerTag) ---
export const listTags = () => axios.get("/crm/tags").then(unwrap);
export const createTag = (data) => axios.post("/crm/tags", data).then(unwrap);
export const updateTag = (id, data) => axios.put(`/crm/tags/${id}`, data).then(unwrap);
export const deleteTag = (id) => axios.delete(`/crm/tags/${id}`).then(unwrap);
export const listCustomerTags = (customerId) => axios.get(`/crm/tags/customer/${customerId}`).then(unwrap);
export const assignTag = (customerId, tagId) => axios.post(`/crm/tags/customer/${customerId}/assign/${tagId}`).then(unwrap);
export const unassignTag = (customerId, tagId) => axios.delete(`/crm/tags/customer/${customerId}/unassign/${tagId}`).then(unwrap);

// --- Nhiệm vụ (CustomerTask) ---
export const listTasks = (params) => axios.get("/crm/tasks", { params }).then(withPagination);
export const getMyTasks = (params) => axios.get("/crm/tasks/my", { params }).then(withPagination);
export const getMyOverdueTaskCount = () => axios.get("/crm/tasks/my/overdue-count").then(unwrap);
export const listAssignableUsers = () => axios.get("/crm/tasks/assignable-users").then(unwrap);
export const createTask = (data) => axios.post("/crm/tasks", data).then(unwrap);
export const updateTask = (id, data) => axios.patch(`/crm/tasks/${id}`, data).then(unwrap);
export const deleteTask = (id) => axios.delete(`/crm/tasks/${id}`).then(unwrap);

// --- Phân khúc (CustomerSegment) ---
export const listSegments = () => axios.get("/crm/segments").then(unwrap);
export const getSegment = (id) => axios.get(`/crm/segments/${id}`).then(unwrap);
export const createSegment = (data) => axios.post("/crm/segments", data).then(unwrap);
export const updateSegment = (id, data) => axios.put(`/crm/segments/${id}`, data).then(unwrap);
export const deleteSegment = (id) => axios.delete(`/crm/segments/${id}`).then(unwrap);
export const previewSegment = (rules, limit = 20) =>
  axios.post(`/crm/segments/preview?limit=${limit}`, { rules }).then(unwrap);

// --- Chiến dịch (Campaign) ---
export const listCampaigns = () => axios.get("/crm/campaigns").then(unwrap);
export const getCampaign = (id) => axios.get(`/crm/campaigns/${id}`).then(unwrap);
export const createCampaign = (data) => axios.post("/crm/campaigns", data).then(unwrap);
export const sendCampaignNow = (id) => axios.post(`/crm/campaigns/${id}/send-now`).then(unwrap);
export const deleteCampaign = (id) => axios.delete(`/crm/campaigns/${id}`).then(unwrap);
export const listCampaignRecipients = (id, params) =>
  axios.get(`/crm/campaigns/${id}/recipients`, { params }).then(withPagination);
// getCampaignStats(id) → { events, recipients, unsubscribed, openRate, clickRate, clickToOpenRate }
//   CRM Phase 4: số liệu đo mở/click/từ chối của 1 chiến dịch.
export const getCampaignStats = (id) => axios.get(`/crm/campaigns/${id}/stats`).then(unwrap);
// Lưu ý: endpoint đo lượt mở/click + từ chối KHÔNG có ở đây — chúng là public
// (token-based), gọi bởi mail client. Xem docs/CRM_SALES_PIPELINE_PLAN.md mục 4.

// ==================== Sales hierarchy (CRM Phase 4) ====================
// getHierarchyTree() → { roots[{ id, fullName, email, role, leadCount, dealCount,
//   children[] }], totals{ users, leads, deals }, flattened[] }
export const getHierarchyTree = () => axios.get("/crm/hierarchy").then(unwrap);
// listHierarchyAssignable() → [user] — user có thể gán làm owner lead/deal
export const listHierarchyAssignable = () => axios.get("/crm/hierarchy/assignable").then(unwrap);
// setReportsTo(userId, reportsToId | null) — 400 nếu tự gán / tạo vòng lặp
export const setReportsTo = (userId, reportsToId) =>
  axios.put(`/crm/hierarchy/${userId}/reports-to`, { reportsToId }).then(unwrap);
