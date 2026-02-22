import { LayoutNode } from './messageProtocol';
import { CanvasRenderer, GraphConfig } from './canvasRenderer';

// ─── Callback Types ─────────────────────────────────────────────────────────

export interface InteractionCallbacks {
    onCommitClick: (sha: string, ctrlKey: boolean, shiftKey: boolean) => void;
    onCommitDblClick: (sha: string) => void;
    onContextMenu: (sha: string, x: number, y: number) => void;
    onSelectionChanged: (selectedShas: Set<string>, primarySha: string | null) => void;
    onRequestRender: () => void;
}

// ─── Interaction Handler ────────────────────────────────────────────────────

/**
 * Handles user interactions (mouse, keyboard) on the graph canvas and
 * translates them into selection changes and event callbacks.
 */
export class InteractionHandler {
    private canvas: HTMLCanvasElement;
    private renderer: CanvasRenderer;
    private callbacks: InteractionCallbacks;

    // Selection state
    private selectedShas: Set<string> = new Set();
    private primarySha: string | null = null;
    private anchorRow: number = -1; // for shift-click range selection

    // Data references (set externally)
    private nodes: LayoutNode[] = [];
    private scrollTop: number = 0;
    private config: GraphConfig;

    // Keyboard navigation
    private currentRow: number = -1;

    // Double-click detection
    private lastClickTime: number = 0;
    private lastClickSha: string | null = null;
    private readonly dblClickThreshold: number = 300;

    constructor(
        canvas: HTMLCanvasElement,
        renderer: CanvasRenderer,
        config: GraphConfig,
        callbacks: InteractionCallbacks,
    ) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.config = config;
        this.callbacks = callbacks;

        this.bindEvents();
    }

    // ── State Accessors ─────────────────────────────────────────────────

    getSelectedShas(): Set<string> {
        return new Set(this.selectedShas);
    }

    getPrimarySha(): string | null {
        return this.primarySha;
    }

    getCurrentRow(): number {
        return this.currentRow;
    }

    // ── External Updates ────────────────────────────────────────────────

    setNodes(nodes: LayoutNode[]): void {
        this.nodes = nodes;
    }

    setScrollTop(scrollTop: number): void {
        this.scrollTop = scrollTop;
    }

    setConfig(config: GraphConfig): void {
        this.config = config;
    }

    /**
     * Programmatically select a commit by SHA.
     */
    selectSha(sha: string): void {
        this.selectedShas.clear();
        this.selectedShas.add(sha);
        this.primarySha = sha;
        const node = this.nodes.find((n) => n.sha === sha);
        if (node) {
            this.currentRow = node.row;
            this.anchorRow = node.row;
        }
        this.callbacks.onSelectionChanged(this.getSelectedShas(), this.primarySha);
        this.callbacks.onRequestRender();
    }

    /**
     * Clear all selection.
     */
    clearSelection(): void {
        this.selectedShas.clear();
        this.primarySha = null;
        this.anchorRow = -1;
        this.callbacks.onSelectionChanged(this.getSelectedShas(), this.primarySha);
        this.callbacks.onRequestRender();
    }

    // ── Event Binding ───────────────────────────────────────────────────

    private bindEvents(): void {
        this.canvas.addEventListener('click', this.handleClick.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDblClick.bind(this));
        this.canvas.addEventListener('contextmenu', this.handleContextMenu.bind(this));

        // Keyboard events on the parent container (so it gets focus)
        const container = this.canvas.parentElement?.parentElement;
        if (container) {
            container.setAttribute('tabindex', '0');
            container.addEventListener('keydown', this.handleKeyDown.bind(this));
        }
    }

    // ── Mouse Handlers ──────────────────────────────────────────────────

    private handleClick(e: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const node = this.renderer.hitTest(x, y, this.nodes, this.scrollTop, this.config);
        if (!node) {
            // Clicked on empty space: clear selection
            if (!e.ctrlKey && !e.metaKey) {
                this.clearSelection();
            }
            return;
        }

        // Check for double-click via timing (backup for dblclick event)
        const now = Date.now();
        if (node.sha === this.lastClickSha && now - this.lastClickTime < this.dblClickThreshold) {
            // Will be handled by dblclick event
            this.lastClickTime = 0;
            this.lastClickSha = null;
            return;
        }
        this.lastClickTime = now;
        this.lastClickSha = node.sha;

        if (e.shiftKey && this.anchorRow >= 0) {
            // Range selection
            this.rangeSelect(this.anchorRow, node.row);
        } else if (e.ctrlKey || e.metaKey) {
            // Toggle selection
            if (this.selectedShas.has(node.sha)) {
                this.selectedShas.delete(node.sha);
                if (this.primarySha === node.sha) {
                    this.primarySha = this.selectedShas.size > 0
                        ? this.selectedShas.values().next().value ?? null
                        : null;
                }
            } else {
                this.selectedShas.add(node.sha);
                this.primarySha = node.sha;
            }
            this.anchorRow = node.row;
        } else {
            // Single selection
            this.selectedShas.clear();
            this.selectedShas.add(node.sha);
            this.primarySha = node.sha;
            this.anchorRow = node.row;
        }

        this.currentRow = node.row;
        this.callbacks.onSelectionChanged(this.getSelectedShas(), this.primarySha);
        this.callbacks.onCommitClick(node.sha, e.ctrlKey || e.metaKey, e.shiftKey);
        this.callbacks.onRequestRender();
    }

    private handleDblClick(e: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const node = this.renderer.hitTest(x, y, this.nodes, this.scrollTop, this.config);
        if (node) {
            this.callbacks.onCommitDblClick(node.sha);
        }
    }

    private handleContextMenu(e: MouseEvent): void {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const node = this.renderer.hitTest(x, y, this.nodes, this.scrollTop, this.config);
        if (node) {
            // Select on right-click if not already selected
            if (!this.selectedShas.has(node.sha)) {
                this.selectedShas.clear();
                this.selectedShas.add(node.sha);
                this.primarySha = node.sha;
                this.currentRow = node.row;
                this.callbacks.onSelectionChanged(this.getSelectedShas(), this.primarySha);
                this.callbacks.onRequestRender();
            }
            this.callbacks.onContextMenu(node.sha, e.clientX, e.clientY);
        }
    }

    // ── Keyboard Handler ────────────────────────────────────────────────

    private handleKeyDown(e: KeyboardEvent): void {
        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this.moveSelection(-1, e.shiftKey);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.moveSelection(1, e.shiftKey);
                break;
            case 'Enter':
                e.preventDefault();
                if (this.primarySha) {
                    this.callbacks.onCommitDblClick(this.primarySha);
                }
                break;
            case 'Escape':
                e.preventDefault();
                this.clearSelection();
                break;
            case 'Home':
                e.preventDefault();
                this.moveToRow(0);
                break;
            case 'End':
                e.preventDefault();
                if (this.nodes.length > 0) {
                    const maxRow = Math.max(...this.nodes.map((n) => n.row));
                    this.moveToRow(maxRow);
                }
                break;
            case 'PageUp':
                e.preventDefault();
                this.moveSelection(-20, e.shiftKey);
                break;
            case 'PageDown':
                e.preventDefault();
                this.moveSelection(20, e.shiftKey);
                break;
        }
    }

    // ── Selection Helpers ───────────────────────────────────────────────

    private moveSelection(delta: number, shift: boolean): void {
        const targetRow = Math.max(0, this.currentRow + delta);
        if (shift && this.anchorRow >= 0) {
            this.rangeSelect(this.anchorRow, targetRow);
            this.currentRow = targetRow;
        } else {
            this.moveToRow(targetRow);
        }
    }

    private moveToRow(row: number): void {
        const node = this.renderer.hitTestRow(row, this.nodes);
        if (node) {
            this.selectedShas.clear();
            this.selectedShas.add(node.sha);
            this.primarySha = node.sha;
            this.currentRow = node.row;
            this.anchorRow = node.row;
            this.callbacks.onSelectionChanged(this.getSelectedShas(), this.primarySha);
            this.callbacks.onCommitClick(node.sha, false, false);
            this.callbacks.onRequestRender();
        }
    }

    private rangeSelect(fromRow: number, toRow: number): void {
        const minRow = Math.min(fromRow, toRow);
        const maxRow = Math.max(fromRow, toRow);
        this.selectedShas.clear();
        for (const node of this.nodes) {
            if (node.row >= minRow && node.row <= maxRow) {
                this.selectedShas.add(node.sha);
            }
        }
        // Primary is the node at the destination row
        const destNode = this.renderer.hitTestRow(toRow, this.nodes);
        if (destNode) {
            this.primarySha = destNode.sha;
        }
        this.callbacks.onSelectionChanged(this.getSelectedShas(), this.primarySha);
        this.callbacks.onRequestRender();
    }

    // ── Cleanup ─────────────────────────────────────────────────────────

    dispose(): void {
        // Event listeners are bound to elements that will be removed with the DOM
    }
}
