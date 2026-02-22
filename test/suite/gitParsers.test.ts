import * as assert from 'assert';
import { parseLogOutput, parseBlameOutput } from '../../src/git/gitParsers';

suite('Git Parsers Test Suite', () => {

    test('parseLogOutput — linear commits', () => {
        const raw = [
            'abc123abc123abc123abc123abc123abc123abc1\x00abc1234\x00def456def456def456def456def456def456def4\x00Alice\x00alice@test.com\x001700000000\x00Alice\x00alice@test.com\x001700000000\x00First commit\x00',
            '\x1e',
            'def456def456def456def456def456def456def4\x00def4567\x00\x00Bob\x00bob@test.com\x001699999000\x00Bob\x00bob@test.com\x001699999000\x00Initial commit\x00',
            '\x1e',
        ].join('');

        const nodes = parseLogOutput(raw);
        assert.strictEqual(nodes.length, 2);
        assert.strictEqual(nodes[0].sha, 'abc123abc123abc123abc123abc123abc123abc1');
        assert.strictEqual(nodes[0].shortSha, 'abc1234');
        assert.strictEqual(nodes[0].authorName, 'Alice');
        assert.strictEqual(nodes[0].subject, 'First commit');
        assert.strictEqual(nodes[0].parents.length, 1);
        assert.strictEqual(nodes[0].parents[0], 'def456def456def456def456def456def456def4');
        assert.strictEqual(nodes[1].parents.length, 0);
    });

    test('parseLogOutput — merge commit with refs', () => {
        const raw = [
            'aaa\x00aa\x00bbb ccc\x00Alice\x00a@e.com\x001700000000\x00Alice\x00a@e.com\x001700000000\x00Merge branch\x00 (HEAD -> refs/heads/main, tag: refs/tags/v1.0)',
            '\x1e',
        ].join('');

        const nodes = parseLogOutput(raw);
        assert.strictEqual(nodes.length, 1);
        assert.strictEqual(nodes[0].parents.length, 2);
        assert.ok(nodes[0].refs.length >= 2);

        const headRef = nodes[0].refs.find(r => r.refType === 'Head');
        assert.ok(headRef);

        const branchRef = nodes[0].refs.find(r => r.refType === 'Branch' && r.name === 'main');
        assert.ok(branchRef);

        const tagRef = nodes[0].refs.find(r => r.refType === 'Tag' && r.name === 'v1.0');
        assert.ok(tagRef);
    });

    test('parseLogOutput — empty input', () => {
        const nodes = parseLogOutput('');
        assert.strictEqual(nodes.length, 0);
    });

    test('parseBlameOutput — single entry', () => {
        const raw = [
            'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 1 1 5',
            'author Alice Smith',
            'author-mail <alice@example.com>',
            'author-time 1700010000',
            'committer Alice Smith',
            'committer-mail <alice@example.com>',
            'committer-time 1700010000',
            'summary Add main entry point',
            'filename src/main.rs',
        ].join('\n');

        const entries = parseBlameOutput(raw);
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].sha, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
        assert.strictEqual(entries[0].shortSha, 'a1b2c3d');
        assert.strictEqual(entries[0].authorName, 'Alice Smith');
        assert.strictEqual(entries[0].authorEmail, 'alice@example.com');
        assert.strictEqual(entries[0].origLine, 1);
        assert.strictEqual(entries[0].finalLine, 1);
        assert.strictEqual(entries[0].numLines, 5);
        assert.strictEqual(entries[0].summary, 'Add main entry point');
        assert.strictEqual(entries[0].filename, 'src/main.rs');
    });

    test('parseBlameOutput — multiple entries', () => {
        const raw = [
            'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 1 1 3',
            'author Alice',
            'author-mail <alice@test.com>',
            'author-time 1700010000',
            'committer Alice',
            'committer-mail <alice@test.com>',
            'committer-time 1700010000',
            'summary First',
            'filename test.ts',
            'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3 4 4 2',
            'author Bob',
            'author-mail <bob@test.com>',
            'author-time 1700020000',
            'committer Bob',
            'committer-mail <bob@test.com>',
            'committer-time 1700020000',
            'summary Second',
            'filename test.ts',
        ].join('\n');

        const entries = parseBlameOutput(raw);
        assert.strictEqual(entries.length, 2);
        assert.strictEqual(entries[0].authorName, 'Alice');
        assert.strictEqual(entries[1].authorName, 'Bob');
        assert.strictEqual(entries[0].numLines, 3);
        assert.strictEqual(entries[1].numLines, 2);
    });

    test('parseBlameOutput — empty input', () => {
        const entries = parseBlameOutput('');
        assert.strictEqual(entries.length, 0);
    });
});
