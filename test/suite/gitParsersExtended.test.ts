import * as assert from 'assert';
import { parseLogOutput, parseBlameOutput } from '../../src/git/gitParsers';
import {
    LOG_LINEAR_3_COMMITS, LOG_MERGE_COMMIT, LOG_WITH_STASH_REF,
    LOG_DETACHED_HEAD, BLAME_MULTI_ENTRY, BLAME_CONTINUATION,
    BLAME_BOUNDARY, BLAME_FILENAME_SPACES,
    sha1, sha2, sha3, sha4,
} from '../fixtures/gitOutputs';

suite('Git Parsers Extended Test Suite', () => {

    // --- parseLogOutput: children links ---

    test('parseLogOutput builds children links correctly', () => {
        const nodes = parseLogOutput(LOG_LINEAR_3_COMMITS);
        assert.strictEqual(nodes.length, 3);
        // sha1's parent is sha2, so sha2 should have sha1 as a child
        const sha2Node = nodes.find(n => n.sha === sha2)!;
        assert.ok(sha2Node.children.includes(sha1));
        // sha3's child should be sha2
        const sha3Node = nodes.find(n => n.sha === sha3)!;
        assert.ok(sha3Node.children.includes(sha2));
    });

    test('parseLogOutput — orphan commit has no parents and no children link errors', () => {
        const nodes = parseLogOutput(LOG_LINEAR_3_COMMITS);
        const rootNode = nodes.find(n => n.sha === sha3)!;
        assert.strictEqual(rootNode.parents.length, 0);
    });

    test('parseLogOutput — partial records with <10 fields are skipped', () => {
        const badRecord = 'too\x00few\x00fields\x1e';
        const nodes = parseLogOutput(badRecord);
        assert.strictEqual(nodes.length, 0);
    });

    test('parseLogOutput — merge commit has multiple parents', () => {
        const nodes = parseLogOutput(LOG_MERGE_COMMIT);
        const mergeNode = nodes[0];
        assert.strictEqual(mergeNode.parents.length, 2);
        assert.strictEqual(mergeNode.parents[0], sha2);
        assert.strictEqual(mergeNode.parents[1], sha3);
    });

    test('parseLogOutput — merge parent back-references: both parents gain child', () => {
        const nodes = parseLogOutput(LOG_MERGE_COMMIT);
        const parent1 = nodes.find(n => n.sha === sha2)!;
        const parent2 = nodes.find(n => n.sha === sha3)!;
        assert.ok(parent1.children.includes(sha1));
        assert.ok(parent2.children.includes(sha1));
    });

    // --- parseDecorate edge cases ---

    test('parseDecorate — detached HEAD produces Head ref only', () => {
        const nodes = parseLogOutput(LOG_DETACHED_HEAD);
        const headNode = nodes[0];
        const headRef = headNode.refs.find(r => r.refType === 'Head');
        assert.ok(headRef);
        assert.strictEqual(headRef!.name, 'HEAD');
        assert.strictEqual(headRef!.isHead, true);
    });

    test('parseDecorate — remote branch ref', () => {
        const raw = [sha1, 'aaaa111', '', 'A', 'a@e.com', '1700000000', 'A', 'a@e.com', '1700000000', 'test',
            ' (refs/remotes/origin/main)'].join('\x00') + '\x1e';
        const nodes = parseLogOutput(raw);
        const remoteRef = nodes[0].refs.find(r => r.refType === 'RemoteBranch');
        assert.ok(remoteRef);
        assert.strictEqual(remoteRef!.name, 'origin/main');
    });

    test('parseDecorate — stash ref', () => {
        const nodes = parseLogOutput(LOG_WITH_STASH_REF);
        const stashRef = nodes[0].refs.find(r => r.refType === 'Stash');
        assert.ok(stashRef);
    });

    test('parseDecorate — multiple refs on one commit', () => {
        const nodes = parseLogOutput(LOG_MERGE_COMMIT);
        const mergeNode = nodes[0];
        // Should have Head, Branch (main), and Tag (v1.0)
        assert.ok(mergeNode.refs.find(r => r.refType === 'Head'));
        assert.ok(mergeNode.refs.find(r => r.refType === 'Branch' && r.name === 'main'));
        assert.ok(mergeNode.refs.find(r => r.refType === 'Tag' && r.name === 'v1.0'));
    });

    test('parseDecorate — tag with full refs/tags/ path is stripped', () => {
        const raw = [sha1, 'aaaa111', '', 'A', 'a@e.com', '1700000000', 'A', 'a@e.com', '1700000000', 'test',
            ' (tag: refs/tags/release-1.2.3)'].join('\x00') + '\x1e';
        const nodes = parseLogOutput(raw);
        const tagRef = nodes[0].refs.find(r => r.refType === 'Tag');
        assert.ok(tagRef);
        assert.strictEqual(tagRef!.name, 'release-1.2.3');
    });

    test('parseDecorate — HEAD -> branch produces both Head and Branch refs', () => {
        const raw = [sha1, 'aaaa111', '', 'A', 'a@e.com', '1700000000', 'A', 'a@e.com', '1700000000', 'test',
            ' (HEAD -> refs/heads/develop)'].join('\x00') + '\x1e';
        const nodes = parseLogOutput(raw);
        assert.ok(nodes[0].refs.find(r => r.refType === 'Head'));
        assert.ok(nodes[0].refs.find(r => r.refType === 'Branch' && r.name === 'develop'));
    });

    // --- parseBlameOutput extended ---

    test('parseBlameOutput — continuation line (no numLines) defaults to 1', () => {
        const entries = parseBlameOutput(BLAME_CONTINUATION);
        assert.strictEqual(entries.length, 2);
        assert.strictEqual(entries[1].numLines, 1);
    });

    test('parseBlameOutput — committer fields are parsed', () => {
        const entries = parseBlameOutput(BLAME_MULTI_ENTRY);
        assert.strictEqual(entries[0].committerName, 'Alice');
        assert.strictEqual(entries[0].committerEmail, 'alice@test.com');
    });

    test('parseBlameOutput — filename with spaces', () => {
        const entries = parseBlameOutput(BLAME_FILENAME_SPACES);
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].filename, 'docs/my file name.md');
    });

    test('parseBlameOutput — boundary commit (all zeros SHA)', () => {
        const entries = parseBlameOutput(BLAME_BOUNDARY);
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].sha, '0000000000000000000000000000000000000000');
        assert.strictEqual(entries[0].authorName, 'Not Committed Yet');
    });
});
