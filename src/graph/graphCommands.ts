import * as vscode from 'vscode';
import { GitCommands } from '../git/gitCommands';
import { GraphViewProvider } from './graphViewProvider';
import { GraphDataProvider } from './graphDataProvider';
import { log, logError, showOutputChannel } from '../common/outputChannel';
import { configuration } from '../common/configuration';
import { isValidSha, isValidRefName } from '../common/validation';

export class GraphCommandHandler {
    constructor(
        private gitCommands: GitCommands,
        private viewProvider: GraphViewProvider,
        private dataProvider: GraphDataProvider,
    ) {}

    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('gitex.openGraph', () => this.openGraph()),
            vscode.commands.registerCommand('gitex.refreshGraph', () => this.refreshGraph()),
            vscode.commands.registerCommand('gitex.jumpToCommit', () => this.jumpToCommit()),
            vscode.commands.registerCommand('gitex.checkoutRevision', (sha: string) => this.checkout(sha)),
            vscode.commands.registerCommand('gitex.checkoutBranch', (branch: string) => this.checkout(branch)),
            vscode.commands.registerCommand('gitex.createBranch', (sha: string) => this.createBranch(sha)),
            vscode.commands.registerCommand('gitex.createTag', (sha: string) => this.createTag(sha)),
            vscode.commands.registerCommand('gitex.mergeBranch', (ref: string) => this.merge(ref)),
            vscode.commands.registerCommand('gitex.rebaseBranch', (ref: string) => this.rebase(ref)),
            vscode.commands.registerCommand('gitex.interactiveRebase', (sha: string) => this.interactiveRebase(sha)),
            vscode.commands.registerCommand('gitex.cherryPick', (sha: string) => this.cherryPick([sha])),
            vscode.commands.registerCommand('gitex.cherryPickSelected', (shas: string[]) => this.cherryPick(shas)),
            vscode.commands.registerCommand('gitex.resetSoft', (sha: string) => this.reset(sha, 'soft')),
            vscode.commands.registerCommand('gitex.resetMixed', (sha: string) => this.reset(sha, 'mixed')),
            vscode.commands.registerCommand('gitex.resetHard', (sha: string) => this.reset(sha, 'hard')),
            vscode.commands.registerCommand('gitex.revertCommit', (sha: string) => this.revert(sha)),
            vscode.commands.registerCommand('gitex.stashChanges', () => this.stashPush()),
            vscode.commands.registerCommand('gitex.stashPop', (index: number) => this.stashPop(index)),
            vscode.commands.registerCommand('gitex.stashApply', (index: number) => this.stashApply(index)),
            vscode.commands.registerCommand('gitex.stashDrop', (index: number) => this.stashDrop(index)),
            vscode.commands.registerCommand('gitex.copySha', (sha: string) => this.copySha(sha)),
            vscode.commands.registerCommand('gitex.copyShortSha', (sha: string) => this.copyShortSha(sha)),
            vscode.commands.registerCommand('gitex.copyMessage', (sha: string) => this.copyMessage(sha)),
        );
    }

    private async openGraph(): Promise<void> {
        await vscode.commands.executeCommand('gitex.graphView.focus');
    }

    private async refreshGraph(): Promise<void> {
        await this.viewProvider.refresh();
    }

    private async jumpToCommit(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter commit SHA, branch name, or tag',
            placeHolder: 'e.g., abc1234, main, v1.0',
        });
        if (!input) { return; }

        const sha = await this.gitCommands.revParse(input);
        if (sha) {
            this.viewProvider.setSelection(sha);
        } else {
            vscode.window.showErrorMessage(`Could not resolve: ${input}`);
        }
    }

    private async checkout(ref: string): Promise<void> {
        // Check for dirty working tree
        const status = await this.gitCommands.getRepoStatus();
        if (status.isDirty) {
            const choice = await vscode.window.showWarningMessage(
                'You have uncommitted changes. What would you like to do?',
                'Stash & Checkout', 'Discard & Checkout', 'Cancel'
            );
            if (choice === 'Stash & Checkout') {
                await this.gitCommands.stashPush('Auto-stash before checkout');
            } else if (choice !== 'Discard & Checkout') {
                return;
            }
        }

        const result = await this.gitCommands.checkout(ref);
        if (result.exitCode === 0) {
            this.showSuccess(`Checked out ${ref}`);
            await this.refreshGraph();
        } else {
            this.showError(`Checkout failed`, result.stderr);
        }
    }

    private async createBranch(sha: string): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter new branch name',
            placeHolder: 'feature/my-branch',
            validateInput: (value) => {
                if (!value.trim()) { return 'Branch name is required'; }
                if (/\s/.test(value)) { return 'Branch name cannot contain spaces'; }
                if (!isValidRefName(value)) { return 'Invalid branch name'; }
                return null;
            },
        });
        if (!name) { return; }

        const result = await this.gitCommands.createBranch(name, sha);
        if (result.exitCode === 0) {
            this.showSuccess(`Branch '${name}' created`);
            await this.refreshGraph();
        } else {
            this.showError('Create branch failed', result.stderr);
        }
    }

    private async createTag(sha: string): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter tag name',
            placeHolder: 'v1.0.0',
        });
        if (!name) { return; }
        if (!isValidRefName(name)) {
            vscode.window.showErrorMessage('GitEx: Invalid tag name');
            return;
        }

        const message = await vscode.window.showInputBox({
            prompt: 'Enter tag message (leave empty for lightweight tag)',
            placeHolder: 'Release version 1.0.0',
        });

        const result = await this.gitCommands.createTag(name, sha, message || undefined);
        if (result.exitCode === 0) {
            this.showSuccess(`Tag '${name}' created`);
            await this.refreshGraph();
        } else {
            this.showError('Create tag failed', result.stderr);
        }
    }

    private async merge(ref: string): Promise<void> {
        const result = await this.gitCommands.merge(ref);
        if (result.exitCode === 0) {
            this.showSuccess(`Merged ${ref}`);
            await this.refreshGraph();
        } else {
            this.showError('Merge failed', result.stderr);
        }
    }

    private async rebase(ref: string): Promise<void> {
        const status = await this.gitCommands.getRepoStatus();
        if (status.isDirty && !configuration.autoStashOnRebase) {
            const choice = await vscode.window.showWarningMessage(
                'You have uncommitted changes. Stash before rebase?',
                'Stash & Rebase', 'Cancel'
            );
            if (choice !== 'Stash & Rebase') { return; }
            await this.gitCommands.stashPush('Auto-stash before rebase');
        }

        const result = await this.gitCommands.rebase(ref);
        if (result.exitCode === 0) {
            this.showSuccess(`Rebased onto ${ref}`);
            await this.refreshGraph();
        } else {
            this.showError('Rebase failed', result.stderr);
        }
    }

    private async interactiveRebase(sha: string): Promise<void> {
        if (!isValidSha(sha)) {
            vscode.window.showErrorMessage('GitEx: Invalid commit SHA');
            return;
        }
        const terminal = vscode.window.createTerminal('GitEx: Interactive Rebase');
        terminal.show();
        terminal.sendText(`git rebase -i ${sha}`);
    }

    private async cherryPick(shas: string[]): Promise<void> {
        const result = await this.gitCommands.cherryPick(shas);
        if (result.exitCode === 0) {
            this.showSuccess(`Cherry-picked ${shas.length} commit(s)`);
            await this.refreshGraph();
        } else {
            this.showError('Cherry-pick failed', result.stderr);
        }
    }

    private async reset(sha: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
        if (mode === 'hard' && configuration.confirmHardReset) {
            const confirm = await vscode.window.showWarningMessage(
                'This will discard all changes. Cannot be undone. Continue?',
                { modal: true },
                'Reset Hard'
            );
            if (confirm !== 'Reset Hard') { return; }
        }

        let result;
        switch (mode) {
            case 'soft': result = await this.gitCommands.resetSoft(sha); break;
            case 'mixed': result = await this.gitCommands.resetMixed(sha); break;
            case 'hard': result = await this.gitCommands.resetHard(sha); break;
        }

        if (result.exitCode === 0) {
            this.showSuccess(`Reset (${mode}) to ${sha.substring(0, 7)}`);
            await this.refreshGraph();
        } else {
            this.showError(`Reset (${mode}) failed`, result.stderr);
        }
    }

    private async revert(sha: string): Promise<void> {
        const result = await this.gitCommands.revert(sha);
        if (result.exitCode === 0) {
            this.showSuccess(`Reverted ${sha.substring(0, 7)}`);
            await this.refreshGraph();
        } else {
            this.showError('Revert failed', result.stderr);
        }
    }

    private async stashPush(): Promise<void> {
        const message = await vscode.window.showInputBox({
            prompt: 'Enter stash message (optional)',
            placeHolder: 'WIP: description',
        });
        const result = await this.gitCommands.stashPush(message || undefined);
        if (result.exitCode === 0) {
            this.showSuccess('Changes stashed');
            await this.refreshGraph();
        } else {
            this.showError('Stash failed', result.stderr);
        }
    }

    private async stashPop(index: number): Promise<void> {
        const result = await this.gitCommands.stashPop(index);
        if (result.exitCode === 0) {
            this.showSuccess('Stash popped');
            await this.refreshGraph();
        } else {
            this.showError('Stash pop failed', result.stderr);
        }
    }

    private async stashApply(index: number): Promise<void> {
        const result = await this.gitCommands.stashApply(index);
        if (result.exitCode === 0) {
            this.showSuccess('Stash applied');
            await this.refreshGraph();
        } else {
            this.showError('Stash apply failed', result.stderr);
        }
    }

    private async stashDrop(index: number): Promise<void> {
        if (configuration.confirmStashDrop) {
            const confirm = await vscode.window.showWarningMessage(
                'Drop this stash? This cannot be undone.',
                { modal: true },
                'Drop Stash'
            );
            if (confirm !== 'Drop Stash') { return; }
        }

        const result = await this.gitCommands.stashDrop(index);
        if (result.exitCode === 0) {
            this.showSuccess('Stash dropped');
            await this.refreshGraph();
        } else {
            this.showError('Stash drop failed', result.stderr);
        }
    }

    private async copySha(sha: string): Promise<void> {
        await vscode.env.clipboard.writeText(sha);
        vscode.window.showInformationMessage('SHA copied to clipboard');
    }

    private async copyShortSha(sha: string): Promise<void> {
        await vscode.env.clipboard.writeText(sha.substring(0, 7));
        vscode.window.showInformationMessage('Short SHA copied to clipboard');
    }

    private async copyMessage(sha: string): Promise<void> {
        try {
            const details = await this.gitCommands.getCommitDetails(sha);
            await vscode.env.clipboard.writeText(details.subject);
            vscode.window.showInformationMessage('Commit message copied to clipboard');
        } catch (error) {
            logError('Failed to copy message', error);
        }
    }

    private showSuccess(message: string): void {
        log(message);
        vscode.window.showInformationMessage(`GitEx: ${message}`);
    }

    private showError(message: string, stderr: string): void {
        logError(`${message}: ${stderr}`);
        vscode.window.showErrorMessage(`GitEx: ${message}`, 'Open Output').then(choice => {
            if (choice === 'Open Output') { showOutputChannel(); }
        });
    }
}
