import * as assert from 'assert';
import { computeGraphLayout, appendToLayout, parseBlame, filterCommits, filterByDate, freeLayout } from '../../src/wasm/wasmBridge';

suite('WASM Bridge Test Suite (TS fallback)', () => {

    test('computeGraphLayout — empty input returns empty layout', () => {
        const result = computeGraphLayout(Buffer.from(''));
        assert.ok(result, 'Should return a LayoutResult');
        assert.deepStrictEqual(result.nodes, []);
        assert.deepStrictEqual(result.edges, []);
        assert.strictEqual(result.totalCount, 0);
    });

    test('computeGraphLayout — single commit', () => {
        // Format: %H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%d%x1e
        const sha = 'abc1234567890abcdef1234567890abcdef123456';
        const shortSha = 'abc1234';
        const record = [
            sha, shortSha, '', 'Author', 'author@example.com', '1700000000',
            'Committer', 'committer@example.com', '1700000000', 'Initial commit', ''
        ].join('\x00') + '\x1e';
        const result = computeGraphLayout(Buffer.from(record));
        assert.strictEqual(result.nodes.length, 1);
        assert.strictEqual(result.nodes[0].sha, sha);
        assert.strictEqual(result.nodes[0].shortSha, shortSha);
        assert.strictEqual(result.nodes[0].subject, 'Initial commit');
        assert.strictEqual(result.nodes[0].lane, 0);
        assert.strictEqual(result.nodes[0].row, 0);
        assert.strictEqual(result.totalCount, 1);
    });

    test('parseBlame — empty input returns empty array', () => {
        const result = parseBlame(Buffer.from(''));
        assert.deepStrictEqual(result, []);
    });

    test('parseBlame — single blame entry', () => {
        const raw = [
            'abc1234567890abcdef1234567890abcdef123456 1 1 1',
            'author Test Author',
            'author-mail <test@example.com>',
            'author-time 1700000000',
            'committer Test Committer',
            'committer-mail <committer@example.com>',
            'committer-time 1700000000',
            'summary Initial commit',
            'filename src/main.ts',
        ].join('\n');
        const result = parseBlame(Buffer.from(raw));
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].authorName, 'Test Author');
        assert.strictEqual(result[0].authorEmail, 'test@example.com');
        assert.strictEqual(result[0].summary, 'Initial commit');
        assert.strictEqual(result[0].filename, 'src/main.ts');
        assert.strictEqual(result[0].finalLine, 1);
        assert.strictEqual(result[0].numLines, 1);
    });

    test('filterCommits — returns empty array without WASM', () => {
        const result = filterCommits(0, 'message', 'test');
        assert.deepStrictEqual(result, []);
    });

    test('filterByDate — returns empty array without WASM', () => {
        const result = filterByDate(0, 1700000000, 1700100000);
        assert.deepStrictEqual(result, []);
    });

    test('freeLayout — does not throw without WASM', () => {
        assert.doesNotThrow(() => freeLayout(0));
    });

    test('appendToLayout — falls back to recompute', () => {
        const result = appendToLayout(0, Buffer.from(''));
        assert.ok(result, 'Should return a LayoutResult');
        assert.deepStrictEqual(result.nodes, []);
        assert.strictEqual(result.totalCount, 0);
    });
});
