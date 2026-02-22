// ─── Types ──────────────────────────────────────────────────────────────────

export interface VisibleRange {
    firstRow: number;
    lastRow: number;
}

export interface ScrollEvent {
    scrollTop: number;
    visibleRange: VisibleRange;
}

export type ScrollCallback = (event: ScrollEvent) => void;
export type NeedMoreDataCallback = (direction: 'before' | 'after', anchorRow: number) => void;

// ─── Virtual Scroll ─────────────────────────────────────────────────────────

/**
 * Manages a scrollable container with virtual scroll capabilities.
 *
 * DOM structure:
 *   container (overflow-y: scroll)
 *     spacer (height = totalRows * rowHeight, positions the canvas)
 *     canvas (position: absolute, rendered within visible region)
 */
export class VirtualScroll {
    private container: HTMLElement;
    private spacer: HTMLElement;
    private canvas: HTMLCanvasElement;

    private rowHeight: number;
    private totalCount: number = 0;
    private bufferRows: number;

    private scrollCallbacks: ScrollCallback[] = [];
    private needMoreDataCallbacks: NeedMoreDataCallback[] = [];

    private loadedRowMin: number = 0;
    private loadedRowMax: number = 0;
    private requestPending: boolean = false;

    constructor(
        container: HTMLElement,
        spacer: HTMLElement,
        canvas: HTMLCanvasElement,
        rowHeight: number = 24,
        bufferRows: number = 50,
    ) {
        this.container = container;
        this.spacer = spacer;
        this.canvas = canvas;
        this.rowHeight = rowHeight;
        this.bufferRows = bufferRows;

        this.container.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });
    }

    // ── Configuration ───────────────────────────────────────────────────

    /**
     * Set the total number of commits. Updates the spacer height so the
     * scrollbar reflects the full repository size.
     */
    setTotalCount(count: number): void {
        this.totalCount = count;
        this.spacer.style.height = `${count * this.rowHeight}px`;
    }

    getTotalCount(): number {
        return this.totalCount;
    }

    /**
     * Inform the virtual scroller about the range of rows that are
     * currently loaded in the data arrays.
     */
    setLoadedRange(minRow: number, maxRow: number): void {
        this.loadedRowMin = minRow;
        this.loadedRowMax = maxRow;
        this.requestPending = false;
    }

    setRowHeight(height: number): void {
        this.rowHeight = height;
        this.spacer.style.height = `${this.totalCount * this.rowHeight}px`;
    }

    // ── Visible Range ───────────────────────────────────────────────────

    /**
     * Calculate the range of rows currently visible in the viewport.
     */
    getVisibleRange(): VisibleRange {
        const scrollTop = this.container.scrollTop;
        const viewportHeight = this.container.clientHeight;
        return {
            firstRow: Math.max(0, Math.floor(scrollTop / this.rowHeight)),
            lastRow: Math.min(
                this.totalCount - 1,
                Math.ceil((scrollTop + viewportHeight) / this.rowHeight),
            ),
        };
    }

    getScrollTop(): number {
        return this.container.scrollTop;
    }

    getViewportHeight(): number {
        return this.container.clientHeight;
    }

    // ── Scrolling ───────────────────────────────────────────────────────

    /**
     * Programmatically scroll to a specific row.
     */
    scrollToRow(row: number): void {
        const targetTop = row * this.rowHeight - this.container.clientHeight / 2 + this.rowHeight / 2;
        this.container.scrollTop = Math.max(0, targetTop);
    }

    /**
     * Set the scroll position directly.
     */
    setScrollTop(scrollTop: number): void {
        this.container.scrollTop = scrollTop;
    }

    // ── Event Handling ──────────────────────────────────────────────────

    onScroll(callback: ScrollCallback): void {
        this.scrollCallbacks.push(callback);
    }

    onNeedMoreData(callback: NeedMoreDataCallback): void {
        this.needMoreDataCallbacks.push(callback);
    }

    private handleScroll(): void {
        const scrollTop = this.container.scrollTop;
        const range = this.getVisibleRange();

        // Position the canvas to cover the visible area
        this.canvas.style.top = `${scrollTop}px`;

        // Emit scroll event
        const event: ScrollEvent = {
            scrollTop,
            visibleRange: range,
        };
        for (const cb of this.scrollCallbacks) {
            cb(event);
        }

        // Check if we need more data
        this.checkDataBoundaries(range);
    }

    /**
     * Check if the visible range is approaching the edge of loaded data
     * and emit a request for more data if needed.
     */
    private checkDataBoundaries(range: VisibleRange): void {
        if (this.requestPending) {
            return;
        }

        // Approaching the bottom of loaded data
        if (range.lastRow >= this.loadedRowMax - this.bufferRows && this.loadedRowMax < this.totalCount) {
            this.requestPending = true;
            for (const cb of this.needMoreDataCallbacks) {
                cb('after', this.loadedRowMax);
            }
        }

        // Approaching the top of loaded data (if we ever support windowed loading)
        if (range.firstRow <= this.loadedRowMin + this.bufferRows && this.loadedRowMin > 0) {
            this.requestPending = true;
            for (const cb of this.needMoreDataCallbacks) {
                cb('before', this.loadedRowMin);
            }
        }
    }

    // ── Cleanup ─────────────────────────────────────────────────────────

    dispose(): void {
        this.scrollCallbacks = [];
        this.needMoreDataCallbacks = [];
    }
}
