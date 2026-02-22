import * as vscode from 'vscode';
import { GitCommands } from '../git/gitCommands';
import { createGitUri, createWorkingTreeUri, createStagedUri } from '../git/gitUri';
import { logError } from '../common/outputChannel';

export class DiffService {
    constructor(private gitCommands: GitCommands) {}

    /**
     * Open a diff between two commits for a specific file.
     * Both sides are read-only.
     */
    async diffCommits(sha1: string, sha2: string, filePath: string): Promise<void> {
        const leftUri = createGitUri(sha1, filePath);
        const rightUri = createGitUri(sha2, filePath);
        const title = `${filePath} (${sha1.substring(0, 7)} ↔ ${sha2.substring(0, 7)})`;

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    /**
     * Open a diff between a commit and its parent for a file.
     * Both sides are read-only.
     */
    async diffWithParent(sha: string, filePath: string): Promise<void> {
        try {
            const details = await this.gitCommands.getCommitDetails(sha);
            const parentSha = details.parents[0];

            if (parentSha) {
                await this.diffCommits(parentSha, sha, filePath);
            } else {
                // Root commit — diff with empty
                const rightUri = createGitUri(sha, filePath);
                const title = `${filePath} (${sha.substring(0, 7)} — new file)`;
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    vscode.Uri.parse('gitex://empty/'),
                    rightUri,
                    title
                );
            }
        } catch (error) {
            logError(`Failed to diff with parent: ${sha}`, error);
        }
    }

    /**
     * Open a diff between a commit and the working tree for a file.
     * Left side (commit) is read-only; right side (working tree) is EDITABLE.
     */
    async diffWithWorkingTree(sha: string, filePath: string, repoRoot: string): Promise<void> {
        const leftUri = createGitUri(sha, filePath);
        const rightUri = createWorkingTreeUri(repoRoot, filePath);
        const title = `${filePath} (${sha.substring(0, 7)} vs Working Tree)`;

        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    /**
     * Open a diff between HEAD and staged content for a file.
     */
    async diffStagedFile(filePath: string): Promise<void> {
        const leftUri = createGitUri('HEAD', filePath);
        const rightUri = createStagedUri(filePath);
        const title = `${filePath} (HEAD vs Staged)`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    /**
     * Open the Compare with Working Tree flow for a commit.
     * Shows list of changed files, clicking opens editable diff.
     */
    async compareWithWorkingTree(sha: string): Promise<void> {
        try {
            const files = await this.gitCommands.getDiffWithWorkingTree(sha);
            const repoRoot = this.gitCommands['git'].getRepoRoot();

            if (files.length === 0) {
                vscode.window.showInformationMessage('No differences with working tree');
                return;
            }

            if (files.length === 1) {
                // Single file — open diff directly
                await this.diffWithWorkingTree(sha, files[0].path, repoRoot);
                return;
            }

            // Multiple files — show quick pick
            const items = files.map(f => ({
                label: `$(diff) [${f.status}] ${f.path}`,
                description: `+${f.insertions} -${f.deletions}`,
                path: f.path,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Changed files between ${sha.substring(0, 7)} and working tree`,
            });

            if (selected) {
                await this.diffWithWorkingTree(sha, selected.path, repoRoot);
            }
        } catch (error) {
            logError(`Failed to compare with working tree: ${sha}`, error);
            vscode.window.showErrorMessage('GitEx: Failed to compare with working tree');
        }
    }

    /**
     * Register diff-related commands.
     */
    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('gitex.showCommitDetails', (sha: string) => {
                // Handled by CommitDetailsProvider — this is registered there
            }),
            vscode.commands.registerCommand('gitex.compareCommits', (sha1: string, sha2: string) => {
                // Handled by CommitComparisonProvider
            }),
            vscode.commands.registerCommand('gitex.compareWithWorkingTree', (sha: string) => {
                this.compareWithWorkingTree(sha);
            }),
        );
    }
}
