import * as assert from 'assert';
import { computeGraphLayout } from '../../src/wasm/wasmBridge';
import {
    LOG_LINEAR_3_COMMITS, LOG_MERGE_COMMIT, LOG_WITH_STASH_REF,
    LOG_DETACHED_HEAD,
    sha1, sha2, sha3, sha4,
} from '../fixtures/gitOutputs';

suite('WASM Bridge Extended Test Suite (TS fallback)', () => {

    // --- Linear commits ---

    test('linear commits — all assigned to lane 0', () => {
        const result = computeGraphLayout(Buffer.from(LOG_LINEAR_3_COMMITS));
        assert.strictEqual(result.nodes.length, 3);
        for (const node of result.nodes) {
            assert.strictEqual(node.lane, 0, `Node ${node.shortSha} should be in lane 0`);
        }
    });

    test('linear commits — rows are sequential 0, 1, 2', () => {
        const result = computeGraphLayout(Buffer.from(LOG_LINEAR_3_COMMITS));
        assert.strictEqual(result.nodes[0].row, 0);
        assert.strictEqual(result.nodes[1].row, 1);
        assert.strictEqual(result.nodes[2].row, 2);
    });

    test('linear commits — edges are all Normal type', () => {
        const result = computeGraphLayout(Buffer.from(LOG_LINEAR_3_COMMITS));
        for (const edge of result.edges) {
            assert.strictEqual(edge.edgeType, 'Normal');
        }
    });

    test('linear commits — totalCount matches node count', () => {
        const result = computeGraphLayout(Buffer.from(LOG_LINEAR_3_COMMITS));
        assert.strictEqual(result.totalCount, 3);
    });

    // --- Merge commits ---

    test('merge creates Merge edge type for second parent', () => {
        const result = computeGraphLayout(Buffer.from(LOG_MERGE_COMMIT));
        const mergeEdges = result.edges.filter(e => e.edgeType === 'Merge');
        assert.ok(mergeEdges.length >= 1, 'Should have at least one Merge edge');
    });

    test('merge — second parent gets different lane', () => {
        const result = computeGraphLayout(Buffer.from(LOG_MERGE_COMMIT));
        const mergeNode = result.nodes.find(n => n.sha === sha1)!;
        const mergeEdge = result.edges.find(e => e.fromSha === sha1 && e.edgeType === 'Merge')!;
        // Merge edge should go to a different lane than the normal edge
        const normalEdge = result.edges.find(e => e.fromSha === sha1 && e.edgeType === 'Normal')!;
        assert.notStrictEqual(mergeEdge.toLane, normalEdge.toLane);
    });

    // --- Edge toRow resolution ---

    test('edge toRow is resolved to target node row', () => {
        const result = computeGraphLayout(Buffer.from(LOG_LINEAR_3_COMMITS));
        for (const edge of result.edges) {
            const targetNode = result.nodes.find(n => n.sha === edge.toSha);
            assert.ok(targetNode, `Edge target ${edge.toSha} should exist in nodes`);
            assert.strictEqual(edge.toRow, targetNode!.row);
        }
    });

    test('truncated history — edges to missing parents are filtered out', () => {
        // sha1 -> sha2 only (sha2 has parent that doesn't exist in input)
        const truncated = [
            sha1, 'aaaa111', sha2, 'A', 'a@e.com', '1700000000', 'A', 'a@e.com', '1700000000', 'test', ''
        ].join('\x00') + '\x1e' + [
            sha2, 'bbbb222', 'deadbeef12345678901234567890123456789012', 'B', 'b@e.com', '1700000000', 'B', 'b@e.com', '1700000000', 'base', ''
        ].join('\x00') + '\x1e';
        const result = computeGraphLayout(Buffer.from(truncated));
        // Edge from sha2 to deadbeef should be filtered (toRow would be -1)
        const deadEdge = result.edges.find(e => e.toSha === 'deadbeef12345678901234567890123456789012');
        assert.strictEqual(deadEdge, undefined);
    });

    // --- Node type detection ---

    test('Head nodeType detected from Head ref', () => {
        const result = computeGraphLayout(Buffer.from(LOG_DETACHED_HEAD));
        const headNode = result.nodes.find(n => n.sha === sha1)!;
        assert.strictEqual(headNode.nodeType, 'Head');
    });

    test('Stash nodeType detected from Stash ref', () => {
        const result = computeGraphLayout(Buffer.from(LOG_WITH_STASH_REF));
        const stashNode = result.nodes.find(n => n.sha === sha1)!;
        assert.strictEqual(stashNode.nodeType, 'Stash');
    });

    test('Normal nodeType for commit without special refs', () => {
        const result = computeGraphLayout(Buffer.from(LOG_LINEAR_3_COMMITS));
        for (const node of result.nodes) {
            assert.strictEqual(node.nodeType, 'Normal');
        }
    });

    // --- Stress test ---

    test('50-commit stress test — no crash, correct count', () => {
        let raw = '';
        for (let i = 0; i < 50; i++) {
            const sha = (i.toString(16).padStart(8, '0')).repeat(5);
            const parentSha = i < 49 ? ((i + 1).toString(16).padStart(8, '0')).repeat(5) : '';
            raw += [sha, sha.substring(0, 7), parentSha, 'Author', 'a@e.com', String(1700000000 - i * 1000),
                'Committer', 'c@e.com', String(1700000000 - i * 1000), `Commit ${i}`, ''].join('\x00') + '\x1e';
        }
        const result = computeGraphLayout(Buffer.from(raw));
        assert.strictEqual(result.nodes.length, 50);
        assert.strictEqual(result.totalCount, 50);
        assert.ok(result.edges.length > 0);
    });
});
