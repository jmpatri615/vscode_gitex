import { GitCommands } from '../git/gitCommands';
import { configuration } from '../common/configuration';
import { computeGraphLayout, appendToLayout, freeLayout } from '../wasm/wasmBridge';
import { LayoutResult, LayoutNode, Edge, GraphViewOptions, FilterOptions } from '../common/types';
import { log, logTiming } from '../common/outputChannel';

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

        // Get total count
        this.totalCount = await this.gitCommands.getTotalCommitCount(this.viewOptions.allBranches);
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
        this.currentLayout.totalCount = this.totalCount;
        this.loadedPages = 1;

        logTiming('Initial graph data load', startMs);
        return this.currentLayout;
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
