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
import { isVirtualSha, WORKING_DIR_SHA, COMMIT_INDEX_SHA } from './common/types';

let gitWatcher: GitWatcher | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    log('GitEx activating...');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        log('No workspace folder open');
        vscode.commands.executeCommand('setContext', 'gitex:hasRepository', false);
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
        vscode.commands.executeCommand('setContext', 'gitex:hasRepository', false);
        return;
    }

    log(`Git repository found at ${gitService.getRepoRoot()}`);
    vscode.commands.executeCommand('setContext', 'gitex:hasRepository', true);

    // Load WASM before initializing providers so it's available on first use
    try {
        await loadWasm(context.extensionPath);
    } catch (err) {
        logError('WASM load error (will use TS fallback)', err);
    }

    // Initialize services
    const gitCommands = new GitCommands(gitService);
    const contentProvider = new GitExContentProvider(gitCommands);
    const graphDataProvider = new GraphDataProvider(gitCommands);
    const blameService = new BlameService(gitCommands);
    const diffService = new DiffService(gitCommands);
    const commitDetailsProvider = new CommitDetailsProvider(context.extensionUri, gitCommands, diffService);
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
        gitCommands,
        async (sha: string) => {
            if (isVirtualSha(sha)) {
                await handleVirtualNodeClick(sha, gitCommands, diffService);
            } else {
                await commitDetailsProvider.show(sha);
            }
        },
        (sha: string) => {
            graphMenuHandler.showContextMenu(sha);
        },
        async (sha1: string, sha2: string) => {
            await compareAnyTwoRefs(sha1, sha2, gitCommands, commitComparisonProvider, diffService);
        },
        (shas: string[]) => {
            graphMenuHandler.setSelection(shas);
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
        vscode.commands.registerCommand('gitex.showCommitDetails', async (sha: string) => {
            if (sha) { await commitDetailsProvider.show(sha); }
        }),
        vscode.commands.registerCommand('gitex.compareCommits', async (sha1: string, sha2: string) => {
            if (sha1 && sha2) { await commitComparisonProvider.compare(sha1, sha2); }
        }),
        vscode.commands.registerCommand('gitex.compareWithWorkingTree', async (sha: string) => {
            if (sha) { await diffService.compareWithWorkingTree(sha); }
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

async function compareAnyTwoRefs(
    sha1: string,
    sha2: string,
    gitCommands: GitCommands,
    commitComparisonProvider: CommitComparisonProvider,
    diffService: DiffService,
): Promise<void> {
    try {
        // Resolve virtual SHAs for display and diff
        if (sha1 === WORKING_DIR_SHA || sha2 === WORKING_DIR_SHA) {
            // One side is working directory
            const otherSha = sha1 === WORKING_DIR_SHA ? sha2 : sha1;
            if (otherSha === COMMIT_INDEX_SHA) {
                // Working dir vs Index: show unstaged changes
                const headSha = await gitCommands.revParse('HEAD');
                if (headSha) { await diffService.compareWithWorkingTree(headSha); }
            } else {
                await diffService.compareWithWorkingTree(otherSha);
            }
        } else if (sha1 === COMMIT_INDEX_SHA || sha2 === COMMIT_INDEX_SHA) {
            // One side is commit index
            const otherSha = sha1 === COMMIT_INDEX_SHA ? sha2 : sha1;
            // Index vs commit: show staged diff against that commit
            const files = await gitCommands.getDiffBetweenIndexAndCommit(otherSha);
            if (files.length === 0) {
                vscode.window.showInformationMessage('No differences between index and commit');
                return;
            }
            // Use comparison provider to show the list
            await commitComparisonProvider.compare(otherSha, COMMIT_INDEX_SHA);
        } else {
            // Both regular commits
            await commitComparisonProvider.compare(sha1, sha2);
        }
    } catch (error) {
        logError('Failed to compare refs', error);
    }
}

async function handleVirtualNodeClick(
    sha: string,
    gitCommands: GitCommands,
    diffService: DiffService,
): Promise<void> {
    if (sha === WORKING_DIR_SHA) {
        // Show unstaged/untracked changes
        const headSha = await gitCommands.revParse('HEAD');
        if (headSha) {
            await diffService.compareWithWorkingTree(headSha);
        }
    } else if (sha === COMMIT_INDEX_SHA) {
        // Show staged changes
        await showStagedChanges(gitCommands, diffService);
    }
}

async function showStagedChanges(
    gitCommands: GitCommands,
    diffService: DiffService,
): Promise<void> {
    const files = await gitCommands.getStagedFiles();
    if (files.length === 0) {
        vscode.window.showInformationMessage('No staged changes');
        return;
    }

    if (files.length === 1) {
        await diffService.diffStagedFile(files[0].path);
        return;
    }

    const items = files.map(f => ({
        label: `$(diff) [${f.status}] ${f.path}`,
        description: '',
        path: f.path,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Staged files',
    });

    if (selected) {
        await diffService.diffStagedFile(selected.path);
    }
}

export function deactivate(): void {
    log('GitEx deactivating');
    if (gitWatcher) {
        gitWatcher.dispose();
        gitWatcher = undefined;
    }
    disposeOutputChannel();
}
