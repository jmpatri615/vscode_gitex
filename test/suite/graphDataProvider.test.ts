import * as assert from 'assert';
import { GraphDataProvider } from '../../src/graph/graphDataProvider';
import { createMockGitCommands } from '../helpers/mockGitCommands';
import { LOG_LINEAR_3_COMMITS, sha1, sha2, sha3 } from '../fixtures/gitOutputs';
import { WORKING_DIR_SHA, COMMIT_INDEX_SHA } from '../../src/common/types';

function makeProvider(overrides = {}) {
    const gitCommands = createMockGitCommands({
        getLogRaw: async () => Buffer.from(LOG_LINEAR_3_COMMITS),
        getTotalCommitCount: async () => 3,
        getStagedFiles: async () => [
            { path: 'staged1.ts', status: 'M' as const, insertions: 1, deletions: 0 },
            { path: 'staged2.ts', status: 'A' as const, insertions: 5, deletions: 0 },
        ],
        getUnstagedFiles: async () => [
            { path: 'modified.ts', status: 'M' as const, insertions: 2, deletions: 1 },
        ],
        getUntrackedFiles: async () => ['new.ts'],
        getRepoStatus: async () => ({
            hasRepo: true,
            repoRoot: '/mock/repo',
            head: sha1,
            branch: 'main',
            isDirty: true,
            isMerging: false,
            isRebasing: false,
        }),
        ...overrides,
    });
    return new GraphDataProvider(gitCommands as any);
}

suite('GraphDataProvider Test Suite', () => {

    // --- loadInitialData ---

    test('loadInitialData returns LayoutResult with nodes and edges', async () => {
        const provider = makeProvider();
        const result = await provider.loadInitialData();
        assert.ok(result.nodes.length > 0);
        assert.ok(result.edges.length > 0);
    });

    test('virtual nodes prepended when HEAD exists', async () => {
        const provider = makeProvider();
        const result = await provider.loadInitialData();
        const indexNode = result.nodes.find(n => n.sha === COMMIT_INDEX_SHA);
        const workingNode = result.nodes.find(n => n.sha === WORKING_DIR_SHA);
        assert.ok(indexNode, 'Index node should exist');
        assert.ok(workingNode, 'Working tree node should exist');
    });

    test('virtual node subjects show change counts', async () => {
        const provider = makeProvider();
        const result = await provider.loadInitialData();
        const indexNode = result.nodes.find(n => n.sha === COMMIT_INDEX_SHA)!;
        assert.ok(indexNode.subject.includes('2'), 'Should mention 2 staged changes');
        assert.ok(indexNode.subject.includes('staged'), 'Should mention staged');

        const workingNode = result.nodes.find(n => n.sha === WORKING_DIR_SHA)!;
        // 1 unstaged + 1 untracked = 2 working changes
        assert.ok(workingNode.subject.includes('2'), 'Should mention 2 working changes');
    });

    test('real node rows shifted by +2 when virtual nodes present', async () => {
        const provider = makeProvider();
        const result = await provider.loadInitialData();
        // The first real node (sha1) was originally row 0, now should be row 2
        const realNode = result.nodes.find(n => n.sha === sha1)!;
        assert.strictEqual(realNode.row, 2);
    });

    test('Index->HEAD edge toRow updated to match shifted HEAD', async () => {
        const provider = makeProvider();
        const result = await provider.loadInitialData();
        const indexToHead = result.edges.find(e => e.fromSha === COMMIT_INDEX_SHA && e.toSha === sha1);
        assert.ok(indexToHead, 'Should find Index->HEAD edge');
        const headNode = result.nodes.find(n => n.sha === sha1)!;
        assert.strictEqual(indexToHead!.toRow, headNode.row);
    });

    test('totalCount includes virtual nodes (+2)', async () => {
        const provider = makeProvider();
        const result = await provider.loadInitialData();
        assert.strictEqual(result.totalCount, 5); // 3 real + 2 virtual
    });

    test('no virtual nodes when HEAD unavailable', async () => {
        const provider = makeProvider({
            getRepoStatus: async () => ({
                hasRepo: true,
                repoRoot: '/mock/repo',
                head: '',  // no HEAD
                branch: '',
                isDirty: false,
                isMerging: false,
                isRebasing: false,
            }),
        });
        const result = await provider.loadInitialData();
        const indexNode = result.nodes.find(n => n.sha === COMMIT_INDEX_SHA);
        assert.strictEqual(indexNode, undefined);
    });

    // --- loadNextPage ---

    test('loadNextPage returns null when all loaded', async () => {
        const provider = makeProvider({
            getTotalCommitCount: async () => 3,
            getRepoStatus: async () => ({
                hasRepo: true, repoRoot: '/mock/repo', head: '', branch: '',
                isDirty: false, isMerging: false, isRebasing: false,
            }),
        });
        await provider.loadInitialData();
        // All 3 commits loaded in first page, next should be null
        const next = await provider.loadNextPage();
        assert.strictEqual(next, null);
    });

    // --- findNodeBySha ---

    test('findNodeBySha finds by full SHA', async () => {
        const provider = makeProvider();
        await provider.loadInitialData();
        const node = provider.findNodeBySha(sha1);
        assert.ok(node);
        assert.strictEqual(node!.sha, sha1);
    });

    test('findNodeBySha finds by short SHA', async () => {
        const provider = makeProvider();
        await provider.loadInitialData();
        const node = provider.findNodeBySha('aaaa111');
        assert.ok(node);
        assert.strictEqual(node!.sha, sha1);
    });

    test('findNodeBySha returns undefined for unknown SHA', async () => {
        const provider = makeProvider();
        await provider.loadInitialData();
        const node = provider.findNodeBySha('deadbeef');
        assert.strictEqual(node, undefined);
    });

    // --- reset ---

    test('reset clears all state', async () => {
        const provider = makeProvider();
        await provider.loadInitialData();
        assert.ok(provider.getCurrentLayout() !== null);
        provider.reset();
        assert.strictEqual(provider.getCurrentLayout(), null);
        assert.strictEqual(provider.getTotalCount(), 0);
        assert.strictEqual(provider.getLoadedCount(), 0);
    });

    // --- getViewOptions / setViewOptions ---

    test('getViewOptions returns current options', () => {
        const provider = makeProvider();
        const opts = provider.getViewOptions();
        assert.strictEqual(typeof opts.allBranches, 'boolean');
        assert.strictEqual(typeof opts.showRemoteBranches, 'boolean');
    });

    test('setViewOptions merges partial options', () => {
        const provider = makeProvider();
        provider.setViewOptions({ showTags: false });
        assert.strictEqual(provider.getViewOptions().showTags, false);
        // Other options unchanged
        assert.strictEqual(typeof provider.getViewOptions().allBranches, 'boolean');
    });
});
