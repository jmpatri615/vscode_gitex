import { FileListEntry } from './messageProtocol';

export type FileClickCallback = (path: string, leftSha: string, rightSha: string) => void;

export class FileListPane {
    private header: HTMLElement;
    private body: HTMLElement;
    private leftSha: string = '';
    private rightSha: string = '';

    constructor(
        private container: HTMLElement,
        private onFileClick: FileClickCallback,
    ) {
        this.header = document.createElement('div');
        this.header.className = 'file-list-header';
        this.container.appendChild(this.header);

        this.body = document.createElement('div');
        this.body.className = 'file-list-body';
        this.container.appendChild(this.body);

        this.clear();
    }

    setFiles(
        files: FileListEntry[],
        leftRef: string,
        rightRef: string,
        leftSha: string,
        rightSha: string,
    ): void {
        this.leftSha = leftSha;
        this.rightSha = rightSha;

        // Header
        this.header.textContent = `${files.length} file${files.length !== 1 ? 's' : ''} changed (${leftRef} \u2192 ${rightRef})`;

        // Body
        this.body.innerHTML = '';

        if (files.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'file-list-empty';
            empty.textContent = 'No changed files';
            this.body.appendChild(empty);
            return;
        }

        for (const file of files) {
            const entry = document.createElement('div');
            entry.className = 'file-list-entry';
            entry.addEventListener('click', () => {
                this.onFileClick(file.path, this.leftSha, this.rightSha);
            });

            // Status badge
            const badge = document.createElement('span');
            badge.className = `file-status file-status-${file.status.toLowerCase()}`;
            badge.textContent = `[${file.status}]`;
            entry.appendChild(badge);

            // File path
            const pathEl = document.createElement('span');
            pathEl.className = 'file-list-path';
            pathEl.textContent = file.oldPath
                ? `${file.oldPath} \u2192 ${file.path}`
                : file.path;
            pathEl.title = pathEl.textContent;
            entry.appendChild(pathEl);

            // Stats
            if (file.insertions > 0 || file.deletions > 0) {
                const stats = document.createElement('span');
                stats.className = 'file-list-stats';
                const parts: string[] = [];
                if (file.insertions > 0) { parts.push(`+${file.insertions}`); }
                if (file.deletions > 0) { parts.push(`-${file.deletions}`); }
                stats.textContent = parts.join(' ');
                entry.appendChild(stats);
            }

            this.body.appendChild(entry);
        }
    }

    clear(): void {
        this.header.textContent = '';
        this.body.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'file-list-empty';
        empty.textContent = 'Select a commit to see changed files';
        this.body.appendChild(empty);
    }
}
