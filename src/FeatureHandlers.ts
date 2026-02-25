import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

// ── File Explorer ──

export async function getFileList(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "작업 폴더가 열려있지 않습니다.";

  const root = folders[0].uri.fsPath;
  const lines: string[] = [
    `┌─ 프로젝트 탐색 ─────────────────────┐`,
    `│ ${root}`,
    `├──────────────────────────────────────┤`,
  ];

  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith("."),
    );
    const files = entries.filter((e) => e.isFile());

    for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`│  [DIR]  ${d.name}/`);
    }
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const size = formatSize(fs.statSync(path.join(root, f.name)).size);
      lines.push(`│  ${size.padStart(8)}  ${f.name}`);
    }

    lines.push(`├──────────────────────────────────────┤`);
    lines.push(`│ 디렉토리: ${dirs.length}  파일: ${files.length}`);
    lines.push(`└──────────────────────────────────────┘`);
  } catch (e) {
    lines.push(`│ [오류] 파일 목록 읽기 실패`);
    lines.push(`└──────────────────────────────────────┘`);
  }

  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

// ── Git Status ──

export async function getGitStatus(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "작업 폴더가 열려있지 않습니다.";

  const cwd = folders[0].uri.fsPath;

  const [status, log] = await Promise.all([
    runCmd("git status --short", cwd),
    runCmd("git log --oneline -10", cwd),
  ]);

  const branch = await runCmd("git branch --show-current", cwd);

  const lines: string[] = [
    `┌─ Git 상태 ──────────────────────────┐`,
    `│ 브랜치: ${branch.trim() || "(없음)"}`,
    `├──────────────────────────────────────┤`,
  ];

  if (status.trim()) {
    lines.push(`│ [변경 파일]`);
    for (const line of status.trim().split("\n")) {
      lines.push(`│  ${line}`);
    }
  } else {
    lines.push(`│ 변경된 파일 없음 (clean)`);
  }

  lines.push(`├──────────────────────────────────────┤`);
  lines.push(`│ [최근 커밋]`);
  if (log.trim()) {
    for (const line of log.trim().split("\n")) {
      lines.push(`│  ${line}`);
    }
  } else {
    lines.push(`│ 커밋 없음`);
  }

  lines.push(`└──────────────────────────────────────┘`);
  return lines.join("\n");
}

// ── Data init/export (for persistence) ──

export function initData(data: {
  todos?: { id: number; text: string; done: boolean }[];
  memos?: { id: number; title: string; content: string; date: string }[];
  bookmarks?: { id: number; filePath: string; label: string }[];
  customMenus?: typeof customMenus;
  hiddenKeys?: string[];
}): void {
  if (data.todos) {
    todos = data.todos;
    todoNextId = todos.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  }
  if (data.memos) {
    memos = data.memos;
    memoNextId = memos.reduce((max, m) => Math.max(max, m.id), 0) + 1;
  }
  if (data.bookmarks) {
    bookmarks = data.bookmarks;
    bookmarkNextId = bookmarks.reduce((max, b) => Math.max(max, b.id), 0) + 1;
  }
  if (data.customMenus) customMenus = data.customMenus;
  if (data.hiddenKeys) hiddenKeys = new Set(data.hiddenKeys);
}

export function exportData(): {
  todos: typeof todos;
  memos: typeof memos;
  bookmarks: typeof bookmarks;
  customMenus: typeof customMenus;
  hiddenKeys: string[];
} {
  return { todos, memos, bookmarks, customMenus, hiddenKeys: [...hiddenKeys] };
}

// ── TODO List ──

interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

let todos: TodoItem[] = [];
let todoNextId = 1;

export function getTodoList(): string {
  const lines: string[] = [
    `┌─ 작업 목록 ─────────────────────────┐`,
    `├──────────────────────────────────────┤`,
  ];

  if (todos.length === 0) {
    lines.push(`│ (비어있음)`);
  } else {
    for (const t of todos) {
      const check = t.done ? "●" : "○";
      lines.push(`│  ${check} [${t.id}] ${t.text}`);
    }
  }

  lines.push(`├──────────────────────────────────────┤`);
  lines.push(`│ add <내용>  : 추가`);
  lines.push(`│ done <번호> : 완료 토글`);
  lines.push(`│ del <번호>  : 삭제`);
  lines.push(`│ P           : 돌아가기`);
  lines.push(`└──────────────────────────────────────┘`);
  return lines.join("\n");
}

export function handleTodoCommand(input: string): string {
  const parts = input.split(" ");
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(" ");

  if (cmd === "add" && arg) {
    todos.push({ id: todoNextId++, text: arg, done: false });
    return getTodoList();
  }
  if (cmd === "done" && arg) {
    const item = todos.find((t) => t.id === Number(arg));
    if (item) item.done = !item.done;
    return getTodoList();
  }
  if (cmd === "del" && arg) {
    todos = todos.filter((t) => t.id !== Number(arg));
    return getTodoList();
  }

  return getTodoList();
}

// ── Memo ──

let memos: { id: number; title: string; content: string; date: string }[] = [];
let memoNextId = 1;

export function getMemoList(): string {
  const lines: string[] = [
    `┌─ 메모/노트 ─────────────────────────┐`,
    `├──────────────────────────────────────┤`,
  ];

  if (memos.length === 0) {
    lines.push(`│ (비어있음)`);
  } else {
    for (const m of memos) {
      lines.push(`│  [${m.id}] ${m.title}  (${m.date})`);
    }
  }

  lines.push(`├──────────────────────────────────────┤`);
  lines.push(`│ new <제목>  : 새 메모`);
  lines.push(`│ <번호>      : 메모 보기`);
  lines.push(`│ del <번호>  : 삭제`);
  lines.push(`│ P           : 돌아가기`);
  lines.push(`└──────────────────────────────────────┘`);
  return lines.join("\n");
}

export function handleMemoCommand(input: string): {
  title: string;
  content: string;
  mode?: string;
} {
  const parts = input.split(" ");
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(" ");

  if (cmd === "new" && arg) {
    const now = new Date().toLocaleDateString("ko-KR");
    memos.push({ id: memoNextId++, title: arg, content: "", date: now });
    return { title: "메모/노트", content: getMemoList() };
  }
  if (cmd === "del" && arg) {
    memos = memos.filter((m) => m.id !== Number(arg));
    return { title: "메모/노트", content: getMemoList() };
  }

  const num = Number(cmd);
  if (!isNaN(num)) {
    const memo = memos.find((m) => m.id === num);
    if (memo) {
      return {
        title: `메모: ${memo.title}`,
        content: `${memo.content || "(내용 없음)"}\n\n──────────────\nedit <내용> : 내용 수정\nP : 목록으로`,
        mode: "memo-edit",
      };
    }
  }

  return { title: "메모/노트", content: getMemoList() };
}

export function editMemo(id: number, content: string): void {
  const memo = memos.find((m) => m.id === id);
  if (memo) memo.content = content;
}

// ── AI Tool Helpers ──

export function getActiveFileContent(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const doc = editor.document;
  const fileName = path.basename(doc.fileName);
  const lang = doc.languageId;
  const content = doc.getText();
  return `파일: ${fileName} (${lang})\n\n${content}`;
}

export function getSelectedCode(): {
  code: string;
  fileName: string;
  lang: string;
} | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;
  const selection = editor.selection;
  const doc = editor.document;
  const code = selection.isEmpty ? doc.getText() : doc.getText(selection);
  return {
    code,
    fileName: path.basename(doc.fileName),
    lang: doc.languageId,
  };
}

export async function getStagedDiff(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "작업 폴더가 열려있지 않습니다.";
  const cwd = folders[0].uri.fsPath;
  const diff = await runCmd("git diff --staged", cwd);
  if (!diff.trim()) {
    const unstaged = await runCmd("git diff", cwd);
    if (unstaged.trim()) return `(staged 없음, unstaged diff)\n\n${unstaged}`;
    return "변경 사항이 없습니다.";
  }
  return diff;
}

export async function getProjectSummary(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "작업 폴더가 열려있지 않습니다.";
  const root = folders[0].uri.fsPath;

  const lines: string[] = [`프로젝트 경로: ${root}\n`];

  // Read package.json if exists
  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = fs.readFileSync(pkgPath, "utf-8");
    lines.push(`package.json:\n${pkg}\n`);
  }

  // Read README if exists
  for (const name of ["README.md", "readme.md", "README.txt"]) {
    const readmePath = path.join(root, name);
    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, "utf-8").slice(0, 2000);
      lines.push(`${name}:\n${readme}\n`);
      break;
    }
  }

  // File tree (top level)
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    lines.push("파일 구조:");
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      lines.push(`  ${e.isDirectory() ? "[DIR] " : ""}${e.name}`);
    }
  } catch {
    lines.push("파일 구조 읽기 실패");
  }

  return lines.join("\n");
}

export async function getGitSummaryData(): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return "작업 폴더가 열려있지 않습니다.";
  const cwd = folders[0].uri.fsPath;
  const [log, stat] = await Promise.all([
    runCmd("git log --oneline -20", cwd),
    runCmd("git diff --stat", cwd),
  ]);
  const lines: string[] = [];
  if (log.trim()) {
    lines.push("최근 커밋 (20개):\n" + log);
  } else {
    lines.push("커밋 이력이 없습니다.");
  }
  if (stat.trim()) {
    lines.push("\n현재 변경 통계:\n" + stat);
  }
  return lines.join("\n");
}

// ── Bookmarks ──

let bookmarks: { id: number; filePath: string; label: string }[] = [];
let bookmarkNextId = 1;

export function getBookmarkList(): string {
  const lines: string[] = [
    `┌─ 북마크 ────────────────────────────┐`,
    `├──────────────────────────────────────┤`,
  ];

  if (bookmarks.length === 0) {
    lines.push(`│ (비어있음)`);
  } else {
    for (const b of bookmarks) {
      lines.push(`│  [${b.id}] ${b.label}`);
      lines.push(`│       ${b.filePath}`);
    }
  }

  lines.push(`├──────────────────────────────────────┤`);
  lines.push(`│ add         : 현재 파일 북마크`);
  lines.push(`│ open <번호> : 파일 열기`);
  lines.push(`│ del <번호>  : 삭제`);
  lines.push(`│ P           : 돌아가기`);
  lines.push(`└──────────────────────────────────────┘`);
  return lines.join("\n");
}

export function handleBookmarkCommand(input: string): {
  content: string;
  openFile?: string;
} {
  const parts = input.split(" ");
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(" ");

  if (cmd === "add") {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const filePath = editor.document.fileName;
      const label = path.basename(filePath);
      bookmarks.push({ id: bookmarkNextId++, filePath, label });
    }
    return { content: getBookmarkList() };
  }
  if (cmd === "open" && arg) {
    const bm = bookmarks.find((b) => b.id === Number(arg));
    if (bm) {
      return { content: getBookmarkList(), openFile: bm.filePath };
    }
    return { content: getBookmarkList() };
  }
  if (cmd === "del" && arg) {
    bookmarks = bookmarks.filter((b) => b.id !== Number(arg));
    return { content: getBookmarkList() };
  }

  return { content: getBookmarkList() };
}

// ── Menu Editor ──

import { CustomMenuItem, MenuItem } from "./types";

let customMenus: CustomMenuItem[] = [];
let hiddenKeys: Set<string> = new Set();

export function getCustomMenus(): CustomMenuItem[] {
  return customMenus;
}

export function getHiddenKeys(): Set<string> {
  return hiddenKeys;
}

export function getMenuEditorList(baseItems: MenuItem[]): string {
  const lines: string[] = [
    `┌─ 메뉴 편집 ────────────────────────┐`,
    `├──────────────────────────────────────┤`,
  ];

  if (customMenus.length > 0) {
    lines.push(`│ [사용자 메뉴]`);
    for (const m of customMenus) {
      lines.push(`│  [${m.key}] ${m.label} (${m.category})`);
    }
  }

  if (hiddenKeys.size > 0) {
    lines.push(`│`);
    lines.push(`│ [숨김 메뉴]`);
    for (const key of hiddenKeys) {
      const item = baseItems.find((i) => i.key === key);
      lines.push(`│  [${key}] ${item ? item.label : "(알 수 없음)"}`);
    }
  }

  if (customMenus.length === 0 && hiddenKeys.size === 0) {
    lines.push(`│ (변경 사항 없음)`);
  }

  lines.push(`├──────────────────────────────────────┤`);
  lines.push(`│ add <번호> <이름>   : 메뉴 추가`);
  lines.push(`│ del <번호>          : 사용자 메뉴 삭제`);
  lines.push(`│ hide <번호>         : 메뉴 숨기기`);
  lines.push(`│ show <번호>         : 숨김 해제`);
  lines.push(`│ cat <번호> <카테고리>: 카테고리 변경`);
  lines.push(`│ P                   : 돌아가기`);
  lines.push(`└──────────────────────────────────────┘`);
  return lines.join("\n");
}

export function handleMenuEditCommand(
  input: string,
  baseItems: MenuItem[],
): string {
  const parts = input.split(" ");
  const cmd = parts[0].toLowerCase();
  const arg1 = parts[1] || "";
  const arg2 = parts.slice(2).join(" ");

  if (cmd === "add" && arg1 && arg2) {
    const existing = [
      ...baseItems.map((i) => i.key),
      ...customMenus.map((i) => i.key),
    ];
    if (existing.includes(arg1)) {
      return (
        `[${arg1}] 이미 사용 중인 번호입니다.\n\n` +
        getMenuEditorList(baseItems)
      );
    }
    customMenus.push({
      key: arg1,
      label: arg2,
      category: "사용자",
      content: "",
    });
    return getMenuEditorList(baseItems);
  }

  if (cmd === "del" && arg1) {
    customMenus = customMenus.filter((m) => m.key !== arg1);
    return getMenuEditorList(baseItems);
  }

  if (cmd === "hide" && arg1) {
    hiddenKeys.add(arg1);
    return getMenuEditorList(baseItems);
  }

  if (cmd === "show" && arg1) {
    hiddenKeys.delete(arg1);
    return getMenuEditorList(baseItems);
  }

  if (cmd === "cat" && arg1 && arg2) {
    const item = customMenus.find((m) => m.key === arg1);
    if (item) item.category = arg2;
    return getMenuEditorList(baseItems);
  }

  return getMenuEditorList(baseItems);
}

// ── Utility ──

function runCmd(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 5000 }, (err, stdout, stderr) => {
      if (err) {
        resolve(stderr || err.message);
      } else {
        resolve(stdout);
      }
    });
  });
}
