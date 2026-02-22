import * as vscode from 'vscode';
import { GitCommands } from './gitCommands';

export const GITEX_SCHEME = 'gitex';

/**
 * TextDocumentContentProvider for viewing files at specific commits.
 * Registers the `gitex:` URI scheme.
 *
 * URI format: gitex://sha/path/to/file?ref=<sha>
 */
export class GitExContentProvider implements vscode.TextDocumentContentProvider {
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    constructor(private gitCommands: GitCommands) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const sha = uri.query.split('=')[1] || uri.authority;
        const filePath = uri.path.startsWith('/') ? uri.path.substring(1) : uri.path;

        try {
            return await this.gitCommands.getFileAtCommit(sha, filePath);
        } catch (error) {
            return `// Error: Could not retrieve ${filePath} at ${sha}\n// ${error}`;
        }
    }

    dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}

/**
 * Create a gitex: URI for viewing a file at a specific commit.
 */
export function createGitUri(sha: string, filePath: string): vscode.Uri {
    return vscode.Uri.parse(`${GITEX_SCHEME}://${sha}/${filePath}?ref=${sha}`);
}

/**
 * Create a URI for a file in the working tree (real file on disk).
 */
export function createWorkingTreeUri(repoRoot: string, filePath: string): vscode.Uri {
    return vscode.Uri.file(`${repoRoot}/${filePath}`);
}
