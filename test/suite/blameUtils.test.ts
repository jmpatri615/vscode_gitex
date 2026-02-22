import * as assert from 'assert';
import { formatDate } from '../../src/blame/blameUtils';

suite('Blame Utils Test Suite', () => {

    test('formatDate — iso format', () => {
        // 2023-11-14 22:13:20 UTC
        const epoch = 1700000000;
        const result = formatDate(epoch, 'iso');
        assert.strictEqual(result, '2023-11-14 22:13:20');
    });

    test('formatDate — relative format', () => {
        // Recent timestamp
        const now = Math.floor(Date.now() / 1000);
        const fiveMinAgo = now - 300;
        const result = formatDate(fiveMinAgo, 'relative');
        assert.strictEqual(result, '5 min ago');
    });

    test('formatDate — relative old date', () => {
        // 2 years ago
        const now = Math.floor(Date.now() / 1000);
        const twoYearsAgo = now - 365 * 2 * 24 * 60 * 60;
        const result = formatDate(twoYearsAgo, 'relative');
        assert.strictEqual(result, '2 years ago');
    });

    test('formatDate — zero epoch returns empty', () => {
        const result = formatDate(0, 'relative');
        assert.strictEqual(result, '');
    });

    test('formatDate — locale format', () => {
        const epoch = 1700000000;
        const result = formatDate(epoch, 'locale');
        // Should return a locale-formatted date string containing the year
        assert.ok(result.includes('2023') || result.includes('23'), `Expected year in "${result}"`);
    });
});
