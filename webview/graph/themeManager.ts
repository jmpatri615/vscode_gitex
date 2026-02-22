// ─── Theme Colors ───────────────────────────────────────────────────────────

export interface ThemeColors {
    background: string;
    foreground: string;
    selection: string;
    border: string;
    nodeDefault: string;
    headIndicator: string;
}

// 12-color palettes for branch lanes
const DARK_PALETTE: readonly string[] = [
    '#4fc1ff', '#6a9955', '#ce9178', '#569cd6',
    '#dcdcaa', '#c586c0', '#d7ba7d', '#9cdcfe',
    '#f44747', '#b5cea8', '#d16969', '#4ec9b0',
];

const LIGHT_PALETTE: readonly string[] = [
    '#0070c1', '#008000', '#a31515', '#0000ff',
    '#795e26', '#af00db', '#e07400', '#001080',
    '#cd3131', '#098658', '#800000', '#267f99',
];

// ─── CSS Variable Helpers ───────────────────────────────────────────────────

function getCssVar(name: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim();
    return value || fallback;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Detect whether the current VS Code theme is dark.
 * VS Code adds class "vscode-dark" or "vscode-light" on the body element.
 */
export function isDarkTheme(): boolean {
    return document.body.classList.contains('vscode-dark') ||
        document.body.classList.contains('vscode-high-contrast');
}

/**
 * Retrieve core theme colors from VS Code CSS custom properties.
 */
export function getThemeColors(): ThemeColors {
    return {
        background: getCssVar('--vscode-editor-background', isDarkTheme() ? '#1e1e1e' : '#ffffff'),
        foreground: getCssVar('--vscode-editor-foreground', isDarkTheme() ? '#d4d4d4' : '#333333'),
        selection: getCssVar('--gitex-graph-selectionBackground',
            getCssVar('--vscode-list-activeSelectionBackground', isDarkTheme() ? '#264f7840' : '#0060c040')),
        border: getCssVar('--vscode-panel-border', isDarkTheme() ? '#444444' : '#cccccc'),
        nodeDefault: getCssVar('--gitex-graph-nodeColor', isDarkTheme() ? '#569cd6' : '#0066b8'),
        headIndicator: getCssVar('--gitex-graph-headIndicator', isDarkTheme() ? '#dcdcaa' : '#795e26'),
    };
}

/**
 * Return a branch color for the given color_index, cycling through the palette.
 */
export function getBranchColor(index: number): string {
    const palette = isDarkTheme() ? DARK_PALETTE : LIGHT_PALETTE;
    return palette[index % palette.length];
}

/**
 * Return the full palette for the current theme.
 */
export function getPalette(): readonly string[] {
    return isDarkTheme() ? DARK_PALETTE : LIGHT_PALETTE;
}

// ─── Theme Change Observer ──────────────────────────────────────────────────

export type ThemeChangeCallback = () => void;

const listeners: ThemeChangeCallback[] = [];
let observer: MutationObserver | null = null;

/**
 * Register a callback that fires whenever VS Code changes theme.
 * Observes mutations on the body element's class attribute.
 */
export function onThemeChange(callback: ThemeChangeCallback): () => void {
    listeners.push(callback);

    // Set up the MutationObserver once
    if (!observer) {
        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    for (const listener of listeners) {
                        listener();
                    }
                    break;
                }
            }
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    // Return an unsubscribe function
    return () => {
        const idx = listeners.indexOf(callback);
        if (idx !== -1) {
            listeners.splice(idx, 1);
        }
        if (listeners.length === 0 && observer) {
            observer.disconnect();
            observer = null;
        }
    };
}
