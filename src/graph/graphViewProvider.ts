import * as vscode from 'vscode';
import * as path from 'path';
import { GraphDataProvider } from './graphDataProvider';
import { configuration } from '../common/configuration';
import { log, logError } from '../common/outputChannel';
import { LayoutResult } from '../common/types';

export class GraphViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gitex.graphView';
    private view?: vscode.WebviewView;
    private extensionUri: vscode.Uri;

    constructor(
        extensionUri: vscode.Uri,
        private dataProvider: GraphDataProvider,
        private onCommitSelected: (sha: string) => void,
        private onCommitContextMenu: (sha: string) => void,
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

    private async handleMessage(message: any): Promise<void> {
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

            case 'commitClick':
                this.onCommitSelected(message.sha);
                break;

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

    private postMessage(message: any): void {
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
    <div id="toolbar">
        <div class="toolbar-group">
            <select id="branch-filter" title="Branch filter">
                <option value="all">All Branches</option>
                <option value="current">Current Branch</option>
            </select>
            <button id="btn-toggle-remotes" class="toolbar-btn toggle-on" title="Show remote branches">Remotes</button>
            <button id="btn-toggle-tags" class="toolbar-btn toggle-on" title="Show tags">Tags</button>
            <button id="btn-toggle-stashes" class="toolbar-btn toggle-on" title="Show stashes">Stashes</button>
        </div>
        <div class="toolbar-group">
            <button id="btn-search" class="toolbar-btn" title="Find (Ctrl+F)">Search</button>
            <button id="btn-refresh" class="toolbar-btn" title="Refresh">Refresh</button>
        </div>
    </div>
    <div id="filter-bar" class="hidden">
        <input type="text" id="filter-input" placeholder="Search commits..." />
        <select id="filter-field">
            <option value="message">Message</option>
            <option value="author">Author</option>
            <option value="committer">Committer</option>
            <option value="sha">SHA</option>
        </select>
        <input type="date" id="filter-date-from" title="From date" />
        <input type="date" id="filter-date-to" title="To date" />
        <button id="btn-filter-close" title="Close">×</button>
    </div>
    <div id="column-headers">
        <div class="column-header" data-col="graph" style="width:200px">Graph</div>
        <div class="column-header" data-col="description" style="flex:1">Description</div>
        <div class="column-header" data-col="author" style="width:120px">Author</div>
        <div class="column-header" data-col="date" style="width:100px">Date</div>
        <div class="column-header" data-col="sha" style="width:70px">SHA</div>
    </div>
    <div id="scroll-container">
        <div id="scroll-spacer"></div>
        <canvas id="graph-canvas"></canvas>
        <div id="text-overlay"></div>
    </div>
    <div id="status-bar">
        <span id="commit-count"></span>
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
