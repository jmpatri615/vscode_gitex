// ─── VS Code API ────────────────────────────────────────────────────────────

interface VsCodeApi {
    postMessage(message: CommitDetailsToExtMessage): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// ─── Message Types ──────────────────────────────────────────────────────────

/** A changed file entry. */
interface ChangedFile {
    path: string;
    old_path: string | null;
    status: 'Added' | 'Modified' | 'Deleted' | 'Renamed' | 'Copied' | 'Unknown';
    additions: number;
    deletions: number;
}

/** Extension -> Webview: commit detail data. */
interface CommitDetailData {
    sha: string;
    short_sha: string;
    author_name: string;
    author_email: string;
    author_date: number;
    committer_name: string;
    committer_email: string;
    commit_date: number;
    subject: string;
    body: string;
    parents: string[];
    files: ChangedFile[];
}

type ExtToDetailsMessage =
    | { type: 'commitData'; data: CommitDetailData }
    | { type: 'themeChanged' }
    | { type: 'clear' };

/** Webview -> Extension messages. */
type CommitDetailsToExtMessage =
    | { type: 'openDiff'; path: string; sha: string }
    | { type: 'navigateToCommit'; sha: string }
    | { type: 'copySha'; sha: string }
    | { type: 'ready' };

// ─── Commit Details App ────────────────────────────────────────────────────

class CommitDetailsApp {
    private vscode: VsCodeApi;
    private contentEl: HTMLElement;
    private currentData: CommitDetailData | null = null;

    constructor() {
        this.vscode = acquireVsCodeApi();
        this.contentEl = document.getElementById('content') as HTMLElement;

        this.setupMessageListener();
        this.vscode.postMessage({ type: 'ready' });
    }

    // ── Message Handling ────────────────────────────────────────────────

    private setupMessageListener(): void {
        window.addEventListener('message', (event: MessageEvent<ExtToDetailsMessage>) => {
            const msg = event.data;
            switch (msg.type) {
                case 'commitData':
                    this.currentData = msg.data;
                    this.render(msg.data);
                    break;
                case 'themeChanged':
                    if (this.currentData) {
                        this.render(this.currentData);
                    }
                    break;
                case 'clear':
                    this.currentData = null;
                    this.renderEmpty();
                    break;
            }
        });
    }

    // ── Rendering ───────────────────────────────────────────────────────

    private render(data: CommitDetailData): void {
        this.contentEl.innerHTML = '';

        // Header: subject
        const header = this.el('div', 'commit-header');
        const subject = this.el('h2', 'commit-subject');
        subject.textContent = data.subject;
        header.appendChild(subject);
        this.contentEl.appendChild(header);

        // SHA row (copyable)
        const shaSection = this.el('div', 'commit-sha-section');
        const shaLabel = this.el('span', 'meta-label');
        shaLabel.textContent = 'SHA: ';
        shaSection.appendChild(shaLabel);
        const shaValue = this.el('span', 'sha-value');
        shaValue.textContent = data.sha;
        shaValue.title = 'Click to copy';
        shaValue.addEventListener('click', () => {
            this.vscode.postMessage({ type: 'copySha', sha: data.sha });
            this.flashCopied(shaValue);
        });
        shaSection.appendChild(shaValue);
        this.contentEl.appendChild(shaSection);

        // Parents
        if (data.parents.length > 0) {
            const parentsSection = this.el('div', 'commit-parents');
            const parentsLabel = this.el('span', 'meta-label');
            parentsLabel.textContent = 'Parents: ';
            parentsSection.appendChild(parentsLabel);
            for (let i = 0; i < data.parents.length; i++) {
                const parentSha = data.parents[i];
                const link = this.el('a', 'parent-link');
                link.textContent = parentSha.slice(0, 7);
                link.title = parentSha;
                (link as HTMLAnchorElement).href = '#';
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.vscode.postMessage({ type: 'navigateToCommit', sha: parentSha });
                });
                parentsSection.appendChild(link);
                if (i < data.parents.length - 1) {
                    parentsSection.appendChild(document.createTextNode(', '));
                }
            }
            this.contentEl.appendChild(parentsSection);
        }

        // Metadata table
        const metaTable = this.el('table', 'commit-meta-table');

        this.addMetaRow(metaTable, 'Author', `${data.author_name} <${data.author_email}>`);
        this.addMetaRow(metaTable, 'Author Date', this.formatDate(data.author_date));
        this.addMetaRow(metaTable, 'Committer', `${data.committer_name} <${data.committer_email}>`);
        this.addMetaRow(metaTable, 'Commit Date', this.formatDate(data.commit_date));

        this.contentEl.appendChild(metaTable);

        // Body (full commit message)
        if (data.body) {
            const bodySection = this.el('div', 'commit-body');
            const bodyLabel = this.el('div', 'section-label');
            bodyLabel.textContent = 'Message';
            bodySection.appendChild(bodyLabel);
            const bodyPre = this.el('pre', 'commit-message');
            bodyPre.textContent = data.body;
            bodySection.appendChild(bodyPre);
            this.contentEl.appendChild(bodySection);
        }

        // Changed files
        if (data.files.length > 0) {
            const filesSection = this.el('div', 'commit-files');
            const filesLabel = this.el('div', 'section-label');
            filesLabel.textContent = `Changed Files (${data.files.length})`;
            filesSection.appendChild(filesLabel);

            const fileList = this.el('ul', 'file-list');
            for (const file of data.files) {
                const li = this.el('li', `file-item file-status-${file.status.toLowerCase()}`);

                // Status badge
                const badge = this.el('span', 'file-status-badge');
                badge.textContent = this.statusChar(file.status);
                badge.title = file.status;
                li.appendChild(badge);

                // File path (clickable)
                const pathLink = this.el('a', 'file-path');
                pathLink.textContent = file.old_path && file.old_path !== file.path
                    ? `${file.old_path} -> ${file.path}`
                    : file.path;
                (pathLink as HTMLAnchorElement).href = '#';
                pathLink.title = `Open diff for ${file.path}`;
                pathLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.vscode.postMessage({ type: 'openDiff', path: file.path, sha: data.sha });
                });
                li.appendChild(pathLink);

                // Stats
                if (file.additions > 0 || file.deletions > 0) {
                    const stats = this.el('span', 'file-stats');
                    if (file.additions > 0) {
                        const add = this.el('span', 'stat-add');
                        add.textContent = `+${file.additions}`;
                        stats.appendChild(add);
                    }
                    if (file.deletions > 0) {
                        const del = this.el('span', 'stat-del');
                        del.textContent = `-${file.deletions}`;
                        stats.appendChild(del);
                    }
                    li.appendChild(stats);
                }

                fileList.appendChild(li);
            }
            filesSection.appendChild(fileList);
            this.contentEl.appendChild(filesSection);
        }
    }

    private renderEmpty(): void {
        this.contentEl.innerHTML = '';
        const empty = this.el('div', 'empty-state');
        empty.textContent = 'Select a commit to view details';
        this.contentEl.appendChild(empty);
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private el(tag: string, className: string): HTMLElement {
        const el = document.createElement(tag);
        el.className = className;
        return el;
    }

    private addMetaRow(table: HTMLElement, label: string, value: string): void {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = label;
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(th);
        tr.appendChild(td);
        table.appendChild(tr);
    }

    private formatDate(timestamp: number): string {
        // Timestamp is in seconds (Unix epoch)
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSec = Math.floor(diffMs / 1000);

        // Relative for recent, absolute for older
        if (diffSec < 60) {
            return 'just now';
        }
        if (diffSec < 3600) {
            const mins = Math.floor(diffSec / 60);
            return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
        }
        if (diffSec < 86400) {
            const hours = Math.floor(diffSec / 3600);
            return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        }
        if (diffSec < 604800) {
            const days = Math.floor(diffSec / 86400);
            return `${days} day${days !== 1 ? 's' : ''} ago`;
        }

        // Fall back to locale string
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    private statusChar(status: string): string {
        switch (status) {
            case 'Added': return 'A';
            case 'Modified': return 'M';
            case 'Deleted': return 'D';
            case 'Renamed': return 'R';
            case 'Copied': return 'C';
            default: return '?';
        }
    }

    private flashCopied(el: HTMLElement): void {
        const original = el.textContent;
        el.textContent = 'Copied!';
        el.classList.add('copied-flash');
        setTimeout(() => {
            el.textContent = original;
            el.classList.remove('copied-flash');
        }, 1200);
    }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    new CommitDetailsApp();
});
