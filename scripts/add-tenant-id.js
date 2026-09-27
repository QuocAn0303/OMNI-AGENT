/**
 * scripts/add-tenant-id.js — Tự động thêm tenantId String? + @@index vào các business model
 * Chạy 1 lần: node scripts/add-tenant-id.js
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');

const SCOPED_MODELS = new Set([
  'Product', 'Category', 'Customer', 'Order', 'OrderItem', 'OrderItemModifier',
  'Inventory', 'InventoryTransaction', 'Warehouse', 'Vendor',
  'BankAccount', 'BankTransaction', 'BankStatement', 'BankStatementLine',
  'Expense', 'ExpenseCategory', 'Debt', 'DebtPayment',
  'Promotion', 'PromotionUsage', 'Invoice', 'Payment',
  'CompanySettings', 'TaxRate',
  'Employee', 'Shift', 'Payroll', 'Violation', 'OvertimeRequest', 'TimeEntry',
  'JournalEntry', 'JournalLine', 'FiscalPeriod',
  'FixedAsset', 'FixedAssetCategory', 'DepreciationSchedule',
  'PettyCashTransaction', 'PrepaidExpense', 'RecurringExpenseLog',
  'JournalPostingError',
  'Area', 'DinerTable', 'TableSession', 'Reservation',
  'KdsStation', 'KdsTicket',
  'ModifierGroup', 'ModifierOption', 'ProductVariant', 'Combo', 'ComboItem',
  'Recipe', 'RecipeIngredient', 'WasteLog',
  'StampCard', 'StampCardTemplate',
  'Printer', 'ReturnLineItem',
  'FoodDeliveryOrder', 'QrOrderSession',
  'BillSplit', 'BillSplitItem',
  'Delivery', 'DeliveryEvent',
  'PurchaseOrder', 'PurchaseItem',
  'StockTransfer', 'StockTransferItem',
  'CycleCount', 'CycleCountItem',
  'SerialNumber', 'InventoryLot', 'LotTransaction',
  'ElectronicInvoice',
  'LoyaltyTransaction', 'StoreCreditTransaction',
  'CustomerNote', 'CustomerTag', 'CustomerTagOnCustomer', 'CustomerTask', 'CustomerSegment',
  'CampaignRecipient', 'CampaignTracking', 'CustomerCampaign',
  'MarketplaceListing', 'MarketplaceSyncLog', 'MarketplaceShop',
  'Notification',
  'OrderReturn',
  'QualityCheck', 'QualityCheckItem',
  'WorkCenter', 'Routing', 'RoutingOperation', 'WorkOrder', 'WorkOrderItem',
  'Bom', 'BomItem',
  'Project', 'ProjectInvoice', 'ProjectMember', 'ProjectTask',
  'AiForecast', 'AiRecommendation',
  'ReportSchedule', 'SavedReport',
  'PortalSession', 'PortalOtp',
  'IntegrationConfig',
  'Workflow', 'WorkflowApproval', 'WorkflowRun', 'WorkflowStep',
]);

let content = fs.readFileSync(SCHEMA_PATH, 'utf8');
let modified = 0;

for (const model of SCOPED_MODELS) {
  // Tìm model block: model ModelName {
  const modelRegex = new RegExp(`(model\\s+${model}\\s*\\{)`, 'g');
  const match = modelRegex.exec(content);
  if (!match) {
    console.warn(`[SKIP] Model ${model} không tìm thấy trong schema`);
    continue;
  }

  // Kiểm tra đã có tenantId chưa
  const modelStart = match.index + match[0].length;
  // Tìm } đóng model
  let braceCount = 1;
  let i = modelStart;
  while (i < content.length && braceCount > 0) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') braceCount--;
    i++;
  }
  const modelEnd = i; // vị trí sau } đóng
  const modelBody = content.slice(modelStart, modelEnd);

  if (modelBody.includes('tenantId')) {
    console.log(`[EXISTS] ${model} đã có tenantId`);
    continue;
  }

  // Tìm dòng id đầu tiên
  const idMatch = modelBody.match(/(\s+id\s+\S+\s+@id[^\n]*\n)/);
  let insertPoint;
  let tenantField;
  if (idMatch) {
    insertPoint = modelStart + idMatch.index + idMatch[0].length;
    tenantField = '  tenantId    String?\n';
  } else {
    // Không có id field, chèn ngay sau {
    insertPoint = modelStart;
    tenantField = '\n  tenantId    String?\n';
  }

  content = content.slice(0, insertPoint) + tenantField + content.slice(insertPoint);

  // Tìm lại modelEnd vì content đã thay đổi
  const newMatch = new RegExp(`model\\s+${model}\\s*\\{`).exec(content);
  if (newMatch) {
    let bc = 1;
    let j = newMatch.index + newMatch[0].length;
    while (j < content.length && bc > 0) {
      if (content[j] === '{') bc++;
      if (content[j] === '}') bc--;
      j++;
    }
    // Chèn @@index trước } cuối
    const closingBrace = j - 1;
    // Tìm dòng có } (có thể có khoảng trắng trước)
    let lineStart = closingBrace;
    while (lineStart > 0 && content[lineStart - 1] !== '\n') lineStart--;
    const indent = content.slice(lineStart, closingBrace);
    const indexLine = `${indent}@@index([tenantId])\n`;
    // Kiểm tra trùng lặp
    const beforeClosing = content.slice(lineStart - 200, lineStart);
    if (!beforeClosing.includes('@@index([tenantId])')) {
      content = content.slice(0, lineStart) + indexLine + content.slice(lineStart);
    }
  }

  modified++;
  console.log(`[OK] ${model}`);
}

fs.writeFileSync(SCHEMA_PATH, content, 'utf8');
console.log(`\nDone: ${modified} models modified`);
