import { GitCommands } from '../git/gitCommands';
import { configuration } from '../common/configuration';
import { computeGraphLayout, appendToLayout, freeLayout } from '../wasm/wasmBridge';
import {
    LayoutResult, LayoutNode, Edge, GraphViewOptions, FilterOptions,
    WORKING_DIR_SHA, COMMIT_INDEX_SHA,
} from '../common/types';
import { log, logError, logTiming } from '../common/outputChannel';

export class GraphDataProvider {
    private currentLayout: LayoutResult | null = null;
    private layoutHandle: number = 0;
    private totalCount: number = 0;
    private loadedPages: number = 0;
    private viewOptions: GraphViewOptions;

    constructor(private gitCommands: GitCommands) {
        this.viewOptions = {
            allBranches: configuration.graphDefaultView === 'allBranches',
            showRemoteBranches: configuration.graphShowRemoteBranches,
            showTags: configuration.graphShowTags,
            showStashes: configuration.graphShowStashes,
        };
    }

    getViewOptions(): GraphViewOptions {
        return { ...this.viewOptions };
    }

    setViewOptions(options: Partial<GraphViewOptions>): void {
        this.viewOptions = { ...this.viewOptions, ...options };
    }

    async loadInitialData(filter?: FilterOptions): Promise<LayoutResult> {
        const startMs = Date.now();

        // Get total count (required) and repo status (best-effort) in parallel
        const statusPromise = this.gitCommands.getRepoStatus().catch(err => {
            logError('Failed to get repo status for virtual nodes', err);
            return null;
        });
        const [totalCount, status] = await Promise.all([
            this.gitCommands.getTotalCommitCount(this.viewOptions.allBranches),
            statusPromise,
        ]);
        this.totalCount = totalCount;
        log(`Total commits: ${this.totalCount}`);

        // Fetch first page
        const rawLog = await this.gitCommands.getLogRaw({
            skip: 0,
            count: configuration.graphPageSize,
            viewOptions: this.viewOptions,
            filter,
        });

        // Compute layout
        if (this.layoutHandle > 0) {
            freeLayout(this.layoutHandle);
        }

        this.currentLayout = computeGraphLayout(rawLog);

        // Prepend virtual nodes (Working Directory + Commit Index) if repo has HEAD
        // This is best-effort: if it fails, we still show the real graph
        if (status?.head) {
            try {
                const virtualResult = await this.buildVirtualNodes(status.head);

                // Only shift rows AFTER virtual nodes are successfully built
                for (const node of this.currentLayout.nodes) {
                    node.row += 2;
                }
                for (const edge of this.currentLayout.edges) {
                    edge.fromRow += 2;
                    edge.toRow += 2;
                }

                // Fix edge target rows now that real nodes have been shifted
                const headNode = this.currentLayout.nodes.find(n => n.sha === status!.head);
                if (headNode) {
                    // Update the Index→HEAD edge to point to the shifted HEAD row
                    const indexToHeadEdge = virtualResult.edges.find(e => e.toSha === status!.head);
                    if (indexToHeadEdge) {
                        indexToHeadEdge.toRow = headNode.row;
                        indexToHeadEdge.toLane = headNode.lane;
                    }
                }

                this.currentLayout.nodes.unshift(...virtualResult.nodes);
                this.currentLayout.edges.unshift(...virtualResult.edges);
                this.totalCount += 2;
            } catch (err) {
                logError('Failed to build virtual nodes, showing graph without them', err);
            }
        }

        this.currentLayout.totalCount = this.totalCount;
        this.loadedPages = 1;

        logTiming('Initial graph data load', startMs);
        return this.currentLayout;
    }

    private async buildVirtualNodes(headSha: string): Promise<{ nodes: LayoutNode[]; edges: Edge[] }> {
        const [stagedFiles, unstagedFiles, untrackedFiles] = await Promise.all([
            this.gitCommands.getStagedFiles(),
            this.gitCommands.getUnstagedFiles(),
            this.gitCommands.getUntrackedFiles(),
        ]);

        const stagedCount = stagedFiles.length;
        const workingCount = unstagedFiles.length + untrackedFiles.length;
        const now = Math.floor(Date.now() / 1000);

        // Find HEAD node lane (before row shift — rows haven't been shifted yet)
        let headLane = 0;
        if (this.currentLayout) {
            const headNode = this.currentLayout.nodes.find(n => n.sha === headSha);
            if (headNode) { headLane = headNode.lane; }
        }

        const indexNode: LayoutNode = {
            sha: COMMIT_INDEX_SHA,
            shortSha: '',
            lane: headLane,
            row: 0,
            colorIndex: 0,
            subject: stagedCount > 0 ? `${stagedCount} staged change${stagedCount !== 1 ? 's' : ''}` : 'No staged changes',
            authorName: 'You',
            authorDate: now,
            refs: [],
            parents: [headSha],
            nodeType: 'CommitIndex',
        };

        const workingNode: LayoutNode = {
            sha: WORKING_DIR_SHA,
            shortSha: '',
            lane: headLane,
            row: 1,
            colorIndex: 0,
            subject: workingCount > 0 ? `${workingCount} working directory change${workingCount !== 1 ? 's' : ''}` : 'No working directory changes',
            authorName: 'You',
            authorDate: now,
            refs: [],
            parents: [COMMIT_INDEX_SHA],
            nodeType: 'WorkingTree',
        };

        // Edge target row for Index→HEAD will be fixed by caller after row shift
        const edges: Edge[] = [
            {
                fromSha: WORKING_DIR_SHA,
                toSha: COMMIT_INDEX_SHA,
                fromLane: headLane,
                toLane: headLane,
                fromRow: 1,
                toRow: 0,
                edgeType: 'Normal',
                colorIndex: 0,
            },
            {
                fromSha: COMMIT_INDEX_SHA,
                toSha: headSha,
                fromLane: headLane,
                toLane: headLane,
                fromRow: 0,
                toRow: 2, // placeholder — caller fixes after row shift
                edgeType: 'Normal',
                colorIndex: 0,
            },
        ];

        return { nodes: [indexNode, workingNode], edges };
    }

    async loadNextPage(filter?: FilterOptions): Promise<LayoutResult | null> {
        const skip = this.loadedPages * configuration.graphPageSize;
        if (skip >= this.totalCount) {
            return null; // All commits loaded
        }

        const startMs = Date.now();
        const rawLog = await this.gitCommands.getLogRaw({
            skip,
            count: configuration.graphPageSize,
            viewOptions: this.viewOptions,
            filter,
        });

        const appendResult = appendToLayout(this.layoutHandle, rawLog);
        if (this.currentLayout) {
            this.currentLayout.nodes.push(...appendResult.nodes);
            this.currentLayout.edges.push(...appendResult.edges);
        } else {
            this.currentLayout = appendResult;
        }
        this.currentLayout!.totalCount = this.totalCount;
        this.loadedPages++;

        logTiming(`Page ${this.loadedPages} load`, startMs);
        return this.currentLayout;
    }

    async loadPage(skip: number, count: number, filter?: FilterOptions): Promise<LayoutResult> {
        const rawLog = await this.gitCommands.getLogRaw({
            skip,
            count,
            viewOptions: this.viewOptions,
            filter,
        });
        return computeGraphLayout(rawLog);
    }

    getCurrentLayout(): LayoutResult | null {
        return this.currentLayout;
    }

    getTotalCount(): number {
        return this.totalCount;
    }

    getLoadedCount(): number {
        return this.currentLayout?.nodes.length ?? 0;
    }

    findNodeBySha(sha: string): LayoutNode | undefined {
        return this.currentLayout?.nodes.find(n => n.sha === sha || n.shortSha === sha);
    }

    reset(): void {
        if (this.layoutHandle > 0) {
            freeLayout(this.layoutHandle);
            this.layoutHandle = 0;
        }
        this.currentLayout = null;
        this.loadedPages = 0;
        this.totalCount = 0;
    }

    dispose(): void {
        this.reset();
    }
}
