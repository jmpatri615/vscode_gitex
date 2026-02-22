import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiffService } from '../../src/commit/diffService';
import { createMockGitCommands } from '../helpers/mockGitCommands';
import { sha1, sha2 } from '../fixtures/gitOutputs';
import { GITEX_SCHEME } from '../../src/git/gitUri';

function makeDiffService(overrides = {}) {
    const gitCommands = createMockGitCommands({
        getCommitDetails: async (sha: string) => ({
            sha,
            shortSha: sha.substring(0, 7),
            parents: [sha2],
            authorName: 'Alice',
            authorEmail: 'alice@test.com',
            authorDate: 1700000000,
            committerName: 'Alice',
            committerEmail: 'alice@test.com',
            commitDate: 1700000000,
            subject: 'Test commit',
            body: '',
            refs: [],
            changedFiles: [],
        }),
        getDiffWithWorkingTree: async () => [
            { path: 'src/main.ts', status: 'M' as const, insertions: 5, deletions: 2 },
        ],
        ...overrides,
    });
    return new DiffService(gitCommands as any);
}

// Track calls to vscode.commands.executeCommand
let executedCommands: { command: string; args: any[] }[] = [];
const originalExecuteCommand = vscode.commands.executeCommand;

suite('DiffService Test Suite', () => {

    setup(() => {
        executedCommands = [];
        // Spy on executeCommand
        (vscode.commands as any).executeCommand = (command: string, ...args: any[]) => {
            executedCommands.push({ command, args });
            return Promise.resolve();
        };
    });

    teardown(() => {
        (vscode.commands as any).executeCommand = originalExecuteCommand;
    });

    // --- diffCommits ---

    test('diffCommits opens vscode.diff with two gitex URIs', async () => {
        const service = makeDiffService();
        await service.diffCommits(sha1, sha2, 'src/main.ts');
        assert.strictEqual(executedCommands.length, 1);
        assert.strictEqual(executedCommands[0].command, 'vscode.diff');
        const [leftUri, rightUri, title] = executedCommands[0].args;
        assert.strictEqual(leftUri.scheme, GITEX_SCHEME);
        assert.strictEqual(rightUri.scheme, GITEX_SCHEME);
    });

    test('diffCommits title contains short SHAs', async () => {
        const service = makeDiffService();
        await service.diffCommits(sha1, sha2, 'src/main.ts');
        const title = executedCommands[0].args[2];
        assert.ok(title.includes(sha1.substring(0, 7)));
        assert.ok(title.includes(sha2.substring(0, 7)));
    });

    // --- diffWithParent ---

    test('diffWithParent uses first parent SHA', async () => {
        const service = makeDiffService();
        await service.diffWithParent(sha1, 'src/main.ts');
        assert.strictEqual(executedCommands.length, 1);
        assert.strictEqual(executedCommands[0].command, 'vscode.diff');
        const [leftUri] = executedCommands[0].args;
        // Left URI should reference the parent sha (sha2)
        assert.ok(leftUri.query.includes(sha2));
    });

    test('diffWithParent — root commit (no parent) uses empty URI', async () => {
        const service = makeDiffService({
            getCommitDetails: async (sha: string) => ({
                sha, shortSha: sha.substring(0, 7),
                parents: [],  // root commit
                authorName: 'Alice', authorEmail: 'a@e.com', authorDate: 0,
                committerName: 'Alice', committerEmail: 'a@e.com', commitDate: 0,
                subject: 'Initial', body: '', refs: [], changedFiles: [],
            }),
        });
        await service.diffWithParent(sha1, 'src/main.ts');
        assert.strictEqual(executedCommands.length, 1);
        const [leftUri] = executedCommands[0].args;
        // Left URI should be the empty gitex URI
        assert.ok(leftUri.toString().includes('empty'));
    });

    // --- diffWithWorkingTree ---

    test('diffWithWorkingTree — right URI is file scheme (editable)', async () => {
        const service = makeDiffService();
        await service.diffWithWorkingTree(sha1, 'src/main.ts', '/repo');
        assert.strictEqual(executedCommands.length, 1);
        const [leftUri, rightUri] = executedCommands[0].args;
        assert.strictEqual(leftUri.scheme, GITEX_SCHEME);
        assert.strictEqual(rightUri.scheme, 'file');
    });

    // --- diffStagedFile ---

    test('diffStagedFile — left is HEAD, right has ref=:0', async () => {
        const service = makeDiffService();
        await service.diffStagedFile('src/main.ts');
        assert.strictEqual(executedCommands.length, 1);
        const [leftUri, rightUri] = executedCommands[0].args;
        assert.ok(leftUri.query.includes('HEAD'));
        assert.ok(rightUri.query.includes(':0'));
    });

    // --- compareWithWorkingTree ---

    test('compareWithWorkingTree — 0 files shows info message', async () => {
        let infoShown = false;
        const origShowInfo = vscode.window.showInformationMessage;
        (vscode.window as any).showInformationMessage = () => {
            infoShown = true;
            return Promise.resolve(undefined);
        };

        const service = makeDiffService({
            getDiffWithWorkingTree: async () => [],
        });
        await service.compareWithWorkingTree(sha1);
        assert.ok(infoShown, 'Should show info message for no differences');

        (vscode.window as any).showInformationMessage = origShowInfo;
    });

    test('compareWithWorkingTree — 1 file opens diff directly', async () => {
        const service = makeDiffService({
            getDiffWithWorkingTree: async () => [
                { path: 'src/main.ts', status: 'M' as const, insertions: 1, deletions: 0 },
            ],
        });
        await service.compareWithWorkingTree(sha1);
        assert.strictEqual(executedCommands.length, 1);
        assert.strictEqual(executedCommands[0].command, 'vscode.diff');
    });
});
