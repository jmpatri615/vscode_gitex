import * as assert from 'assert';
import { BlameService } from '../../src/blame/blameService';
import { createMockGitCommands } from '../helpers/mockGitCommands';
import { BLAME_MULTI_ENTRY, sha1, sha2 } from '../fixtures/gitOutputs';

function makeService(overrides = {}) {
    const gitCommands = createMockGitCommands({
        getBlameRaw: async () => Buffer.from(BLAME_MULTI_ENTRY),
        revParse: async () => sha1,
        ...overrides,
    });
    return new BlameService(gitCommands as any);
}

suite('BlameService Test Suite', () => {

    // --- getBlame ---

    test('getBlame returns parsed entries', async () => {
        const service = makeService();
        const entries = await service.getBlame('src/main.ts');
        assert.strictEqual(entries.length, 2);
        assert.strictEqual(entries[0].authorName, 'Alice');
        assert.strictEqual(entries[1].authorName, 'Bob');
    });

    test('getBlame caches result (second call does not re-invoke gitCommands)', async () => {
        let callCount = 0;
        const service = makeService({
            getBlameRaw: async () => {
                callCount++;
                return Buffer.from(BLAME_MULTI_ENTRY);
            },
            revParse: async () => sha1,
        });

        await service.getBlame('src/main.ts');
        await service.getBlame('src/main.ts');
        assert.strictEqual(callCount, 1, 'getBlameRaw should only be called once');
    });

    test('cache invalidated when HEAD changes (different revParse result)', async () => {
        let currentHead = sha1;
        let callCount = 0;
        const service = makeService({
            getBlameRaw: async () => {
                callCount++;
                return Buffer.from(BLAME_MULTI_ENTRY);
            },
            revParse: async () => currentHead,
        });

        await service.getBlame('src/main.ts');
        currentHead = sha2;  // HEAD changes
        await service.getBlame('src/main.ts');
        assert.strictEqual(callCount, 2, 'getBlameRaw should be called again after HEAD change');
    });

    test('returns empty array on error', async () => {
        const service = makeService({
            getBlameRaw: async () => { throw new Error('git blame failed'); },
        });
        const entries = await service.getBlame('src/main.ts');
        assert.strictEqual(entries.length, 0);
    });

    // --- getBlameForLine ---

    test('getBlameForLine finds entry containing line', async () => {
        const service = makeService();
        // Entry 1: lines 1-3, Entry 2: lines 4-5
        const entry = await service.getBlameForLine('src/main.ts', 2);
        assert.ok(entry);
        assert.strictEqual(entry!.authorName, 'Alice');
    });

    test('getBlameForLine returns null for line not in any entry', async () => {
        const service = makeService();
        const entry = await service.getBlameForLine('src/main.ts', 100);
        assert.strictEqual(entry, null);
    });

    test('getBlameForLine — first line of entry', async () => {
        const service = makeService();
        const entry = await service.getBlameForLine('src/main.ts', 1);
        assert.ok(entry);
        assert.strictEqual(entry!.authorName, 'Alice');
    });

    test('getBlameForLine — last line of entry', async () => {
        const service = makeService();
        // Alice's entry: finalLine=1, numLines=3 → lines 1,2,3
        const entry = await service.getBlameForLine('src/main.ts', 3);
        assert.ok(entry);
        assert.strictEqual(entry!.authorName, 'Alice');
    });

    // --- invalidateCache ---

    test('invalidateCache for specific file', async () => {
        let callCount = 0;
        const service = makeService({
            getBlameRaw: async () => {
                callCount++;
                return Buffer.from(BLAME_MULTI_ENTRY);
            },
            revParse: async () => sha1,
        });

        await service.getBlame('src/main.ts');
        service.invalidateCache('src/main.ts');
        await service.getBlame('src/main.ts');
        assert.strictEqual(callCount, 2);
    });

    test('invalidateCache for all files', async () => {
        let callCount = 0;
        const service = makeService({
            getBlameRaw: async () => {
                callCount++;
                return Buffer.from(BLAME_MULTI_ENTRY);
            },
            revParse: async () => sha1,
        });

        await service.getBlame('file1.ts');
        await service.getBlame('file2.ts');
        service.invalidateCache();  // clear all
        await service.getBlame('file1.ts');
        assert.strictEqual(callCount, 3);
    });

    // --- dispose ---

    test('dispose clears cache', async () => {
        let callCount = 0;
        const service = makeService({
            getBlameRaw: async () => {
                callCount++;
                return Buffer.from(BLAME_MULTI_ENTRY);
            },
            revParse: async () => sha1,
        });

        await service.getBlame('src/main.ts');
        service.dispose();
        await service.getBlame('src/main.ts');
        assert.strictEqual(callCount, 2);
    });
});
