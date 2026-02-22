import * as vscode from 'vscode';
import { BlameService } from './blameService';
import { BlameEntry } from '../common/types';
import { configuration } from '../common/configuration';
import { logError } from '../common/outputChannel';
import { formatDate } from './blameUtils';

export class BlameStatusBar implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private debounceTimer: NodeJS.Timeout | undefined;
    private disposables: vscode.Disposable[] = [];

    constructor(private blameService: BlameService) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'gitex.showCommitDetails';
        this.statusBarItem.name = 'GitEx Blame';

        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection(e => {
                if (configuration.blameStatusBarEnabled) {
                    this.onCursorMove(e.textEditor);
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && configuration.blameStatusBarEnabled) {
                    this.onCursorMove(editor);
                } else {
                    this.statusBarItem.hide();
                }
            }),
        );

        if (configuration.blameStatusBarEnabled) {
            this.statusBarItem.show();
        }
    }

    private onCursorMove(editor: vscode.TextEditor): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.updateStatusBar(editor).catch(err => logError('Failed to update status bar blame', err));
        }, configuration.blameInlineDelay);
    }

    private async updateStatusBar(editor: vscode.TextEditor): Promise<void> {
        if (!configuration.blameStatusBarEnabled) {
            this.statusBarItem.hide();
            return;
        }

        if (editor.document.isUntitled) {
            this.statusBarItem.text = '$(git-commit) File not tracked';
            this.statusBarItem.tooltip = undefined;
            return;
        }

        const line = editor.selection.active.line + 1; // 1-indexed for git
        const filePath = editor.document.uri.fsPath;

        try {
            const entry = await this.blameService.getBlameForLine(filePath, line);
            if (entry) {
                this.statusBarItem.text = `$(git-commit) ${entry.authorName}, ${formatDate(entry.authorDate, 'relative')} — ${entry.summary || ''}`;
                this.statusBarItem.tooltip = new vscode.MarkdownString(
                    `**${entry.sha}**\n\n` +
                    `Author: ${entry.authorName} <${entry.authorEmail}>\n\n` +
                    `Date: ${formatDate(entry.authorDate, 'iso')}\n\n` +
                    `${entry.summary || ''}`
                );
                // Store SHA for command
                this.statusBarItem.command = {
                    command: 'gitex.showCommitDetails',
                    title: 'Show Commit Details',
                    arguments: [entry.sha],
                };
                this.statusBarItem.show();
            } else {
                this.statusBarItem.text = '$(git-commit) Not committed';
                this.statusBarItem.show();
            }
        } catch {
            this.statusBarItem.text = '$(git-commit) File not tracked';
            this.statusBarItem.show();
        }
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.statusBarItem.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
