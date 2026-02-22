import * as vscode from 'vscode';
import { BlameDecorationManager } from './blameDecorations';
import { BlameStatusBar } from './blameStatusBar';

export class BlameCommandHandler {
    constructor(
        private decorationManager: BlameDecorationManager,
        private statusBar: BlameStatusBar,
    ) {}

    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('gitex.toggleBlame', () => this.toggleBlame()),
            vscode.commands.registerCommand('gitex.toggleInlineBlame', () => this.toggleInlineBlame()),
        );
    }

    private toggleBlame(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor');
            return;
        }
        this.decorationManager.toggleGutterBlame(editor);
    }

    private async toggleInlineBlame(): Promise<void> {
        const config = vscode.workspace.getConfiguration('gitex');
        const current = config.get<boolean>('blame.inline.enabled', true);
        await config.update('blame.inline.enabled', !current, vscode.ConfigurationTarget.Global);
    }
}
