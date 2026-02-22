import * as vscode from 'vscode';
import { LayoutNode } from '../common/types';
import { GraphDataProvider } from './graphDataProvider';

interface MenuAction {
    label: string;
    command: string;
    args?: any[];
    group: string;
}

export class GraphMenuHandler {
    private selectedShas: string[] = [];

    constructor(private dataProvider: GraphDataProvider) {}

    setSelection(shas: string[]): void {
        this.selectedShas = shas;
    }

    async showContextMenu(sha: string): Promise<void> {
        const node = this.dataProvider.findNodeBySha(sha);
        if (!node) { return; }

        const actions = this.buildMenuActions(node);
        const items: vscode.QuickPickItem[] = [];
        let lastGroup = '';

        for (const action of actions) {
            if (action.group !== lastGroup && items.length > 0) {
                items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            }
            items.push({ label: action.label, description: action.group });
            lastGroup = action.group;
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Actions for ${node.shortSha} — ${node.subject}`,
        });

        if (selected) {
            const action = actions.find(a => a.label === selected.label);
            if (action) {
                await vscode.commands.executeCommand(action.command, ...(action.args || [sha]));
            }
        }
    }

    private buildMenuActions(node: LayoutNode): MenuAction[] {
        const sha = node.sha;
        const actions: MenuAction[] = [];

        // Checkout
        actions.push({ label: 'Checkout Revision', command: 'gitex.checkoutRevision', args: [sha], group: 'Checkout' });
        for (const ref of node.refs) {
            if (ref.refType === 'Branch' && !ref.isHead) {
                actions.push({ label: `Checkout Branch '${ref.name}'`, command: 'gitex.checkoutBranch', args: [ref.name], group: 'Checkout' });
            }
        }
        actions.push({ label: 'Create Branch Here...', command: 'gitex.createBranch', args: [sha], group: 'Checkout' });
        actions.push({ label: 'Create Tag Here...', command: 'gitex.createTag', args: [sha], group: 'Checkout' });

        // Branch operations
        for (const ref of node.refs) {
            if (ref.refType === 'Branch' || ref.refType === 'RemoteBranch') {
                actions.push({ label: `Merge '${ref.name}' into Current Branch`, command: 'gitex.mergeBranch', args: [ref.name], group: 'Branch Ops' });
                actions.push({ label: `Rebase Current Branch onto '${ref.name}'`, command: 'gitex.rebaseBranch', args: [ref.name], group: 'Branch Ops' });
            }
        }
        actions.push({ label: 'Interactive Rebase...', command: 'gitex.interactiveRebase', args: [sha], group: 'Branch Ops' });

        // Cherry-pick
        actions.push({ label: 'Cherry-pick This Commit', command: 'gitex.cherryPick', args: [sha], group: 'Cherry-pick' });
        if (this.selectedShas.length > 1) {
            actions.push({ label: `Cherry-pick ${this.selectedShas.length} Selected Commits`, command: 'gitex.cherryPickSelected', args: [this.selectedShas], group: 'Cherry-pick' });
        }

        // Reset
        actions.push({ label: 'Reset (Soft)', command: 'gitex.resetSoft', args: [sha], group: 'Reset' });
        actions.push({ label: 'Reset (Mixed)', command: 'gitex.resetMixed', args: [sha], group: 'Reset' });
        actions.push({ label: 'Reset (Hard)', command: 'gitex.resetHard', args: [sha], group: 'Reset' });

        // Revert
        actions.push({ label: 'Revert This Commit', command: 'gitex.revertCommit', args: [sha], group: 'Revert' });

        // Stash (only for stash nodes)
        if (node.nodeType === 'Stash') {
            const stashIndex = this.extractStashIndex(node);
            if (stashIndex !== null) {
                actions.push({ label: 'Pop Stash', command: 'gitex.stashPop', args: [stashIndex], group: 'Stash' });
                actions.push({ label: 'Apply Stash', command: 'gitex.stashApply', args: [stashIndex], group: 'Stash' });
                actions.push({ label: 'Drop Stash', command: 'gitex.stashDrop', args: [stashIndex], group: 'Stash' });
            }
        }

        // Diff
        actions.push({ label: 'Compare with Working Tree', command: 'gitex.compareWithWorkingTree', args: [sha], group: 'Diff' });
        actions.push({ label: 'Compare with HEAD', command: 'gitex.showCommitDetails', args: [sha], group: 'Diff' });
        if (this.selectedShas.length === 2) {
            actions.push({ label: 'Compare Selected Commits', command: 'gitex.compareCommits', args: this.selectedShas, group: 'Diff' });
        }

        // Copy
        actions.push({ label: 'Copy SHA', command: 'gitex.copySha', args: [sha], group: 'Copy' });
        actions.push({ label: 'Copy Short SHA', command: 'gitex.copyShortSha', args: [sha], group: 'Copy' });
        actions.push({ label: 'Copy Commit Message', command: 'gitex.copyMessage', args: [sha], group: 'Copy' });

        return actions;
    }

    private extractStashIndex(node: LayoutNode): number | null {
        const stashRef = node.refs.find(r => r.refType === 'Stash');
        if (stashRef) {
            const match = stashRef.name.match(/\{(\d+)\}/);
            if (match) { return parseInt(match[1], 10); }
        }
        return 0; // Default to most recent stash
    }
}
