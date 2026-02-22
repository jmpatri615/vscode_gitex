import * as vscode from 'vscode';
import { GraphDataProvider } from './graphDataProvider';
import { log, logError } from '../common/outputChannel';
import { WebviewIncomingMessage, WebviewOutgoingMessage } from '../common/types';

export class GraphViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gitex.graphView';
    private view?: vscode.WebviewView;
    private extensionUri: vscode.Uri;

    constructor(
        extensionUri: vscode.Uri,
        private dataProvider: GraphDataProvider,
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
                if (this.onSelectionChanged) {
                    this.onSelectionChanged(selectedShas);
                }
                if (selectedShas.length === 2 && this.onCompareSelected) {
                    this.onCompareSelected(selectedShas[0], selectedShas[1]);
                } else if (selectedShas.length === 1) {
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
    <div id="scroll-container" class="scroll-container" role="grid" aria-label="Commit graph" tabindex="0">
        <div id="scroll-spacer" class="scroll-spacer"></div>
        <canvas id="graph-canvas" class="graph-canvas" role="img" aria-label="Git commit graph visualization"></canvas>
        <div id="text-overlay"></div>
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
