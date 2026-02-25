import { spawn, ChildProcess } from "child_process";

interface ChatEntry {
  role: "user" | "assistant";
  content: string;
}

export interface SendOptions {
  appendSystemPrompt?: string;
}

export class ChatProvider {
  private proc: ChildProcess | null = null;
  private history: ChatEntry[] = [];

  async send(
    message: string,
    onChunk: (text: string, done: boolean) => void,
  ): Promise<void> {
    this.abort();

    this.history.push({ role: "user", content: message });

    const fullPrompt = this.buildPrompt(message);

    return new Promise<void>((resolve) => {
      let output = "";

      this.proc = spawn("claude", ["-p", "-"], {
        shell: true,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.stdin?.write(fullPrompt);
      this.proc.stdin?.end();

      this.proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        onChunk(output, false);
      });

      this.proc.stderr?.on("data", (data: Buffer) => {
        const err = data.toString();
        if (err.trim()) {
          output += `\n[오류] ${err}`;
        }
      });

      this.proc.on("close", () => {
        this.proc = null;
        const result = output || "(응답 없음)";
        this.history.push({ role: "assistant", content: result });
        if (this.history.length > 40) {
          this.history = this.history.slice(-40);
        }
        onChunk(result, true);
        resolve();
      });

      this.proc.on("error", (err) => {
        this.proc = null;
        onChunk(
          `[오류] Claude CLI 실행 실패: ${err.message}\nclaude 명령이 PATH에 있는지 확인하세요.`,
          true,
        );
        resolve();
      });
    });
  }

  private buildPrompt(currentMessage: string): string {
    if (this.history.length <= 1) {
      return currentMessage;
    }

    // Build context from previous exchanges (exclude current message which is already last)
    const prev = this.history.slice(0, -1);
    let context = "이전 대화 내용:\n";
    for (const entry of prev) {
      const label = entry.role === "user" ? "사용자" : "Claude";
      context += `[${label}] ${entry.content}\n`;
    }
    context += `\n위 대화의 맥락을 유지하며 다음 질문에 답해줘.\n\n[사용자] ${currentMessage}`;
    return context;
  }

  async sendWithPrompt(
    prompt: string,
    onChunk: (text: string, done: boolean) => void,
  ): Promise<void> {
    return this.sendWithOptions(prompt, onChunk);
  }

  async sendWithOptions(
    prompt: string,
    onChunk: (text: string, done: boolean) => void,
    options?: SendOptions,
  ): Promise<void> {
    this.abort();

    return new Promise<void>((resolve) => {
      let output = "";

      const args = ["-p", "-"];
      if (options?.appendSystemPrompt) {
        args.push("--append-system-prompt", options.appendSystemPrompt);
      }

      this.proc = spawn("claude", args, {
        shell: true,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.stdin?.write(prompt);
      this.proc.stdin?.end();

      this.proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        onChunk(output, false);
      });

      this.proc.stderr?.on("data", (data: Buffer) => {
        const err = data.toString();
        if (err.trim()) {
          output += `\n[오류] ${err}`;
        }
      });

      this.proc.on("close", () => {
        this.proc = null;
        onChunk(output || "(응답 없음)", true);
        resolve();
      });

      this.proc.on("error", (err) => {
        this.proc = null;
        onChunk(
          `[오류] Claude CLI 실행 실패: ${err.message}\nclaude 명령이 PATH에 있는지 확인하세요.`,
          true,
        );
        resolve();
      });
    });
  }

  resetChat(): void {
    this.history = [];
  }

  abort(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
