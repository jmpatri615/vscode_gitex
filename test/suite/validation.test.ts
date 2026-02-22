import * as assert from 'assert';
import { isValidSha, isValidRefName, sanitizeGitPattern } from '../../src/common/validation';

suite('Validation Test Suite', () => {

    // --- isValidSha ---

    test('isValidSha — accepts valid short SHA', () => {
        assert.strictEqual(isValidSha('abc1234'), true);
    });

    test('isValidSha — accepts valid full SHA', () => {
        assert.strictEqual(isValidSha('abc1234def5678901234567890abcdef12345678'), true);
    });

    test('isValidSha — rejects too-short SHA', () => {
        assert.strictEqual(isValidSha('abc12'), false);
    });

    test('isValidSha — rejects too-long SHA', () => {
        assert.strictEqual(isValidSha('a'.repeat(41)), false);
    });

    test('isValidSha — rejects non-hex characters', () => {
        assert.strictEqual(isValidSha('xyz1234'), false);
    });

    test('isValidSha — rejects shell metacharacters', () => {
        assert.strictEqual(isValidSha('abc1234; rm -rf /'), false);
    });

    test('isValidSha — rejects empty string', () => {
        assert.strictEqual(isValidSha(''), false);
    });

    // --- isValidRefName ---

    test('isValidRefName — accepts valid branch name', () => {
        assert.strictEqual(isValidRefName('feature/my-branch'), true);
    });

    test('isValidRefName — accepts simple name', () => {
        assert.strictEqual(isValidRefName('main'), true);
    });

    test('isValidRefName — rejects shell metacharacters (semicolon)', () => {
        assert.strictEqual(isValidRefName('branch; rm -rf /'), false);
    });

    test('isValidRefName — rejects shell metacharacters (backtick)', () => {
        assert.strictEqual(isValidRefName('branch`cmd`'), false);
    });

    test('isValidRefName — rejects shell metacharacters (dollar)', () => {
        assert.strictEqual(isValidRefName('branch$var'), false);
    });

    test('isValidRefName — rejects double dot (..)', () => {
        assert.strictEqual(isValidRefName('branch..name'), false);
    });

    test('isValidRefName — rejects trailing dot', () => {
        assert.strictEqual(isValidRefName('branch.'), false);
    });

    test('isValidRefName — rejects trailing slash', () => {
        assert.strictEqual(isValidRefName('branch/'), false);
    });

    test('isValidRefName — rejects leading dash', () => {
        assert.strictEqual(isValidRefName('-branch'), false);
    });

    test('isValidRefName — rejects @{ sequence', () => {
        assert.strictEqual(isValidRefName('branch@{0}'), false);
    });

    test('isValidRefName — rejects spaces', () => {
        assert.strictEqual(isValidRefName('my branch'), false);
    });

    test('isValidRefName — rejects colon', () => {
        assert.strictEqual(isValidRefName('branch:name'), false);
    });

    test('isValidRefName — rejects empty string', () => {
        assert.strictEqual(isValidRefName(''), false);
    });

    // --- sanitizeGitPattern ---

    test('sanitizeGitPattern — passes through plain text', () => {
        assert.strictEqual(sanitizeGitPattern('hello world'), 'hello world');
    });

    test('sanitizeGitPattern — escapes regex metacharacters', () => {
        assert.strictEqual(sanitizeGitPattern('foo.*bar'), 'foo\\.\\*bar');
    });

    test('sanitizeGitPattern — escapes parentheses and brackets', () => {
        assert.strictEqual(sanitizeGitPattern('fn(arg)'), 'fn\\(arg\\)');
        assert.strictEqual(sanitizeGitPattern('[test]'), '\\[test\\]');
    });

    test('sanitizeGitPattern — escapes dollar and caret', () => {
        assert.strictEqual(sanitizeGitPattern('$100'), '\\$100');
        assert.strictEqual(sanitizeGitPattern('^start'), '\\^start');
    });

    test('sanitizeGitPattern — escapes pipe and plus', () => {
        assert.strictEqual(sanitizeGitPattern('a|b'), 'a\\|b');
        assert.strictEqual(sanitizeGitPattern('a+b'), 'a\\+b');
    });

    test('sanitizeGitPattern — escapes backslash', () => {
        assert.strictEqual(sanitizeGitPattern('path\\file'), 'path\\\\file');
    });
});
