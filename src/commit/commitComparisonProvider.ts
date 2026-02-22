import * as vscode from 'vscode';
import { GitCommands } from '../git/gitCommands';
import { ChangedFile, ComparisonIncomingMessage, WORKING_DIR_SHA, COMMIT_INDEX_SHA, isVirtualSha } from '../common/types';
import { createGitUri, createWorkingTreeUri, createStagedUri } from '../git/gitUri';
import { logError } from '../common/outputChannel';

export class CommitComparisonProvider {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private extensionUri: vscode.Uri,
        private gitCommands: GitCommands,
    ) {}

    async compare(sha1: string, sha2: string): Promise<void> {
        try {
            let files: ChangedFile[];
            if (sha1 === WORKING_DIR_SHA || sha2 === WORKING_DIR_SHA) {
                const otherSha = sha1 === WORKING_DIR_SHA ? sha2 : sha1;
                if (otherSha === COMMIT_INDEX_SHA) {
                    files = await this.gitCommands.getDiffBetweenIndexAndWorkingTree();
                } else {
                    files = await this.gitCommands.getDiffWithWorkingTree(otherSha);
                }
            } else if (sha1 === COMMIT_INDEX_SHA || sha2 === COMMIT_INDEX_SHA) {
                const otherSha = sha1 === COMMIT_INDEX_SHA ? sha2 : sha1;
                files = await this.gitCommands.getDiffBetweenIndexAndCommit(otherSha);
            } else {
                files = await this.gitCommands.getDiffBetweenCommits(sha1, sha2);
            }
            this.showComparisonPanel(sha1, sha2, files);
        } catch (error) {
            logError(`Failed to compare ${this.formatRef(sha1)} and ${this.formatRef(sha2)}`, error);
            vscode.window.showErrorMessage('GitEx: Failed to compare commits');
        }
    }

    private formatRef(sha: string): string {
        if (sha === WORKING_DIR_SHA) { return 'Working Dir'; }
        if (sha === COMMIT_INDEX_SHA) { return 'Index'; }
        return sha.substring(0, 7);
    }

    private showComparisonPanel(sha1: string, sha2: string, files: ChangedFile[]): void {
        const short1 = this.formatRef(sha1);
        const short2 = this.formatRef(sha2);

        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'gitex.comparison',
                `${short1} ↔ ${short2}`,
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );
            this.panel.onDidDispose(() => { this.panel = undefined; });
            this.panel.webview.onDidReceiveMessage(async (message: ComparisonIncomingMessage) => {
                try {
                    if (message.type === 'openDiff') {
                        await this.openDiffForFile(sha1, sha2, message.path);
                    }
                } catch (error) {
                    logError('Error handling comparison message', error);
                }
            });
        }

        this.panel.title = `${short1} ↔ ${short2}`;
        this.panel.webview.html = this.getHtml(this.panel.webview, sha1, sha2, files);
    }

    private async openDiffForFile(sha1: string, sha2: string, filePath: string): Promise<void> {
        const leftUri = this.resolveUri(sha1, filePath);
        const rightUri = this.resolveUri(sha2, filePath);
        const title = `${filePath} (${this.formatRef(sha1)} ↔ ${this.formatRef(sha2)})`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    private resolveUri(sha: string, filePath: string): vscode.Uri {
        if (sha === WORKING_DIR_SHA) {
            const repoRoot = this.gitCommands['git'].getRepoRoot();
            return createWorkingTreeUri(repoRoot, filePath);
        }
        if (sha === COMMIT_INDEX_SHA) {
            return createStagedUri(filePath);
        }
        return createGitUri(sha, filePath);
    }

    private getHtml(webview: vscode.Webview, sha1: string, sha2: string, files: ChangedFile[]): string {
        const nonce = getNonce();
        const filesHtml = files.map(f =>
            `<div class="file-entry" data-path="${escapeHtml(f.path)}">
                <span class="file-status">[${f.status}]</span>
                <span class="file-path">${escapeHtml(f.path)}</span>
                <span class="file-stats">+${f.insertions} -${f.deletions}</span>
            </div>`
        ).join('\n');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 16px; }
        h2 { font-size: 14px; margin-bottom: 16px; }
        .file-entry { padding: 4px 8px; cursor: pointer; display: flex; gap: 8px; }
        .file-entry:hover { background: var(--vscode-list-hoverBackground); }
        .file-status { color: var(--vscode-gitDecoration-modifiedResourceForeground); font-family: monospace; min-width: 30px; }
        .file-path { flex: 1; }
        .file-stats { color: var(--vscode-descriptionForeground); font-family: monospace; }
    </style>
</head>
<body>
    <h2>Comparing ${sha1.substring(0, 7)} ↔ ${sha2.substring(0, 7)}</h2>
    <p>${files.length} file(s) changed</p>
    <div class="file-list">${filesHtml}</div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('.file-entry').forEach(el => {
            el.addEventListener('click', () => {
                vscode.postMessage({ type: 'openDiff', path: el.dataset.path });
            });
        });
    </script>
</body>
</html>`;
    }

    dispose(): void {
        this.panel?.dispose();
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return text;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
