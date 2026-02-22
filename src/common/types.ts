// Shared type definitions for GitEx extension

export interface CommitNode {
    sha: string;
    shortSha: string;
    parents: string[];
    children: string[];
    authorName: string;
    authorEmail: string;
    authorDate: number; // epoch seconds
    committerName: string;
    committerEmail: string;
    commitDate: number;
    subject: string;
    refs: RefInfo[];
}

export interface RefInfo {
    name: string;
    refType: RefType;
    isHead: boolean;
}

export type RefType = 'Branch' | 'RemoteBranch' | 'Tag' | 'Head' | 'Stash';

export type NodeType = 'Normal' | 'Head' | 'Stash' | 'WorkingTree' | 'CommitIndex';

export const WORKING_DIR_SHA = '0000000000000000000000000000000000000001';
export const COMMIT_INDEX_SHA = '0000000000000000000000000000000000000002';

export function isVirtualSha(sha: string): boolean {
    return sha === WORKING_DIR_SHA || sha === COMMIT_INDEX_SHA;
}

export interface LayoutNode {
    sha: string;
    shortSha: string;
    lane: number;
    row: number;
    colorIndex: number;
    subject: string;
    authorName: string;
    authorDate: number;
    refs: RefInfo[];
    parents: string[];
    nodeType: NodeType;
}

export interface Edge {
    fromSha: string;
    toSha: string;
    fromLane: number;
    toLane: number;
    fromRow: number;
    toRow: number;
    edgeType: 'Normal' | 'Merge';
    colorIndex: number;
}

export interface LayoutResult {
    nodes: LayoutNode[];
    edges: Edge[];
    totalCount: number;
}

export interface BlameEntry {
    sha: string;
    shortSha: string;
    origLine: number;
    finalLine: number;
    numLines: number;
    authorName: string;
    authorEmail: string;
    authorDate: number;
    committerName: string;
    committerEmail: string;
    committerDate: number;
    summary: string;
    filename: string;
}

export interface CommitDetails {
    sha: string;
    shortSha: string;
    parents: string[];
    authorName: string;
    authorEmail: string;
    authorDate: number;
    committerName: string;
    committerEmail: string;
    commitDate: number;
    subject: string;
    body: string;
    refs: RefInfo[];
    changedFiles: ChangedFile[];
}

export interface ChangedFile {
    path: string;
    oldPath?: string; // for renames
    status: FileStatus;
    insertions: number;
    deletions: number;
}

export type FileStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U';

export interface GraphViewOptions {
    allBranches: boolean;
    showRemoteBranches: boolean;
    showTags: boolean;
    showStashes: boolean;
}

export interface FilterOptions {
    field?: 'message' | 'author' | 'committer' | 'sha';
    pattern?: string;
    after?: number;
    before?: number;
}

export interface StashEntry {
    index: number;
    sha: string;
    message: string;
    date: number;
}

export interface BranchInfo {
    name: string;
    sha: string;
    isRemote: boolean;
    isCurrent: boolean;
    upstream?: string;
}

export interface TagInfo {
    name: string;
    sha: string;
    isAnnotated: boolean;
    message?: string;
}

export interface RepoStatus {
    hasRepo: boolean;
    repoRoot: string;
    head: string;
    branch: string;
    isDirty: boolean;
    isMerging: boolean;
    isRebasing: boolean;
}

// --- Webview Message Types ---

export type WebviewIncomingMessage =
    | { type: 'ready' }
    | { type: 'requestPage'; skip: number; count: number }
    | { type: 'commitClick'; sha: string; selectedShas?: string[] }
    | { type: 'commitDblClick'; sha: string }
    | { type: 'contextMenu'; sha: string }
    | { type: 'filterChange'; field: FilterOptions['field']; pattern: string }
    | { type: 'dateFilterChange'; after: number; before: number }
    | { type: 'saveState'; state: unknown };

export type WebviewOutgoingMessage =
    | { type: 'layoutData'; data: LayoutResult; append: boolean }
    | { type: 'updateTotalCount'; count: number }
    | { type: 'themeChanged' }
    | { type: 'setSelection'; sha: string };

export type CommitDetailIncomingMessage =
    | { type: 'openDiff'; sha: string; path: string }
    | { type: 'navigateToParent'; sha: string }
    | { type: 'openFile'; sha: string; path: string }
    | { type: 'copySha'; sha: string };

export type ComparisonIncomingMessage =
    | { type: 'openDiff'; path: string };
