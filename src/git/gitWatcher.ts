import * as vscode from 'vscode';
import * as path from 'path';
import { configuration } from '../common/configuration';
import { log } from '../common/outputChannel';

export type WatcherEvent = 'head' | 'refs' | 'index' | 'merge' | 'rebase';

export class GitWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = [];
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private callbacks: ((event: WatcherEvent) => void)[] = [];

    constructor(private repoRoot: string) {}

    start(): void {
        const gitDir = path.join(this.repoRoot, '.git');

        // Watch HEAD (branch switch, commit)
        this.watch(path.join(gitDir, 'HEAD'), 'head');

        // Watch refs (branch/tag create/delete)
        this.watch(path.join(gitDir, 'refs', 'heads', '**'), 'refs');
        this.watch(path.join(gitDir, 'refs', 'tags', '**'), 'refs');
        this.watch(path.join(gitDir, 'refs', 'remotes', '**'), 'refs');
        this.watch(path.join(gitDir, 'refs', 'stash'), 'refs');

        // Watch index (staging changes)
        this.watch(path.join(gitDir, 'index'), 'index');

        // Watch merge/rebase state
        this.watch(path.join(gitDir, 'MERGE_HEAD'), 'merge');
        this.watch(path.join(gitDir, 'REBASE_HEAD'), 'rebase');

        log(`GitWatcher started for ${gitDir}`);
    }

    onChange(callback: (event: WatcherEvent) => void): void {
        this.callbacks.push(callback);
    }

    private watch(globPattern: string, event: WatcherEvent): void {
        const relativePattern = new vscode.RelativePattern(
            vscode.Uri.file(path.dirname(globPattern)),
            path.basename(globPattern)
        );
        const watcher = vscode.workspace.createFileSystemWatcher(relativePattern);

        const handler = () => this.debounceEmit(event);
        watcher.onDidChange(handler);
        watcher.onDidCreate(handler);
        watcher.onDidDelete(handler);
        this.watchers.push(watcher);
    }

    private debounceEmit(event: WatcherEvent): void {
        if (!configuration.autoRefresh) { return; }

        const existing = this.debounceTimers.get(event);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.debounceTimers.delete(event);
            log(`GitWatcher: ${event} changed`);
            for (const cb of this.callbacks) {
                cb(event);
            }
        }, configuration.autoRefreshDebounce);

        this.debounceTimers.set(event, timer);
    }

    dispose(): void {
        for (const watcher of this.watchers) {
            watcher.dispose();
        }
        this.watchers = [];
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();
        this.callbacks = [];
        log('GitWatcher disposed');
    }
}
