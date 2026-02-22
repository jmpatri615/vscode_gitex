import * as vscode from 'vscode';
import { BlameService } from './blameService';
import { configuration } from '../common/configuration';
import { formatDate } from './blameUtils';

export class BlameHoverProvider implements vscode.HoverProvider {
    constructor(private blameService: BlameService) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): Promise<vscode.Hover | null> {
        if (!configuration.blameHoverEnabled) {
            return null;
        }

        if (document.isUntitled) {
            return null;
        }

        const filePath = document.uri.fsPath;
        const line = position.line + 1; // 1-indexed for git

        try {
            const entry = await this.blameService.getBlameForLine(filePath, line);
            if (!entry) { return null; }

            const markdown = new vscode.MarkdownString();
            markdown.isTrusted = true;
            markdown.supportHtml = true;

            markdown.appendMarkdown(`### $(git-commit) ${entry.shortSha}\n\n`);
            markdown.appendMarkdown(`**Author:** ${entry.authorName} \\<${entry.authorEmail}\\>\n\n`);

            if (entry.committerName && entry.committerName !== entry.authorName) {
                markdown.appendMarkdown(`**Committer:** ${entry.committerName} \\<${entry.committerEmail}\\>\n\n`);
            }

            markdown.appendMarkdown(`**Date:** ${formatDate(entry.authorDate, 'iso')} (${formatDate(entry.authorDate, 'relative')})\n\n`);
            markdown.appendMarkdown('---\n\n');
            markdown.appendMarkdown(`${entry.summary || ''}\n\n`);
            markdown.appendMarkdown('---\n\n');

            // Action links
            markdown.appendMarkdown(
                `[Open in Graph](command:gitex.jumpToCommit?${encodeURIComponent(JSON.stringify([entry.sha]))}) ` +
                `| [Show Details](command:gitex.showCommitDetails?${encodeURIComponent(JSON.stringify([entry.sha]))})`
            );

            return new vscode.Hover(markdown, document.validateRange(
                new vscode.Range(position.line, 0, position.line, Number.MAX_SAFE_INTEGER)
            ));
        } catch {
            return null;
        }
    }
}
