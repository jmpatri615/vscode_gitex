import * as assert from 'assert';

suite('Configuration Test Suite', () => {

    test('configuration module exports are defined', () => {
        // Verify the configuration module can be required without error
        const configModule = require('../../src/common/configuration');
        assert.ok(configModule.configuration, 'configuration object should be exported');
        assert.ok(typeof configModule.onConfigurationChanged === 'function', 'onConfigurationChanged should be a function');
    });

    test('validation module exports are defined', () => {
        const validation = require('../../src/common/validation');
        assert.ok(typeof validation.isValidSha === 'function', 'isValidSha should be exported');
        assert.ok(typeof validation.isValidRefName === 'function', 'isValidRefName should be exported');
        assert.ok(typeof validation.sanitizeGitPattern === 'function', 'sanitizeGitPattern should be exported');
    });
});
