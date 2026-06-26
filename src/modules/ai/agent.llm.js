/**
 * modules/ai/agent.llm.js — Proxy LLM server cho AI agent
 * 
 * Tổng quan:
 * - Endpoint OpenAI-compatible (/v1/chat/completions) hỗ trợ streaming
 * - Giao tiếp với Python inference process (Qwen 2.5) qua stdin/stdout JSON
 * - Tool calling: gửi query → nhận tool call → thực thi → generate response
 * 
 * Hàm:
 * - startPythonProcess(): Khởi động Python subprocess, gắn stdio handlers
 * - queryModel(payload): Gửi JSON request đến Python, trả về Promise response
 * - generateToolCall(query, res, stream): Gửi query → nhận tool call từ model → trả về OpenAI format
 * - generateResponse(messages, query, res, stream): Nhận tool result → gửi prompt → trả về text response
 * - writeChunk(res, id, created, delta, finishReason): Ghi SSE chunk cho streaming
 */
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const INFERENCE_SCRIPT = path.join(__dirname, 'inference.py');
const router = express.Router();

let pythonProcess = null;
let requestQueue = [];
let buffer = '';

function startPythonProcess() {
  if (pythonProcess) return;
  try {
    const pythonCmd = os.platform() === 'win32' ? 'python' : 'python3';
    pythonProcess = spawn(pythonCmd, ['-u', INFERENCE_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
    });

    pythonProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const next = requestQueue.shift();
          if (next) next(null, parsed);
        } catch (e) { /* partial JSON */ }
      }
    });

    pythonProcess.stderr.on('data', (data) => {});

    pythonProcess.on('error', (err) => {
      console.error('[LLM] Process error:', err.message);
    });
    pythonProcess.on('exit', (code) => {
      console.error('[LLM] Process exited:', code);
      pythonProcess = null;
      while (requestQueue.length > 0) {
        const cb = requestQueue.shift();
        if (cb) cb(new Error('process exited'));
      }
    });
  } catch (err) {
    console.error('[LLM] Failed to start Python:', err.message);
  }
}

function queryModel(payload) {
  if (!pythonProcess) startPythonProcess();
  if (!pythonProcess) return Promise.reject(new Error('No Python process'));

  return new Promise((resolve, reject) => {
    const json = JSON.stringify(payload) + '\n';
    requestQueue.push((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
    try { pythonProcess.stdin.write(json); } catch (e) { reject(e); }
    setTimeout(() => {
      const idx = requestQueue.indexOf(null);
      if (idx >= 0) { requestQueue.splice(idx, 1); reject(new Error('Python process timeout after 120s')); }
    }, 120000);
  });
}

// POST /api/llm/v1/chat/completions  — OpenAI-compatible streaming endpoint
router.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, stream } = req.body;
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages is required' } });
    }

    const hasToolResults = messages.some(m => m.role === 'tool');
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const query = lastUserMsg ? lastUserMsg.content : '';

    if (hasToolResults) {
      return await generateResponse(messages, query, res, stream !== false);
    }

    return await generateToolCall(query, res, stream !== false);
  } catch (e) {
    console.error('[LLM Proxy] Error:', e.message, e.stack);
    if (!res.headersSent) res.status(500).json({ error: { message: e.message } });
  }
});

async function generateToolCall(query, res, stream) {
  const result = await queryModel({ query, entities: {} });
  const toolCall = (result && result.toolCall) || { tool: 'unknown', params: {} };
  const toolName = toolCall.tool;
  const args = JSON.stringify(toolCall.params || {});
  const callId = 'call_' + Date.now();
  const id = 'chatcmpl-' + Date.now();
  const created = Math.floor(Date.now() / 1000);

  if (!stream) {
    return res.json({
      id, object: 'chat.completion', created, model: 'qwen-erp',
      choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function', function: { name: toolName, arguments: args } }] }, finish_reason: 'tool_calls' }],
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  writeChunk(res, id, created, { role: 'assistant', content: null }, null);
  writeChunk(res, id, created, { tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: toolName, arguments: '' } }] }, null);

  for (let i = 0; i < args.length; i += 100) {
    writeChunk(res, id, created, { tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 100) } }] }, null);
  }

  writeChunk(res, id, created, {}, 'tool_calls');
  res.write('data: [DONE]\n\n');
  res.end();
}

async function generateResponse(messages, query, res, stream) {
  const toolResultMsg = [...messages].reverse().find(m => m.role === 'tool');
  let toolResult = {};
  if (toolResultMsg) {
    try { toolResult = JSON.parse(toolResultMsg.content); } catch { toolResult = { data: toolResultMsg.content }; }
  }

  const prompt =
    `Bạn là trợ lý ERP thông minh. Trả lời người dùng bằng tiếng Việt, ngắn gọn, ` +
    `chính xác dựa trên dữ liệu bên dưới. Chỉ nói những gì có trong dữ liệu.\n\n` +
    `Người dùng hỏi: ${query}\n\n` +
    `Dữ liệu: ${JSON.stringify(toolResult)}\n\n` +
    `Trả lời:`;

  const result = await queryModel({ prompt, mode: 'response' });
  const text = (result && result.response) || 'Không thể tạo phản hồi.';
  const id = 'chatcmpl-' + Date.now();
  const created = Math.floor(Date.now() / 1000);

  if (!stream) {
    return res.json({
      id, object: 'chat.completion', created, model: 'qwen-erp',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  writeChunk(res, id, created, { role: 'assistant', content: '' }, null);

  for (let i = 0; i < text.length; i += 3) {
    writeChunk(res, id, created, { content: text.slice(i, i + 3) }, null);
  }

  writeChunk(res, id, created, {}, 'stop');
  res.write('data: [DONE]\n\n');
  res.end();
}

function writeChunk(res, id, created, delta, finishReason) {
  res.write(`data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model: 'qwen-erp',
    choices: [{ index: 0, delta, finish_reason: finishReason || null }],
  })}\n\n`);
}

module.exports = router;
module.exports.queryModel = queryModel;
module.exports.startPythonProcess = startPythonProcess;