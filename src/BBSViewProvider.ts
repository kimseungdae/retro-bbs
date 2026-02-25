import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { MenuEngine } from "./MenuEngine";
import { ChatProvider } from "./ChatProvider";
import {
  getFileList,
  getGitStatus,
  getTodoList,
  handleTodoCommand,
  getMemoList,
  handleMemoCommand,
  editMemo,
  getActiveFileContent,
  getSelectedCode,
  getStagedDiff,
  getProjectSummary,
  getGitSummaryData,
  getBookmarkList,
  handleBookmarkCommand,
  getMenuEditorList,
  handleMenuEditCommand,
  getCustomMenus,
  getHiddenKeys,
  initData,
  exportData,
} from "./FeatureHandlers";
import { PersistenceProvider } from "./PersistenceProvider";
import { ExtMessage, MenuConfig, WebviewMessage } from "./types";

type ViewMode =
  | "menu"
  | "chat"
  | "content"
  | "todo"
  | "memo"
  | "memo-edit"
  | "settings"
  | "bookmark"
  | "menu-edit"
  | "error-solve"
  | "ask-code";

export class BBSViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private menuEngine: MenuEngine;
  private chatProvider: ChatProvider;
  private persistence: PersistenceProvider;
  private extensionPath: string;
  private viewMode: ViewMode = "menu";
  private currentMemoId = 0;

  constructor(private context: vscode.ExtensionContext) {
    this.extensionPath = context.extensionPath;
    const configPath = path.join(this.extensionPath, "config", "menus.json");
    const menuConfig: MenuConfig = JSON.parse(
      fs.readFileSync(configPath, "utf-8"),
    );
    this.menuEngine = new MenuEngine(menuConfig);
    this.chatProvider = new ChatProvider();
    this.persistence = new PersistenceProvider();
    const saved = this.persistence.init();
    initData(saved);
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "retroBBS",
      "★ 클로드 코드 ★",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.extensionPath, "out", "webview")),
        ],
      },
    );

    this.panel.webview.html = this.getHtmlContent();

    this.panel.webview.onDidReceiveMessage(
      (msg: ExtMessage) => this.handleMessage(msg),
      undefined,
      this.context.subscriptions,
    );

    this.panel.onDidDispose(() => {
      this.chatProvider.abort();
      this.panel = undefined;
    });
  }

  private getHtmlContent(): string {
    const webviewUri = (file: string) =>
      this.panel!.webview.asWebviewUri(
        vscode.Uri.file(path.join(this.extensionPath, "out", "webview", file)),
      );

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel!.webview.cspSource} 'unsafe-inline'; script-src ${this.panel!.webview.cspSource}; font-src ${this.panel!.webview.cspSource};">
  <link rel="stylesheet" href="${webviewUri("styles.css")}">
  <title>클로드 코드</title>
</head>
<body>
  <div id="bbs-screen">
    <div id="bbs-header"></div>
    <div id="bbs-content"></div>
    <div id="bbs-statusbar"></div>
    <div id="bbs-input-area">
      <span class="prompt">&gt;&gt; </span>
      <input type="text" id="bbs-input" autocomplete="off" spellcheck="false" autofocus>
    </div>
  </div>
  <script src="${webviewUri("main.js")}"></script>
</body>
</html>`;
  }

  private handleMessage(msg: ExtMessage): void {
    switch (msg.type) {
      case "ready":
        this.sendMenuState();
        break;
      case "navigate":
        this.handleNavigate(msg.menuKey);
        break;
      case "goBack":
        this.handleGoBack();
        break;
      case "goHome":
        if (this.viewMode === "chat") this.chatProvider.resetChat();
        this.viewMode = "menu";
        this.chatProvider.abort();
        this.menuEngine.goHome();
        this.sendMenuState();
        break;
      case "chat":
        this.handleChat(msg.message);
        break;
      case "input":
        this.handleInteractiveInput(msg.text);
        break;
    }
  }

  private handleGoBack(): void {
    if (this.viewMode !== "menu") {
      if (this.viewMode === "chat") this.chatProvider.resetChat();
      this.viewMode = "menu";
      this.chatProvider.abort();
      this.menuEngine.goBack() || this.menuEngine.goHome();
      this.sendMenuState();
    } else {
      this.menuEngine.goBack();
      this.sendMenuState();
    }
  }

  private async handleNavigate(key: string): Promise<void> {
    const item = this.menuEngine.navigate(key);
    if (!item) {
      // In interactive modes, forward input
      if (
        this.viewMode === "todo" ||
        this.viewMode === "memo" ||
        this.viewMode === "memo-edit" ||
        this.viewMode === "settings" ||
        this.viewMode === "bookmark" ||
        this.viewMode === "menu-edit" ||
        this.viewMode === "error-solve" ||
        this.viewMode === "ask-code"
      ) {
        this.handleInteractiveInput(key);
        return;
      }
      this.sendMessage({
        type: "error",
        message: `'${key}' - 해당 메뉴가 없습니다.`,
      });
      return;
    }

    switch (item.type) {
      case "submenu":
        this.sendMenuState();
        break;

      case "command":
        if (item.command === "retroBBS.fileExplorer") {
          this.viewMode = "content";
          const content = await getFileList();
          this.sendMessage({
            type: "renderContent",
            title: "프로젝트 탐색",
            content,
          });
        } else if (item.command === "retroBBS.gitStatus") {
          this.viewMode = "content";
          const content = await getGitStatus();
          this.sendMessage({
            type: "renderContent",
            title: "Git 상태/로그",
            content,
          });
        } else if (item.command === "retroBBS.todoList") {
          this.viewMode = "todo";
          const content = getTodoList();
          this.sendMessage({
            type: "renderContent",
            title: "작업 목록",
            content,
          });
        } else if (item.command === "retroBBS.codeReview") {
          this.handleAICommand("코드 리뷰", () => {
            const code = getActiveFileContent();
            if (!code) return null;
            return `다음 코드를 리뷰해줘. 버그, 개선점, 보안 이슈를 찾아서 한국어로 설명해줘.\n\n${code}`;
          });
        } else if (item.command === "retroBBS.codeExplain") {
          this.handleAICommand("코드 설명", () => {
            const code = getActiveFileContent();
            if (!code) return null;
            return `다음 코드를 한국어로 자세히 설명해줘. 각 함수와 주요 로직의 역할을 설명해줘.\n\n${code}`;
          });
        } else if (item.command === "retroBBS.commitMessage") {
          this.handleAICommandAsync("커밋 메시지 생성", async () => {
            const diff = await getStagedDiff();
            return `다음 git diff에 대한 간결한 커밋 메시지를 영어로 작성해줘. conventional commits 형식으로.\n\n${diff}`;
          });
        } else if (item.command === "retroBBS.projectAnalysis") {
          this.handleAICommandAsync("프로젝트 분석", async () => {
            const summary = await getProjectSummary();
            return `다음 프로젝트 정보를 분석하고 한국어로 요약해줘. 기술 스택, 구조, 주요 기능을 설명해줘.\n\n${summary}`;
          });
        } else if (item.command === "retroBBS.securityAudit") {
          this.handleAICommandWithSystem(
            "보안 감사",
            () => {
              const code = getActiveFileContent();
              if (!code) return null;
              return `다음 코드의 보안 취약점을 분석해줘.\n\n${code}`;
            },
            "You are a security auditor specializing in OWASP Top 10. Analyze code for: injection flaws, XSS, broken authentication, sensitive data exposure, hardcoded secrets, insecure deserialization, and other vulnerabilities. Report findings in Korean with severity levels (높음/중간/낮음) and remediation suggestions.",
          );
        } else if (item.command === "retroBBS.generateTests") {
          this.handleAICommandWithSystem(
            "테스트 생성",
            () => {
              const code = getActiveFileContent();
              if (!code) return null;
              return `다음 코드의 테스트 코드를 생성해줘.\n\n${code}`;
            },
            "You are a test engineer. Generate comprehensive unit tests for the given code. Auto-detect the language and use the appropriate testing framework (Jest for JS/TS, pytest for Python, JUnit for Java, etc). Include edge cases, error cases, and happy paths. Output only the test code.",
          );
        } else if (item.command === "retroBBS.gitSummary") {
          this.handleAICommandAsync("Git 변경 요약", async () => {
            const data = await getGitSummaryData();
            return `다음 Git 히스토리를 분석해서 한국어로 읽기 쉬운 변경 요약을 작성해줘. 릴리즈 노트 형식으로 카테고리별로 정리해줘.\n\n${data}`;
          });
        } else if (item.command === "retroBBS.errorSolver") {
          this.viewMode = "error-solve";
          this.sendMessage({
            type: "renderContent",
            title: "에러 해결사",
            content: this.getErrorSolverContent(),
          });
        } else if (item.command === "retroBBS.askCode") {
          this.enterAskCodeMode();
        } else if (item.command) {
          vscode.commands.executeCommand(item.command);
          this.sendMenuState();
        }
        break;

      case "content":
        if (item.key === "11") {
          this.viewMode = "memo";
          this.sendMessage({
            type: "renderContent",
            title: "메모/노트",
            content: getMemoList(),
          });
        } else if (item.key === "12") {
          this.viewMode = "bookmark";
          this.sendMessage({
            type: "renderContent",
            title: "북마크",
            content: getBookmarkList(),
          });
        } else if (item.key === "31") {
          this.viewMode = "settings";
          this.sendMessage({
            type: "renderContent",
            title: "환경 설정",
            content: this.getSettingsContent(),
          });
        } else if (item.key === "32") {
          this.viewMode = "menu-edit";
          this.sendMessage({
            type: "renderContent",
            title: "메뉴 편집",
            content: getMenuEditorList(this.menuEngine.getConfig().items),
          });
        } else {
          this.viewMode = "content";
          this.sendMessage({
            type: "renderContent",
            title: item.label,
            content: item.content || "",
          });
        }
        break;

      case "chat":
        this.viewMode = "chat";
        this.sendMessage({
          type: "renderChat",
          messages: [
            {
              role: "system",
              content:
                "Claude 채팅방에 입장했습니다. 메시지를 입력하세요. (Q: 나가기)",
              timestamp: Date.now(),
            },
          ],
        });
        break;
    }
  }

  private persistData(): void {
    this.persistence.save(exportData());
  }

  private handleInteractiveInput(input: string): void {
    if (this.viewMode === "settings") {
      this.handleSettingsInput(input);
      return;
    }
    if (this.viewMode === "bookmark") {
      this.handleBookmarkInput(input);
      return;
    }
    if (this.viewMode === "menu-edit") {
      this.handleMenuEditInput(input);
      return;
    }
    if (this.viewMode === "error-solve") {
      this.handleErrorSolveInput(input);
      return;
    }
    if (this.viewMode === "ask-code") {
      this.handleAskCodeInput(input);
      return;
    }
    if (this.viewMode === "todo") {
      const content = handleTodoCommand(input);
      this.persistData();
      this.sendMessage({ type: "renderContent", title: "작업 목록", content });
    } else if (this.viewMode === "memo") {
      const result = handleMemoCommand(input);
      this.persistData();
      if (result.mode === "memo-edit") {
        this.viewMode = "memo-edit";
        this.currentMemoId = Number(input);
      }
      this.sendMessage({
        type: "renderContent",
        title: result.title,
        content: result.content,
      });
    } else if (this.viewMode === "memo-edit") {
      const parts = input.split(" ");
      if (parts[0].toLowerCase() === "edit" && parts.length > 1) {
        editMemo(this.currentMemoId, parts.slice(1).join(" "));
        this.persistData();
        const result = handleMemoCommand(String(this.currentMemoId));
        this.sendMessage({
          type: "renderContent",
          title: result.title,
          content: result.content,
        });
      } else if (parts[0].toUpperCase() === "P") {
        this.viewMode = "memo";
        this.sendMessage({
          type: "renderContent",
          title: "메모/노트",
          content: getMemoList(),
        });
      }
    }
  }

  private handleAICommand(
    title: string,
    buildPrompt: () => string | null,
  ): void {
    const prompt = buildPrompt();
    if (!prompt) {
      this.sendMessage({
        type: "error",
        message: "열려있는 파일이 없습니다. 에디터에서 파일을 열어주세요.",
      });
      return;
    }
    this.viewMode = "content";
    this.sendMessage({
      type: "contentChunk",
      title,
      text: "Claude에 요청 중...",
      done: false,
    });
    this.chatProvider.sendWithPrompt(prompt, (text, done) => {
      this.sendMessage({ type: "contentChunk", title, text, done });
    });
  }

  private async handleAICommandAsync(
    title: string,
    buildPrompt: () => Promise<string>,
  ): Promise<void> {
    this.viewMode = "content";
    this.sendMessage({
      type: "contentChunk",
      title,
      text: "데이터 수집 중...",
      done: false,
    });
    const prompt = await buildPrompt();
    this.sendMessage({
      type: "contentChunk",
      title,
      text: "Claude에 요청 중...",
      done: false,
    });
    await this.chatProvider.sendWithPrompt(prompt, (text, done) => {
      this.sendMessage({ type: "contentChunk", title, text, done });
    });
  }

  private async handleChat(message: string): Promise<void> {
    await this.chatProvider.send(message, (text, done) => {
      this.sendMessage({ type: "chatChunk", text, done });
    });
  }

  private getSettingsContent(): string {
    const lines: string[] = [
      `┌─ 환경 설정 ─────────────────────────┐`,
      `├──────────────────────────────────────┤`,
      `│ [테마 선택]`,
      `│`,
      `│  1. 하이텔    (파란 배경 + 노란/시안)`,
      `│  2. 나우누리  (검정 배경 + 녹색)`,
      `│  3. 천리안    (남색 배경 + 흰색/주황)`,
      `│`,
      `├──────────────────────────────────────┤`,
      `│ 번호를 입력하세요  P: 돌아가기`,
      `└──────────────────────────────────────┘`,
    ];
    return lines.join("\n");
  }

  private handleSettingsInput(input: string): void {
    const themeMap: Record<string, string> = {
      "1": "hitel",
      "2": "naunuri",
      "3": "chollian",
    };
    const theme = themeMap[input.trim()];
    if (theme) {
      this.sendMessage({ type: "setTheme", theme });
      this.sendMessage({
        type: "renderContent",
        title: "환경 설정",
        content: this.getSettingsContent(),
      });
    } else if (input.toUpperCase() === "P") {
      this.handleGoBack();
    }
  }

  private handleBookmarkInput(input: string): void {
    if (input.toUpperCase() === "P") {
      this.handleGoBack();
      return;
    }
    const result = handleBookmarkCommand(input);
    this.persistData();
    this.sendMessage({
      type: "renderContent",
      title: "북마크",
      content: result.content,
    });
    if (result.openFile) {
      vscode.workspace.openTextDocument(result.openFile).then((doc) => {
        vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
      });
    }
  }

  private handleMenuEditInput(input: string): void {
    if (input.toUpperCase() === "P") {
      this.handleGoBack();
      return;
    }
    const content = handleMenuEditCommand(
      input,
      this.menuEngine.getConfig().items,
    );
    this.persistData();
    this.sendMessage({
      type: "renderContent",
      title: "메뉴 편집",
      content,
    });
  }

  private handleAICommandWithSystem(
    title: string,
    buildPrompt: () => string | null,
    systemPrompt: string,
  ): void {
    const prompt = buildPrompt();
    if (!prompt) {
      this.sendMessage({
        type: "error",
        message: "열려있는 파일이 없습니다. 에디터에서 파일을 열어주세요.",
      });
      return;
    }
    this.viewMode = "content";
    this.sendMessage({
      type: "contentChunk",
      title,
      text: "Claude에 요청 중...",
      done: false,
    });
    this.chatProvider.sendWithOptions(
      prompt,
      (text, done) => {
        this.sendMessage({ type: "contentChunk", title, text, done });
      },
      { appendSystemPrompt: systemPrompt },
    );
  }

  private getErrorSolverContent(): string {
    return [
      `┌─ 에러 해결사 ───────────────────────┐`,
      `├──────────────────────────────────────┤`,
      `│ 에러 메시지를 입력하면 원인과`,
      `│ 해결책을 분석합니다.`,
      `│`,
      `│ 에러 텍스트를 붙여넣거나 입력하세요.`,
      `├──────────────────────────────────────┤`,
      `│ P : 돌아가기`,
      `└──────────────────────────────────────┘`,
    ].join("\n");
  }

  private async handleErrorSolveInput(input: string): Promise<void> {
    if (input.toUpperCase() === "P") {
      this.handleGoBack();
      return;
    }
    this.viewMode = "content";
    this.sendMessage({
      type: "contentChunk",
      title: "에러 해결사",
      text: "프로젝트 정보 수집 중...",
      done: false,
    });
    const summary = await getProjectSummary();
    const prompt = `프로젝트 컨텍스트:\n${summary}\n\n에러 메시지:\n${input}\n\n이 에러의 원인을 분석하고 해결책을 한국어로 제시해줘.`;
    this.sendMessage({
      type: "contentChunk",
      title: "에러 해결사",
      text: "Claude에 요청 중...",
      done: false,
    });
    await this.chatProvider.sendWithOptions(
      prompt,
      (text, done) => {
        this.sendMessage({
          type: "contentChunk",
          title: "에러 해결사",
          text,
          done,
        });
      },
      {
        appendSystemPrompt:
          "You are a debugging expert. Analyze the error message in the context of the project. Explain the root cause and provide step-by-step solutions in Korean. Be specific and actionable.",
      },
    );
  }

  private enterAskCodeMode(): void {
    const selected = getSelectedCode();
    if (!selected) {
      this.sendMessage({
        type: "error",
        message: "열려있는 파일이 없습니다. 에디터에서 파일을 열어주세요.",
      });
      return;
    }
    this.viewMode = "ask-code";
    const isSelection = selected.code.length < 5000;
    this.sendMessage({
      type: "renderContent",
      title: "선택 코드 질문",
      content: [
        `┌─ 선택 코드 질문 ────────────────────┐`,
        `├──────────────────────────────────────┤`,
        `│ 파일: ${selected.fileName} (${selected.lang})`,
        `│ 대상: ${isSelection ? "선택 영역" : "전체 파일"}`,
        `│ 크기: ${selected.code.length} 글자`,
        `│`,
        `│ 이 코드에 대해 질문을 입력하세요.`,
        `├──────────────────────────────────────┤`,
        `│ P : 돌아가기`,
        `└──────────────────────────────────────┘`,
      ].join("\n"),
    });
  }

  private async handleAskCodeInput(input: string): Promise<void> {
    if (input.toUpperCase() === "P") {
      this.handleGoBack();
      return;
    }
    const selected = getSelectedCode();
    if (!selected) {
      this.sendMessage({
        type: "error",
        message: "열려있는 파일이 없습니다.",
      });
      return;
    }
    this.viewMode = "content";
    const prompt = `파일: ${selected.fileName} (${selected.lang})\n\n코드:\n${selected.code}\n\n질문: ${input}`;
    this.sendMessage({
      type: "contentChunk",
      title: "선택 코드 질문",
      text: "Claude에 요청 중...",
      done: false,
    });
    await this.chatProvider.sendWithOptions(prompt, (text, done) => {
      this.sendMessage({
        type: "contentChunk",
        title: "선택 코드 질문",
        text,
        done,
      });
    });
  }

  private sendMenuState(): void {
    this.viewMode = "menu";
    const state = this.menuEngine.getState();
    const config = this.menuEngine.getConfig();
    const hidden = getHiddenKeys();
    const custom = getCustomMenus();

    state.current = [
      ...state.current.filter((i) => !hidden.has(i.key)),
      ...custom.map((m) => ({
        key: m.key,
        label: m.label,
        type: "content" as const,
        category: m.category,
        content: m.content,
      })),
    ];

    this.sendMessage({ type: "renderMenu", state, menuConfig: config });
  }

  private sendMessage(msg: WebviewMessage): void {
    this.panel?.webview.postMessage(msg);
  }
}
