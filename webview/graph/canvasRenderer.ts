import { LayoutNode, Edge, RefInfo } from './messageProtocol';
import { getBranchColor, getThemeColors, isDarkTheme, ThemeColors } from './themeManager';

// ─── Config ─────────────────────────────────────────────────────────────────

export interface GraphConfig {
    rowHeight: number;
    laneWidth: number;
    nodeRadius: number;
    graphWidth: number;
}

export const DEFAULT_CONFIG: GraphConfig = {
    rowHeight: 24,
    laneWidth: 16,
    nodeRadius: 4,
    graphWidth: 200,
};

// ─── Dirty Region Tracking ──────────────────────────────────────────────────

interface DirtyRegion {
    top: number;
    bottom: number;
}

// ─── Canvas Renderer ────────────────────────────────────────────────────────

export class CanvasRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private dpr: number;
    private dirty: DirtyRegion | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get 2D rendering context');
        }
        this.ctx = ctx;
        this.dpr = window.devicePixelRatio || 1;
    }

    // ── Sizing ──────────────────────────────────────────────────────────

    /**
     * Resize the canvas to match its CSS layout size, accounting for
     * devicePixelRatio for sharp HiDPI rendering.
     */
    resize(width: number, height: number): void {
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(width * this.dpr);
        this.canvas.height = Math.round(height * this.dpr);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // ── Dirty Region ────────────────────────────────────────────────────

    setDirtyRegion(top: number, bottom: number): void {
        this.dirty = { top, bottom };
    }

    clearDirtyRegion(): void {
        this.dirty = null;
    }

    // ── Main Render ─────────────────────────────────────────────────────

    /**
     * Full render pass. Only draws nodes/edges within the visible viewport
     * (scrollTop +/- buffer).
     */
    render(
        nodes: LayoutNode[],
        edges: Edge[],
        scrollTop: number,
        viewportHeight: number,
        config: GraphConfig,
        selectedShas: Set<string>,
        primarySha: string | null,
    ): void {
        const ctx = this.ctx;
        const colors = getThemeColors();
        const bufferRows = 10;
        const firstVisibleRow = Math.max(0, Math.floor(scrollTop / config.rowHeight) - bufferRows);
        const lastVisibleRow = Math.ceil((scrollTop + viewportHeight) / config.rowHeight) + bufferRows;

        // Clear canvas
        ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

        // Draw selection background for selected rows
        for (const node of nodes) {
            if (node.row < firstVisibleRow || node.row > lastVisibleRow) {
                continue;
            }
            if (selectedShas.has(node.sha)) {
                const y = node.row * config.rowHeight - scrollTop;
                ctx.fillStyle = node.sha === primarySha
                    ? colors.selection
                    : this.adjustAlpha(colors.selection, 0.5);
                ctx.fillRect(0, y, this.canvas.width / this.dpr, config.rowHeight);
            }
        }

        // Draw edges (behind nodes)
        for (const edge of edges) {
            if (edge.to_row < firstVisibleRow && edge.from_row < firstVisibleRow) {
                continue;
            }
            if (edge.to_row > lastVisibleRow && edge.from_row > lastVisibleRow) {
                continue;
            }
            this.drawEdge(ctx, edge, scrollTop, config, colors);
        }

        // Draw nodes (on top of edges)
        for (const node of nodes) {
            if (node.row < firstVisibleRow || node.row > lastVisibleRow) {
                continue;
            }
            this.drawNode(ctx, node, scrollTop, config, colors);
        }

        // Draw labels (on top of everything)
        for (const node of nodes) {
            if (node.row < firstVisibleRow || node.row > lastVisibleRow) {
                continue;
            }
            if (node.refs.length > 0) {
                this.drawLabels(ctx, node, scrollTop, config, colors);
            }
        }
    }

    // ── Edge Drawing ────────────────────────────────────────────────────

    drawEdge(
        ctx: CanvasRenderingContext2D,
        edge: Edge,
        scrollTop: number,
        config: GraphConfig,
        colors: ThemeColors,
    ): void {
        const color = getBranchColor(edge.color_index);
        const fromX = this.laneToX(edge.from_lane, config);
        const fromY = edge.from_row * config.rowHeight + config.rowHeight / 2 - scrollTop;
        const toX = this.laneToX(edge.to_lane, config);
        const toY = edge.to_row * config.rowHeight + config.rowHeight / 2 - scrollTop;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = edge.edge_type === 'Merge' ? 0.7 : 1.0;

        if (edge.from_lane === edge.to_lane) {
            // Straight vertical line for same-lane edges
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
        } else {
            // Bezier curve for cross-lane edges
            const midY = (fromY + toY) / 2;
            ctx.moveTo(fromX, fromY);
            ctx.bezierCurveTo(
                fromX, midY,
                toX, midY,
                toX, toY,
            );
        }

        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }

    // ── Node Drawing ────────────────────────────────────────────────────

    drawNode(
        ctx: CanvasRenderingContext2D,
        node: LayoutNode,
        scrollTop: number,
        config: GraphConfig,
        colors: ThemeColors,
    ): void {
        const x = this.laneToX(node.lane, config);
        const y = node.row * config.rowHeight + config.rowHeight / 2 - scrollTop;
        const r = config.nodeRadius;
        const color = getBranchColor(node.color_index);

        switch (node.node_type) {
            case 'Head':
                // Double ring for HEAD
                ctx.beginPath();
                ctx.arc(x, y, r + 2, 0, Math.PI * 2);
                ctx.strokeStyle = colors.headIndicator;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                break;

            case 'Stash':
                // Diamond for stash
                ctx.beginPath();
                ctx.moveTo(x, y - r - 1);
                ctx.lineTo(x + r + 1, y);
                ctx.lineTo(x, y + r + 1);
                ctx.lineTo(x - r - 1, y);
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = colors.foreground;
                ctx.lineWidth = 0.5;
                ctx.stroke();
                break;

            case 'WorkingTree':
                // Dashed circle for working tree
                ctx.beginPath();
                ctx.setLineDash([2, 2]);
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.setLineDash([]);
                break;

            case 'Normal':
            default:
                // Filled circle
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                break;
        }
    }

    // ── Label / Badge Drawing ───────────────────────────────────────────

    drawLabels(
        ctx: CanvasRenderingContext2D,
        node: LayoutNode,
        scrollTop: number,
        config: GraphConfig,
        _colors: ThemeColors,
    ): void {
        const baseX = this.laneToX(node.lane, config) + config.nodeRadius + 6;
        const y = node.row * config.rowHeight + config.rowHeight / 2 - scrollTop;
        let offsetX = baseX;

        for (const ref of node.refs) {
            offsetX = this.drawBadge(ctx, ref, offsetX, y, config);
            offsetX += 4; // gap between badges
        }
    }

    private drawBadge(
        ctx: CanvasRenderingContext2D,
        ref: RefInfo,
        x: number,
        y: number,
        _config: GraphConfig,
    ): number {
        const fontSize = 10;
        const paddingH = 4;
        const paddingV = 2;
        const height = fontSize + paddingV * 2;
        const radius = 3;

        // Choose style based on ref type
        let bgColor: string;
        let textColor: string;
        let label = ref.name;
        let fontStyle = '';

        switch (ref.ref_type) {
            case 'Branch':
                bgColor = isDarkTheme() ? '#3a6ea5' : '#0066b8';
                textColor = '#ffffff';
                fontStyle = ref.is_head ? 'bold ' : '';
                break;
            case 'RemoteBranch':
                bgColor = isDarkTheme() ? '#4a4a6a' : '#8888bb';
                textColor = '#ffffff';
                fontStyle = 'italic ';
                break;
            case 'Tag':
                bgColor = isDarkTheme() ? '#6a5a2a' : '#c9a000';
                textColor = '#ffffff';
                break;
            case 'Head':
                bgColor = isDarkTheme() ? '#dcdcaa' : '#795e26';
                textColor = isDarkTheme() ? '#1e1e1e' : '#ffffff';
                fontStyle = 'bold ';
                label = 'HEAD';
                break;
            case 'Stash':
                bgColor = isDarkTheme() ? '#555555' : '#aaaaaa';
                textColor = '#ffffff';
                break;
            default:
                bgColor = '#666666';
                textColor = '#ffffff';
                break;
        }

        ctx.font = `${fontStyle}${fontSize}px var(--vscode-font-family, "Segoe UI", sans-serif)`;
        const textWidth = ctx.measureText(label).width;
        const totalWidth = textWidth + paddingH * 2;
        const top = y - height / 2;

        if (ref.ref_type === 'Tag') {
            // Tag: pointed-left shape
            const pointInset = 5;
            ctx.beginPath();
            ctx.moveTo(x + pointInset, top);
            ctx.lineTo(x + totalWidth + pointInset, top);
            ctx.lineTo(x + totalWidth + pointInset, top + height);
            ctx.lineTo(x + pointInset, top + height);
            ctx.lineTo(x, y); // point
            ctx.closePath();
            ctx.fillStyle = bgColor;
            ctx.fill();
            ctx.fillStyle = textColor;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(label, x + pointInset + paddingH, y);
            return x + totalWidth + pointInset;
        } else {
            // Branch / HEAD / Stash: rounded rect
            this.roundRect(ctx, x, top, totalWidth, height, radius);
            ctx.fillStyle = bgColor;
            ctx.fill();
            ctx.fillStyle = textColor;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(label, x + paddingH, y);
            return x + totalWidth;
        }
    }

    private roundRect(
        ctx: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        r: number,
    ): void {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    // ── Hit Testing ─────────────────────────────────────────────────────

    /**
     * Determine which node, if any, is at the given (x, y) coordinates
     * (in canvas CSS coordinates, not backing-store pixels).
     */
    hitTest(
        x: number,
        y: number,
        nodes: LayoutNode[],
        scrollTop: number,
        config: GraphConfig,
    ): LayoutNode | null {
        // First check if click is within the graph column
        // Then test by row, then proximity to node center
        const clickRow = Math.floor((y + scrollTop) / config.rowHeight);
        const hitRadius = config.rowHeight / 2; // generous hit area for entire row

        for (const node of nodes) {
            if (node.row !== clickRow) {
                continue;
            }
            // Row matched -- this node is hit
            // Optionally verify x is within the graph area
            if (x <= config.graphWidth + 50) {
                return node;
            }
            // Even if outside graph area, selecting by row is expected
            return node;
        }
        return null;
    }

    /**
     * Hit test that returns the node at the given row index,
     * regardless of x position. Useful for keyboard navigation.
     */
    hitTestRow(
        row: number,
        nodes: LayoutNode[],
    ): LayoutNode | null {
        for (const node of nodes) {
            if (node.row === row) {
                return node;
            }
        }
        return null;
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private laneToX(lane: number, config: GraphConfig): number {
        return config.laneWidth + lane * config.laneWidth;
    }

    private adjustAlpha(color: string, factor: number): string {
        // If the color already has alpha (8-char hex or rgba), try to adjust
        if (color.length === 9 && color.startsWith('#')) {
            const alphaHex = color.slice(7, 9);
            const alpha = parseInt(alphaHex, 16) / 255;
            const newAlpha = Math.round(alpha * factor * 255)
                .toString(16)
                .padStart(2, '0');
            return color.slice(0, 7) + newAlpha;
        }
        // Otherwise just return as is
        return color;
    }
}
