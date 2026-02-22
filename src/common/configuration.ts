import * as vscode from 'vscode';

const SECTION = 'gitex';

function get<T>(key: string, defaultValue: T): T {
    return vscode.workspace.getConfiguration(SECTION).get<T>(key, defaultValue);
}

export const configuration = {
    // General
    get gitPath(): string { return get<string>('git.path', ''); },
    get autoRefresh(): boolean { return get<boolean>('autoRefresh', true); },
    get autoRefreshDebounce(): number { return get<number>('autoRefreshDebounce', 500); },

    // Graph
    get graphDefaultView(): 'allBranches' | 'currentBranch' { return get<'allBranches' | 'currentBranch'>('graph.defaultView', 'allBranches'); },
    get graphShowRemoteBranches(): boolean { return get<boolean>('graph.showRemoteBranches', true); },
    get graphShowTags(): boolean { return get<boolean>('graph.showTags', true); },
    get graphShowStashes(): boolean { return get<boolean>('graph.showStashes', true); },
    get graphRowHeight(): number { return get<number>('graph.rowHeight', 24); },
    get graphLaneWidth(): number { return get<number>('graph.laneWidth', 16); },
    get graphPageSize(): number { return get<number>('graph.pageSize', 500); },
    get graphScrollBuffer(): number { return get<number>('graph.scrollBuffer', 50); },
    get graphBranchColors(): Record<string, string> { return get<Record<string, string>>('graph.branchColors', {}); },
    get graphDateFormat(): 'relative' | 'iso' | 'locale' { return get<'relative' | 'iso' | 'locale'>('graph.dateFormat', 'relative'); },

    // Blame
    get blameInlineEnabled(): boolean { return get<boolean>('blame.inline.enabled', true); },
    get blameInlineFormat(): string { return get<string>('blame.inline.format', '${author}, ${date} - ${message}'); },
    get blameInlineDateFormat(): 'relative' | 'iso' | 'locale' { return get<'relative' | 'iso' | 'locale'>('blame.inline.dateFormat', 'relative'); },
    get blameInlineDelay(): number { return get<number>('blame.inline.delay', 150); },
    get blameStatusBarEnabled(): boolean { return get<boolean>('blame.statusBar.enabled', true); },
    get blameGutterEnabled(): boolean { return get<boolean>('blame.gutter.enabled', false); },
    get blameGutterColorMode(): 'age' | 'author' { return get<'age' | 'author'>('blame.gutter.colorMode', 'age'); },
    get blameHoverEnabled(): boolean { return get<boolean>('blame.hover.enabled', true); },
    get blameCacheSize(): number { return get<number>('blame.cacheSize', 50); },
    get blameIgnoreRevs(): boolean { return get<boolean>('blame.ignoreRevs', true); },
    get blameIgnoreWhitespace(): boolean { return get<boolean>('blame.ignoreWhitespace', false); },

    // Operations
    get confirmHardReset(): boolean { return get<boolean>('operations.confirmHardReset', true); },
    get confirmStashDrop(): boolean { return get<boolean>('operations.confirmStashDrop', true); },
    get autoStashOnRebase(): boolean { return get<boolean>('operations.autoStashOnRebase', false); },
    get mergeNoFf(): boolean { return get<boolean>('operations.mergeNoFf', false); },
};

export function onConfigurationChanged(callback: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(SECTION)) {
            callback(e);
        }
    });
}
