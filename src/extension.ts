import * as vscode from 'vscode';
import { GitService } from './git/gitService';
import { GitCommands } from './git/gitCommands';
import { GitExContentProvider, GITEX_SCHEME } from './git/gitUri';
import { GitWatcher } from './git/gitWatcher';
import { GraphViewProvider } from './graph/graphViewProvider';
import { GraphDataProvider } from './graph/graphDataProvider';
import { GraphCommandHandler } from './graph/graphCommands';
import { GraphMenuHandler } from './graph/graphMenus';
import { BlameService } from './blame/blameService';
import { BlameDecorationManager } from './blame/blameDecorations';
import { BlameStatusBar } from './blame/blameStatusBar';
import { BlameHoverProvider } from './blame/blameHoverProvider';
import { BlameCommandHandler } from './blame/blameCommands';
import { CommitDetailsProvider } from './commit/commitDetailsProvider';
import { CommitComparisonProvider } from './commit/commitComparisonProvider';
import { DiffService } from './commit/diffService';
import { loadWasm } from './wasm/wasmLoader';
import { onConfigurationChanged } from './common/configuration';
import { log, logError, getOutputChannel, disposeOutputChannel } from './common/outputChannel';

let gitWatcher: GitWatcher | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    log('GitEx activating...');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        log('No workspace folder open');
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Initialize Git service
    const gitService = new GitService(workspaceRoot);
    const initialized = await gitService.initialize();
    if (!initialized) {
        vscode.window.showInformationMessage(
            'GitEx: No git repository found in this workspace.',
        );
        log('Git not found or not a repository');
        return;
    }

    log(`Git repository found at ${gitService.getRepoRoot()}`);

    // Load WASM (non-blocking — falls back to TS if unavailable)
    loadWasm(context.extensionPath).catch(err => {
        logError('WASM load error', err);
    });

    // Initialize services
    const gitCommands = new GitCommands(gitService);
    const contentProvider = new GitExContentProvider(gitCommands);
    const graphDataProvider = new GraphDataProvider(gitCommands);
    const blameService = new BlameService(gitCommands);
    const diffService = new DiffService(gitCommands);
    const commitDetailsProvider = new CommitDetailsProvider(context.extensionUri, gitCommands);
    const commitComparisonProvider = new CommitComparisonProvider(context.extensionUri, gitCommands);
    const graphMenuHandler = new GraphMenuHandler(graphDataProvider);

    // Register content provider for gitex: URI scheme
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(GITEX_SCHEME, contentProvider)
    );

    // Register graph sidebar webview
    const graphViewProvider = new GraphViewProvider(
        context.extensionUri,
        graphDataProvider,
        async (sha: string) => {
            await commitDetailsProvider.show(sha);
        },
        (sha: string) => {
            graphMenuHandler.showContextMenu(sha);
        },
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GraphViewProvider.viewType, graphViewProvider)
    );

    // Register blame components
    const blameDecorations = new BlameDecorationManager(blameService);
    const blameStatusBar = new BlameStatusBar(blameService);
    const blameHover = new BlameHoverProvider(blameService);
    const blameCommands = new BlameCommandHandler(blameDecorations, blameStatusBar);

    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ scheme: 'file' }, blameHover),
    );

    // Register commands
    const graphCommands = new GraphCommandHandler(gitCommands, graphViewProvider, graphDataProvider);
    graphCommands.registerCommands(context);
    blameCommands.registerCommands(context);

    // Register diff commands
    context.subscriptions.push(
        vscode.commands.registerCommand('gitex.showCommitDetails', (sha: string) => {
            if (sha) { commitDetailsProvider.show(sha); }
        }),
        vscode.commands.registerCommand('gitex.compareCommits', (sha1: string, sha2: string) => {
            if (sha1 && sha2) { commitComparisonProvider.compare(sha1, sha2); }
        }),
        vscode.commands.registerCommand('gitex.compareWithWorkingTree', (sha: string) => {
            if (sha) { diffService.compareWithWorkingTree(sha); }
        }),
    );

    // Set up file watchers for auto-refresh
    gitWatcher = new GitWatcher(gitService.getRepoRoot());
    gitWatcher.onChange(async (event) => {
        log(`Git change detected: ${event}`);
        if (event === 'head' || event === 'refs') {
            await graphViewProvider.refresh();
            blameService.invalidateCache(); // HEAD changed, blame cache invalid
        } else if (event === 'index') {
            // Index change — might want to refresh working tree node
            await graphViewProvider.refresh();
        }
    });
    gitWatcher.start();
    context.subscriptions.push(gitWatcher);

    // Listen for configuration changes
    context.subscriptions.push(
        onConfigurationChanged((e) => {
            log('Configuration changed');
            if (e.affectsConfiguration('gitex.graph')) {
                graphViewProvider.refresh();
            }
        }),
    );

    // Listen for theme changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveColorTheme(() => {
            graphViewProvider.notifyThemeChanged();
        }),
    );

    // Register disposables
    context.subscriptions.push(
        blameDecorations,
        blameStatusBar,
        blameService,
        commitDetailsProvider,
        commitComparisonProvider,
        contentProvider,
        graphDataProvider,
        { dispose: () => getOutputChannel() },
    );

    log('GitEx activated successfully');
}

export function deactivate(): void {
    log('GitEx deactivating');
    if (gitWatcher) {
        gitWatcher.dispose();
        gitWatcher = undefined;
    }
    disposeOutputChannel();
}
