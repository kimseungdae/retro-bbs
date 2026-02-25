export interface MenuItem {
  key: string;
  label: string;
  type: "command" | "content" | "submenu" | "chat";
  category?: string;
  command?: string;
  content?: string;
  children?: MenuItem[];
}

export interface MenuConfig {
  title: string;
  subtitle: string;
  items: MenuItem[];
}

export interface MenuState {
  path: string[];
  current: MenuItem[];
  title: string;
  input: string;
}

export interface CustomMenuItem {
  key: string;
  label: string;
  category: string;
  content: string;
}

// Extension → Webview
export type WebviewMessage =
  | { type: "renderMenu"; state: MenuState; menuConfig: MenuConfig }
  | { type: "renderChat"; messages: ChatMessage[] }
  | { type: "chatChunk"; text: string; done: boolean }
  | { type: "contentChunk"; text: string; done: boolean; title: string }
  | { type: "renderContent"; title: string; content: string }
  | { type: "setTheme"; theme: string }
  | { type: "error"; message: string };

// Webview → Extension
export type ExtMessage =
  | { type: "navigate"; menuKey: string }
  | { type: "goBack" }
  | { type: "goHome" }
  | { type: "input"; text: string }
  | { type: "chat"; message: string }
  | { type: "ready" };

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}
