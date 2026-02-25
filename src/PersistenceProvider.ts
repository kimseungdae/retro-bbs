import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

interface PersistedData {
  todos: { id: number; text: string; done: boolean }[];
  memos: { id: number; title: string; content: string; date: string }[];
  bookmarks: { id: number; filePath: string; label: string }[];
}

const DEFAULT_DATA: PersistedData = {
  todos: [],
  memos: [],
  bookmarks: [],
};

export class PersistenceProvider {
  private dataPath: string | null = null;
  private data: PersistedData = { ...DEFAULT_DATA };

  init(): PersistedData {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return this.data;

    const dir = path.join(folders[0].uri.fsPath, ".retro-bbs");
    this.dataPath = path.join(dir, "data.json");

    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, "utf-8");
        this.data = { ...DEFAULT_DATA, ...JSON.parse(raw) };
      }
    } catch {
      this.data = { ...DEFAULT_DATA };
    }

    return this.data;
  }

  save(data: Partial<PersistedData>): void {
    Object.assign(this.data, data);
    if (!this.dataPath) return;

    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2));
    } catch {
      // silently fail
    }
  }

  getData(): PersistedData {
    return this.data;
  }
}
