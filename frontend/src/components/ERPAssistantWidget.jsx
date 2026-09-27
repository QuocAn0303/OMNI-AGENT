/**
 * Frontend: src/components/ERPAssistantWidget.jsx — ERPAssistantWidget
 * 
 * Tổng quan:
 * - Widget chatbot AI dạng floating button, gọi API /api/agent/chat.
 * - Lưu lịch sử tin nhắn trong local state, hỗ trợ gợi ý câu hỏi nhanh.
 * - Tự động scroll xuống tin nhắn mới nhất.
 * 
 * Props:
 * - Không nhận props (component độc lập)
 * 
 * Hàm/Exports:
 * - ERPAssistantWidget: Component chính — floating chatbot widget
 * - ChatBubble: Sub-component hiển thị 1 tin nhắn (user / assistant)
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, Spin, Tag } from 'antd';
import {
  CloseOutlined, SendOutlined,
  RobotOutlined, UserOutlined,
} from '@ant-design/icons';

/**
 * ERPAssistantWidget — Floating chatbot widget (RAG-powered)
 * Endpoint: POST /api/ai/chat { message, history }
 */
export default function ERPAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (content) => {
    if (!content.trim()) return;
    const userMsg = { role: 'user', content, id: Date.now().toString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Lỗi server');
      setMessages(prev => [...prev, { role: 'assistant', content: json.data.response, id: (Date.now() + 1).toString() }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [messages]);

  const handleSuggestion = (text) => {
    sendMessage(text);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) sendMessage(input);
  };

  const handleNew = () => setMessages([]);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Mở trợ lý AI"
          style={{
            position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
            borderRadius: '50%', background: 'var(--primary)', color: '#fff',
            border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
            boxShadow: '0 8px 24px rgba(15, 118, 110, 0.30)', zIndex: 1000,
            transition: 'all var(--transition-base)',
          }}
        >
          <RobotOutlined style={{ fontSize: 22 }} />
        </button>
      )}

      {open && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, width: 400, height: 600,
            background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column',
            zIndex: 1000, overflow: 'hidden', border: '1px solid var(--border-light)',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: 'var(--bg-sidebar)', padding: '14px 18px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 'var(--radius-md)',
                background: 'var(--primary)', display: 'grid', placeItems: 'center',
              }}>
                <RobotOutlined style={{ fontSize: 16, color: '#fff' }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>AI Assistant</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#10b981', marginRight: 4 }} />
                  {messages.length > 0 ? `${messages.length} tin nhắn` : 'Sẵn sàng'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {messages.length > 0 && (
                <Button type="text" size="small" onClick={handleNew} style={{ color: 'rgba(255,255,255,0.7)' }}>
                  Mới
                </Button>
              )}
              <Button
                type="text" size="small"
                icon={<CloseOutlined style={{ color: 'rgba(255,255,255,0.7)' }} />}
                onClick={() => setOpen(false)}
              />
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1, overflowY: 'auto', padding: 14,
              background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: 10,
            }}
          >
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                <RobotOutlined style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }} />
                <div style={{ fontSize: 13, marginBottom: 8 }}>Xin chào! Tôi là trợ lý AI.</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Hỏi tôi về doanh thu, tồn kho, đơn hàng... hoặc yêu cầu tạo đơn, nhập hàng, nhắc nợ
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div key={msg.id || idx}>
                <ChatBubble role={msg.role} content={msg.content} />
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                <Spin size="small" /> Đang xử lý...
              </div>
            )}

            {error && (
              <div style={{
                padding: '8px 12px', background: '#fef2f2', borderRadius: 'var(--radius-md)',
                color: '#dc2626', fontSize: 13, textAlign: 'center',
              }}>
                Lỗi: {error}
              </div>
            )}

            {messages.length > 0 && (
              <div style={{ textAlign: 'center', padding: '12px 0 4px', borderTop: '1px solid var(--border-light)', marginTop: 4 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>Thử hỏi thêm:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                  {[
                    { label: '💰 Doanh thu', text: 'Doanh thu tháng này?' },
                    { label: '📦 Tồn kho', text: 'Tồn kho sáp treo?' },
                    { label: '📋 Đơn hàng', text: 'Đơn hàng hôm nay?' },
                    { label: '👤 Khách hàng', text: 'Khách hàng Nguyễn Văn A?' },
                    { label: '🛒 Tạo đơn', text: 'Tạo đơn hàng 5 áo polo cho khách Nguyễn Văn A' },
                    { label: '📥 Nhập hàng', text: 'Tạo đơn nhập 100 áo polo từ NCC' },
                    { label: '💳 Nhắc nợ', text: 'Nhắc nợ khách Nguyễn Văn A' },
                    { label: '👥 Nhân sự', text: 'Thông tin nhân sự Lê Nguyễn Quốc An?' },
                    { label: '📊 Dashboard', text: 'Tình hình kinh doanh?' },
                  ].map((q) => (
                    <Tag
                      key={q.text}
                      style={{ cursor: 'pointer', padding: '1px 8px', fontSize: 11, margin: 0 }}
                      onClick={() => handleSuggestion(q.text)}
                    >
                      {q.label}
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} style={{
            padding: 12, borderTop: '1px solid var(--border-light)',
            background: 'var(--bg-secondary)', display: 'flex', gap: 8,
          }}>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Nhập câu hỏi..."
              disabled={loading}
              autoFocus
            />
            <Button
              type="primary" htmlType="submit"
              icon={<SendOutlined />} loading={loading}
              disabled={!input.trim()}
            />
          </form>
        </div>
      )}
    </>
  );
}

function ChatBubble({ role, content }) {
  const isUser = role === 'user';
  return (
    <div style={{ display: 'flex', gap: 8, flexDirection: isUser ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: isUser ? 'var(--bg-tertiary)' : 'var(--primary)',
        color: isUser ? 'var(--text-secondary)' : '#fff',
        display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 12,
      }}>
        {isUser ? <UserOutlined /> : <RobotOutlined />}
      </div>
      <div style={{
        maxWidth: '78%', padding: '10px 14px', borderRadius: 'var(--radius-md)',
        background: isUser ? 'var(--primary)' : 'var(--bg-secondary)',
        color: isUser ? '#fff' : 'var(--text-primary)', fontSize: 13,
        lineHeight: 1.5, border: isUser ? 'none' : '1px solid var(--border-light)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {content}
      </div>
    </div>
  );
}
