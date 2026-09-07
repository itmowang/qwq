import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { AuthenticatedUser, ServiceEndpoints } from "../../shared/auth";

type Credentials = {
  tenantId: string;
  username: string;
  password: string;
};

type Conversation = {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
};

function createConversation(): Conversation {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: "新对话",
    updatedAt: Date.now(),
    messages: [],
  };
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

type MessagePart = UIMessage["parts"][number];
type PartRecord = Record<string, unknown>;

function partRecord(part: MessagePart): PartRecord {
  return part as unknown as PartRecord;
}

function displayPartValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolLabel(part: MessagePart): string {
  const record = partRecord(part);
  const explicitName = record.toolName;

  if (typeof explicitName === "string" && explicitName) return explicitName;
  return part.type === "dynamic-tool" ? "工具调用" : part.type.replace(/^tool-/, "");
}

function toolStateLabel(state: unknown): string {
  switch (state) {
    case "input-streaming":
      return "正在生成参数";
    case "input-available":
      return "准备调用";
    case "output-available":
      return "已完成";
    case "output-error":
      return "调用失败";
    case "approval-requested":
      return "等待确认";
    case "approval-responded":
      return "已确认";
    default:
      return "处理中";
  }
}

function isToolCallPart(part: MessagePart): boolean {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function ToolCallPart({ part }: { part: MessagePart }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true);
  const record = partRecord(part);
  const input = displayPartValue(record.input ?? record.args);
  const output = displayPartValue(record.output ?? record.result ?? record.toolResult ?? record.data);
  const error = displayPartValue(record.errorText ?? record.error);
  const isComplete = record.state === "output-available";
  const result = output || (isComplete ? "工具调用已完成，结果已用于生成下方回答。" : "正在等待工具返回结果…");

  return (
    <section className={`tool-call tool-call--${String(record.state ?? "pending")}`}>
      <div className="tool-call__header">
        <span aria-hidden="true" className="tool-call__icon">⌘</span>
        <span className="tool-call__name">{toolLabel(part)}</span>
        <span className="tool-call__state">{toolStateLabel(record.state)}</span>
        <button
          aria-expanded={isExpanded}
          className="tool-call__toggle"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          type="button"
        >
          {isExpanded ? "收起" : "展开"}
        </button>
      </div>
      {isExpanded ? (
        <div className="tool-call__body">
          {input ? (
            <details className="tool-call__details">
              <summary>调用参数</summary>
              <pre>{input}</pre>
            </details>
          ) : null}
          <div className="tool-call__result">
            <p>工具反馈</p>
            <pre>{result}</pre>
          </div>
          {error ? <p className="tool-call__error">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function MessagePartView({ part, isStreaming }: { part: MessagePart; isStreaming: boolean }): React.JSX.Element | null {
  if (part.type === "text") {
    return (
      <div className={isStreaming ? "message-markdown message-markdown--streaming" : "message-markdown"}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
        {isStreaming ? <span aria-hidden="true" className="streaming-cursor" /> : null}
      </div>
    );
  }

  if (part.type === "reasoning") {
    const text = displayPartValue(partRecord(part).text);
    return (
      <details className="message-reasoning" open={isStreaming}>
        <summary><span aria-hidden="true">✦</span> 思考过程{isStreaming ? "（生成中）" : ""}</summary>
        <div>{text || "正在整理思路…"}</div>
      </details>
    );
  }

  if (isToolCallPart(part)) {
    return <ToolCallPart part={part} />;
  }

  return null;
}

function hasVisibleActivity(part: MessagePart): boolean {
  return (part.type === "text" && part.text.length > 0)
    || part.type === "reasoning"
    || part.type === "dynamic-tool"
    || part.type.startsWith("tool-");
}

function conversationTitle(messages: UIMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const text = firstUserMessage ? messageText(firstUserMessage) : "";

  if (!text) return "新对话";
  return text.length > 22 ? `${text.slice(0, 22)}…` : text;
}

function formatConversationTime(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function Avatar({ user, size = "md" }: { user: AuthenticatedUser; size?: "sm" | "md" }): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = user.displayName.trim().slice(0, 1).toUpperCase() || "U";
  const showImage = Boolean(user.avatar) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [user.avatar]);

  return (
    <span className={`user-avatar user-avatar--${size}`}>
      {!showImage ? <span>{initial}</span> : null}
      {showImage ? (
        <img
          src={user.avatar}
          alt={`${user.displayName}的头像`}
          onError={() => setImageFailed(true)}
          referrerPolicy="no-referrer"
        />
      ) : null}
    </span>
  );
}

function ConversationPanel({
  conversation,
  onMessagesChange,
}: {
  conversation: Conversation;
  onMessagesChange: (conversationId: string, messages: UIMessage[]) => void;
}): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [mcpSessionInput, setMcpSessionInput] = useState<{ bladeAuth: string; tenantId: string } | null>(null);
  const [serviceEndpoints, setServiceEndpoints] = useState<ServiceEndpoints | null>(null);
  const [chatProxyUrl, setChatProxyUrl] = useState<string | null>(null);
  const [isLoadingMcpSessionInput, setIsLoadingMcpSessionInput] = useState(true);
  const initialMessages = useRef(conversation.messages);
  const skipInitialPersist = useRef(true);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    let isCurrent = true;

    void Promise.all([
      window.api.auth.getMcpSessionInput(),
      window.api.server.getEndpoints(),
      window.api.server.getChatProxyUrl(),
    ]).then(([sessionInput, endpoints, proxyUrl]) => {
      if (!isCurrent) return;
      setMcpSessionInput(sessionInput);
      setServiceEndpoints(endpoints);
      setChatProxyUrl(proxyUrl);
      setIsLoadingMcpSessionInput(false);
    }).catch(() => {
      if (!isCurrent) return;
      setMcpSessionInput(null);
      setServiceEndpoints(null);
      setChatProxyUrl(null);
      setIsLoadingMcpSessionInput(false);
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${chatProxyUrl ?? "http://127.0.0.1:0"}/chat/portmax-assistant`,
        headers: mcpSessionInput
          ? {
              "x-portmax-blade-auth": mcpSessionInput.bladeAuth,
              "x-portmax-tenant-id": mcpSessionInput.tenantId,
            }
          : undefined,
      }),
    [chatProxyUrl, mcpSessionInput],
  );
  const { messages, setMessages, sendMessage, status, error } = useChat({
    id: conversation.id,
    transport,
  });
  const isSending = status === "submitted" || status === "streaming";
  const canSend = Boolean(mcpSessionInput && serviceEndpoints && chatProxyUrl) && !isSending;
  const scrollToBottom = useCallback((): void => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) return;

    const animationFrame = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(animationFrame);
  }, [messages, scrollToBottom, status]);

  function handleConversationScroll(event: React.UIEvent<HTMLElement>): void {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
    shouldAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 48;
  }

  useEffect(() => {
    setMessages(initialMessages.current);
  }, [setMessages]);

  useEffect(() => {
    if (skipInitialPersist.current) {
      skipInitialPersist.current = false;
      return;
    }

    onMessagesChange(conversation.id, messages);
  }, [conversation.id, messages, onMessagesChange]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = prompt.trim();

    if (!text || !canSend) return;

    shouldAutoScrollRef.current = true;
    sendMessage({ text });
    setPrompt("");
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <>
      <section className="conversation-scroll" aria-live="polite" onScroll={handleConversationScroll} ref={scrollContainerRef}>
        {messages.length === 0 ? (
          <div className="conversation-empty">
            <div className="conversation-empty__mark" aria-hidden="true">✦</div>
            <h2>从这里开始一段新对话</h2>
            <p>询问 Portmax 助手业务、数据或当前时间相关的问题。</p>
            <div className="suggestion-list">
              {["现在上海几点？", "帮我梳理今天的工作", "我可以做什么？"].map((suggestion) => (
                <button
                  className="suggestion-chip"
                  key={suggestion}
                  onClick={() => setPrompt(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => {
              const isUser = message.role === "user";
              const hasToolCall = !isUser && message.parts.some(isToolCallPart);
              const isStreamingMessage = isSending && !isUser && message.id === messages[messages.length - 1]?.id;
              return (
                <article className={`message-row ${isUser ? "message-row--user" : ""} ${hasToolCall ? "message-row--has-tool" : ""}`} key={message.id}>
                  <div className="message-avatar">{isUser ? "你" : "PM"}</div>
                  <div className="message-content">
                    <p className="message-author">{isUser ? "你" : "Portmax Assistant"}</p>
                    <div className="message-bubble">
                      {message.parts.map((part, index) => (
                        <MessagePartView isStreaming={isStreamingMessage} key={`${part.type}-${index}`} part={part} />
                      ))}
                    </div>
                  </div>
                </article>
              );
            })}
            {isSending && !messages.some((message) => message.parts.some(hasVisibleActivity)) ? (
              <p className="message-thinking">Portmax 正在思考…</p>
            ) : null}
            {error ? <p className="chat-error">{error.message}</p> : null}
          </div>
        )}
      </section>

      <div className="composer-region">
        <form className="composer" onSubmit={submit}>
          <label className="sr-only" htmlFor="chat-input">消息</label>
          <textarea
            className="composer-input"
            disabled={!canSend}
            id="chat-input"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder="向 Portmax Assistant 提问…"
            rows={1}
            value={prompt}
          />
          <button
            className="primary-button composer-send"
            disabled={!prompt.trim() || !canSend}
            type="submit"
          >
            {isSending ? "发送中" : "发送"}
          </button>
        </form>
        <p className="composer-note">
          {isLoadingMcpSessionInput
            ? "正在验证登录凭据…"
            : !mcpSessionInput
              ? "登录凭据或工作区服务不可用，请重新登录后重试。"
              : "Enter 发送 · Shift + Enter 换行 · Portmax 可能会出错，请核查重要信息。"}
        </p>
      </div>
    </>
  );
}

function ChatHome({ user, onLogout }: { user: AuthenticatedUser; onLogout: () => void }): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(() => [createConversation()]);
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0].id);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  );
  const historyConversations = useMemo(
    () => conversations.filter((conversation) => conversation.messages.length > 0),
    [conversations],
  );
  const canStartNewConversation = activeConversation.messages.length > 0;

  function startNewConversation(): void {
    if (!canStartNewConversation) return;

    const conversation = createConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveConversationId(conversation.id);
  }

  const updateConversationMessages = useCallback((conversationId: string, messages: UIMessage[]): void => {
    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, messages, title: conversationTitle(messages), updatedAt: Date.now() }
        : conversation
    )));
  }, []);

  function selectConversation(conversationId: string): void {
    setConversations((current) => current.filter(
      (conversation) => conversation.id === conversationId || conversation.messages.length > 0,
    ));
    setActiveConversationId(conversationId);
  }

  return (
    <main className="workspace-shell">
      <aside className="sidebar-shell">
        <div className="sidebar-brand">
          <div className="sidebar-brand__mark">P</div>
          <div>
            <p className="sidebar-brand__name">Portmax</p>
            <p className="sidebar-brand__meta">AI WORKSPACE</p>
          </div>
        </div>

        <button
          className="sidebar-new-chat"
          disabled={!canStartNewConversation}
          onClick={startNewConversation}
          title={canStartNewConversation ? "新建对话" : "请先在当前对话中发送一条消息"}
          type="button"
        >
          <span className="sidebar-new-chat__icon" aria-hidden="true">+</span>
          新建对话
        </button>
        {!canStartNewConversation ? <p className="sidebar-hint">请先在当前对话中发送一条消息。</p> : null}

        <div className="sidebar-history">
          <div className="sidebar-history__heading">
            <span>聊天历史</span>
            <span>{historyConversations.length}</span>
          </div>
          <ul className="sidebar-history-list" aria-label="聊天历史">
            {historyConversations.map((conversation) => {
              const isActive = conversation.id === activeConversation.id;
              return (
                <li key={conversation.id}>
                  <button
                    aria-current={isActive ? "page" : undefined}
                    className={`sidebar-history-item ${isActive ? "sidebar-history-item--active" : ""}`}
                    onClick={() => selectConversation(conversation.id)}
                    type="button"
                  >
                    <span className="sidebar-history-item__dot" aria-hidden="true" />
                    <span className="sidebar-history-item__title">{conversation.title}</span>
                    <span className="sidebar-history-item__time">{formatConversationTime(conversation.updatedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {historyConversations.length === 0 ? (
            <div className="sidebar-empty-state">发送第一条消息后，可以创建更多对话。</div>
          ) : null}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-session-status"><span />会话已加密保存在本机</div>
          <button className="sidebar-logout" onClick={onLogout} type="button">
            <span aria-hidden="true">↗</span>
            退出登录
          </button>
        </div>
      </aside>

      <section className="workspace-content">
        <header className="workspace-header">
          <div className="workspace-title">
            <p className="workspace-title__name">{activeConversation.title}</p>
            <p className="workspace-title__meta">Mastra 服务 · 已就绪</p>
          </div>
          <div className="user-card">
            <Avatar size="sm" user={user} />
            <div className="user-card__meta">
              <p className="user-card__name">{user.displayName}</p>
              <p className="user-card__role">{user.roleName || user.username}</p>
            </div>
          </div>
        </header>

        <div className="workspace-context">
          当前登录：<strong>{user.username}</strong>
          {user.companyCode ? <span> · {user.companyCode}</span> : null}
          {user.edition ? <span> · {user.edition}</span> : null}
          <span> · 租户 {user.tenantId}</span>
        </div>

        <ConversationPanel
          conversation={activeConversation}
          key={activeConversation.id}
          onMessagesChange={updateConversationMessages}
        />
      </section>
    </main>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (user: AuthenticatedUser) => void }): React.JSX.Element {
  const [credentials, setCredentials] = useState<Credentials>({
    tenantId: "733179",
    username: "Shon_S",
    password: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof Credentials, value: string): void {
    setCredentials((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    const login = window.api?.auth?.login;
    if (!login) {
      setError("登录模块尚未加载。请完全退出桌面端后重新启动应用。");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const result = await login(credentials);
      if (result.success) {
        setCredentials((current) => ({ ...current, password: "" }));
        onAuthenticated(result.user);
      } else {
        setError(result.message);
      }
    } catch {
      setError("桌面端登录服务不可用。请完全退出并重新启动应用后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-hero">
        <div className="login-hero__content">
          <div className="login-mark">P</div>
          <p className="login-eyebrow">PORTMAX WORKSPACE</p>
          <h1>让每次决策，更从容。</h1>
          <p className="login-hero__description">连接你的 Portmax 工作空间，在一个专注、安全的桌面环境中开始协作。</p>
          <ul className="login-features">
            {["安全本地连接", "智能工作助手", "专注的对话体验"].map((feature) => (
              <li key={feature}><i aria-hidden="true" />{feature}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="login-form-pane">
        <div className="login-form-card">
          <p className="login-form__eyebrow">WELCOME BACK</p>
          <h2>登录工作空间</h2>
          <p className="login-form__intro">输入你的账户信息以继续。</p>

          <form className="login-form" onSubmit={submit}>
            {[
              ["tenantId", "tenant-id", "租户 ID", "organization"],
              ["username", "username", "用户名", "username"],
            ].map(([field, id, label, autoComplete]) => (
              <label className="login-field" htmlFor={id} key={field}>
                {label}
                <input
                  autoComplete={autoComplete}
                  className="login-input"
                  disabled={isSubmitting}
                  id={id}
                  onChange={(event) => updateField(field as keyof Credentials, event.target.value)}
                  required
                  value={credentials[field as keyof Credentials]}
                />
              </label>
            ))}
            <label className="login-field" htmlFor="password">
              密码
              <input
                autoComplete="current-password"
                className="login-input"
                disabled={isSubmitting}
                id="password"
                onChange={(event) => updateField("password", event.target.value)}
                required
                type="password"
                value={credentials.password}
              />
            </label>
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            <button className="primary-button login-submit" disabled={isSubmitting} type="submit">
              {isSubmitting ? "正在验证…" : "安全登录"}
              <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="login-policy">登录即表示你同意按照组织的访问策略使用 Portmax。</p>
        </div>
      </section>
    </main>
  );
}

function App(): React.JSX.Element {
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function restoreSavedSession(): Promise<void> {
      try {
        const user = await window.api?.auth?.restoreSession();
        if (isMounted) setAuthenticatedUser(user ?? null);
      } catch {
        if (isMounted) setAuthenticatedUser(null);
      } finally {
        if (isMounted) setIsRestoringSession(false);
      }
    }

    void restoreSavedSession();
    return () => {
      isMounted = false;
    };
  }, []);

  async function logout(): Promise<void> {
    const clearSession = window.api?.auth?.logout;
    if (!clearSession) {
      window.alert("无法访问安全会话服务。请完全退出桌面端后重试。");
      return;
    }

    try {
      await clearSession();
      setAuthenticatedUser(null);
    } catch {
      window.alert("无法删除本机加密会话。请关闭其他 Portmax 窗口后重试。");
    }
  }

  if (isRestoringSession) {
    return <main className="app-loading">正在安全恢复登录状态…</main>;
  }

  return authenticatedUser ? (
    <ChatHome onLogout={() => void logout()} user={authenticatedUser} />
  ) : (
    <LoginScreen onAuthenticated={setAuthenticatedUser} />
  );
}

export default App;
