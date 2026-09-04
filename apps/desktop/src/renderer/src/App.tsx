import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

const mastraServerUrl = import.meta.env.VITE_MASTRA_SERVER_URL ?? "http://localhost:4111";

type Credentials = {
  tenantId: string;
  username: string;
  password: string;
};

function ChatHome({ username }: { username: string }): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: `${mastraServerUrl}/chat/portmax-assistant`,
    }),
  });
  const isSending = status === "submitted" || status === "streaming";

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = prompt.trim();

    if (!text || isSending) return;

    sendMessage({ text });
    setPrompt("");
  }

  return (
    <main className="chat-shell">
      <header className="chat-header">
        <div>
          <p className="eyebrow">PORTMAX DESKTOP</p>
          <h1>Portmax Assistant</h1>
          <p>你好，{username}。通过本机 Mastra 服务与 Agent 对话。</p>
        </div>
        <span className={`connection ${error ? "connection--error" : ""}`}>
          <i /> {error ? "连接失败" : "本机服务"}
        </span>
      </header>

      <section className="conversation" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-state">
            <strong>开始新的对话</strong>
            <span>例如，询问“现在上海几点？”来调用当前时间工具。</span>
          </div>
        ) : (
          messages.map((message) => (
            <article className={`message message--${message.role}`} key={message.id}>
              <span className="message-label">{message.role === "user" ? "你" : "Portmax"}</span>
              <div className="message-content">
                {message.parts.map((part, index) =>
                  part.type === "text" ? <p key={index}>{part.text}</p> : null,
                )}
              </div>
            </article>
          ))
        )}
        {isSending ? <p className="typing">Portmax 正在思考…</p> : null}
        {error ? <p className="error-message">{error.message}</p> : null}
      </section>

      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-input">
          消息
        </label>
        <textarea
          id="chat-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="输入你的问题…"
          rows={1}
          disabled={isSending}
        />
        <button type="submit" disabled={!prompt.trim() || isSending}>
          {isSending ? "发送中" : "发送"}
        </button>
      </form>
      <p className="footnote">请先运行 <code>pnpm dev:client</code> 启动本机 Mastra 服务。</p>
    </main>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (username: string) => void }): React.JSX.Element {
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
        onAuthenticated(result.username);
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
      <section className="login-intro" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true"><span /></div>
        <p className="eyebrow">PORTMAX WORKSPACE</p>
        <h1 id="login-title">让每次决策，更从容。</h1>
        <p className="login-copy">连接你的 Portmax 工作空间，在一个专注、安全的桌面环境中开始协作。</p>
        <div className="feature-list" aria-label="产品特性">
          <span><i />安全本地连接</span>
          <span><i />智能工作助手</span>
          <span><i />专注的对话体验</span>
        </div>
      </section>

      <section className="login-panel" aria-label="登录 Portmax">
        <div className="login-card">
          <div className="login-card__heading">
            <p className="eyebrow">WELCOME BACK</p>
            <h2>登录工作空间</h2>
            <p>输入你的账户信息以继续。</p>
          </div>

          <form className="login-form" onSubmit={submit}>
            <label htmlFor="tenant-id">
              租户 ID
              <input
                id="tenant-id"
                value={credentials.tenantId}
                onChange={(event) => updateField("tenantId", event.target.value)}
                autoComplete="organization"
                disabled={isSubmitting}
                required
              />
            </label>
            <label htmlFor="username">
              用户名
              <input
                id="username"
                value={credentials.username}
                onChange={(event) => updateField("username", event.target.value)}
                autoComplete="username"
                disabled={isSubmitting}
                required
              />
            </label>
            <label htmlFor="password">
              密码
              <input
                id="password"
                type="password"
                value={credentials.password}
                onChange={(event) => updateField("password", event.target.value)}
                autoComplete="current-password"
                disabled={isSubmitting}
                required
              />
            </label>
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            <button className="login-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "正在验证…" : "安全登录"}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          <p className="login-notice">登录即表示你同意按照组织的访问策略使用 Portmax。</p>
        </div>
      </section>
    </main>
  );
}

function App(): React.JSX.Element {
  const [authenticatedUser, setAuthenticatedUser] = useState<string | null>(null);

  return authenticatedUser ? (
    <ChatHome username={authenticatedUser} />
  ) : (
    <LoginScreen onAuthenticated={setAuthenticatedUser} />
  );
}

export default App;
