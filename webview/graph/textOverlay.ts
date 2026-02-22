import { LayoutNode, RefType, isVirtualSha } from './messageProtocol';
import { ColumnLayout } from './columnLayout';
import { GraphConfig } from './canvasRenderer';

/**
 * Renders text columns (Description, Author, Date, SHA) as positioned
 * HTML elements overlaid on the scroll container, aligned with the canvas
 * graph column.
 */
export class TextOverlay {
    private container: HTMLElement;
    private columnLayout: ColumnLayout;
    private rowElements: Map<number, HTMLElement> = new Map();

    constructor(container: HTMLElement, columnLayout: ColumnLayout) {
        this.container = container;
        this.columnLayout = columnLayout;
        this.container.style.position = 'absolute';
        this.container.style.top = '0';
        this.container.style.left = '0';
        this.container.style.width = '100%';
        this.container.style.pointerEvents = 'none';
    }

    render(
        nodes: LayoutNode[],
        scrollTop: number,
        viewportHeight: number,
        config: GraphConfig,
    ): void {
        const bufferRows = 5;
        const firstVisibleRow = Math.max(0, Math.floor(scrollTop / config.rowHeight) - bufferRows);
        const lastVisibleRow = Math.ceil((scrollTop + viewportHeight) / config.rowHeight) + bufferRows;

        // Remove rows that are no longer visible
        for (const [row, el] of this.rowElements) {
            if (row < firstVisibleRow || row > lastVisibleRow) {
                el.remove();
                this.rowElements.delete(row);
            }
        }

        // Position overlay to match canvas (stuck at scrollTop)
        this.container.style.top = `${scrollTop}px`;

        // Add/update visible rows
        for (const node of nodes) {
            if (node.row < firstVisibleRow || node.row > lastVisibleRow) { continue; }

            let rowEl = this.rowElements.get(node.row);
            if (!rowEl) {
                rowEl = this.createRow(node, config);
                this.container.appendChild(rowEl);
                this.rowElements.set(node.row, rowEl);
            }

            // Position relative to the overlay (which starts at scrollTop)
            const y = node.row * config.rowHeight - scrollTop;
            rowEl.style.top = `${y}px`;
        }
    }

    private createRow(node: LayoutNode, config: GraphConfig): HTMLElement {
        const row = document.createElement('div');
        row.className = node.row % 2 === 1 ? 'text-row text-row-alt' : 'text-row';
        row.style.position = 'absolute';
        row.style.left = '0';
        row.style.width = '100%';
        row.style.height = `${config.rowHeight}px`;
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.overflow = 'hidden';

        const columns = this.columnLayout.getColumns();

        for (const col of columns) {
            const cell = document.createElement('span');
            cell.className = `text-cell text-cell-${col.id}`;

            if (col.flexible) {
                cell.style.flex = '1';
                cell.style.minWidth = `${col.minWidth}px`;
            } else {
                cell.style.width = `${col.width}px`;
                cell.style.flexShrink = '0';
            }

            cell.style.overflow = 'hidden';
            cell.style.textOverflow = 'ellipsis';
            cell.style.whiteSpace = 'nowrap';
            cell.style.padding = '0 4px';
            cell.style.lineHeight = `${config.rowHeight}px`;
            cell.style.fontSize = '12px';
            cell.style.color = 'var(--vscode-editor-foreground, #cccccc)';

            switch (col.id) {
                case 'graph':
                    // Graph column is rendered by canvas — leave empty
                    break;
                case 'description': {
                    // Render ref badges inline before the subject text
                    for (const ref of node.refs) {
                        const badge = document.createElement('span');
                        badge.className = `badge badge-${this.refTypeToBadgeClass(ref.refType)}`;
                        if (ref.refType === 'Head') {
                            badge.textContent = 'HEAD';
                        } else {
                            badge.textContent = ref.name;
                        }
                        if (ref.isHead && ref.refType === 'Branch') {
                            badge.style.fontWeight = 'bold';
                        }
                        cell.appendChild(badge);
                    }
                    const subjectSpan = document.createElement('span');
                    subjectSpan.textContent = node.subject;
                    if (isVirtualSha(node.sha)) {
                        subjectSpan.style.fontStyle = 'italic';
                        subjectSpan.style.opacity = '0.7';
                    }
                    cell.appendChild(subjectSpan);
                    break;
                }
                case 'author':
                    cell.textContent = node.authorName;
                    cell.style.color = 'var(--vscode-descriptionForeground, #999999)';
                    break;
                case 'date':
                    cell.textContent = isVirtualSha(node.sha) ? 'now' : formatDate(node.authorDate);
                    cell.style.color = 'var(--vscode-descriptionForeground, #999999)';
                    break;
                case 'sha':
                    cell.textContent = isVirtualSha(node.sha) ? '' : node.shortSha;
                    cell.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
                    cell.style.color = 'var(--vscode-descriptionForeground, #999999)';
                    break;
            }

            row.appendChild(cell);
        }

        return row;
    }

    private refTypeToBadgeClass(refType: RefType): string {
        switch (refType) {
            case 'Branch': return 'branch';
            case 'RemoteBranch': return 'remote';
            case 'Tag': return 'tag';
            case 'Head': return 'head';
            case 'Stash': return 'stash';
            default: return 'branch';
        }
    }

    clear(): void {
        this.container.innerHTML = '';
        this.rowElements.clear();
    }
}

function formatDate(epoch: number): string {
    const d = new Date(epoch * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
}
