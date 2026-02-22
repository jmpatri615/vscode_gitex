import * as vscode from 'vscode';
import { BlameService } from './blameService';
import { BlameEntry } from '../common/types';
import { configuration } from '../common/configuration';
import { formatDate } from './blameUtils';

export class BlameDecorationManager implements vscode.Disposable {
    private inlineDecorationType: vscode.TextEditorDecorationType;
    private gutterDecorationTypes: vscode.TextEditorDecorationType[] = [];
    private debounceTimer: NodeJS.Timeout | undefined;
    private currentEditor: vscode.TextEditor | undefined;
    private currentEntries: BlameEntry[] = [];
    private gutterEnabled = false;
    private disposables: vscode.Disposable[] = [];

    constructor(private blameService: BlameService) {
        this.inlineDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                color: new vscode.ThemeColor('gitex.blame.inlineColor'),
                fontStyle: 'italic',
                margin: '0 0 0 3em',
            },
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
        });

        // Listen for cursor movement
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection(e => {
                if (configuration.blameInlineEnabled) {
                    this.onCursorMove(e.textEditor);
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.clearInlineDecorations();
                if (editor && configuration.blameInlineEnabled) {
                    this.onCursorMove(editor);
                }
                if (editor && this.gutterEnabled) {
                    this.showGutterBlame(editor);
                }
            }),
            vscode.workspace.onDidChangeTextDocument(e => {
                // Clear decorations for modified lines
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === e.document) {
                    this.blameService.invalidateCache(e.document.uri.fsPath);
                    this.clearInlineDecorations();
                    if (this.gutterEnabled) {
                        this.clearGutterDecorations();
                    }
                }
            }),
        );
    }

    private onCursorMove(editor: vscode.TextEditor): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.updateInlineBlame(editor);
        }, configuration.blameInlineDelay);
    }

    private async updateInlineBlame(editor: vscode.TextEditor): Promise<void> {
        if (!configuration.blameInlineEnabled) {
            this.clearInlineDecorations();
            return;
        }

        const line = editor.selection.active.line;
        const filePath = editor.document.uri.fsPath;

        // Don't blame unsaved or untitled files
        if (editor.document.isUntitled || editor.document.isDirty) {
            const decoration: vscode.DecorationOptions = {
                range: new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
                renderOptions: {
                    after: { contentText: '  (unsaved)' },
                },
            };
            editor.setDecorations(this.inlineDecorationType, [decoration]);
            return;
        }

        const entry = await this.blameService.getBlameForLine(filePath, line + 1); // git blame is 1-indexed
        if (!entry) {
            this.clearInlineDecorations();
            return;
        }

        const text = this.formatInlineBlame(entry);
        const decoration: vscode.DecorationOptions = {
            range: new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
            renderOptions: {
                after: { contentText: `  ${text}` },
            },
        };
        editor.setDecorations(this.inlineDecorationType, [decoration]);
    }

    private formatInlineBlame(entry: BlameEntry): string {
        const format = configuration.blameInlineFormat;
        return format
            .replace('${author}', entry.authorName)
            .replace('${date}', formatDate(entry.authorDate, configuration.blameInlineDateFormat))
            .replace('${message}', entry.summary || '')
            .replace('${sha}', entry.shortSha)
            .replace('${email}', entry.authorEmail || '');
    }

    async showGutterBlame(editor: vscode.TextEditor): Promise<void> {
        this.gutterEnabled = true;
        const filePath = editor.document.uri.fsPath;
        const entries = await this.blameService.getBlame(filePath);
        this.currentEntries = entries;
        this.currentEditor = editor;
        this.renderGutterDecorations(editor, entries);
    }

    hideGutterBlame(): void {
        this.gutterEnabled = false;
        this.clearGutterDecorations();
    }

    toggleGutterBlame(editor: vscode.TextEditor): void {
        if (this.gutterEnabled) {
            this.hideGutterBlame();
        } else {
            this.showGutterBlame(editor);
        }
    }

    private renderGutterDecorations(editor: vscode.TextEditor, entries: BlameEntry[]): void {
        this.clearGutterDecorations();

        const colorMode = configuration.blameGutterColorMode;
        const decorationMap = new Map<string, vscode.DecorationOptions[]>();

        // Group entries by SHA for block grouping
        let lastSha = '';
        for (const entry of entries) {
            for (let i = 0; i < entry.numLines; i++) {
                const line = entry.finalLine - 1 + i; // 0-indexed
                if (line >= editor.document.lineCount) { break; }

                const isBlockStart = entry.sha !== lastSha || i === 0;
                const text = isBlockStart
                    ? `${entry.authorName.padEnd(15).substring(0, 15)} ${formatDate(entry.authorDate, 'relative').padEnd(12).substring(0, 12)} ${entry.shortSha}`
                    : '';

                const colorKey = colorMode === 'age'
                    ? getAgeColorKey(entry.authorDate)
                    : getAuthorColorKey(entry.authorName);

                if (!decorationMap.has(colorKey)) {
                    decorationMap.set(colorKey, []);
                }
                decorationMap.get(colorKey)!.push({
                    range: new vscode.Range(line, 0, line, 0),
                    renderOptions: {
                        before: {
                            contentText: text,
                            width: '280px',
                            fontStyle: 'normal',
                        },
                    },
                });

                lastSha = entry.sha;
            }
        }

        // Create decoration types for each color
        for (const [colorKey, decorations] of decorationMap) {
            const decType = vscode.window.createTextEditorDecorationType({
                before: {
                    color: colorKey,
                    margin: '0 1em 0 0',
                },
                isWholeLine: false,
            });
            editor.setDecorations(decType, decorations);
            this.gutterDecorationTypes.push(decType);
        }
    }

    private clearInlineDecorations(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.setDecorations(this.inlineDecorationType, []);
        }
    }

    private clearGutterDecorations(): void {
        for (const decType of this.gutterDecorationTypes) {
            decType.dispose();
        }
        this.gutterDecorationTypes = [];
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.inlineDecorationType.dispose();
        this.clearGutterDecorations();
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}

function getAgeColorKey(epoch: number): string {
    const ageMs = Date.now() - epoch * 1000;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Gradient from warm (recent) to cool (old)
    if (ageDays < 7) { return '#e2c08d'; }
    if (ageDays < 30) { return '#c4a86c'; }
    if (ageDays < 90) { return '#9b9b6b'; }
    if (ageDays < 365) { return '#6a8a8b'; }
    return '#4a6a9b';
}

function getAuthorColorKey(author: string): string {
    const colors = ['#4fc1ff', '#6a9955', '#ce9178', '#569cd6', '#dcdcaa',
                     '#c586c0', '#d7ba7d', '#9cdcfe', '#f44747', '#b5cea8'];
    let hash = 0;
    for (let i = 0; i < author.length; i++) {
        hash = ((hash << 5) - hash) + author.charCodeAt(i);
        hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
}
