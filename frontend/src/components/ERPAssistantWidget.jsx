import { useState, useRef, useEffect } from 'react';
import { Input, Button, Spin } from 'antd';
import {
  MessageOutlined, CloseOutlined, SendOutlined,
  RobotOutlined, UserOutlined,
} from '@ant-design/icons';
import axios from '../api/axios';
//phần này chưa sử dụng được, vì backend chưa xử lý được request này
/**
 * ERPAssistantWidget — Floating chatbot widget
 * Đồng bộ theme Slate Emerald với phần còn lại
 *
 * Endpoint: POST /assistant/chat { message, history }
 */
export default function ERPAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Xin chào! Tôi là trợ lý ERP. Bạn có thể hỏi tôi về doanh thu, sản phẩm, đơn hàng, khách hàng...',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  // Auto scroll xuống cuối khi có message mới
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    try {
      const res = await axios.post('/assistant/chat', {
        message: text,
        history: newMessages.slice(-10), // Gửi 10 tin gần nhất làm context
      });
      setMessages([
        ...newMessages,
        { role: 'assistant', content: res.data?.reply || 'Tôi chưa hiểu câu hỏi này.' },
      ]);
    } catch {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: '❌ Có lỗi xảy ra. Vui lòng thử lại sau.' },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Floating launcher button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Mở trợ lý"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--primary)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 8px 24px rgba(15, 118, 110, 0.30)',
            zIndex: 1000,
            transition: 'all var(--transition-base)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
            e.currentTarget.style.boxShadow = '0 12px 28px rgba(15, 118, 110, 0.40)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(15, 118, 110, 0.30)';
          }}
        >
          <MessageOutlined style={{ fontSize: 22 }} />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            width: 380,
            height: 560,
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-xl)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1000,
            overflow: 'hidden',
            border: '1px solid var(--border-light)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: 'var(--bg-sidebar)',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-md)',
                background: 'var(--primary)',
                display: 'grid',
                placeItems: 'center',
              }}>
                <RobotOutlined style={{ fontSize: 16, color: '#fff' }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>ERP Assistant</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                  <span style={{
                    display: 'inline-block',
                    width: 6, height: 6,
                    borderRadius: '50%',
                    background: '#10b981',
                    marginRight: 4,
                  }} />
                  Đang hoạt động
                </div>
              </div>
            </div>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined style={{ color: 'rgba(255,255,255,0.7)' }} />}
              onClick={() => setOpen(false)}
            />
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 16,
              background: 'var(--bg-primary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {messages.map((msg, i) => (
              <ChatBubble key={i} role={msg.role} content={msg.content} />
            ))}
            {sending && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                <Spin size="small" /> Đang soạn câu trả lời...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: 12,
              borderTop: '1px solid var(--border-light)',
              background: 'var(--bg-secondary)',
              display: 'flex',
              gap: 8,
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Nhập câu hỏi..."
              onPressEnter={handleSend}
              disabled={sending}
              autoFocus
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={sending}
              disabled={!input.trim()}
            />
          </div>
        </div>
      )}
    </>
  );
}

function ChatBubble({ role, content }) {
  const isUser = role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: isUser ? 'var(--bg-tertiary)' : 'var(--primary)',
          color: isUser ? 'var(--text-secondary)' : '#fff',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          fontSize: 12,
        }}
      >
        {isUser ? <UserOutlined /> : <RobotOutlined />}
      </div>
      <div
        style={{
          maxWidth: '78%',
          padding: '10px 14px',
          borderRadius: 'var(--radius-md)',
          background: isUser ? 'var(--primary)' : 'var(--bg-secondary)',
          color: isUser ? '#fff' : 'var(--text-primary)',
          fontSize: 13,
          lineHeight: 1.5,
          border: isUser ? 'none' : '1px solid var(--border-light)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {content}
      </div>
    </div>
  );
}
