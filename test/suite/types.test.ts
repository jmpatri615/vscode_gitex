import * as assert from 'assert';
import { isVirtualSha, WORKING_DIR_SHA, COMMIT_INDEX_SHA } from '../../src/common/types';

suite('Types Test Suite', () => {

    // --- Constants ---

    test('WORKING_DIR_SHA is 40 characters', () => {
        assert.strictEqual(WORKING_DIR_SHA.length, 40);
    });

    test('COMMIT_INDEX_SHA is 40 characters', () => {
        assert.strictEqual(COMMIT_INDEX_SHA.length, 40);
    });

    test('WORKING_DIR_SHA and COMMIT_INDEX_SHA are distinct', () => {
        assert.notStrictEqual(WORKING_DIR_SHA, COMMIT_INDEX_SHA);
    });

    // --- isVirtualSha ---

    test('isVirtualSha returns true for WORKING_DIR_SHA', () => {
        assert.strictEqual(isVirtualSha(WORKING_DIR_SHA), true);
    });

    test('isVirtualSha returns true for COMMIT_INDEX_SHA', () => {
        assert.strictEqual(isVirtualSha(COMMIT_INDEX_SHA), true);
    });

    test('isVirtualSha returns false for a real SHA', () => {
        assert.strictEqual(isVirtualSha('abc1234567890abcdef1234567890abcdef123456'), false);
    });

    test('isVirtualSha returns false for empty string', () => {
        assert.strictEqual(isVirtualSha(''), false);
    });

    test('isVirtualSha returns false for partial virtual SHA prefix', () => {
        assert.strictEqual(isVirtualSha('0000000000000000000000000000000000000003'), false);
    });
});
