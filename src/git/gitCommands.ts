import * as vscode from 'vscode';
import { GitService, GitResult } from './gitService';
import { configuration } from '../common/configuration';
import { logError } from '../common/outputChannel';
import {
    CommitDetails, ChangedFile, FileStatus, BranchInfo,
    TagInfo, StashEntry, RepoStatus, GraphViewOptions, FilterOptions
} from '../common/types';
import { sanitizeGitPattern } from '../common/validation';

/** Custom log format: NUL-delimited fields, record separator between records */
const LOG_FORMAT = '%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%d%x1e';

export class GitCommands {
    constructor(private git: GitService) {}

    // --- Log & Graph ---

    async getLogRaw(options: {
        skip?: number;
        count?: number;
        viewOptions?: GraphViewOptions;
        filter?: FilterOptions;
    } = {}): Promise<Buffer> {
        const args = ['log', `--format=${LOG_FORMAT}`, '--topo-order', '--parents', '--decorate=full'];

        const view = options.viewOptions;
        if (!view || view.allBranches) {
            args.push('--all');
        }

        if (options.filter?.pattern) {
            const safePattern = sanitizeGitPattern(options.filter.pattern);
            switch (options.filter.field) {
                case 'message': args.push(`--grep=${safePattern}`); break;
                case 'author': args.push(`--author=${safePattern}`); break;
                case 'committer': args.push(`--committer=${safePattern}`); break;
            }
        }
        if (options.filter?.after) {
            args.push(`--after=${options.filter.after}`);
        }
        if (options.filter?.before) {
            args.push(`--before=${options.filter.before}`);
        }

        if (options.skip) {
            args.push(`--skip=${options.skip}`);
        }
        args.push(`-n`, `${options.count || configuration.graphPageSize}`);

        const result = await this.git.exec(args);
        if (result.exitCode !== 0) {
            throw new Error(`git log failed: ${result.stderr}`);
        }
        return Buffer.from(result.stdout, 'utf8');
    }

    async getTotalCommitCount(allBranches: boolean): Promise<number> {
        const args = ['rev-list', '--count'];
        if (allBranches) {
            args.push('--all');
        } else {
            args.push('HEAD');
        }
        const result = await this.git.exec(args);
        if (result.exitCode !== 0) {
            return 0;
        }
        return parseInt(result.stdout.trim(), 10) || 0;
    }

    // --- Commit Details ---

    async getCommitDetails(sha: string): Promise<CommitDetails> {
        const format = '%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%b%x00%d';
        const result = await this.git.exec(['show', '--format=' + format, '--stat', '--stat-width=200', '-z', sha]);
        if (result.exitCode !== 0) {
            throw new Error(`git show failed: ${result.stderr}`);
        }

        const parts = result.stdout.split('\x00');
        const changedFiles = await this.getChangedFiles(sha);

        return {
            sha: parts[0],
            shortSha: parts[1],
            parents: parts[2] ? parts[2].split(' ') : [],
            authorName: parts[3],
            authorEmail: parts[4],
            authorDate: parseInt(parts[5], 10),
            committerName: parts[6],
            committerEmail: parts[7],
            commitDate: parseInt(parts[8], 10),
            subject: parts[9],
            body: parts[10] || '',
            refs: [], // Parsed from decorate string
            changedFiles,
        };
    }

    async getChangedFiles(sha: string): Promise<ChangedFile[]> {
        // Two parallel queries instead of N+1 per-file status lookups
        const [statusResult, numstatResult] = await Promise.all([
            this.git.exec(['diff-tree', '--no-commit-id', '-r', '--name-status', '-z', sha]),
            this.git.exec(['diff-tree', '--no-commit-id', '-r', '--numstat', '-z', sha]),
        ]);

        // Build status map from --name-status -z output
        // Format: STATUS\0path\0 (or for renames: R###\0oldpath\0newpath\0)
        const statusMap = new Map<string, { status: FileStatus; oldPath?: string }>();
        if (statusResult.exitCode === 0) {
            const parts = statusResult.stdout.split('\0');
            let si = 0;
            while (si < parts.length) {
                const statusStr = parts[si];
                if (!statusStr) { si++; continue; }
                const code = statusStr.charAt(0) as FileStatus;
                if ('MADRCT'.includes(code)) {
                    if (code === 'R' || code === 'C') {
                        // Rename/Copy: next two entries are old and new paths
                        const oldPath = parts[si + 1] || '';
                        const newPath = parts[si + 2] || '';
                        statusMap.set(newPath, { status: code, oldPath });
                        si += 3;
                    } else {
                        const filePath = parts[si + 1] || '';
                        statusMap.set(filePath, { status: code });
                        si += 2;
                    }
                } else {
                    si++;
                }
            }
        }

        // Parse --numstat -z output and join with status map
        if (numstatResult.exitCode !== 0) {
            return [];
        }

        const files: ChangedFile[] = [];
        const entries = numstatResult.stdout.split('\0').filter(s => s.length > 0);
        let i = 0;
        while (i < entries.length) {
            const line = entries[i];
            const match = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/);
            if (match) {
                const insertions = match[1] === '-' ? 0 : parseInt(match[1], 10);
                const deletions = match[2] === '-' ? 0 : parseInt(match[2], 10);
                const path = match[3];

                if (path === '') {
                    // Rename: next two entries are old and new paths
                    i++;
                    const oldPath = entries[i] || '';
                    i++;
                    const newPath = entries[i] || '';
                    const info = statusMap.get(newPath);
                    files.push({ path: newPath, oldPath, status: info?.status || 'R', insertions, deletions });
                } else {
                    const info = statusMap.get(path);
                    files.push({ path, status: info?.status || 'M', insertions, deletions });
                }
            }
            i++;
        }
        return files;
    }

    async getFileAtCommit(sha: string, filePath: string): Promise<string> {
        const result = await this.git.exec(['show', `${sha}:${filePath}`]);
        if (result.exitCode !== 0) {
            throw new Error(`git show failed: ${result.stderr}`);
        }
        return result.stdout;
    }

    // --- Diff ---

    async getDiffBetweenCommits(sha1: string, sha2: string): Promise<ChangedFile[]> {
        const result = await this.git.exec(['diff', '--numstat', '-z', sha1, sha2]);
        if (result.exitCode !== 0) {
            return [];
        }
        return this.parseNumstat(result.stdout);
    }

    async getDiffWithWorkingTree(sha: string): Promise<ChangedFile[]> {
        const result = await this.git.exec(['diff', '--numstat', '-z', sha]);
        if (result.exitCode !== 0) {
            return [];
        }
        return this.parseNumstat(result.stdout);
    }

    private parseNumstat(output: string): ChangedFile[] {
        const files: ChangedFile[] = [];
        const entries = output.split('\0').filter(s => s.length > 0);
        for (const entry of entries) {
            const match = entry.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
            if (match) {
                files.push({
                    path: match[3],
                    status: 'M',
                    insertions: match[1] === '-' ? 0 : parseInt(match[1], 10),
                    deletions: match[2] === '-' ? 0 : parseInt(match[2], 10),
                });
            }
        }
        return files;
    }

    // --- Staged / Unstaged / Untracked ---

    async getStagedFiles(): Promise<ChangedFile[]> {
        const result = await this.git.exec(['diff', '--cached', '--name-status', '-z']);
        if (result.exitCode !== 0) { return []; }
        return this.parseNameStatus(result.stdout);
    }

    async getUnstagedFiles(): Promise<ChangedFile[]> {
        const result = await this.git.exec(['diff', '--name-status', '-z']);
        if (result.exitCode !== 0) { return []; }
        return this.parseNameStatus(result.stdout);
    }

    async getUntrackedFiles(): Promise<string[]> {
        const result = await this.git.exec(['ls-files', '--others', '--exclude-standard']);
        if (result.exitCode !== 0) { return []; }
        return result.stdout.trim().split('\n').filter(l => l.length > 0);
    }

    private parseNameStatus(output: string): ChangedFile[] {
        const files: ChangedFile[] = [];
        const parts = output.split('\0');
        let i = 0;
        while (i < parts.length) {
            const statusStr = parts[i];
            if (!statusStr) { i++; continue; }
            const code = statusStr.charAt(0) as FileStatus;
            if ('MADRCT'.includes(code)) {
                if (code === 'R' || code === 'C') {
                    const oldPath = parts[i + 1] || '';
                    const newPath = parts[i + 2] || '';
                    files.push({ path: newPath, oldPath, status: code, insertions: 0, deletions: 0 });
                    i += 3;
                } else {
                    const filePath = parts[i + 1] || '';
                    files.push({ path: filePath, status: code, insertions: 0, deletions: 0 });
                    i += 2;
                }
            } else {
                i++;
            }
        }
        return files;
    }

    async getDiffBetweenIndexAndCommit(sha: string): Promise<ChangedFile[]> {
        const result = await this.git.exec(['diff', '--cached', '--numstat', '-z', sha]);
        if (result.exitCode !== 0) { return []; }
        return this.parseNumstat(result.stdout);
    }

    async getDiffBetweenIndexAndWorkingTree(): Promise<ChangedFile[]> {
        const result = await this.git.exec(['diff', '--numstat', '-z']);
        if (result.exitCode !== 0) { return []; }
        return this.parseNumstat(result.stdout);
    }

    // --- Blame ---

    async getBlameRaw(filePath: string): Promise<Buffer> {
        const args = ['blame', '--incremental'];
        if (configuration.blameIgnoreWhitespace) {
            args.push('-w');
        }
        if (configuration.blameIgnoreRevs) {
            // Check if ignore-revs file exists
            const ignoreRevsResult = await this.git.exec(['rev-parse', '--show-toplevel']);
            if (ignoreRevsResult.exitCode === 0) {
                const repoRoot = ignoreRevsResult.stdout.trim();
                try {
                    const fs = await import('fs');
                    const ignoreRevsPath = `${repoRoot}/.git-blame-ignore-revs`;
                    if (fs.existsSync(ignoreRevsPath)) {
                        args.push('--ignore-revs-file', ignoreRevsPath);
                    }
                } catch {
                    // ignore
                }
            }
        }
        args.push('--', filePath);
        const result = await this.git.exec(args);
        if (result.exitCode !== 0) {
            throw new Error(`git blame failed: ${result.stderr}`);
        }
        return Buffer.from(result.stdout, 'utf8');
    }

    streamBlame(filePath: string, onData: (data: Buffer) => void, onClose: (code: number) => void): void {
        const args = ['blame', '--incremental'];
        if (configuration.blameIgnoreWhitespace) {
            args.push('-w');
        }
        args.push('--', filePath);
        this.git.execStream({
            args,
            cwd: this.git.getRepoRoot(),
            onData,
            onClose,
        });
    }

    // --- Branches ---

    async getBranches(): Promise<BranchInfo[]> {
        const result = await this.git.exec([
            'for-each-ref', '--format=%(refname:short)%00%(objectname:short)%00%(HEAD)%00%(upstream:short)',
            'refs/heads/', 'refs/remotes/'
        ]);
        if (result.exitCode !== 0) {
            return [];
        }
        return result.stdout.trim().split('\n').filter(l => l).map(line => {
            const [name, sha, head, upstream] = line.split('\x00');
            return {
                name,
                sha,
                isRemote: name.includes('/'),
                isCurrent: head === '*',
                upstream: upstream || undefined,
            };
        });
    }

    async getCurrentBranch(): Promise<string> {
        const result = await this.git.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
        return result.exitCode === 0 ? result.stdout.trim() : '';
    }

    // --- Tags ---

    async getTags(): Promise<TagInfo[]> {
        const result = await this.git.exec([
            'for-each-ref', '--format=%(refname:short)%00%(objectname:short)%00%(*objectname:short)%00%(contents:subject)',
            'refs/tags/'
        ]);
        if (result.exitCode !== 0) {
            return [];
        }
        return result.stdout.trim().split('\n').filter(l => l).map(line => {
            const [name, sha, deref, message] = line.split('\x00');
            return {
                name,
                sha: deref || sha,
                isAnnotated: !!deref,
                message: message || undefined,
            };
        });
    }

    // --- Stashes ---

    async getStashes(): Promise<StashEntry[]> {
        const result = await this.git.exec(['stash', 'list', '--format=%H%x00%gd%x00%gs%x00%at']);
        if (result.exitCode !== 0) {
            return [];
        }
        return result.stdout.trim().split('\n').filter(l => l).map(line => {
            const [sha, ref, message, date] = line.split('\x00');
            const indexMatch = ref.match(/\{(\d+)\}/);
            return {
                index: indexMatch ? parseInt(indexMatch[1], 10) : 0,
                sha,
                message,
                date: parseInt(date, 10),
            };
        });
    }

    // --- Repo Status ---

    async getRepoStatus(): Promise<RepoStatus> {
        const headResult = await this.git.exec(['rev-parse', 'HEAD']);
        const branchResult = await this.git.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
        const dirtyResult = await this.git.exec(['status', '--porcelain']);
        const mergeResult = await this.git.exec(['rev-parse', '--verify', 'MERGE_HEAD']);
        const rebaseResult = await this.git.exec(['rev-parse', '--verify', 'REBASE_HEAD']);

        return {
            hasRepo: headResult.exitCode === 0,
            repoRoot: this.git.getRepoRoot(),
            head: headResult.exitCode === 0 ? headResult.stdout.trim() : '',
            branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() : '',
            isDirty: dirtyResult.stdout.trim().length > 0,
            isMerging: mergeResult.exitCode === 0,
            isRebasing: rebaseResult.exitCode === 0,
        };
    }

    // --- Git Operations ---

    async checkout(ref: string): Promise<GitResult> {
        return this.git.exec(['checkout', ref]);
    }

    async createBranch(name: string, startPoint?: string): Promise<GitResult> {
        const args = ['branch', name];
        if (startPoint) { args.push(startPoint); }
        return this.git.exec(args);
    }

    async createTag(name: string, sha: string, message?: string): Promise<GitResult> {
        if (message) {
            return this.git.exec(['tag', '-a', name, sha, '-m', message]);
        }
        return this.git.exec(['tag', name, sha]);
    }

    async merge(ref: string): Promise<GitResult> {
        const args = ['merge'];
        if (configuration.mergeNoFf) {
            args.push('--no-ff');
        }
        args.push(ref);
        return this.git.exec(args);
    }

    async rebase(ref: string): Promise<GitResult> {
        const args = ['rebase'];
        if (configuration.autoStashOnRebase) {
            args.push('--autostash');
        }
        args.push(ref);
        return this.git.exec(args);
    }

    async cherryPick(shas: string[]): Promise<GitResult> {
        return this.git.exec(['cherry-pick', ...shas]);
    }

    async resetSoft(sha: string): Promise<GitResult> {
        return this.git.exec(['reset', '--soft', sha]);
    }

    async resetMixed(sha: string): Promise<GitResult> {
        return this.git.exec(['reset', '--mixed', sha]);
    }

    async resetHard(sha: string): Promise<GitResult> {
        return this.git.exec(['reset', '--hard', sha]);
    }

    async revert(sha: string): Promise<GitResult> {
        return this.git.exec(['revert', sha]);
    }

    async stashPush(message?: string): Promise<GitResult> {
        const args = ['stash', 'push'];
        if (message) { args.push('-m', message); }
        return this.git.exec(args);
    }

    async stashPop(index: number): Promise<GitResult> {
        return this.git.exec(['stash', 'pop', `stash@{${index}}`]);
    }

    async stashApply(index: number): Promise<GitResult> {
        return this.git.exec(['stash', 'apply', `stash@{${index}}`]);
    }

    async stashDrop(index: number): Promise<GitResult> {
        return this.git.exec(['stash', 'drop', `stash@{${index}}`]);
    }

    async revParse(ref: string): Promise<string | null> {
        const result = await this.git.exec(['rev-parse', '--verify', ref]);
        return result.exitCode === 0 ? result.stdout.trim() : null;
    }
}
