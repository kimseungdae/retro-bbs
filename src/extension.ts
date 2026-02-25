import * as vscode from "vscode";
import { BBSViewProvider } from "./BBSViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new BBSViewProvider(context);

  const openCmd = vscode.commands.registerCommand("retroBBS.open", () => {
    provider.open();
  });

  context.subscriptions.push(openCmd);
}

export function deactivate(): void {}
