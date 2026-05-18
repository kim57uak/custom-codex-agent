/**
 * ChatSidepanel — AI 어시스턴트 채팅 사이드패널 컴포넌트.
 *
 * 기능:
 * - 사용자 메시지를 받아 AI 응답 생성 (chat:send IPC)
 * - 병렬로 워크플로 추천 (workflow:recommend-and-create)
 * - 2명 이상의 에이전트가 추천되면 워크플로 실행 제안 UI 표시
 * - ReactMarkdown + Mermaid 다이어그램 렌더링 지원
 * - 접힘/펼침 모드, 가로 리사이즈 지원
 *
 * Props:
 * - collapsed: 패널 접힘 상태
 * - onToggle: 접힘/펼침 토글 콜백
 *
 * State:
 * - messages (ChatMessage[]): 채팅 메시지 목록 (user/assistant/system)
 * - wfRecommendations: 추천 워크플로 상태 (goalPrompt, agents 목록)
 * - isLoading: 전송 중 로딩 표시
 *
 * 앱 내 배치:
 * - 전체 앱 레이아웃의 최우측 사이드패널
 * - App.tsx에서 Layout 컴포넌트 내부, 메인 콘텐츠 영역 우측에 위치
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { useUIStore } from '../../stores/uiStore';
import { useResizeHandle } from '../../hooks/useResizeHandle';
import type { WorkflowRecommendedAgent } from '../../../types/ipc-contract';
import { ipcInvoke } from '../../utils/ipc';

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

const STEP_ICONS: Record<string, string> = {
  shield: '\u{1F6E1}',
  'check-circle': '\u2705',
  'file-text': '\u{1F4C4}',
  database: '\u{1F4BE}',
  layout: '\u{1F3A8}',
  server: '\u{1F5A5}',
  'play-square': '\u25B6',
  folder: '\u{1F4C1}',
  table: '\u{1F4CA}',
  presentation: '\u{1F4CA}',
  bot: '\u{1F916}',
};

/** 아이콘 키에 해당하는 이모지 반환 */
function getIcon(iconKey: string | null | undefined): string {
  return STEP_ICONS[iconKey || 'bot']!;
}

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

/**
 * MermaidBlock — Mermaid 다이어그램 렌더링 블록 컴포넌트.
 * @returns Mermaid SVG 또는 fallback 코드 블록 JSX
 */
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

/**
 * ChatMessageItem — 개별 채팅 메시지 렌더링 컴포넌트.
 * @returns 메시지 버블 JSX 요소
 */
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

/**
 * ChatSidepanel — AI 어시스턴트 채팅 사이드패널.
 * 메시지 송수신, 워크플로 추천, Mermaid 다이어그램 렌더링 지원.
 * @param props - 컴포넌트 Props
 * @returns 채팅 사이드패널 JSX 요소
 */
export const ChatSidepanel: React.FC<ChatSidepanelProps> = ({ collapsed = false, onToggle }) => {
  const selectedEngine = useUIStore((s) => s.selectedEngine);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [wfRecommendations, setWfRecommendations] = useState<{
    goalPrompt: string;
    agents: WorkflowRecommendedAgent[];
    workflowRunId: string | null;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatResizeRef = useResizeHandle({
    direction: 'horizontal',
    invert: true,
    onResize: (delta) => {
      useUIStore.getState().setChatWidth(useUIStore.getState().chatWidth + delta);
    },
  });

  /** 새 채팅 메시지 추가 */
  const addMessage = useCallback((role: MessageRole, content: string) => {
    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role,
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, newMessage]);
  }, []);

  /** 채팅 메시지 전송 — AI 응답 및 워크플로 추천 병렬 요청 */
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    addMessage('user', userMessage);

    try {
      const [chatResult, wfResult] = await Promise.all([
        ipcInvoke<{ response: string }>('chat:send', {
          message: userMessage,
          systemPrompt: SYSTEM_PROMPT,
          engine: selectedEngine,
        }),
        ipcInvoke<{ recommendations: WorkflowRecommendedAgent[]; workflowRunId: string | null }>(
          'workflow:recommend-and-create', { goalPrompt: userMessage, maxAgents: 4, engine: selectedEngine }
        ),
      ]);

      if (chatResult?.response) {
        addMessage('assistant', chatResult.response);
      } else {
        addMessage('system', 'Unable to get a response. Please try again later.');
      }

      if (wfResult && wfResult.recommendations.length >= 2) {
        setWfRecommendations({
          goalPrompt: userMessage,
          agents: wfResult.recommendations,
          workflowRunId: wfResult.workflowRunId,
        });
      }
    } catch {
      addMessage('system', 'An error occurred while sending the message.');
    } finally {
      setIsLoading(false);
    }
  };

  /** 추천 워크플로 실행 */
  const handleRunWorkflow = useCallback(async () => {
    if (!wfRecommendations?.workflowRunId) return;
    await ipcInvoke('workflow:run', wfRecommendations.workflowRunId);
    addMessage('system', `워크플로 실행을 시작했습니다: ${wfRecommendations.goalPrompt}`);
    setWfRecommendations(null);
  }, [wfRecommendations, addMessage]);

  /** 워크플로 추천 UI 닫기 */
  const handleDismissWorkflow = useCallback(() => {
    setWfRecommendations(null);
  }, []);

  /** 입력 필드 키보드 이벤트 — Enter 전송, Shift+Enter 줄바꿈 */
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
            <div className="empty-state__icon" style={{ width: '80px', height: '80px', fontSize: '32px' }}>
              <span className="codicon codicon-comment" />
            </div>
            <p>No messages yet</p>
            <p className="chat-sidepanel__hint">Ask me anything about your agents or workflows.</p>
          </div>
        )}

        {messages.map((message) => (
          <ChatMessageItem key={message.id} message={message} />
        ))}

        {wfRecommendations && (
          <div className="chat-msg chat-msg--workflow">
            <div className="chat-msg__avatar">
              <span className="codicon codicon-workflow" />
            </div>
            <div className="chat-msg__bubble">
              <div className="chat-msg__header">
                <span className="chat-msg__role">Workflow</span>
              </div>
              <div className="chat-msg__body">
                <div className="workflow-recommendation">
                  <div className="workflow-rec-header">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    <span>추천 워크플로: {wfRecommendations.agents.length}명의 에이전트</span>
                  </div>
                  <div className="workflow-rec-agents">
                    {wfRecommendations.agents.map((agent, i) => (
                      <div key={`${agent.agentName}-${i}`} className="workflow-rec-agent">
                        <span className="workflow-rec-agent__icon">{agent.iconKey ? getIcon(agent.iconKey) : '\u{1F916}'}</span>
                        <div className="workflow-rec-agent__info">
                          <span className="workflow-rec-agent__name">{agent.agentName}</span>
                          {agent.reason && <span className="workflow-rec-agent__reason">{agent.reason}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="workflow-rec-actions">
                    <button className="btn-run" onClick={handleRunWorkflow}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      워크플로 실행
                    </button>
                    <button className="btn-dismiss" onClick={handleDismissWorkflow}>취소</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

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
