import * as vscode from 'vscode';
import { GitCommands } from '../git/gitCommands';
import { CommitDetails } from '../common/types';
import { logError } from '../common/outputChannel';

export class CommitDetailsProvider {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private extensionUri: vscode.Uri,
        private gitCommands: GitCommands,
    ) {}

    async show(sha: string): Promise<void> {
        try {
            const details = await this.gitCommands.getCommitDetails(sha);
            if (this.panel) {
                this.panel.reveal(vscode.ViewColumn.Beside);
            } else {
                this.panel = vscode.window.createWebviewPanel(
                    'gitex.commitDetails',
                    `Commit ${details.shortSha}`,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        localResourceRoots: [
                            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
                        ],
                    }
                );
                this.panel.onDidDispose(() => {
                    this.panel = undefined;
                });

                this.panel.webview.onDidReceiveMessage(message => {
                    this.handleMessage(message);
                });
            }

            this.panel.title = `Commit ${details.shortSha}`;
            this.panel.webview.html = this.getHtml(this.panel.webview, details);
        } catch (error) {
            logError(`Failed to show commit details for ${sha}`, error);
            vscode.window.showErrorMessage(`GitEx: Failed to load commit details`);
        }
    }

    private handleMessage(message: any): void {
        switch (message.type) {
            case 'openDiff':
                vscode.commands.executeCommand('gitex.showCommitDetails', message.sha);
                break;
            case 'navigateToParent':
                this.show(message.sha);
                break;
            case 'openFile':
                vscode.commands.executeCommand('gitex.compareWithWorkingTree', message.sha);
                break;
            case 'copySha':
                vscode.env.clipboard.writeText(message.sha);
                break;
        }
    }

    private getHtml(webview: vscode.Webview, details: CommitDetails): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'commitDetails', 'commitDetails.css')
        );
        const nonce = getNonce();

        const refsHtml = details.refs.map(ref => {
            const cls = ref.refType.toLowerCase();
            return `<span class="ref-badge ${cls}">${ref.name}</span>`;
        }).join(' ');

        const filesHtml = details.changedFiles.map(f => {
            const statusClass = f.status.toLowerCase();
            const stats = `+${f.insertions} -${f.deletions}`;
            return `<div class="file-entry" data-path="${escapeHtml(f.path)}" data-sha="${details.sha}">
                <span class="file-status ${statusClass}">[${f.status}]</span>
                <span class="file-path">${escapeHtml(f.path)}</span>
                <span class="file-stats">${stats}</span>
            </div>`;
        }).join('\n');

        const parentsHtml = details.parents.map(p =>
            `<a href="#" class="parent-link" data-sha="${p}">${p.substring(0, 7)}</a>`
        ).join(' ');

        const authorDate = new Date(details.authorDate * 1000).toISOString().replace('T', ' ').substring(0, 19);
        const commitDate = new Date(details.commitDate * 1000).toISOString().replace('T', ' ').substring(0, 19);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Commit Details</title>
</head>
<body>
    <div class="commit-header">
        <div class="sha-line">
            <span class="sha" title="Click to copy">${details.sha}</span>
            <button class="copy-btn" data-sha="${details.sha}">Copy</button>
        </div>
        <div class="refs">${refsHtml}</div>
    </div>
    <div class="commit-meta">
        <table>
            <tr><td class="label">Author</td><td>${escapeHtml(details.authorName)} &lt;${escapeHtml(details.authorEmail)}&gt;</td></tr>
            <tr><td class="label">Date</td><td>${authorDate}</td></tr>
            ${details.committerName !== details.authorName ?
                `<tr><td class="label">Committer</td><td>${escapeHtml(details.committerName)} &lt;${escapeHtml(details.committerEmail)}&gt;</td></tr>
                 <tr><td class="label">Commit Date</td><td>${commitDate}</td></tr>` : ''}
            <tr><td class="label">Parents</td><td>${parentsHtml || 'None (root commit)'}</td></tr>
        </table>
    </div>
    <div class="commit-message">
        <h3>Message</h3>
        <pre>${escapeHtml(details.subject)}${details.body ? '\n\n' + escapeHtml(details.body) : ''}</pre>
    </div>
    <div class="changed-files">
        <h3>Changed Files (${details.changedFiles.length})</h3>
        ${filesHtml}
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        document.querySelectorAll('.parent-link').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                vscode.postMessage({ type: 'navigateToParent', sha: el.dataset.sha });
            });
        });

        document.querySelectorAll('.file-entry').forEach(el => {
            el.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'openFile',
                    path: el.dataset.path,
                    sha: el.dataset.sha,
                });
            });
        });

        document.querySelectorAll('.copy-btn').forEach(el => {
            el.addEventListener('click', () => {
                vscode.postMessage({ type: 'copySha', sha: el.dataset.sha });
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
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
