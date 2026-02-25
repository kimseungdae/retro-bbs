interface MenuItem {
  key: string;
  label: string;
  type: string;
  category?: string;
}

interface MenuState {
  path: string[];
  current: MenuItem[];
  title: string;
  input: string;
}

interface MenuConfig {
  title: string;
  subtitle: string;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

type WebviewMessage =
  | { type: "renderMenu"; state: MenuState; menuConfig: MenuConfig }
  | { type: "renderChat"; messages: ChatMessage[] }
  | { type: "chatChunk"; text: string; done: boolean }
  | {
      type: "conversationStep";
      step: unknown;
      stepIndex: number;
      title: string;
    }
  | { type: "renderContent"; title: string; content: string }
  | { type: "contentChunk"; text: string; done: boolean; title: string }
  | { type: "setTheme"; theme: string }
  | { type: "error"; message: string };

interface AppState {
  fontSize?: number;
  theme?: string;
  bootSeen?: boolean;
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// DOM refs
const headerEl = document.getElementById("bbs-header")!;
const contentEl = document.getElementById("bbs-content")!;
const statusbarEl = document.getElementById("bbs-statusbar")!;
const inputEl = document.getElementById("bbs-input") as HTMLInputElement;

let currentMode: "menu" | "chat" | "content" | "conversation" = "menu";
let chatMessages: ChatMessage[] = [];
let isWaitingResponse = false;
let pendingReady = false;

// ── Persistent state ──
const savedState = (vscode.getState() as AppState) || {};
let fontSize = savedState.fontSize || 16;
let currentTheme = savedState.theme || "hitel";

function saveState(): void {
  vscode.setState({
    fontSize,
    theme: currentTheme,
    bootSeen: true,
  });
}

// ── Font size control ──
const FONT_MIN = 12;
const FONT_MAX = 28;
const FONT_STEP = 2;

function applyFontSize(): void {
  document.documentElement.style.setProperty(
    "--font-size-base",
    `${fontSize}px`,
  );
  saveState();
}

function changeFontSize(delta: number): void {
  const next = fontSize + delta;
  if (next < FONT_MIN || next > FONT_MAX) return;
  fontSize = next;
  applyFontSize();
}

// ── Theme control ──
function applyTheme(theme: string): void {
  currentTheme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  saveState();
}

applyFontSize();
applyTheme(currentTheme);

// ── Boot sequence ──

const BOOT_LINES = [
  { text: "", delay: 200 },
  { text: "  ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗", delay: 30 },
  { text: "  ██╔═══╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝", delay: 30 },
  { text: "  ██║    ██║     ███████║██║   ██║██║  ██║█████╗  ", delay: 30 },
  { text: "  ██║    ██║     ██╔══██║██║   ██║██║  ██║██╔══╝  ", delay: 30 },
  { text: "  ██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗", delay: 30 },
  { text: "  ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝", delay: 30 },
  { text: "            ★  C O D E  ★", delay: 100 },
  { text: "", delay: 200 },
  { text: "  ─────────────────────────────────────", delay: 50 },
  { text: "  RETRO-BBS Terminal v1.0", delay: 80 },
  { text: "  (C) 2026 Claude Code System", delay: 80 },
  { text: "  ─────────────────────────────────────", delay: 200 },
  { text: "", delay: 100 },
  { text: "  모뎀 초기화 중... ATZ", delay: 300 },
  { text: "  OK", delay: 200 },
  { text: "  다이얼링... ATDT 01410", delay: 400 },
  { text: "  CONNECT 14400", delay: 300 },
  { text: "", delay: 100 },
  { text: "  ★ 클로드 코드 시스템에 접속합니다 ★", delay: 400 },
  { text: "  접속 완료!", delay: 300 },
];

async function playBootSequence(): Promise<void> {
  currentMode = "content";
  headerEl.innerHTML = "";
  statusbarEl.textContent = "";
  inputEl.style.display = "none";

  contentEl.innerHTML = '<div class="boot-screen"></div>';
  const bootEl = contentEl.querySelector(".boot-screen")!;

  for (const line of BOOT_LINES) {
    await sleep(line.delay);
    const lineEl = document.createElement("div");
    lineEl.className = "boot-line";
    lineEl.textContent = line.text;
    bootEl.appendChild(lineEl);
    contentEl.scrollTop = contentEl.scrollHeight;
  }

  await sleep(600);
  inputEl.style.display = "";
  pendingReady = true;
  vscode.postMessage({ type: "ready" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Render functions ──

function renderMenu(state: MenuState, config: MenuConfig): void {
  currentMode = "menu";

  // Header
  const pathText =
    state.path.length > 0 ? `${config.title} > ${state.path.join(" > ")}` : "";

  headerEl.innerHTML = `
    <div class="header-title">${escapeHtml(state.title || config.title)}</div>
    <div class="header-subtitle">${escapeHtml(config.subtitle)}</div>
    ${pathText ? `<div class="header-path">${escapeHtml(pathText)}</div>` : ""}
  `;

  // Group by category
  const categories = new Map<string, MenuItem[]>();
  for (const item of state.current) {
    const cat = item.category || "기타";
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(item);
  }

  // Content - menu grid
  let html = '<div class="menu-grid">';
  for (const [catName, items] of categories) {
    html += `<div class="menu-category">`;
    html += `<div class="category-title">${escapeHtml(catName)}</div>`;
    for (const item of items) {
      html += `
        <div class="menu-item" data-key="${escapeHtml(item.key)}">
          <span class="menu-key">${escapeHtml(item.key)}.</span>
          <span class="menu-label">${escapeHtml(item.label)}</span>
        </div>`;
    }
    html += "</div>";
  }
  html += "</div>";

  contentEl.innerHTML = html;

  // Click handlers
  contentEl.querySelectorAll(".menu-item").forEach((el) => {
    el.addEventListener("click", () => {
      const key = (el as HTMLElement).dataset.key;
      if (key) vscode.postMessage({ type: "navigate", menuKey: key });
    });
  });

  // Statusbar
  statusbarEl.textContent =
    "이동(번호)  상위메뉴(P)  초기화면(T)  도움말(H)  폰트작게(-)  폰트크게(+)";
  inputEl.value = "";
  inputEl.placeholder = "메뉴 번호를 입력하세요...";
  inputEl.focus();
}

function renderContent(title: string, content: string): void {
  currentMode = "content";

  headerEl.innerHTML = `
    <div class="header-title">${escapeHtml(title)}</div>
  `;

  contentEl.innerHTML = `
    <div class="content-view">
      <div class="content-title">${escapeHtml(title)}</div>
      <div>${escapeHtml(content)}</div>
    </div>
  `;

  statusbarEl.textContent =
    "상위메뉴(P)  초기화면(T)  ESC(뒤로)  폰트작게(-)  폰트크게(+)";
  inputEl.value = "";
  inputEl.placeholder = "명령어를 입력하세요...";
  inputEl.focus();
  contentEl.scrollTop = 0;
}

function renderChat(messages: ChatMessage[]): void {
  currentMode = "chat";
  chatMessages = messages;

  headerEl.innerHTML = `
    <div class="header-title">Claude 채팅방</div>
    <div class="header-subtitle">AI와 대화하세요</div>
  `;

  renderChatMessages();

  statusbarEl.textContent = "나가기(Q)  지우기(C)  메시지를 입력하고 Enter";
  inputEl.value = "";
  inputEl.placeholder = "메시지를 입력하세요...";
  inputEl.focus();
}

function renderChatMessages(): void {
  let html = '<div class="chat-messages">';
  for (const msg of chatMessages) {
    const senderMap = { system: "시스템", user: "나", assistant: "Claude" };
    const sender = senderMap[msg.role];
    html += `
      <div class="chat-msg ${msg.role}">
        <span class="chat-sender">[${escapeHtml(sender)}]</span>
        <span class="chat-text"> ${escapeHtml(msg.content)}</span>
      </div>`;
  }
  html += "</div>";
  contentEl.innerHTML = html;
  contentEl.scrollTop = contentEl.scrollHeight;
}

function showError(message: string): void {
  const errorEl = document.createElement("div");
  errorEl.className = "error-flash";
  errorEl.textContent = message;
  contentEl.appendChild(errorEl);
  setTimeout(() => errorEl.remove(), 2000);
}

// ── Input handling ──

inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    handleInput(text);
    inputEl.value = "";
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (currentMode !== "menu") {
      vscode.postMessage({ type: "goBack" });
    }
  }
});

// Global key shortcuts (work without typing in input)
document.addEventListener("keydown", (e: KeyboardEvent) => {
  // Font size: always available
  if (e.key === "-" || e.key === "_") {
    e.preventDefault();
    changeFontSize(-FONT_STEP);
    return;
  }
  if (e.key === "+" || e.key === "=") {
    e.preventDefault();
    changeFontSize(FONT_STEP);
    return;
  }

  // Don't intercept when input is focused and has content
  if (document.activeElement === inputEl && inputEl.value.length > 0) return;

  const key = e.key.toUpperCase();

  if (currentMode === "menu") {
    if (key === "P") {
      e.preventDefault();
      vscode.postMessage({ type: "goBack" });
    } else if (key === "T") {
      e.preventDefault();
      vscode.postMessage({ type: "goHome" });
    }
  } else if (currentMode === "chat") {
    if (key === "Q" && !inputEl.value) {
      e.preventDefault();
      vscode.postMessage({ type: "goHome" });
    }
  } else if (currentMode === "content") {
    if (key === "P" || e.key === "Escape") {
      e.preventDefault();
      vscode.postMessage({ type: "goBack" });
    } else if (key === "T") {
      e.preventDefault();
      vscode.postMessage({ type: "goHome" });
    }
  }

  // Always keep input focused
  inputEl.focus();
});

function handleInput(text: string): void {
  if (currentMode === "menu") {
    vscode.postMessage({ type: "navigate", menuKey: text });
  } else if (currentMode === "chat") {
    if (text.toUpperCase() === "Q") {
      vscode.postMessage({ type: "goHome" });
      return;
    }
    if (isWaitingResponse) return;

    chatMessages.push({
      role: "user",
      content: text,
      timestamp: Date.now(),
    });
    renderChatMessages();
    isWaitingResponse = true;
    vscode.postMessage({ type: "chat", message: text });
  } else if (currentMode === "conversation") {
    vscode.postMessage({
      type: "conversationResponse",
      stepIndex: 0,
      value: text,
    });
  } else if (currentMode === "content") {
    if (text.toUpperCase() === "P") {
      vscode.postMessage({ type: "goBack" });
    } else {
      vscode.postMessage({ type: "input", text });
    }
  }
}

// ── Message handler from extension ──

window.addEventListener("message", (event: MessageEvent<WebviewMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "renderMenu":
      renderMenu(msg.state, msg.menuConfig);
      break;
    case "renderContent":
      renderContent(msg.title, msg.content);
      break;
    case "renderChat":
      renderChat(msg.messages);
      break;
    case "chatChunk":
      handleChatChunk(msg.text, msg.done);
      break;
    case "contentChunk":
      handleContentChunk(msg.title, msg.text, msg.done);
      break;
    case "conversationStep":
      renderConversationStep(msg.title, msg.step, msg.stepIndex);
      break;
    case "setTheme":
      applyTheme(msg.theme);
      break;
    case "error":
      showError(msg.message);
      break;
  }
});

function handleChatChunk(text: string, done: boolean): void {
  // Remove previous streaming message if exists
  const lastMsg = chatMessages[chatMessages.length - 1];
  if (lastMsg && lastMsg.role === "assistant" && !done) {
    // Update streaming message in place
    if (lastMsg.content.startsWith("[...")) {
      lastMsg.content = text;
    } else {
      chatMessages.push({
        role: "assistant",
        content: text,
        timestamp: Date.now(),
      });
    }
    renderChatMessages();
    return;
  }

  if (!done) {
    chatMessages.push({
      role: "assistant",
      content: text,
      timestamp: Date.now(),
    });
    renderChatMessages();
  } else {
    // Final: replace or add
    const streaming = chatMessages.findIndex(
      (m) =>
        m.role === "assistant" &&
        m.timestamp === chatMessages[chatMessages.length - 1]?.timestamp,
    );
    if (streaming >= 0 && chatMessages[streaming].role === "assistant") {
      chatMessages[streaming].content = text;
    } else {
      chatMessages.push({
        role: "assistant",
        content: text,
        timestamp: Date.now(),
      });
    }
    renderChatMessages();
    isWaitingResponse = false;
  }
}

function renderConversationStep(
  title: string,
  step: {
    type: string;
    message?: string;
    options?: { key: string; label: string }[];
  },
  _stepIndex: number,
): void {
  currentMode = "conversation";

  headerEl.innerHTML = `
    <div class="header-title">${escapeHtml(title)}</div>
    <div class="header-subtitle">대화셋 진행 중</div>
  `;

  let html = '<div class="content-view">';
  html += `<div class="content-title">${escapeHtml(title)}</div>`;

  if (step.message) {
    html += `<div style="margin: 8px 0; white-space: pre-wrap;">${escapeHtml(step.message)}</div>`;
  }

  if (step.type === "select" && step.options) {
    for (const opt of step.options) {
      html += `<div class="menu-item" data-key="${escapeHtml(opt.key)}">`;
      html += `<span class="menu-key">${escapeHtml(opt.key)}.</span>`;
      html += `<span class="menu-label">${escapeHtml(opt.label)}</span>`;
      html += `</div>`;
    }
  }

  html += "</div>";
  contentEl.innerHTML = html;

  contentEl.querySelectorAll(".menu-item").forEach((el) => {
    el.addEventListener("click", () => {
      const key = (el as HTMLElement).dataset.key;
      if (key) {
        vscode.postMessage({
          type: "conversationResponse",
          stepIndex: _stepIndex,
          value: key,
        });
      }
    });
  });

  statusbarEl.textContent = "입력 후 Enter  |  ESC: 취소";
  inputEl.value = "";
  inputEl.placeholder =
    step.type === "select" ? "번호를 선택하세요..." : "입력하세요...";
  inputEl.focus();
}

function handleContentChunk(title: string, text: string, done: boolean): void {
  currentMode = "content";

  headerEl.innerHTML = `
    <div class="header-title">${escapeHtml(title)}</div>
  `;

  contentEl.innerHTML = `
    <div class="content-view">
      <div class="content-title">${escapeHtml(title)}</div>
      <div class="content-stream">${escapeHtml(text)}${done ? "" : '<span class="cursor-blink">█</span>'}</div>
    </div>
  `;

  statusbarEl.textContent = done
    ? "상위메뉴(P)  초기화면(T)  ESC(뒤로)  폰트작게(-)  폰트크게(+)"
    : "Claude 응답 수신 중...";
  contentEl.scrollTop = contentEl.scrollHeight;

  if (done) {
    inputEl.value = "";
    inputEl.placeholder = "명령어를 입력하세요...";
    inputEl.focus();
  }
}

// ── Utility ──

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

// ── Init ──
if (savedState.bootSeen) {
  vscode.postMessage({ type: "ready" });
} else {
  playBootSequence();
}
