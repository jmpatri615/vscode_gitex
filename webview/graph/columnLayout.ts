// ─── Types ──────────────────────────────────────────────────────────────────

export interface Column {
    id: string;
    label: string;
    width: number;
    minWidth: number;
    flexible: boolean;
}

export type ColumnResizeCallback = (columns: Column[]) => void;

// ─── Default Column Definitions ─────────────────────────────────────────────

function defaultColumns(): Column[] {
    return [
        { id: 'graph', label: 'Graph', width: 200, minWidth: 80, flexible: false },
        { id: 'description', label: 'Description', width: 0, minWidth: 150, flexible: true },
        { id: 'author', label: 'Author', width: 120, minWidth: 60, flexible: false },
        { id: 'date', label: 'Date', width: 100, minWidth: 60, flexible: false },
        { id: 'sha', label: 'SHA', width: 70, minWidth: 50, flexible: false },
    ];
}

// ─── Column Layout ──────────────────────────────────────────────────────────

export class ColumnLayout {
    private columns: Column[];
    private resizeCallbacks: ColumnResizeCallback[] = [];
    private headerContainer: HTMLElement | null = null;

    // Drag state
    private dragging: boolean = false;
    private dragColumnIndex: number = -1;
    private dragStartX: number = 0;
    private dragStartWidth: number = 0;

    // Bound handlers for cleanup
    private boundMouseMove: ((e: MouseEvent) => void) | null = null;
    private boundMouseUp: ((e: MouseEvent) => void) | null = null;

    constructor(columns?: Column[]) {
        this.columns = columns || defaultColumns();
    }

    // ── Accessors ───────────────────────────────────────────────────────

    getColumns(): Column[] {
        return this.columns;
    }

    /**
     * Determine which column a given x coordinate falls within.
     * Returns the column index, or -1 if out of bounds.
     */
    getColumnAtX(x: number): number {
        let accum = 0;
        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i];
            const w = col.flexible ? this.getFlexWidth() : col.width;
            accum += w;
            if (x < accum) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Get the x offset (left edge) of a column by index.
     */
    getColumnLeft(index: number): number {
        let accum = 0;
        for (let i = 0; i < index; i++) {
            const col = this.columns[i];
            accum += col.flexible ? this.getFlexWidth() : col.width;
        }
        return accum;
    }

    /**
     * Get the effective width of a column.
     */
    getColumnWidth(index: number): number {
        const col = this.columns[index];
        if (!col) { return 0; }
        return col.flexible ? this.getFlexWidth() : col.width;
    }

    setColumnWidth(id: string, width: number): void {
        const col = this.columns.find(c => c.id === id);
        if (col && !col.flexible) {
            col.width = Math.max(col.minWidth, width);
            this.updateHeaderWidths();
            this.emitResize();
        }
    }

    // ── Events ──────────────────────────────────────────────────────────

    onResize(callback: ColumnResizeCallback): void {
        this.resizeCallbacks.push(callback);
    }

    private emitResize(): void {
        for (const cb of this.resizeCallbacks) {
            cb(this.columns);
        }
    }

    // ── Rendering ───────────────────────────────────────────────────────

    /**
     * Render column headers into the given container element.
     * Sets up resize handles with drag-to-resize behavior.
     */
    render(container: HTMLElement): void {
        this.headerContainer = container;
        container.innerHTML = '';
        container.classList.add('column-headers');

        for (let i = 0; i < this.columns.length; i++) {
            const col = this.columns[i];
            const header = document.createElement('div');
            header.className = 'column-header';
            header.dataset.columnId = col.id;
            header.textContent = col.label;

            if (col.flexible) {
                header.style.flex = '1';
                header.style.minWidth = `${col.minWidth}px`;
            } else {
                header.style.width = `${col.width}px`;
                header.style.minWidth = `${col.minWidth}px`;
                header.style.flexShrink = '0';
            }

            // Add resize handle (except for the last column and the flexible column)
            if (i < this.columns.length - 1 && !col.flexible) {
                const handle = document.createElement('div');
                handle.className = 'column-resize-handle';
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.startResize(i, e.clientX);
                });
                header.appendChild(handle);
            }

            container.appendChild(header);
        }
    }

    /**
     * Update header widths after a resize without full re-render.
     */
    updateHeaderWidths(): void {
        if (!this.headerContainer) { return; }
        const headers = this.headerContainer.querySelectorAll('.column-header');
        for (let i = 0; i < headers.length && i < this.columns.length; i++) {
            const header = headers[i] as HTMLElement;
            const col = this.columns[i];
            if (col.flexible) {
                header.style.flex = '1';
                header.style.width = '';
            } else {
                header.style.flex = '';
                header.style.width = `${col.width}px`;
            }
        }
    }

    // ── Resize Logic ────────────────────────────────────────────────────

    private startResize(columnIndex: number, clientX: number): void {
        this.dragging = true;
        this.dragColumnIndex = columnIndex;
        this.dragStartX = clientX;
        this.dragStartWidth = this.columns[columnIndex].width;

        this.boundMouseMove = this.onResizeMove.bind(this);
        this.boundMouseUp = this.onResizeEnd.bind(this);

        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }

    private onResizeMove(e: MouseEvent): void {
        if (!this.dragging) { return; }
        const delta = e.clientX - this.dragStartX;
        const col = this.columns[this.dragColumnIndex];
        col.width = Math.max(col.minWidth, this.dragStartWidth + delta);
        this.updateHeaderWidths();
        this.emitResize();
    }

    private onResizeEnd(): void {
        this.dragging = false;
        if (this.boundMouseMove) {
            document.removeEventListener('mousemove', this.boundMouseMove);
        }
        if (this.boundMouseUp) {
            document.removeEventListener('mouseup', this.boundMouseUp);
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        this.boundMouseMove = null;
        this.boundMouseUp = null;
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /**
     * Compute the width of the flexible column.
     * It fills the remaining space after fixed columns.
     */
    private getFlexWidth(): number {
        if (!this.headerContainer) { return 300; }
        const containerWidth = this.headerContainer.clientWidth;
        let fixedTotal = 0;
        for (const col of this.columns) {
            if (!col.flexible) {
                fixedTotal += col.width;
            }
        }
        return Math.max(150, containerWidth - fixedTotal);
    }

    // ── Cleanup ─────────────────────────────────────────────────────────

    dispose(): void {
        this.onResizeEnd();
        this.resizeCallbacks = [];
    }
}
