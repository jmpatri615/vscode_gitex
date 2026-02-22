import * as assert from 'assert';
import { createGitUri, createWorkingTreeUri, createStagedUri, GITEX_SCHEME } from '../../src/git/gitUri';

suite('Git URI Test Suite', () => {

    // --- createGitUri ---

    test('createGitUri uses gitex scheme', () => {
        const uri = createGitUri('abc1234', 'src/main.ts');
        assert.strictEqual(uri.scheme, GITEX_SCHEME);
    });

    test('createGitUri sets authority to SHA', () => {
        const uri = createGitUri('abc1234', 'src/main.ts');
        assert.strictEqual(uri.authority, 'abc1234');
    });

    test('createGitUri sets path correctly', () => {
        const uri = createGitUri('abc1234', 'src/main.ts');
        assert.strictEqual(uri.path, '/src/main.ts');
    });

    test('createGitUri sets query with ref=SHA', () => {
        const uri = createGitUri('abc1234', 'src/main.ts');
        assert.strictEqual(uri.query, 'ref=abc1234');
    });

    test('createGitUri handles special characters in path', () => {
        const uri = createGitUri('abc1234', 'src/my file (1).ts');
        assert.ok(uri.path.includes('my'));
    });

    // --- createWorkingTreeUri ---

    test('createWorkingTreeUri uses file scheme', () => {
        const uri = createWorkingTreeUri('/repo', 'src/main.ts');
        assert.strictEqual(uri.scheme, 'file');
    });

    test('createWorkingTreeUri combines repo root and file path', () => {
        const uri = createWorkingTreeUri('/repo', 'src/main.ts');
        assert.strictEqual(uri.fsPath, '/repo/src/main.ts');
    });

    // --- createStagedUri ---

    test('createStagedUri uses gitex scheme', () => {
        const uri = createStagedUri('src/main.ts');
        assert.strictEqual(uri.scheme, GITEX_SCHEME);
    });

    test('createStagedUri sets authority to staged', () => {
        const uri = createStagedUri('src/main.ts');
        assert.strictEqual(uri.authority, 'staged');
    });

    test('createStagedUri sets query with ref=:0 (index)', () => {
        const uri = createStagedUri('src/main.ts');
        assert.strictEqual(uri.query, 'ref=:0');
    });
});
