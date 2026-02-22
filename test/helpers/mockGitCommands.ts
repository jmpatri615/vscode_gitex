/**
 * Mock GitCommands factory for testing GraphDataProvider, BlameService, GraphViewProvider.
 * Provides sensible defaults for all methods with per-test overrides.
 */

import { ChangedFile, BranchInfo, TagInfo, StashEntry, RepoStatus, CommitDetails } from '../../src/common/types';

export interface MockGitCommandsOverrides {
    getLogRaw?: (...args: any[]) => Promise<Buffer>;
    getTotalCommitCount?: (...args: any[]) => Promise<number>;
    getCommitDetails?: (...args: any[]) => Promise<CommitDetails>;
    getChangedFiles?: (...args: any[]) => Promise<ChangedFile[]>;
    getFileAtCommit?: (...args: any[]) => Promise<string>;
    getDiffBetweenCommits?: (...args: any[]) => Promise<ChangedFile[]>;
    getDiffWithWorkingTree?: (...args: any[]) => Promise<ChangedFile[]>;
    getStagedFiles?: (...args: any[]) => Promise<ChangedFile[]>;
    getUnstagedFiles?: (...args: any[]) => Promise<ChangedFile[]>;
    getUntrackedFiles?: (...args: any[]) => Promise<string[]>;
    getDiffBetweenIndexAndCommit?: (...args: any[]) => Promise<ChangedFile[]>;
    getDiffBetweenIndexAndWorkingTree?: (...args: any[]) => Promise<ChangedFile[]>;
    getBlameRaw?: (...args: any[]) => Promise<Buffer>;
    streamBlame?: (...args: any[]) => void;
    getBranches?: () => Promise<BranchInfo[]>;
    getTags?: () => Promise<TagInfo[]>;
    getStashes?: () => Promise<StashEntry[]>;
    getRepoStatus?: () => Promise<RepoStatus>;
    revParse?: (...args: any[]) => Promise<string | null>;
    getCurrentBranch?: () => Promise<string>;
}

const defaultRepoStatus: RepoStatus = {
    hasRepo: true,
    repoRoot: '/mock/repo',
    head: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
    branch: 'main',
    isDirty: false,
    isMerging: false,
    isRebasing: false,
};

export function createMockGitCommands(overrides: MockGitCommandsOverrides = {}) {
    const mock = {
        getLogRaw: overrides.getLogRaw || (async () => Buffer.from('')),
        getTotalCommitCount: overrides.getTotalCommitCount || (async () => 0),
        getCommitDetails: overrides.getCommitDetails || (async () => ({
            sha: '', shortSha: '', parents: [], authorName: '', authorEmail: '',
            authorDate: 0, committerName: '', committerEmail: '', commitDate: 0,
            subject: '', body: '', refs: [], changedFiles: [],
        })),
        getChangedFiles: overrides.getChangedFiles || (async () => []),
        getFileAtCommit: overrides.getFileAtCommit || (async () => ''),
        getDiffBetweenCommits: overrides.getDiffBetweenCommits || (async () => []),
        getDiffWithWorkingTree: overrides.getDiffWithWorkingTree || (async () => []),
        getStagedFiles: overrides.getStagedFiles || (async () => []),
        getUnstagedFiles: overrides.getUnstagedFiles || (async () => []),
        getUntrackedFiles: overrides.getUntrackedFiles || (async () => []),
        getDiffBetweenIndexAndCommit: overrides.getDiffBetweenIndexAndCommit || (async () => []),
        getDiffBetweenIndexAndWorkingTree: overrides.getDiffBetweenIndexAndWorkingTree || (async () => []),
        getBlameRaw: overrides.getBlameRaw || (async () => Buffer.from('')),
        streamBlame: overrides.streamBlame || (() => { /* noop */ }),
        getBranches: overrides.getBranches || (async () => []),
        getTags: overrides.getTags || (async () => []),
        getStashes: overrides.getStashes || (async () => []),
        getRepoStatus: overrides.getRepoStatus || (async () => ({ ...defaultRepoStatus })),
        revParse: overrides.revParse || (async () => null),
        getCurrentBranch: overrides.getCurrentBranch || (async () => 'main'),
        // Private git field accessed by GraphViewProvider via this.gitCommands['git']
        git: {
            getRepoRoot: () => '/mock/repo',
        },
    };
    return mock;
}
