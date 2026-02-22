import * as assert from 'assert';
import * as vscode from 'vscode';
import { GraphViewProvider } from '../../src/graph/graphViewProvider';
import { GraphDataProvider } from '../../src/graph/graphDataProvider';
import { createMockGitCommands } from '../helpers/mockGitCommands';
import { createMockWebviewView } from '../helpers/mockWebview';
import { LOG_LINEAR_3_COMMITS, sha1, sha2, sha3 } from '../fixtures/gitOutputs';
import { WORKING_DIR_SHA, COMMIT_INDEX_SHA, ChangedFile } from '../../src/common/types';

const testFiles: ChangedFile[] = [
    { path: 'src/main.ts', status: 'M', insertions: 5, deletions: 2 },
    { path: 'src/new.ts', status: 'A', insertions: 10, deletions: 0 },
];

function makeViewProvider(gitOverrides = {}) {
    const gitCommands = createMockGitCommands({
        getLogRaw: async () => Buffer.from(LOG_LINEAR_3_COMMITS),
        getTotalCommitCount: async () => 3,
        getChangedFiles: async () => testFiles,
        getDiffBetweenCommits: async () => testFiles,
        getDiffWithWorkingTree: async () => testFiles,
        getStagedFiles: async () => testFiles,
        getUnstagedFiles: async () => [],
        getUntrackedFiles: async () => [],
        getDiffBetweenIndexAndCommit: async () => testFiles,
        getDiffBetweenIndexAndWorkingTree: async () => testFiles,
        revParse: async () => sha1,
        getRepoStatus: async () => ({
            hasRepo: true, repoRoot: '/mock/repo', head: '', branch: 'main',
            isDirty: false, isMerging: false, isRebasing: false,
        }),
        ...gitOverrides,
    });
    const dataProvider = new GraphDataProvider(gitCommands as any);
    const onCommitSelected = () => {};
    const onContextMenu = () => {};

    const provider = new GraphViewProvider(
        vscode.Uri.file('/mock/extension'),
        dataProvider,
        gitCommands as any,
        onCommitSelected,
        onContextMenu,
    );

    const mock = createMockWebviewView();

    // Resolve the webview view — this registers the message handler
    provider.resolveWebviewView(
        mock.webviewView,
        {} as any,
        { isCancellationRequested: false, onCancellationRequested: (() => ({ dispose: () => {} })) as any } as any,
    );

    return { provider, mock, gitCommands };
}

suite('GraphViewProvider Test Suite', () => {

    // --- formatRef (tested via private access) ---

    suite('formatRef', () => {

        test('WORKING_DIR_SHA returns "Working Tree"', () => {
            const { provider } = makeViewProvider();
            const result = (provider as any).formatRef(WORKING_DIR_SHA);
            assert.strictEqual(result, 'Working Tree');
        });

        test('COMMIT_INDEX_SHA returns "Index"', () => {
            const { provider } = makeViewProvider();
            const result = (provider as any).formatRef(COMMIT_INDEX_SHA);
            assert.strictEqual(result, 'Index');
        });

        test('"HEAD" returns "HEAD"', () => {
            const { provider } = makeViewProvider();
            const result = (provider as any).formatRef('HEAD');
            assert.strictEqual(result, 'HEAD');
        });

        test('long SHA truncated to 7 chars', () => {
            const { provider } = makeViewProvider();
            const result = (provider as any).formatRef(sha1);
            assert.strictEqual(result, sha1.substring(0, 7));
        });

        test('"sha^" preserves caret with truncation', () => {
            const { provider } = makeViewProvider();
            const result = (provider as any).formatRef(sha1 + '^');
            assert.strictEqual(result, sha1.substring(0, 7) + '^');
        });

        test('short ref returned as-is', () => {
            const { provider } = makeViewProvider();
            const result = (provider as any).formatRef('abc1234');
            assert.strictEqual(result, 'abc1234');
        });
    });

    // --- fetchAndSendFileList (tested via commitClick message) ---

    suite('fetchAndSendFileList', () => {

        test('0 shas sends fileListClear', async () => {
            const { mock } = makeViewProvider();
            mock.clearPostedMessages();
            await mock.simulateMessage({ type: 'selectionCleared' });
            const msgs = mock.getPostedMessages();
            assert.ok(msgs.some(m => m.type === 'fileListClear'));
        });

        test('3+ shas sends fileListClear', async () => {
            const { mock } = makeViewProvider();
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: sha1,
                selectedShas: [sha1, sha2, sha3],
            });
            const msgs = mock.getPostedMessages();
            assert.ok(msgs.some(m => m.type === 'fileListClear'));
        });

        test('single WORKING_DIR_SHA calls getDiffWithWorkingTree', async () => {
            let calledDiffWorkingTree = false;
            const { mock } = makeViewProvider({
                getDiffWithWorkingTree: async () => {
                    calledDiffWorkingTree = true;
                    return testFiles;
                },
            });
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: WORKING_DIR_SHA,
                selectedShas: [WORKING_DIR_SHA],
            });
            assert.ok(calledDiffWorkingTree, 'Should call getDiffWithWorkingTree');
            const fileListMsg = mock.getPostedMessages().find(m => m.type === 'fileListData');
            assert.ok(fileListMsg);
            assert.strictEqual(fileListMsg.leftRef, 'HEAD');
            assert.strictEqual(fileListMsg.rightRef, 'Working Tree');
        });

        test('single COMMIT_INDEX_SHA calls getStagedFiles', async () => {
            let calledGetStaged = false;
            const { mock } = makeViewProvider({
                getStagedFiles: async () => {
                    calledGetStaged = true;
                    return testFiles;
                },
            });
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: COMMIT_INDEX_SHA,
                selectedShas: [COMMIT_INDEX_SHA],
            });
            assert.ok(calledGetStaged, 'Should call getStagedFiles');
            const fileListMsg = mock.getPostedMessages().find(m => m.type === 'fileListData');
            assert.ok(fileListMsg);
            assert.strictEqual(fileListMsg.rightRef, 'Index');
        });

        test('single real SHA calls getChangedFiles with leftRef="sha^"', async () => {
            let calledGetChanged = false;
            const { mock } = makeViewProvider({
                getChangedFiles: async () => {
                    calledGetChanged = true;
                    return testFiles;
                },
            });
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: sha1,
                selectedShas: [sha1],
            });
            assert.ok(calledGetChanged, 'Should call getChangedFiles');
            const fileListMsg = mock.getPostedMessages().find(m => m.type === 'fileListData');
            assert.ok(fileListMsg);
            assert.strictEqual(fileListMsg.leftRef, sha1.substring(0, 7) + '^');
            assert.strictEqual(fileListMsg.rightRef, sha1.substring(0, 7));
        });

        test('two real SHAs calls getDiffBetweenCommits', async () => {
            let calledDiffBetween = false;
            const { mock } = makeViewProvider({
                getDiffBetweenCommits: async () => {
                    calledDiffBetween = true;
                    return testFiles;
                },
            });
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: sha1,
                selectedShas: [sha1, sha2],
            });
            assert.ok(calledDiffBetween, 'Should call getDiffBetweenCommits');
        });

        test('WORKING_DIR + commit normalizes and calls getDiffWithWorkingTree', async () => {
            let diffTarget = '';
            const { mock } = makeViewProvider({
                getDiffWithWorkingTree: async (sha: string) => {
                    diffTarget = sha;
                    return testFiles;
                },
            });
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: sha1,
                selectedShas: [WORKING_DIR_SHA, sha1],
            });
            assert.strictEqual(diffTarget, sha1);
            const fileListMsg = mock.getPostedMessages().find(m => m.type === 'fileListData');
            assert.ok(fileListMsg);
            assert.strictEqual(fileListMsg.rightRef, 'Working Tree');
        });

        test('COMMIT_INDEX + commit calls getDiffBetweenIndexAndCommit', async () => {
            let calledIndexDiff = false;
            const { mock } = makeViewProvider({
                getDiffBetweenIndexAndCommit: async () => {
                    calledIndexDiff = true;
                    return testFiles;
                },
            });
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: sha1,
                selectedShas: [COMMIT_INDEX_SHA, sha1],
            });
            assert.ok(calledIndexDiff, 'Should call getDiffBetweenIndexAndCommit');
        });

        test('WORKING_DIR + COMMIT_INDEX calls getDiffBetweenIndexAndWorkingTree', async () => {
            let calledIdxWt = false;
            const { mock } = makeViewProvider({
                getDiffBetweenIndexAndWorkingTree: async () => {
                    calledIdxWt = true;
                    return testFiles;
                },
            });
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: WORKING_DIR_SHA,
                selectedShas: [WORKING_DIR_SHA, COMMIT_INDEX_SHA],
            });
            assert.ok(calledIdxWt, 'Should call getDiffBetweenIndexAndWorkingTree');
        });

        test('error sends fileListClear', async () => {
            const { mock } = makeViewProvider({
                getChangedFiles: async () => { throw new Error('git error'); },
            });
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: sha1,
                selectedShas: [sha1],
            });
            const msgs = mock.getPostedMessages();
            assert.ok(msgs.some(m => m.type === 'fileListClear'));
        });
    });

    // --- Message handling ---

    suite('message handling', () => {

        test('selectionCleared resets currentSelectedShas and sends fileListClear', async () => {
            const { provider, mock } = makeViewProvider();
            // First select something
            mock.clearPostedMessages();
            await mock.simulateMessage({
                type: 'commitClick',
                sha: sha1,
                selectedShas: [sha1],
            });
            // Now clear
            mock.clearPostedMessages();
            await mock.simulateMessage({ type: 'selectionCleared' });
            const msgs = mock.getPostedMessages();
            assert.ok(msgs.some(m => m.type === 'fileListClear'));
        });
    });
});
