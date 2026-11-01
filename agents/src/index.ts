/**
 * index.ts — bề mặt công khai của package `agents/`.
 *
 * KHÔNG export gì chạm tới Prisma: package này chỉ nói chuyện với ERP qua HTTP
 * (`erp/erpClient`). Ranh giới đó là một phần của thiết kế bảo mật UC-009.
 */
export * from './contracts/types';
export * from './erp/erpClient';
export * from './policy/policyEngine';
export * from './policy/toolWrapper';
export * from './policy/skillContract';
export * from './policy/untrustedContent';
export * from './policy/scheduledJob';
export * from './telemetry/auditAndTrace';
export * from './llm/modelFactory';
export * from './orchestrator';
export * from './agents/knowledge/chunker';
export * from './agents/knowledge/citationValidator';
export * from './agents/knowledge/knowledgeAgent';
export * from './agents/finance/financeContract';
export * from './agents/finance/invoiceValidator';
export * from './agents/finance/skillManifest';
export * from './agents/finance/financeAgent';
export * from './agents/sales/salesContract';
export * from './agents/sales/pricingEngine';
export * from './agents/sales/mcpClient';
export * from './agents/sales/salesAgent';
export * from './memory/piiFilter';
export * from './memory/memoryBoundary';
export * from './memory/compaction';
