import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { useUIStore } from '../../stores/uiStore';
import { useResizeHandle } from '../../hooks/useResizeHandle';

type MessageRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
}

interface ChatSidepanelProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

async function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T | null> {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  try {
    return await window.electronAPI.invoke(channel, ...args) as T;
  } catch (err) {
    console.error(`[IPC Error] ${channel}:`, err);
    return null;
  }
}

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

function MermaidBlock({ code }: { code: string }) {
  const elRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const id = useMemo(() => `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, []);

  useEffect(() => {
    if (!elRef.current || failed) return;
    (async () => {
      try {
        const { svg } = await mermaid.render(id, code);
        if (elRef.current) elRef.current.innerHTML = svg;
      } catch {
        setFailed(true);
      }
    })();
  }, [code, id, failed]);

  if (failed) {
    return <div className="chat-msg-code-block"><pre><code>{code}</code></pre></div>;
  }
  return <div ref={elRef} className="chat-msg-mermaid" />;
}

const ChatMessageItem: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`chat-msg chat-msg--${message.role}`}>
      <div className="chat-msg__avatar">
        {isUser ? (
          <span className="codicon codicon-account" />
        ) : isSystem ? (
          <span className="codicon codicon-info" />
        ) : (
          <span>AI</span>
        )}
      </div>
      <div className="chat-msg__bubble">
        <div className="chat-msg__header">
          <span className="chat-msg__role">
            {isUser ? 'You' : isSystem ? 'System' : 'AI Assistant'}
          </span>
          <span className="chat-msg__time">{formatTime(message.timestamp)}</span>
        </div>
        <div className="chat-msg__body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code(props) {
                const { className, children } = props;
                const isBlock = /language-/.test(className || '');
                if (isBlock) {
                  const lang = className?.replace('language-', '') || '';
                  const code = String(children).replace(/\n$/, '');
                  if (lang === 'mermaid') {
                    return <MermaidBlock code={code} />;
                  }
                  return (
                    <div className="chat-msg-code-block">
                      {lang && <div className="chat-msg-code-header">{lang}</div>}
                      <pre><code>{code}</code></pre>
                    </div>
                  );
                }
                return <code className="chat-msg-inline-code">{children}</code>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

const SYSTEM_PROMPT = `You are an expert AI assistant integrated into the Agent Orchestrator desktop application.
Your role is to help the user understand their AI agents, skills, workflows, and the overall system.
Answer questions about the application, help debug issues, suggest improvements, and provide general guidance.

When asked about the system, use the available IPC tools to fetch real data.
Be concise, technical, and helpful. Focus on being an agentic AI assistant.`;

export const ChatSidepanel: React.FC<ChatSidepanelProps> = ({ collapsed = false, onToggle }) => {
  const selectedEngine = useUIStore((s) => s.selectedEngine);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatResizeRef = useResizeHandle({
    direction: 'horizontal',
    invert: true,
    onResize: (delta) => {
      useUIStore.getState().setChatWidth(useUIStore.getState().chatWidth + delta);
    },
  });

  const addMessage = useCallback((role: MessageRole, content: string) => {
    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role,
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, newMessage]);
  }, []);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    addMessage('user', userMessage);

    try {
      const result = await ipcInvoke<{ response: string }>('chat:send', {
        message: userMessage,
        systemPrompt: SYSTEM_PROMPT,
        engine: selectedEngine,
      });
      if (result?.response) {
        addMessage('assistant', result.response);
      } else {
        addMessage('system', 'Unable to get a response. Please try again later.');
      }
    } catch {
      addMessage('system', 'An error occurred while sending the message.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [inputValue]);

  if (collapsed) {
    return (
      <aside
        className="chat-sidepanel chat-sidepanel--collapsed"
        role="complementary"
        aria-label="AI Chat (collapsed)"
      >
        <button className="chat-sidepanel__expand" onClick={onToggle} title="Expand chat">
          <span className="codicon codicon-comment" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="chat-sidepanel"
      role="complementary"
      aria-label="AI Chat"
    >
      <div ref={chatResizeRef} className="chat-resize-handle" />
      <div className="chat-sidepanel__header">
        <h3 className="chat-sidepanel__title">AI Assistant</h3>
        <button
          className="chat-sidepanel__toggle"
          onClick={onToggle}
          title="Toggle chat"
          aria-label="Toggle chat"
        >
          <span className="codicon codicon-chrome-minimize" />
        </button>
      </div>

      <div className="chat-sidepanel__messages">
        {messages.length === 0 && (
          <div className="chat-sidepanel__empty">
            <span className="codicon codicon-comment" style={{ fontSize: '32px' }} />
            <p>No messages yet</p>
            <p className="chat-sidepanel__hint">Ask me anything about your agents or workflows.</p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessageItem key={message.id} message={message} />
        ))}

        {isLoading && (
          <div className="chat-msg chat-msg--loading">
            <div className="chat-msg__avatar">AI</div>
            <div className="chat-msg__bubble">
              <div className="chat-msg__body">
                <span className="chat-msg__thinking">
                  <span className="chat-msg__thinking-dot" />
                  <span className="chat-msg__thinking-dot" />
                  <span className="chat-msg__thinking-dot" />
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-sidepanel__input-area">
        <textarea
          ref={textareaRef}
          className="chat-sidepanel__input"
          placeholder="Ask me anything... (Enter to send)"
          rows={1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Chat input"
        />
        <button
          className="chat-sidepanel__send"
          onClick={handleSend}
          disabled={!inputValue.trim() || isLoading}
          aria-label="Send message"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </aside>
  );
};

export default ChatSidepanel;
