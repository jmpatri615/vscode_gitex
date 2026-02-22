// ─── Types ──────────────────────────────────────────────────────────────────

export type FilterField = 'message' | 'author' | 'committer' | 'sha';

export interface FilterState {
    field: FilterField;
    pattern: string;
    dateAfter: number | null;
    dateBefore: number | null;
}

export type FilterChangeCallback = (field: string, pattern: string) => void;
export type DateFilterChangeCallback = (after: number, before: number) => void;
export type FilterCloseCallback = () => void;

// ─── Filter Bar ─────────────────────────────────────────────────────────────

/**
 * Renders a search/filter UI bar at the top of the graph view.
 * Supports text filtering by field (message, author, committer, SHA)
 * and date range filtering.
 */
export class FilterBar {
    private container: HTMLElement;
    private visible: boolean = false;

    // DOM elements
    private barElement: HTMLElement | null = null;
    private inputElement: HTMLInputElement | null = null;
    private fieldSelect: HTMLSelectElement | null = null;
    private dateAfterInput: HTMLInputElement | null = null;
    private dateBeforeInput: HTMLInputElement | null = null;

    // Callbacks
    private filterChangeCallbacks: FilterChangeCallback[] = [];
    private dateFilterChangeCallbacks: DateFilterChangeCallback[] = [];
    private closeCallbacks: FilterCloseCallback[] = [];

    // Debounce
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly debounceMs: number = 300;

    constructor(container: HTMLElement) {
        this.container = container;
        this.buildDOM();
        this.bindGlobalShortcut();
    }

    // ── Public API ──────────────────────────────────────────────────────

    show(): void {
        if (this.barElement) {
            this.visible = true;
            this.barElement.classList.remove('hidden');
            this.inputElement?.focus();
        }
    }

    hide(): void {
        if (this.barElement) {
            this.visible = false;
            this.barElement.classList.add('hidden');
            // Clear filter on hide
            if (this.inputElement) {
                this.inputElement.value = '';
            }
            this.emitFilterChange();
            for (const cb of this.closeCallbacks) {
                cb();
            }
        }
    }

    toggle(): void {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    isVisible(): boolean {
        return this.visible;
    }

    getFilter(): FilterState {
        return {
            field: (this.fieldSelect?.value as FilterField) || 'message',
            pattern: this.inputElement?.value || '',
            dateAfter: this.dateAfterInput?.valueAsNumber || null,
            dateBefore: this.dateBeforeInput?.valueAsNumber || null,
        };
    }

    // ── Events ──────────────────────────────────────────────────────────

    onFilterChange(callback: FilterChangeCallback): void {
        this.filterChangeCallbacks.push(callback);
    }

    onDateFilterChange(callback: DateFilterChangeCallback): void {
        this.dateFilterChangeCallbacks.push(callback);
    }

    onClose(callback: FilterCloseCallback): void {
        this.closeCallbacks.push(callback);
    }

    // ── DOM Construction ────────────────────────────────────────────────

    private buildDOM(): void {
        const bar = document.createElement('div');
        bar.className = 'filter-bar hidden';
        bar.id = 'filter-bar';

        // ── Text filter row ──

        const textRow = document.createElement('div');
        textRow.className = 'filter-row';

        // Field selector
        const fieldSelect = document.createElement('select');
        fieldSelect.className = 'filter-field-select';
        fieldSelect.title = 'Filter field';
        const fields: { value: FilterField; label: string }[] = [
            { value: 'message', label: 'Message' },
            { value: 'author', label: 'Author' },
            { value: 'committer', label: 'Committer' },
            { value: 'sha', label: 'SHA' },
        ];
        for (const f of fields) {
            const opt = document.createElement('option');
            opt.value = f.value;
            opt.textContent = f.label;
            fieldSelect.appendChild(opt);
        }
        fieldSelect.addEventListener('change', () => this.emitFilterChange());
        this.fieldSelect = fieldSelect;
        textRow.appendChild(fieldSelect);

        // Search input
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'filter-input';
        input.placeholder = 'Search commits...';
        input.addEventListener('input', () => this.debouncedFilterChange());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        });
        this.inputElement = input;
        textRow.appendChild(input);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'filter-close-btn';
        closeBtn.title = 'Close filter (Escape)';
        closeBtn.textContent = '\u00d7'; // multiplication sign as close icon
        closeBtn.addEventListener('click', () => this.hide());
        textRow.appendChild(closeBtn);

        bar.appendChild(textRow);

        // ── Date filter row ──

        const dateRow = document.createElement('div');
        dateRow.className = 'filter-row filter-date-row';

        const afterLabel = document.createElement('label');
        afterLabel.className = 'filter-date-label';
        afterLabel.textContent = 'From:';
        dateRow.appendChild(afterLabel);

        const dateAfter = document.createElement('input');
        dateAfter.type = 'date';
        dateAfter.className = 'filter-date-input';
        dateAfter.addEventListener('change', () => this.emitDateFilterChange());
        this.dateAfterInput = dateAfter;
        dateRow.appendChild(dateAfter);

        const beforeLabel = document.createElement('label');
        beforeLabel.className = 'filter-date-label';
        beforeLabel.textContent = 'To:';
        dateRow.appendChild(beforeLabel);

        const dateBefore = document.createElement('input');
        dateBefore.type = 'date';
        dateBefore.className = 'filter-date-input';
        dateBefore.addEventListener('change', () => this.emitDateFilterChange());
        this.dateBeforeInput = dateBefore;
        dateRow.appendChild(dateBefore);

        const clearDatesBtn = document.createElement('button');
        clearDatesBtn.className = 'filter-clear-dates-btn';
        clearDatesBtn.textContent = 'Clear Dates';
        clearDatesBtn.title = 'Clear date filters';
        clearDatesBtn.addEventListener('click', () => {
            if (this.dateAfterInput) { this.dateAfterInput.value = ''; }
            if (this.dateBeforeInput) { this.dateBeforeInput.value = ''; }
            this.emitDateFilterChange();
        });
        dateRow.appendChild(clearDatesBtn);

        bar.appendChild(dateRow);

        this.barElement = bar;
        this.container.appendChild(bar);
    }

    // ── Global Shortcut ─────────────────────────────────────────────────

    private bindGlobalShortcut(): void {
        document.addEventListener('keydown', (e) => {
            // Ctrl+F or Cmd+F toggles filter bar
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                this.toggle();
            }
        });
    }

    // ── Emit Helpers ────────────────────────────────────────────────────

    private debouncedFilterChange(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.emitFilterChange();
        }, this.debounceMs);
    }

    private emitFilterChange(): void {
        const field = this.fieldSelect?.value || 'message';
        const pattern = this.inputElement?.value || '';
        for (const cb of this.filterChangeCallbacks) {
            cb(field, pattern);
        }
    }

    private emitDateFilterChange(): void {
        const after = this.dateAfterInput?.valueAsNumber || 0;
        const before = this.dateBeforeInput?.valueAsNumber || 0;
        for (const cb of this.dateFilterChangeCallbacks) {
            cb(after, before);
        }
    }

    // ── Cleanup ─────────────────────────────────────────────────────────

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.filterChangeCallbacks = [];
        this.dateFilterChangeCallbacks = [];
        this.closeCallbacks = [];
    }
}
