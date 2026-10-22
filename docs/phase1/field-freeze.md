# Phase 1 — Danh sách trường (field) đã chốt


Sinh tự động từ schema thật trong PostgreSQL ngày 04/10/2026 (đọc information_schema.columns).
Mỗi bảng dưới đây là một bảng được kiểm chứng >= 300 dòng ở R1/AN.1.

**Quy ước:** Phase 1 KHÔNG thêm cột mới. Từ thời điểm chốt, mọi thay đổi tên/kiểu cột phải kèm migration mới và cập nhật lại tài liệu này.


## `products`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `sku` | text | NO |
| 3 | `name` | text | NO |
| 4 | `imageUrl` | text | YES |
| 5 | `description` | text | YES |
| 6 | `price` | numeric | NO |
| 7 | `costPrice` | numeric | NO |
| 8 | `unit` | text | NO |
| 9 | `isActive` | boolean | NO |
| 10 | `createdAt` | timestamp without time zone | NO |
| 11 | `updatedAt` | timestamp without time zone | NO |
| 12 | `categoryId` | text | NO |
| 13 | `trackByLot` | boolean | NO |
| 14 | `trackBySerial` | boolean | NO |
| 15 | `shelfLifeDays` | integer | YES |
| 16 | `kdsStationId` | text | YES |
| 17 | `productType` | USER-DEFINED | NO |
| 18 | `tenantId` | text | YES |

*Tổng: 18 cột.*


## `customers`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `name` | text | NO |
| 3 | `phone` | text | YES |
| 4 | `email` | text | YES |
| 5 | `address` | text | YES |
| 6 | `taxCode` | text | YES |
| 7 | `totalSpent` | numeric | NO |
| 8 | `totalDebt` | numeric | NO |
| 9 | `storeCredit` | numeric | NO |
| 10 | `tier` | USER-DEFINED | NO |
| 11 | `loyaltyPoints` | integer | NO |
| 12 | `isActive` | boolean | NO |
| 13 | `createdAt` | timestamp without time zone | NO |
| 14 | `updatedAt` | timestamp without time zone | NO |
| 15 | `tenantId` | text | YES |
| 16 | `creditLimit` | numeric | NO |
| 17 | `churnProbability` | double precision | YES |
| 18 | `clvPredicted` | numeric | YES |
| 19 | `clvScoredAt` | timestamp without time zone | YES |
| 20 | `leadStatus` | USER-DEFINED | YES |
| 21 | `referralSource` | text | YES |
| 22 | `rfmFrequency` | integer | YES |
| 23 | `rfmMonetary` | numeric | YES |
| 24 | `rfmRecencyDays` | integer | YES |
| 25 | `rfmScoredAt` | timestamp without time zone | YES |
| 26 | `rfmSegment` | text | YES |
| 27 | `zaloUserId` | text | YES |

*Tổng: 27 cột.*


## `orders`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `orderCode` | text | NO |
| 3 | `status` | USER-DEFINED | NO |
| 4 | `paymentMethod` | USER-DEFINED | NO |
| 5 | `paymentStatus` | USER-DEFINED | NO |
| 6 | `subtotal` | numeric | NO |
| 7 | `discount` | numeric | NO |
| 8 | `discountType` | text | YES |
| 9 | `discountValue` | numeric | NO |
| 10 | `promotionDiscount` | numeric | NO |
| 11 | `voucherCode` | text | YES |
| 12 | `loyaltyDiscount` | numeric | NO |
| 13 | `loyaltyPointsUsed` | integer | NO |
| 14 | `total` | numeric | NO |
| 15 | `currency` | text | NO |
| 16 | `exchangeRate` | numeric | NO |
| 17 | `note` | text | YES |
| 18 | `createdAt` | timestamp without time zone | NO |
| 19 | `updatedAt` | timestamp without time zone | NO |
| 20 | `customerId` | text | YES |
| 21 | `warehouseId` | text | YES |
| 22 | `createdById` | text | NO |
| 23 | `channel` | text | NO |
| 24 | `channelOrderId` | text | YES |
| 25 | `orderType` | USER-DEFINED | NO |
| 26 | `seatNumber` | integer | YES |
| 27 | `serviceChargePercent` | numeric | NO |
| 28 | `splitMode` | text | YES |
| 29 | `tableId` | text | YES |
| 30 | `tableSessionId` | text | YES |
| 31 | `tipAmount` | numeric | NO |
| 32 | `tenantId` | text | YES |

*Tổng: 32 cột.*


## `order_items`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `quantity` | integer | NO |
| 3 | `price` | numeric | NO |
| 4 | `subtotal` | numeric | NO |
| 5 | `discountType` | text | YES |
| 6 | `discountValue` | numeric | NO |
| 7 | `discountAmount` | numeric | NO |
| 8 | `orderId` | text | NO |
| 9 | `productId` | text | NO |
| 10 | `comboId` | text | YES |
| 11 | `courseId` | integer | NO |
| 12 | `parentOrderItemId` | text | YES |
| 13 | `status` | text | NO |
| 14 | `voidReason` | text | YES |
| 15 | `tenantId` | text | YES |

*Tổng: 15 cột.*


## `payments`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `orderId` | text | NO |
| 3 | `amount` | numeric | NO |
| 4 | `currency` | text | NO |
| 5 | `exchangeRate` | numeric | NO |
| 6 | `method` | USER-DEFINED | NO |
| 7 | `reference` | text | YES |
| 8 | `note` | text | YES |
| 9 | `createdById` | text | NO |
| 10 | `createdAt` | timestamp without time zone | NO |
| 11 | `tenantId` | text | YES |
| 12 | `provider` | text | YES |
| 13 | `providerTxId` | text | YES |
| 14 | `rawResponse` | jsonb | YES |
| 15 | `refundedAmount` | numeric | NO |
| 16 | `txStatus` | text | YES |

*Tổng: 16 cột.*


## `crm_leads`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `tenantId` | text | YES |
| 3 | `leadName` | text | NO |
| 4 | `email` | text | YES |
| 5 | `mobileNo` | text | YES |
| 6 | `jobTitle` | text | YES |
| 7 | `source` | text | YES |
| 8 | `status` | USER-DEFINED | NO |
| 9 | `stageId` | text | YES |
| 10 | `leadOwnerId` | text | YES |
| 11 | `organizationId` | text | YES |
| 12 | `contactId` | text | YES |
| 13 | `expectedValue` | numeric | YES |
| 14 | `convertedAt` | timestamp without time zone | YES |
| 15 | `convertedDealId` | text | YES |
| 16 | `lastContactedAt` | timestamp without time zone | YES |
| 17 | `notes` | text | YES |
| 18 | `createdAt` | timestamp without time zone | NO |
| 19 | `updatedAt` | timestamp without time zone | NO |

*Tổng: 19 cột.*


## `crm_deals`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `tenantId` | text | YES |
| 3 | `dealName` | text | NO |
| 4 | `organizationId` | text | YES |
| 5 | `contactId` | text | YES |
| 6 | `leadId` | text | YES |
| 7 | `customerId` | text | YES |
| 8 | `stageId` | text | YES |
| 9 | `kind` | USER-DEFINED | NO |
| 10 | `value` | numeric | NO |
| 11 | `currency` | text | NO |
| 12 | `probability` | integer | NO |
| 13 | `expectedCloseDate` | timestamp without time zone | YES |
| 14 | `nextStep` | text | YES |
| 15 | `dealOwnerId` | text | YES |
| 16 | `closedAt` | timestamp without time zone | YES |
| 17 | `lostReason` | text | YES |
| 18 | `orderId` | text | YES |
| 19 | `createdAt` | timestamp without time zone | NO |
| 20 | `updatedAt` | timestamp without time zone | NO |

*Tổng: 20 cột.*


## `crm_communications`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `tenantId` | text | YES |
| 3 | `type` | USER-DEFINED | NO |
| 4 | `direction` | USER-DEFINED | YES |
| 5 | `subject` | text | YES |
| 6 | `content` | text | NO |
| 7 | `durationSec` | integer | YES |
| 8 | `leadId` | text | YES |
| 9 | `dealId` | text | YES |
| 10 | `contactId` | text | YES |
| 11 | `createdById` | text | YES |
| 12 | `createdAt` | timestamp without time zone | NO |

*Tổng: 12 cột.*


## `customer_tasks`

| # | cột | kiểu | nullable |
|---|------|------|----------|
| 1 | `id` | text | NO |
| 2 | `customerId` | text | NO |
| 3 | `title` | text | NO |
| 4 | `description` | text | YES |
| 5 | `status` | USER-DEFINED | NO |
| 6 | `priority` | USER-DEFINED | NO |
| 7 | `dueAt` | timestamp without time zone | YES |
| 8 | `assignedToId` | text | NO |
| 9 | `createdById` | text | NO |
| 10 | `completedAt` | timestamp without time zone | YES |
| 11 | `createdAt` | timestamp without time zone | NO |
| 12 | `updatedAt` | timestamp without time zone | NO |
| 13 | `tenantId` | text | YES |

*Tổng: 13 cột.*

