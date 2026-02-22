import { getWasm } from './wasmLoader';
import { parseLogOutput, parseBlameOutput } from '../git/gitParsers';
import { LayoutResult, BlameEntry, LayoutNode } from '../common/types';
import { log, logTiming } from '../common/outputChannel';

/**
 * Pure-TS fallback graph layout when WASM is unavailable.
 * Simple lane assignment: topological order, active lane tracking.
 */
function computeGraphLayoutTS(raw: Buffer): LayoutResult {
    const commits = parseLogOutput(raw.toString('utf8'));
    const nodes: LayoutNode[] = [];
    const edges: LayoutResult['edges'] = [];

    // Lane assignment
    const activeLanes: (string | null)[] = [];
    const shaToLane = new Map<string, number>();

    for (let row = 0; row < commits.length; row++) {
        const commit = commits[row];
        let lane = -1;

        // Check if a child already reserved a lane for this commit
        const reservedLane = shaToLane.get(commit.sha);
        if (reservedLane !== undefined) {
            lane = reservedLane;
        }

        // If no reserved lane, find first empty lane
        if (lane === -1) {
            lane = activeLanes.indexOf(null);
            if (lane === -1) {
                lane = activeLanes.length;
                activeLanes.push(null);
            }
        }

        // Occupy lane
        activeLanes[lane] = null; // Will be set to first parent below

        // Determine color index
        const branchRef = commit.refs.find(r => r.refType === 'Branch');
        const colorIndex = branchRef ? hashString(branchRef.name) % 12 : lane % 12;

        // Determine node type
        let nodeType: LayoutNode['nodeType'] = 'Normal';
        if (commit.refs.some(r => r.refType === 'Head')) { nodeType = 'Head'; }
        if (commit.refs.some(r => r.refType === 'Stash')) { nodeType = 'Stash'; }

        nodes.push({
            sha: commit.sha,
            shortSha: commit.shortSha,
            lane,
            row,
            colorIndex,
            subject: commit.subject,
            authorName: commit.authorName,
            authorDate: commit.authorDate,
            refs: commit.refs,
            parents: commit.parents,
            nodeType,
        });

        // Connect to parents: first parent continues this lane, others get new lanes
        for (let pi = 0; pi < commit.parents.length; pi++) {
            const parentSha = commit.parents[pi];
            let parentLane: number;

            const existingParentLane = shaToLane.get(parentSha);
            if (existingParentLane !== undefined) {
                // Parent already has a reserved lane
                parentLane = existingParentLane;
            } else if (pi === 0) {
                // First parent: continue on same lane
                parentLane = lane;
                activeLanes[lane] = parentSha;
                shaToLane.set(parentSha, lane);
            } else {
                // Additional parents: find a new lane
                parentLane = activeLanes.indexOf(null);
                if (parentLane === -1) {
                    parentLane = activeLanes.length;
                    activeLanes.push(null);
                }
                activeLanes[parentLane] = parentSha;
                shaToLane.set(parentSha, parentLane);
            }

            // Create edge with placeholder toRow (-1); resolved in second pass
            edges.push({
                fromSha: commit.sha,
                toSha: parentSha,
                fromLane: lane,
                toLane: parentLane,
                fromRow: row,
                toRow: -1,
                edgeType: pi > 0 ? 'Merge' : 'Normal',
                colorIndex,
            });
        }

        // Free lanes for commits with no parents continuing
        if (commit.parents.length === 0) {
            activeLanes[lane] = null;
        }
    }

    // Second pass: resolve toRow for all edges
    const shaToRow = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
        shaToRow.set(nodes[i].sha, i);
    }
    for (const edge of edges) {
        const resolvedRow = shaToRow.get(edge.toSha);
        if (resolvedRow !== undefined) {
            edge.toRow = resolvedRow;
            // Update color: for normal edges, use the parent node's color
            if (edge.edgeType === 'Normal') {
                edge.colorIndex = nodes[resolvedRow].colorIndex;
            }
        }
    }
    // Remove edges whose parent was not found (e.g., truncated history)
    const resolvedEdges = edges.filter(e => e.toRow >= 0);

    return { nodes, edges: resolvedEdges, totalCount: commits.length };
}

function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

/**
 * Compute graph layout — uses WASM if available, otherwise falls back to TS.
 */
export function computeGraphLayout(rawLog: Buffer): LayoutResult {
    const startMs = Date.now();
    const wasm = getWasm();

    if (wasm) {
        try {
            const result = wasm.compute_graph_layout(new Uint8Array(rawLog));
            logTiming('WASM compute_graph_layout', startMs);
            return JSON.parse(result);
        } catch (error) {
            log(`WASM layout failed, falling back to TS: ${error}`);
        }
    }

    const result = computeGraphLayoutTS(rawLog);
    logTiming('TS compute_graph_layout', startMs);
    return result;
}

/**
 * Append additional commits to an existing layout.
 */
export function appendToLayout(handle: number, rawLog: Buffer): LayoutResult {
    const wasm = getWasm();
    if (wasm) {
        try {
            const result = wasm.append_to_layout(handle, new Uint8Array(rawLog));
            return JSON.parse(result);
        } catch (error) {
            log(`WASM append failed, falling back: ${error}`);
        }
    }
    // For TS fallback, just recompute
    return computeGraphLayoutTS(rawLog);
}

/**
 * Free a layout handle in WASM.
 */
export function freeLayout(handle: number): void {
    const wasm = getWasm();
    if (wasm) {
        try { wasm.free_layout(handle); } catch (error) { log(`WASM free_layout failed: ${error}`); }
    }
}

/**
 * Parse git blame output — uses WASM if available.
 */
export function parseBlame(rawBlame: Buffer): BlameEntry[] {
    const startMs = Date.now();
    const wasm = getWasm();

    if (wasm) {
        try {
            const result = wasm.parse_blame(new Uint8Array(rawBlame));
            logTiming('WASM parse_blame', startMs);
            return JSON.parse(result);
        } catch (error) {
            log(`WASM blame parse failed, falling back to TS: ${error}`);
        }
    }

    const result = parseBlameOutput(rawBlame.toString('utf8'));
    logTiming('TS parse_blame', startMs);
    return result;
}

/**
 * Filter commits by field and pattern — uses WASM if available.
 */
export function filterCommits(handle: number, field: string, pattern: string): LayoutNode[] {
    const wasm = getWasm();
    if (wasm) {
        try {
            return JSON.parse(wasm.filter_commits(handle, field, pattern));
        } catch (error) { log(`WASM filter_commits failed: ${error}`); }
    }
    return []; // Client-side filtering handled in webview for TS fallback
}

/**
 * Filter commits by date range.
 */
export function filterByDate(handle: number, after: number, before: number): LayoutNode[] {
    const wasm = getWasm();
    if (wasm) {
        try {
            return JSON.parse(wasm.filter_by_date(handle, after, before));
        } catch (error) { log(`WASM filter_by_date failed: ${error}`); }
    }
    return [];
}
