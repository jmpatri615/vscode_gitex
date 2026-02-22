import * as vscode from 'vscode';
import { GraphDataProvider } from './graphDataProvider';
import { GitCommands } from '../git/gitCommands';
import { createGitUri, createWorkingTreeUri, createStagedUri } from '../git/gitUri';
import { log, logError } from '../common/outputChannel';
import {
    WebviewIncomingMessage, WebviewOutgoingMessage, ChangedFile,
    WORKING_DIR_SHA, COMMIT_INDEX_SHA, isVirtualSha,
} from '../common/types';

export class GraphViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gitex.graphView';
    private view?: vscode.WebviewView;
    private extensionUri: vscode.Uri;
    private currentSelectedShas: string[] = [];

    constructor(
        extensionUri: vscode.Uri,
        private dataProvider: GraphDataProvider,
        private gitCommands: GitCommands,
        private onCommitSelected: (sha: string) => void,
        private onCommitContextMenu: (sha: string) => void,
        private onCompareSelected?: (sha1: string, sha2: string) => void,
        private onSelectionChanged?: (shas: string[]) => void,
    ) {
        this.extensionUri = extensionUri;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
            ],
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });

        webviewView.onDidDispose(() => {
            this.view = undefined;
            log('Graph webview disposed');
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.refresh();
            }
        });
    }

    async refresh(): Promise<void> {
        if (!this.view) { return; }

        try {
            const layout = await this.dataProvider.loadInitialData();
            this.postMessage({
                type: 'layoutData',
                data: layout,
                append: false,
            });
            this.postMessage({
                type: 'updateTotalCount',
                count: this.dataProvider.getTotalCount(),
            });

            // Re-fetch file list for current selection after refresh
            if (this.currentSelectedShas.length > 0) {
                await this.fetchAndSendFileList(this.currentSelectedShas);
            }
        } catch (error) {
            logError('Failed to refresh graph', error);
        }
    }

    setSelection(sha: string): void {
        this.postMessage({ type: 'setSelection', sha });
    }

    notifyThemeChanged(): void {
        this.postMessage({ type: 'themeChanged' });
    }

    private async handleMessage(message: WebviewIncomingMessage): Promise<void> {
        switch (message.type) {
            case 'ready':
                await this.refresh();
                break;

            case 'requestPage': {
                const { skip, count } = message;
                try {
                    const layout = await this.dataProvider.loadPage(skip, count);
                    this.postMessage({
                        type: 'layoutData',
                        data: layout,
                        append: true,
                    });
                } catch (error) {
                    logError('Failed to load page', error);
                }
                break;
            }

            case 'commitClick': {
                const selectedShas = message.selectedShas || [message.sha];
                this.currentSelectedShas = selectedShas;

                if (this.onSelectionChanged) {
                    this.onSelectionChanged(selectedShas);
                }

                // Fetch file list for inline pane
                await this.fetchAndSendFileList(selectedShas);

                // Single click still shows commit details; double-click also handled below
                if (selectedShas.length === 1) {
                    this.onCommitSelected(message.sha);
                }
                break;
            }

            case 'commitDblClick':
                this.onCommitSelected(message.sha);
                break;

            case 'contextMenu':
                this.onCommitContextMenu(message.sha);
                break;

            case 'selectionCleared':
                this.currentSelectedShas = [];
                this.postMessage({ type: 'fileListClear' });
                break;

            case 'fileClick':
                await this.openDiffForFile(message.leftSha, message.rightSha, message.path);
                break;

            case 'filterChange': {
                const { field, pattern } = message;
                try {
                    const layout = await this.dataProvider.loadInitialData({
                        field,
                        pattern,
                    });
                    this.postMessage({
                        type: 'layoutData',
                        data: layout,
                        append: false,
                    });
                } catch (error) {
                    logError('Failed to filter', error);
                }
                break;
            }

            case 'dateFilterChange': {
                const { after, before } = message;
                try {
                    const layout = await this.dataProvider.loadInitialData({
                        after,
                        before,
                    });
                    this.postMessage({
                        type: 'layoutData',
                        data: layout,
                        append: false,
                    });
                } catch (error) {
                    logError('Failed to filter by date', error);
                }
                break;
            }
        }
    }

    private async fetchAndSendFileList(selectedShas: string[]): Promise<void> {
        if (selectedShas.length === 0 || selectedShas.length > 2) {
            this.postMessage({ type: 'fileListClear' });
            return;
        }

        try {
            let files: ChangedFile[];
            let leftRef: string;
            let rightRef: string;
            let leftSha: string;
            let rightSha: string;

            if (selectedShas.length === 1) {
                const sha = selectedShas[0];

                if (sha === WORKING_DIR_SHA) {
                    // Working directory → diff HEAD vs working tree
                    const head = await this.gitCommands.revParse('HEAD');
                    leftSha = head || 'HEAD';
                    rightSha = WORKING_DIR_SHA;
                    leftRef = 'HEAD';
                    rightRef = 'Working Tree';
                    files = await this.gitCommands.getDiffWithWorkingTree(leftSha);
                } else if (sha === COMMIT_INDEX_SHA) {
                    // Staged files
                    leftSha = 'HEAD';
                    rightSha = COMMIT_INDEX_SHA;
                    leftRef = 'HEAD';
                    rightRef = 'Index';
                    files = await this.gitCommands.getStagedFiles();
                } else {
                    // Regular commit → diff vs parent
                    leftSha = `${sha}^`;
                    rightSha = sha;
                    leftRef = sha.substring(0, 7) + '^';
                    rightRef = sha.substring(0, 7);
                    files = await this.gitCommands.getChangedFiles(sha);
                }
            } else {
                // Two selected shas
                const [sha1, sha2] = selectedShas;
                leftSha = sha1;
                rightSha = sha2;
                leftRef = this.formatRef(sha1);
                rightRef = this.formatRef(sha2);

                if (sha1 === WORKING_DIR_SHA || sha2 === WORKING_DIR_SHA) {
                    const otherSha = sha1 === WORKING_DIR_SHA ? sha2 : sha1;
                    if (otherSha === COMMIT_INDEX_SHA) {
                        files = await this.gitCommands.getDiffBetweenIndexAndWorkingTree();
                    } else {
                        files = await this.gitCommands.getDiffWithWorkingTree(otherSha);
                    }
                    // Normalize so left is the non-working-tree side
                    leftSha = sha1 === WORKING_DIR_SHA ? sha2 : sha1;
                    rightSha = WORKING_DIR_SHA;
                    leftRef = this.formatRef(leftSha);
                    rightRef = 'Working Tree';
                } else if (sha1 === COMMIT_INDEX_SHA || sha2 === COMMIT_INDEX_SHA) {
                    const otherSha = sha1 === COMMIT_INDEX_SHA ? sha2 : sha1;
                    files = await this.gitCommands.getDiffBetweenIndexAndCommit(otherSha);
                    leftSha = otherSha;
                    rightSha = COMMIT_INDEX_SHA;
                    leftRef = this.formatRef(otherSha);
                    rightRef = 'Index';
                } else {
                    files = await this.gitCommands.getDiffBetweenCommits(sha1, sha2);
                }
            }

            this.postMessage({
                type: 'fileListData',
                files,
                leftRef,
                rightRef,
                leftSha,
                rightSha,
            });
        } catch (error) {
            logError('Failed to fetch file list', error);
            this.postMessage({ type: 'fileListClear' });
        }
    }

    private async openDiffForFile(leftSha: string, rightSha: string, path: string): Promise<void> {
        try {
            const repoRoot = this.gitCommands['git'].getRepoRoot();

            let leftUri: vscode.Uri;
            let rightUri: vscode.Uri;
            let title: string;

            // Resolve left side
            if (leftSha === COMMIT_INDEX_SHA) {
                leftUri = createStagedUri(path);
            } else if (leftSha === WORKING_DIR_SHA) {
                leftUri = createWorkingTreeUri(repoRoot, path);
            } else if (isVirtualSha(leftSha)) {
                leftUri = createGitUri('HEAD', path);
            } else {
                // Could be "sha^" for parent diff
                leftUri = createGitUri(leftSha, path);
            }

            // Resolve right side
            if (rightSha === WORKING_DIR_SHA) {
                rightUri = createWorkingTreeUri(repoRoot, path);
            } else if (rightSha === COMMIT_INDEX_SHA) {
                rightUri = createStagedUri(path);
            } else {
                rightUri = createGitUri(rightSha, path);
            }

            const leftLabel = this.formatRef(leftSha);
            const rightLabel = this.formatRef(rightSha);
            const fileName = path.split('/').pop() || path;
            title = `${fileName} (${leftLabel} \u2194 ${rightLabel})`;

            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        } catch (error) {
            logError('Failed to open diff', error);
        }
    }

    private formatRef(sha: string): string {
        if (sha === WORKING_DIR_SHA) { return 'Working Tree'; }
        if (sha === COMMIT_INDEX_SHA) { return 'Index'; }
        if (sha === 'HEAD') { return 'HEAD'; }
        if (sha.endsWith('^')) { return sha.length > 8 ? sha.substring(0, 7) + '^' : sha; }
        return sha.length > 7 ? sha.substring(0, 7) : sha;
    }

    private postMessage(message: WebviewOutgoingMessage): void {
        this.view?.webview.postMessage(message);
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'graph', 'index.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'graph', 'graph.css')
        );
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>GitEx Graph</title>
</head>
<body>
    <div id="toolbar" class="toolbar" role="toolbar" aria-label="Graph controls">
        <select id="branch-filter" title="Branch filter">
            <option value="all">All Branches</option>
            <option value="current">Current Branch</option>
        </select>
        <button id="btn-toggle-remotes" class="toolbar-btn active" title="Show remote branches">Remotes</button>
        <button id="btn-toggle-tags" class="toolbar-btn active" title="Show tags">Tags</button>
        <button id="btn-toggle-stashes" class="toolbar-btn active" title="Show stashes">Stashes</button>
        <div class="toolbar-spacer"></div>
        <button id="btn-search" class="toolbar-btn" title="Find (Ctrl+F)">Search</button>
        <button id="btn-refresh" class="toolbar-btn" title="Refresh">Refresh</button>
    </div>
    <div id="filter-container" role="search" aria-label="Commit filter"></div>
    <div id="column-headers" role="row" aria-label="Column headers"></div>
    <div id="split-wrapper" class="split-wrapper">
        <div id="graph-pane" class="graph-pane">
            <div id="scroll-container" class="scroll-container" role="grid" aria-label="Commit graph" tabindex="0">
                <div id="scroll-spacer" class="scroll-spacer"></div>
                <canvas id="graph-canvas" class="graph-canvas" role="img" aria-label="Git commit graph visualization"></canvas>
                <div id="text-overlay"></div>
            </div>
        </div>
        <div id="split-divider" class="split-divider"></div>
        <div id="file-list-pane" class="file-list-pane"></div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
