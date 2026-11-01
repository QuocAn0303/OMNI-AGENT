/**
 * modules/agent-gateway/telegram-gateway.service.js — Bot Telegram tối giản (Bước 9).
 *
 * ============================================================================
 * BOT NÀY KHÔNG PHẢI "CHUYỂN TIẾP TIN NHẮN TỚI LLM"
 * ============================================================================
 * Đề SE373 nói rõ: chỉ forward tin nhắn cho LLM thì KHÔNG tính. Vì vậy mỗi tin
 * nhắn giao việc đi thẳng vào `startRun` (cùng đường với Web UI):
 *   - dựng `AuthContext` từ tài khoản ERP đã liên kết;
 *   - giao việc cho agent qua service nghiệp vụ;
 *   - nếu phát sinh gate, trả về `inline_keyboard` có ĐÚNG hai nút:
 *       ✅ Duyệt   → callback_data `gate_decide:<gateId>:APPROVED`
 *       ❌ Từ chối → callback_data `gate_decide:<gateId>:REJECTED`
 *   - khi người dùng bấm nút, callback gọi TRỰC TIẾP `decideGatewayGate` —
 *     không có bản sao logic duyệt nào trong bot.
 *
 * ============================================================================
 * LIÊN KẾT TELEGRAM ↔ TÀI KHOẢN ERP
 * ============================================================================
 * Route nằm sau `authenticate`, nên request mang JWT của tài khoản ERP. Lần đầu
 * một `telegramUserId` xuất hiện, cặp (tenant, telegramUserId/chatId) được gắn
 * với chính tài khoản đó. Lần sau:
 *   - cùng người → tiếp tục;
 *   - khác người → 409 `TELEGRAM_BINDING_CONFLICT` (không cho chiếm chat).
 *
 * Có thể khai báo liên kết cố định qua biến môi trường `TELEGRAM_BINDINGS`
 * (JSON array `[{ "telegramUserId": "...", "telegramChatId": "...", "userId": "..." }]`)
 * để bot service dùng token riêng thay vì token cá nhân. KHÔNG log token.
 */

'use strict';

const ApiError = require('../../utils/apiError');
const logger = require('../../utils/logger');
const prisma = require('../../config/prisma');
const service = require('./agent-gateway.service');
const sales = require('./sales.service');
const orchestration = require('./orchestration.service');

const CALLBACK_PATTERN = /^gate_decide:([^:]+):(APPROVED|REJECTED)$/;
const BINDINGS = new Map();

const bindingKey = (tenantId, telegramUserId) => `${tenantId || 'no-tenant'}:tg:${telegramUserId}`;
const chatKey = (tenantId, telegramChatId) => `${tenantId || 'no-tenant'}:chat:${telegramChatId}`;

const normalizeTelegramId = (value) => {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || null;
};

const envBindings = () => {
  const raw = String(process.env.TELEGRAM_BINDINGS || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn(`[agent-gateway] TELEGRAM_BINDINGS không phải JSON hợp lệ: ${err.message}`);
    return [];
  }
};

const assertBindingFree = ({ tenantId, telegramUserId, telegramChatId, userId }) => {
  const tgKey = telegramUserId ? bindingKey(tenantId, telegramUserId) : null;
  const chat = telegramChatId ? chatKey(tenantId, telegramChatId) : null;

  for (const key of [tgKey, chat]) {
    if (!key) continue;
    const existing = BINDINGS.get(key);
    if (existing && String(existing.userId) !== String(userId)) {
      throw new ApiError(409, 'TELEGRAM_BINDING_CONFLICT: Telegram này đã liên kết tài khoản khác', {
        code: 'TELEGRAM_BINDING_CONFLICT',
      });
    }
  }

  for (const binding of envBindings()) {
    const envTg = normalizeTelegramId(binding.telegramUserId);
    const envChat = normalizeTelegramId(binding.telegramChatId);
    const matchesTg = telegramUserId && envTg === telegramUserId;
    const matchesChat = telegramChatId && envChat === telegramChatId;
    if (!matchesTg && !matchesChat) continue;
    if (binding.userId && String(binding.userId) !== String(userId)) {
      throw new ApiError(409, 'TELEGRAM_BINDING_CONFLICT: cấu hình TELEGRAM_BINDINGS thuộc tài khoản khác', {
        code: 'TELEGRAM_BINDING_CONFLICT',
      });
    }
  }
};

/**
 * Dựng actor từ JWT (`req.user`) rồi kiểm tra/gắn liên kết Telegram.
 * Danh tính KHÔNG BAO GIỜ lấy từ `telegramUserId` trong body.
 */
const resolveIdentity = async ({ reqUser, telegramUserId, telegramChatId }) => {
  if (!reqUser?.id) throw new ApiError(401, 'Chưa xác thực tài khoản');

  const actor = await service.getAuthContext({ userId: reqUser.id });
  const tgUserId = normalizeTelegramId(telegramUserId);
  const tgChatId = normalizeTelegramId(telegramChatId);

  if (!tgUserId && !tgChatId) {
    return { actor, binding: null };
  }

  assertBindingFree({
    tenantId: actor.tenantId,
    telegramUserId: tgUserId,
    telegramChatId: tgChatId,
    userId: actor.userId,
  });

  const boundAt = new Date().toISOString();
  if (tgUserId) {
    BINDINGS.set(bindingKey(actor.tenantId, tgUserId), {
      userId: actor.userId,
      telegramUserId: tgUserId,
      telegramChatId: tgChatId,
      boundAt,
    });
  }
  if (tgChatId) {
    BINDINGS.set(chatKey(actor.tenantId, tgChatId), {
      userId: actor.userId,
      telegramUserId: tgUserId,
      telegramChatId: tgChatId,
      boundAt,
    });
  }

  return {
    actor,
    binding: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      telegramUserId: tgUserId,
      telegramChatId: tgChatId,
      boundAt,
    },
  };
};

/**
 * Gate có thể là bản ghi AgentHumanGate (`id`) hoặc mục báo cáo của run
 * (`gateId` — xem `orchestration.service.js`). Chỉ nhận `id` thì nút Duyệt/Từ
 * chối biến mất khỏi chat ở đúng nhánh quan trọng nhất, nên phải nhận cả hai.
 */
const gateIdOf = (gate) => (gate && (gate.id || gate.gateId)) || null;

const buildInlineKeyboard = (gates = []) => gates
  .map(gateIdOf)
  .filter(Boolean)
  .map((gateId) => ([
    {
      text: '✅ Duyệt',
      callback_data: `gate_decide:${gateId}:APPROVED`,
    },
    {
      text: '❌ Từ chối',
      callback_data: `gate_decide:${gateId}:REJECTED`,
    },
  ]));

const buildSendMessage = ({ chatId, text, gates = [] }) => {
  const keyboard = buildInlineKeyboard(gates);
  const payload = {
    method: 'sendMessage',
    chat_id: chatId === null || chatId === undefined ? null : String(chatId),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (keyboard.length > 0) payload.reply_markup = { inline_keyboard: keyboard };
  return payload;
};

const runSummaryText = (run) => {
  const counts = run.counts || {};
  const lines = [
    `<b>Run</b> <code>${run.runId}</code>`,
    `Trạng thái: <b>${run.status}</b>`,
    `Hoàn tất: ${counts.completed || 0} · Chặn: ${counts.denied_or_blocked || 0} · `
      + `Chờ duyệt: ${counts.pending_approval || 0} · Lỗi: ${counts.failed || 0}`,
  ];

  if (run.memoriesUsed > 0) lines.push(`Bộ nhớ dài hạn đã nạp: ${run.memoriesUsed} mục`);
  for (const item of run.report?.pending_approval || []) {
    lines.push(`• ${item.agent}: ${item.summary}`);
  }
  for (const item of run.report?.denied_or_blocked || []) {
    lines.push(`• Bị chặn (${item.agent}): ${item.summary}`);
  }
  return lines.join('\n');
};

const parseMessage = (body = {}) => {
  const rawMessage = body.message;
  const isTelegramShape = rawMessage && typeof rawMessage === 'object';
  const text = isTelegramShape
    ? rawMessage.text
    : typeof rawMessage === 'string'
      ? rawMessage
      : body.text;

  return {
    text: String(text ?? '').trim(),
    telegramUserId: normalizeTelegramId(
      isTelegramShape ? rawMessage.from?.id : body.telegramUserId,
    ),
    telegramChatId: normalizeTelegramId(
      isTelegramShape ? rawMessage.chat?.id : body.telegramChatId,
    ),
    messageId: isTelegramShape ? rawMessage.message_id ?? null : null,
  };
};

const handleWebhook = async ({ body = {}, reqUser } = {}) => {
  const message = parseMessage(body);
  const { actor, binding } = await resolveIdentity({
    reqUser,
    telegramUserId: message.telegramUserId,
    telegramChatId: message.telegramChatId,
  });

  if (!message.text && !body.opsRequest) {
    return {
      ok: false,
      error: 'TELEGRAM_MESSAGE_EMPTY',
      text: 'Hãy gửi một yêu cầu công việc, ví dụ: “tra cứu hạn mức công tác phí”.',
      binding,
      reply_markup: { inline_keyboard: [] },
    };
  }

  if (/^\/(start|help)\b/i.test(message.text)) {
    const text = [
      '<b>Aduu Multi-Agent</b>',
      'Gửi yêu cầu công việc cho agent. Khi có đề xuất cần duyệt, bot sẽ hiện nút ✅ Duyệt / ❌ Từ chối ngay trong chat.',
      'Ví dụ: “đối chiếu hoá đơn PO-...”, “soạn báo giá cho khách ...”.',
    ].join('\n');
    const reply = buildSendMessage({ chatId: message.telegramChatId, text });
    return {
      ok: true,
      type: 'message',
      binding,
      reply_markup: reply.reply_markup || { inline_keyboard: [] },
      telegramPayload: reply,
    };
  }

  const run = await orchestration.startRun({
    message: message.text,
    opsRequest: body.opsRequest,
    actor,
    source: 'TELEGRAM',
  });

  const gates = (run.report.pending_approval || []).filter((item) => item.gateId);
  const reply = buildSendMessage({
    chatId: message.telegramChatId,
    text: runSummaryText(run),
    gates,
  });

  logger.info(
    `[agent-gateway] telegram webhook user=${actor.userId} run=${run.runId} `
      + `status=${run.status} gates=${gates.length}`,
  );

  return {
    ok: true,
    type: 'message',
    binding,
    run: {
      runId: run.runId,
      status: run.status,
      counts: run.counts,
      report: run.report,
      traceSummary: run.traceSummary,
    },
    gates: gates.map((gate) => ({
      gateId: gate.gateId,
      actionType: gate.classification || null,
      summary: gate.summary,
    })),
    reply_markup: reply.reply_markup || { inline_keyboard: [] },
    telegramPayload: reply,
  };
};

/**
 * Chốt kết quả sau khi gate APPROVED — KHÔNG tự quyết định thay con người.
 * Gate đã được cập nhật bởi `decideGatewayGate` trước khi hàm này chạy.
 */
const finalizeApprovedGate = async ({ gate, actor }) => {
  const payload = gate.actionPayload && typeof gate.actionPayload === 'object'
    ? gate.actionPayload
    : {};

  if (gate.actionType === 'INVOICE_3WAY_APPROVAL') {
    const draft = payload.paymentDraft;
    if (!draft) {
      return { actionType: gate.actionType, status: 'SKIPPED', reason: 'NO_PAYMENT_DRAFT' };
    }

    const finalizedDraft = {
      ...draft,
      status: 'approved',
      finalized: true,
      approvedAt: new Date().toISOString(),
      approvedBy: actor.userId,
    };

    await prisma.agentHumanGate.update({
      where: { id: gate.id },
      data: {
        actionPayload: {
          ...payload,
          paymentDraft: finalizedDraft,
          finalization: {
            status: 'FINALIZED',
            finalizedAt: finalizedDraft.approvedAt,
            finalizedBy: actor.userId,
            channel: 'TELEGRAM',
          },
        },
        resultRef: `payment-draft:${draft.invoiceNumber || gate.id}`,
      },
    });

    return {
      actionType: gate.actionType,
      status: 'FINALIZED',
      paymentDraft: finalizedDraft,
      resultRef: `payment-draft:${draft.invoiceNumber || gate.id}`,
    };
  }

  if (gate.actionType === 'QUOTE_DISCOUNT_APPROVAL') {
    try {
      const finalized = await sales.finalizeApprovedQuote({
        gateId: gate.id,
        runId: payload.runId || `telegram-${gate.id}`,
        nodeId: payload.nodeId || 'telegram-callback',
        quote: payload.quote,
        customer: payload.customerId ? { id: payload.customerId } : undefined,
        dealId: payload.dealId || null,
        idempotencyKey: `${payload.runId || gate.id}:telegram-finalize`,
        actor,
      });
      const resultRef = finalized.draft?.id || finalized.quote?.quoteNumber || null;
      if (resultRef) {
        await prisma.agentHumanGate.update({ where: { id: gate.id }, data: { resultRef } });
      }
      return {
        actionType: gate.actionType,
        status: 'FINALIZED',
        quoteNumber: finalized.quote?.quoteNumber || null,
        draftId: finalized.draft?.id || null,
        resultRef,
      };
    } catch (err) {
      logger.error(
        `[agent-gateway] chốt báo giá sau duyệt Telegram THẤT BẠI (gate=${gate.id}): ${err.message}`,
      );
      return {
        actionType: gate.actionType,
        status: 'FAILED',
        error: err.message,
        retryAt: `/api/agent-gateway/sales/quote-drafts`,
      };
    }
  }

  return { actionType: gate.actionType, status: 'SKIPPED', reason: 'ACTION_TYPE_NOT_FINALIZABLE' };
};

const parseCallback = (body = {}) => {
  const query = body.callback_query && typeof body.callback_query === 'object'
    ? body.callback_query
    : null;
  const data = String(query?.data ?? body.data ?? '').trim();
  return {
    callbackId: String(query?.id ?? body.callbackQueryId ?? '').trim() || null,
    data,
    telegramUserId: normalizeTelegramId(query?.from?.id ?? body.telegramUserId),
    telegramChatId: normalizeTelegramId(query?.message?.chat?.id ?? body.telegramChatId),
    messageId: query?.message?.message_id ?? null,
  };
};

const handleCallback = async ({ body = {}, reqUser } = {}) => {
  const callback = parseCallback(body);
  const match = CALLBACK_PATTERN.exec(callback.data);
  if (!match) {
    throw new ApiError(400, 'callback_data không hợp lệ — cần gate_decide:<gateId>:APPROVED|REJECTED', {
      code: 'TELEGRAM_CALLBACK_INVALID',
    });
  }

  const [, gateId, decision] = match;
  const { actor, binding } = await resolveIdentity({
    reqUser,
    telegramUserId: callback.telegramUserId,
    telegramChatId: callback.telegramChatId,
  });

  const note = decision === 'REJECTED'
    ? String(body.note || 'Từ chối qua Telegram').trim()
    : (body.note ? String(body.note) : null);

  // BẤT BIẾN: mọi quyết định đi qua đúng một hàm của server.
  const gate = await service.decideGatewayGate({
    gateId,
    decision,
    note,
    actor,
  });

  const finalization = decision === 'APPROVED'
    ? await finalizeApprovedGate({ gate, actor })
    : null;

  const currentGate = finalization?.status === 'FINALIZED'
    ? await prisma.agentHumanGate.findFirst({ where: { id: gate.id } })
    : gate;

  const payload = gate.actionPayload && typeof gate.actionPayload === 'object'
    ? gate.actionPayload
    : {};

  try {
    await service.auditAgentEvent({
      runId: payload.runId || `telegram-${gate.id}`,
      userId: actor.userId,
      tenantId: actor.tenantId,
      agentName: 'orchestrator',
      toolName: 'telegram.callback',
      resource: 'agent-gateway.gate',
      decision: 'ALLOW',
      reason: `TELEGRAM_${decision}`,
      department: actor.department,
      params: {
        gateId: gate.id,
        actionType: gate.actionType,
        note,
      },
      resultSummary: `Telegram callback ${decision}`,
      approvalDecision: decision,
    });
  } catch (err) {
    // Audit là bằng chứng kiểm soát: hỏng thì báo lỗi, không trả "đã duyệt" giả.
    logger.error(`[agent-gateway] audit callback Telegram THẤT BẠI (gate=${gate.id}): ${err.message}`);
    throw err;
  }

  logger.info(
    `[agent-gateway] telegram callback gate=${gate.id} decision=${decision} `
      + `actor=${actor.userId} role=${actor.role}`,
  );

  return {
    ok: true,
    type: 'callback_query',
    binding,
    gate: {
      id: currentGate.id,
      actionType: currentGate.actionType,
      status: currentGate.status,
      decidedAt: currentGate.decidedAt,
      decidedById: currentGate.decidedById,
      decisionNote: currentGate.decisionNote,
      resultRef: currentGate.resultRef,
    },
    finalization,
    answerCallbackQuery: {
      callback_query_id: callback.callbackId,
      text: decision === 'APPROVED' ? '✅ Đã duyệt đề xuất' : '❌ Đã từ chối đề xuất',
      show_alert: false,
    },
  };
};

module.exports = {
  CALLBACK_PATTERN,
  BINDINGS,
  gateIdOf,
  buildInlineKeyboard,
  buildSendMessage,
  handleWebhook,
  handleCallback,
  finalizeApprovedGate,
  resolveIdentity,
  parseMessage,
  parseCallback,
};
