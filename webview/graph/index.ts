import '../styles/common.css';
import '../styles/graph.css';

import {
    ExtToWebviewMessage,
    WebviewToExtMessage,
    LayoutNode,
    Edge,
    GraphState,
} from './messageProtocol';
import { CanvasRenderer, DEFAULT_CONFIG, GraphConfig } from './canvasRenderer';
import { VirtualScroll } from './virtualScroll';
import { ColumnLayout } from './columnLayout';
import { InteractionHandler } from './interactionHandler';
import { FilterBar } from './filterBar';
import { TextOverlay } from './textOverlay';
import { onThemeChange } from './themeManager';
import { FileListPane } from './fileListPane';
import { SplitDivider } from './splitDivider';

// ─── VS Code API ────────────────────────────────────────────────────────────

interface VsCodeApi {
    postMessage(message: WebviewToExtMessage): void;
    getState(): GraphState | undefined;
    setState(state: GraphState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// ─── Graph Application ─────────────────────────────────────────────────────

class GraphApp {
    private vscode: VsCodeApi;

    // Data
    private nodes: LayoutNode[] = [];
    private edges: Edge[] = [];
    private totalCount: number = 0;
    private pageSize: number = 500;
    private loadedCount: number = 0;

    // Components
    private canvasRenderer: CanvasRenderer;
    private virtualScroll: VirtualScroll;
    private columnLayout: ColumnLayout;
    private interactionHandler: InteractionHandler;
    private filterBar: FilterBar;
    private textOverlay: TextOverlay;
    private fileListPane: FileListPane;
    private splitDivider: SplitDivider;

    // Config
    private config: GraphConfig;

    // DOM elements
    private canvas: HTMLCanvasElement;
    private scrollContainer: HTMLElement;
    private graphPane: HTMLElement;

    // Render scheduling
    private renderScheduled: boolean = false;

    constructor() {
        this.vscode = acquireVsCodeApi();
        this.config = { ...DEFAULT_CONFIG };

        // ── Grab DOM elements ──
        this.canvas = document.getElementById('graph-canvas') as HTMLCanvasElement;
        this.scrollContainer = document.getElementById('scroll-container') as HTMLElement;
        this.graphPane = document.getElementById('graph-pane') as HTMLElement;
        const spacer = document.getElementById('scroll-spacer') as HTMLElement;
        const columnHeaders = document.getElementById('column-headers') as HTMLElement;
        const filterContainer = document.getElementById('filter-container') as HTMLElement;
        const textOverlayEl = document.getElementById('text-overlay') as HTMLElement;
        const splitDividerEl = document.getElementById('split-divider') as HTMLElement;
        const fileListPaneEl = document.getElementById('file-list-pane') as HTMLElement;

        // ── Initialize components ──

        this.canvasRenderer = new CanvasRenderer(this.canvas);

        this.virtualScroll = new VirtualScroll(
            this.scrollContainer,
            spacer,
            this.canvas,
            this.config.rowHeight,
        );

        this.columnLayout = new ColumnLayout();
        this.columnLayout.render(columnHeaders);

        this.textOverlay = new TextOverlay(textOverlayEl, this.columnLayout);

        this.interactionHandler = new InteractionHandler(
            this.canvas,
            this.canvasRenderer,
            this.config,
            {
                onCommitClick: (sha, ctrlKey, shiftKey) => {
                    this.postMessage({
                        type: 'commitClick',
                        sha,
                        ctrlKey,
                        shiftKey,
                        selectedShas: Array.from(this.interactionHandler.getSelectedShas()),
                    });
                    this.saveState();
                },
                onCommitDblClick: (sha) => {
                    this.postMessage({ type: 'commitDblClick', sha });
                },
                onContextMenu: (sha, x, y) => {
                    this.postMessage({ type: 'contextMenu', sha, x, y });
                },
                onSelectionChanged: (selectedShas, _primarySha) => {
                    // When selection is cleared, notify extension
                    if (selectedShas.size === 0) {
                        this.postMessage({ type: 'selectionCleared' });
                    }
                },
                onRequestRender: () => {
                    this.scheduleRender();
                },
            },
        );

        this.filterBar = new FilterBar(filterContainer);

        // ── File list pane ──
        this.fileListPane = new FileListPane(fileListPaneEl, (path, leftSha, rightSha) => {
            this.postMessage({ type: 'fileClick', path, leftSha, rightSha });
        });

        // ── Split divider ──
        this.splitDivider = new SplitDivider(splitDividerEl, this.graphPane, fileListPaneEl, (topHeight) => {
            this.handleResize();
            this.saveState();
        });

        // ── Wire up events ──
        this.setupScrollEvents();
        this.setupFilterEvents();
        this.setupColumnEvents();
        this.setupResizeObserver();
        this.setupThemeObserver();
        this.setupMessageListener();

        // ── Restore state ──
        this.restoreState();

        // ── Initial sizing ──
        this.handleResize();

        // ── Signal ready ──
        this.postMessage({ type: 'ready' });
    }

    // ── Message Handling ────────────────────────────────────────────────

    private setupMessageListener(): void {
        window.addEventListener('message', (event: MessageEvent<ExtToWebviewMessage>) => {
            const msg = event.data;
            switch (msg.type) {
                case 'layoutData':
                    this.handleLayoutData(msg.data.nodes, msg.data.edges, msg.data.totalCount, msg.append);
                    break;

                case 'updateTotalCount':
                    this.totalCount = msg.count;
                    this.virtualScroll.setTotalCount(msg.count);
                    break;

                case 'themeChanged':
                    this.scheduleRender();
                    break;

                case 'setSelection':
                    this.interactionHandler.selectSha(msg.sha);
                    // Scroll to the selected node
                    const node = this.nodes.find((n) => n.sha === msg.sha);
                    if (node) {
                        this.virtualScroll.scrollToRow(node.row);
                    }
                    break;

                case 'filterResult':
                    this.handleFilterResult(msg.nodes, msg.edges);
                    break;

                case 'stateRestore':
                    this.applyState(msg.state);
                    break;

                case 'fileListData':
                    this.fileListPane.setFiles(
                        msg.files,
                        msg.leftRef,
                        msg.rightRef,
                        msg.leftSha,
                        msg.rightSha,
                    );
                    break;

                case 'fileListClear':
                    this.fileListPane.clear();
                    break;
            }
        });
    }

    private postMessage(msg: WebviewToExtMessage): void {
        this.vscode.postMessage(msg);
    }

    // ── Layout Data ─────────────────────────────────────────────────────

    private handleLayoutData(
        nodes: LayoutNode[],
        edges: Edge[],
        totalCount: number,
        append: boolean,
    ): void {
        if (append) {
            this.nodes = this.nodes.concat(nodes);
            this.edges = this.edges.concat(edges);
        } else {
            this.nodes = nodes;
            this.edges = edges;
            this.textOverlay.clear();
        }

        this.totalCount = totalCount;
        this.loadedCount = this.nodes.length;

        // Auto-size graph column to fit lanes
        this.autoSizeGraphColumn();

        this.virtualScroll.setTotalCount(totalCount);
        this.virtualScroll.setLoadedRange(0, this.loadedCount);
        this.interactionHandler.setNodes(this.nodes);

        this.scheduleRender();
    }

    private autoSizeGraphColumn(): void {
        let maxLane = 0;
        for (const node of this.nodes) {
            if (node.lane > maxLane) { maxLane = node.lane; }
        }
        const autoWidth = Math.max(80, (maxLane + 2) * this.config.laneWidth + 16);
        if (autoWidth !== this.config.graphWidth) {
            this.config.graphWidth = autoWidth;
            this.columnLayout.setColumnWidth('graph', autoWidth);
            this.interactionHandler.setConfig(this.config);
            this.handleResize();
        }
    }

    private handleFilterResult(nodes: LayoutNode[], edges: Edge[]): void {
        this.nodes = nodes;
        this.edges = edges;
        this.interactionHandler.setNodes(this.nodes);
        this.scheduleRender();
    }

    // ── Scroll Events ───────────────────────────────────────────────────

    private setupScrollEvents(): void {
        this.virtualScroll.onScroll((event) => {
            this.interactionHandler.setScrollTop(event.scrollTop);
            this.scheduleRender();
        });

        this.virtualScroll.onNeedMoreData((_direction, anchorRow) => {
            this.postMessage({
                type: 'requestPage',
                skip: anchorRow,
                count: this.pageSize,
            });
        });
    }

    // ── Filter Events ───────────────────────────────────────────────────

    private setupFilterEvents(): void {
        this.filterBar.onFilterChange((field, pattern) => {
            this.postMessage({ type: 'filterChange', field, pattern });
            this.saveState();
        });

        this.filterBar.onDateFilterChange((after, before) => {
            this.postMessage({ type: 'dateFilterChange', after, before });
        });
    }

    // ── Column Events ───────────────────────────────────────────────────

    private setupColumnEvents(): void {
        this.columnLayout.onResize((columns) => {
            // Update graph width from the graph column
            const graphCol = columns.find((c) => c.id === 'graph');
            if (graphCol) {
                this.config.graphWidth = graphCol.width;
                this.interactionHandler.setConfig(this.config);
            }
            this.scheduleRender();
        });
    }

    // ── Resize Handling ─────────────────────────────────────────────────

    private setupResizeObserver(): void {
        const observer = new ResizeObserver(() => {
            this.handleResize();
        });
        observer.observe(this.scrollContainer);
    }

    private handleResize(): void {
        const width = this.scrollContainer.clientWidth;
        const height = this.scrollContainer.clientHeight;
        this.canvasRenderer.resize(width, height);
        this.scheduleRender();
    }

    // ── Theme ───────────────────────────────────────────────────────────

    private setupThemeObserver(): void {
        onThemeChange(() => {
            this.scheduleRender();
        });
    }

    // ── Rendering ───────────────────────────────────────────────────────

    private scheduleRender(): void {
        if (this.renderScheduled) { return; }
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.renderScheduled = false;
            this.doRender();
        });
    }

    private doRender(): void {
        const scrollTop = this.virtualScroll.getScrollTop();
        const viewportHeight = this.virtualScroll.getViewportHeight();

        this.canvasRenderer.render(
            this.nodes,
            this.edges,
            scrollTop,
            viewportHeight,
            this.config,
            this.interactionHandler.getSelectedShas(),
            this.interactionHandler.getPrimarySha(),
        );

        this.textOverlay.render(
            this.nodes,
            scrollTop,
            viewportHeight,
            this.config,
        );
    }

    // ── State Persistence ───────────────────────────────────────────────

    private saveState(): void {
        const filter = this.filterBar.getFilter();
        const graphPaneHeight = this.graphPane.getBoundingClientRect().height;
        const state: GraphState = {
            scrollTop: this.virtualScroll.getScrollTop(),
            selectedSha: this.interactionHandler.getPrimarySha(),
            filterField: filter.field,
            filterPattern: filter.pattern,
            splitPosition: graphPaneHeight > 0 ? graphPaneHeight : undefined,
        };
        this.vscode.setState(state);
        this.postMessage({ type: 'saveState', state });
    }

    private restoreState(): void {
        const state = this.vscode.getState();
        if (state) {
            this.applyState(state);
        }
    }

    private applyState(state: GraphState): void {
        if (state.scrollTop > 0) {
            this.virtualScroll.setScrollTop(state.scrollTop);
        }
        if (state.selectedSha) {
            this.interactionHandler.selectSha(state.selectedSha);
        }
        if (state.splitPosition && state.splitPosition > 0) {
            this.graphPane.style.height = `${state.splitPosition}px`;
            this.graphPane.style.flex = 'none';
        }
        // Filter state is applied after data arrives; store for later
    }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    new GraphApp();
});
