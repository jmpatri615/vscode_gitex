// ─── Ref & Node Types ───────────────────────────────────────────────────────

/** The type of a git reference. Mirrors Rust RefType. */
export type RefType = 'Branch' | 'RemoteBranch' | 'Tag' | 'Head' | 'Stash';

/** A git reference decorating a commit. Mirrors Rust RefInfo. */
export interface RefInfo {
    name: string;
    refType: RefType;
    isHead: boolean;
}

/** The visual type of a graph node. Mirrors Rust NodeType. */
export type NodeType = 'Normal' | 'Head' | 'Stash' | 'WorkingTree' | 'CommitIndex';

export const WORKING_DIR_SHA = '0000000000000000000000000000000000000001';
export const COMMIT_INDEX_SHA = '0000000000000000000000000000000000000002';

export function isVirtualSha(sha: string): boolean {
    return sha === WORKING_DIR_SHA || sha === COMMIT_INDEX_SHA;
}

/** The visual type of an edge. Mirrors Rust EdgeType. */
export type EdgeType = 'Normal' | 'Merge';

// ─── Layout Structures ─────────────────────────────────────────────────────

/** A positioned commit node for rendering. Mirrors Rust LayoutNode. */
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

/** An edge connecting two commits. Mirrors Rust Edge. */
export interface Edge {
    fromSha: string;
    toSha: string;
    fromLane: number;
    toLane: number;
    fromRow: number;
    toRow: number;
    edgeType: EdgeType;
    colorIndex: number;
}

/** The complete layout result from the engine. Mirrors Rust LayoutResult. */
export interface LayoutResult {
    nodes: LayoutNode[];
    edges: Edge[];
    totalCount: number;
}

// ─── Webview State ──────────────────────────────────────────────────────────

/** Persisted graph state for save/restore across reloads. */
export interface GraphState {
    scrollTop: number;
    selectedSha: string | null;
    filterField: string | null;
    filterPattern: string | null;
}

// ─── Extension → Webview Messages ───────────────────────────────────────────

export interface LayoutDataMessage {
    type: 'layoutData';
    data: LayoutResult;
    append: boolean;
}

export interface UpdateTotalCountMessage {
    type: 'updateTotalCount';
    count: number;
}

export interface ThemeChangedMessage {
    type: 'themeChanged';
}

export interface SetSelectionMessage {
    type: 'setSelection';
    sha: string;
}

export interface FilterResultMessage {
    type: 'filterResult';
    nodes: LayoutNode[];
    edges: Edge[];
}

export interface StateRestoreMessage {
    type: 'stateRestore';
    state: GraphState;
}

export type ExtToWebviewMessage =
    | LayoutDataMessage
    | UpdateTotalCountMessage
    | ThemeChangedMessage
    | SetSelectionMessage
    | FilterResultMessage
    | StateRestoreMessage;

// ─── Webview → Extension Messages ───────────────────────────────────────────

export interface RequestPageMessage {
    type: 'requestPage';
    skip: number;
    count: number;
}

export interface CommitClickMessage {
    type: 'commitClick';
    sha: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    selectedShas: string[];
}

export interface CommitDblClickMessage {
    type: 'commitDblClick';
    sha: string;
}

export interface ContextMenuMessage {
    type: 'contextMenu';
    sha: string;
    x: number;
    y: number;
}

export interface FilterChangeMessage {
    type: 'filterChange';
    field: string;
    pattern: string;
}

export interface DateFilterChangeMessage {
    type: 'dateFilterChange';
    after: number;
    before: number;
}

export interface SaveStateMessage {
    type: 'saveState';
    state: GraphState;
}

export interface ReadyMessage {
    type: 'ready';
}

export type WebviewToExtMessage =
    | RequestPageMessage
    | CommitClickMessage
    | CommitDblClickMessage
    | ContextMenuMessage
    | FilterChangeMessage
    | DateFilterChangeMessage
    | SaveStateMessage
    | ReadyMessage;
