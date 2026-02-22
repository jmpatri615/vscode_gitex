import { CommitNode, RefInfo, RefType, BlameEntry } from '../common/types';

const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x00';

/**
 * Parse the raw git log output into CommitNode objects.
 * Falls back to pure-TS parsing when WASM is unavailable.
 */
export function parseLogOutput(raw: string): CommitNode[] {
    const records = raw.split(RECORD_SEPARATOR).filter(r => r.trim().length > 0);
    const nodes: CommitNode[] = [];

    for (const record of records) {
        const fields = record.split(FIELD_SEPARATOR);
        if (fields.length < 10) { continue; }

        const sha = fields[0].trim();
        const shortSha = fields[1];
        const parentStr = fields[2];
        const parents = parentStr ? parentStr.split(' ').filter(p => p.length > 0) : [];
        const authorName = fields[3];
        const authorEmail = fields[4];
        const authorDate = parseInt(fields[5], 10) || 0;
        const committerName = fields[6];
        const committerEmail = fields[7];
        const commitDate = parseInt(fields[8], 10) || 0;
        const subject = fields[9];
        const decorateStr = fields.length > 10 ? fields[10] : '';
        const refs = parseDecorate(decorateStr);

        nodes.push({
            sha, shortSha, parents, children: [],
            authorName, authorEmail, authorDate,
            committerName, committerEmail, commitDate,
            subject, refs,
        });
    }

    // Build children links
    const shaMap = new Map<string, CommitNode>();
    for (const node of nodes) {
        shaMap.set(node.sha, node);
    }
    for (const node of nodes) {
        for (const parentSha of node.parents) {
            const parent = shaMap.get(parentSha);
            if (parent) {
                parent.children.push(node.sha);
            }
        }
    }

    return nodes;
}

function parseDecorate(decorateStr: string): RefInfo[] {
    if (!decorateStr) { return []; }
    // Format: " (HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0)"
    const trimmed = decorateStr.replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();
    if (!trimmed) { return []; }

    const refs: RefInfo[] = [];
    const parts = trimmed.split(',').map(s => s.trim());

    for (const part of parts) {
        if (!part) { continue; }

        let isHead = false;
        let name = part;

        // Handle HEAD ->
        if (name.startsWith('HEAD -> ')) {
            isHead = true;
            name = name.substring('HEAD -> '.length);
            refs.push({ name: 'HEAD', refType: 'Head', isHead: true });
        } else if (name === 'HEAD') {
            refs.push({ name: 'HEAD', refType: 'Head', isHead: true });
            continue;
        }

        // Determine ref type
        let refType: RefType = 'Branch';
        if (name.startsWith('tag: ')) {
            name = name.substring('tag: '.length);
            refType = 'Tag';
        }

        // Strip full ref paths
        if (name.startsWith('refs/heads/')) {
            name = name.substring('refs/heads/'.length);
            refType = 'Branch';
        } else if (name.startsWith('refs/remotes/')) {
            name = name.substring('refs/remotes/'.length);
            refType = 'RemoteBranch';
        } else if (name.startsWith('refs/tags/')) {
            name = name.substring('refs/tags/'.length);
            refType = 'Tag';
        } else if (name.startsWith('refs/stash')) {
            refType = 'Stash';
        }

        refs.push({ name, refType, isHead });
    }

    return refs;
}

/**
 * Parse git blame --incremental output (fallback TS parser).
 */
export function parseBlameOutput(raw: string): BlameEntry[] {
    const entries: BlameEntry[] = [];
    const lines = raw.split('\n');
    let current: Partial<BlameEntry> | null = null;

    for (const line of lines) {
        // SHA header line: <sha> <orig_line> <final_line> <num_lines>
        const headerMatch = line.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/);
        if (headerMatch) {
            if (current && current.sha) {
                entries.push(current as BlameEntry);
            }
            current = {
                sha: headerMatch[1],
                shortSha: headerMatch[1].substring(0, 7),
                origLine: parseInt(headerMatch[2], 10),
                finalLine: parseInt(headerMatch[3], 10),
                numLines: headerMatch[4] ? parseInt(headerMatch[4], 10) : 1,
            };
            continue;
        }

        if (!current) { continue; }

        // Key-value pairs
        if (line.startsWith('author ')) {
            current.authorName = line.substring(7);
        } else if (line.startsWith('author-mail ')) {
            current.authorEmail = line.substring(12).replace(/^<|>$/g, '');
        } else if (line.startsWith('author-time ')) {
            current.authorDate = parseInt(line.substring(12), 10);
        } else if (line.startsWith('committer ')) {
            current.committerName = line.substring(10);
        } else if (line.startsWith('committer-mail ')) {
            current.committerEmail = line.substring(15).replace(/^<|>$/g, '');
        } else if (line.startsWith('committer-time ')) {
            current.committerDate = parseInt(line.substring(15), 10);
        } else if (line.startsWith('summary ')) {
            current.summary = line.substring(8);
        } else if (line.startsWith('filename ')) {
            current.filename = line.substring(9);
        }
    }

    if (current && current.sha) {
        entries.push(current as BlameEntry);
    }

    return entries;
}
