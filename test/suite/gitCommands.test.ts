import * as assert from 'assert';
import { GitCommands } from '../../src/git/gitCommands';
import { createMockGitService, ok, fail } from '../helpers/mockGitService';
import {
    NUMSTAT_SIMPLE, NUMSTAT_RENAME,
    NAME_STATUS_SIMPLE, NAME_STATUS_RENAME, NAME_STATUS_COPY,
    BRANCHES_OUTPUT, TAGS_OUTPUT, STASHES_OUTPUT,
    COMMIT_DETAILS_OUTPUT, COMMIT_DETAILS_NO_BODY,
    sha1, sha2,
} from '../fixtures/gitOutputs';

function makeCommands(handler: (args: string[]) => any): GitCommands {
    const mock = createMockGitService(handler);
    return new GitCommands(mock as any);
}

suite('GitCommands Test Suite', () => {

    // ======== parseNumstat (via getDiffBetweenCommits / getDiffWithWorkingTree) ========

    suite('parseNumstat', () => {

        test('3 files parsed correctly from getDiffBetweenCommits', async () => {
            const cmd = makeCommands(async () => ok(NUMSTAT_SIMPLE));
            const files = await cmd.getDiffBetweenCommits('sha1', 'sha2');
            assert.strictEqual(files.length, 3);
            assert.strictEqual(files[0].path, 'src/main.ts');
            assert.strictEqual(files[0].insertions, 10);
            assert.strictEqual(files[0].deletions, 2);
        });

        test('binary file has 0 insertions and 0 deletions', async () => {
            const cmd = makeCommands(async () => ok(NUMSTAT_SIMPLE));
            const files = await cmd.getDiffBetweenCommits('sha1', 'sha2');
            const binary = files.find(f => f.path === 'assets/logo.png')!;
            assert.strictEqual(binary.insertions, 0);
            assert.strictEqual(binary.deletions, 0);
        });

        test('empty output returns empty array', async () => {
            const cmd = makeCommands(async () => ok(''));
            const files = await cmd.getDiffBetweenCommits('sha1', 'sha2');
            assert.strictEqual(files.length, 0);
        });

        test('git error (exit code 1) returns empty array', async () => {
            const cmd = makeCommands(async () => fail('error'));
            const files = await cmd.getDiffBetweenCommits('sha1', 'sha2');
            assert.strictEqual(files.length, 0);
        });

        test('getDiffWithWorkingTree parses numstat', async () => {
            const cmd = makeCommands(async () => ok(NUMSTAT_SIMPLE));
            const files = await cmd.getDiffWithWorkingTree('HEAD');
            assert.strictEqual(files.length, 3);
        });
    });

    // ======== parseNameStatus (via getStagedFiles / getUnstagedFiles) ========

    suite('parseNameStatus', () => {

        test('M/A/D status codes parsed correctly from getStagedFiles', async () => {
            const cmd = makeCommands(async () => ok(NAME_STATUS_SIMPLE));
            const files = await cmd.getStagedFiles();
            assert.strictEqual(files.length, 3);
            assert.strictEqual(files[0].status, 'M');
            assert.strictEqual(files[0].path, 'src/main.ts');
            assert.strictEqual(files[1].status, 'A');
            assert.strictEqual(files[1].path, 'src/new.ts');
            assert.strictEqual(files[2].status, 'D');
            assert.strictEqual(files[2].path, 'src/old.ts');
        });

        test('rename (R100) with oldPath and newPath', async () => {
            const cmd = makeCommands(async () => ok(NAME_STATUS_RENAME));
            const files = await cmd.getStagedFiles();
            assert.strictEqual(files.length, 1);
            assert.strictEqual(files[0].status, 'R');
            assert.strictEqual(files[0].path, 'new/path.ts');
            assert.strictEqual(files[0].oldPath, 'old/path.ts');
        });

        test('copy (C100) with source and dest paths', async () => {
            const cmd = makeCommands(async () => ok(NAME_STATUS_COPY));
            const files = await cmd.getStagedFiles();
            assert.strictEqual(files.length, 1);
            assert.strictEqual(files[0].status, 'C');
            assert.strictEqual(files[0].path, 'src/copy.ts');
            assert.strictEqual(files[0].oldPath, 'src/original.ts');
        });

        test('empty output returns empty array', async () => {
            const cmd = makeCommands(async () => ok(''));
            const files = await cmd.getUnstagedFiles();
            assert.strictEqual(files.length, 0);
        });

        test('git error returns empty array', async () => {
            const cmd = makeCommands(async () => fail());
            const files = await cmd.getStagedFiles();
            assert.strictEqual(files.length, 0);
        });
    });

    // ======== getChangedFiles (dual parse + merge) ========

    suite('getChangedFiles', () => {

        test('status from name-status merged with stats from numstat', async () => {
            const cmd = makeCommands(async (args: string[]) => {
                if (args.includes('--name-status')) {
                    return ok(NAME_STATUS_SIMPLE);
                }
                if (args.includes('--numstat')) {
                    return ok(NUMSTAT_SIMPLE);
                }
                return ok('');
            });
            const files = await cmd.getChangedFiles(sha1);
            // Should have files from numstat with status from name-status
            assert.ok(files.length > 0);
            const mainFile = files.find(f => f.path === 'src/main.ts');
            assert.ok(mainFile);
            assert.strictEqual(mainFile!.status, 'M');
            assert.strictEqual(mainFile!.insertions, 10);
        });

        test('rename detection from numstat empty-path format', async () => {
            const cmd = makeCommands(async (args: string[]) => {
                if (args.includes('--name-status')) {
                    return ok(NAME_STATUS_RENAME);
                }
                if (args.includes('--numstat')) {
                    return ok(NUMSTAT_RENAME);
                }
                return ok('');
            });
            const files = await cmd.getChangedFiles(sha1);
            assert.strictEqual(files.length, 1);
            assert.strictEqual(files[0].path, 'new/file.ts');
            assert.strictEqual(files[0].oldPath, 'old/file.ts');
        });

        test('fallback to M when status not in map', async () => {
            // numstat has a file that name-status doesn't
            const cmd = makeCommands(async (args: string[]) => {
                if (args.includes('--name-status')) {
                    return ok('');  // no status info
                }
                if (args.includes('--numstat')) {
                    return ok(`5\t2\tunknown.ts\x00`);
                }
                return ok('');
            });
            const files = await cmd.getChangedFiles(sha1);
            assert.strictEqual(files.length, 1);
            assert.strictEqual(files[0].status, 'M');  // default fallback
        });

        test('numstat error returns empty array', async () => {
            const cmd = makeCommands(async (args: string[]) => {
                if (args.includes('--name-status')) {
                    return ok(NAME_STATUS_SIMPLE);
                }
                if (args.includes('--numstat')) {
                    return fail();
                }
                return ok('');
            });
            const files = await cmd.getChangedFiles(sha1);
            assert.strictEqual(files.length, 0);
        });
    });

    // ======== getCommitDetails ========

    suite('getCommitDetails', () => {

        test('all NUL-delimited fields parsed correctly', async () => {
            let getChangedFilesCalled = false;
            const cmd = makeCommands(async (args: string[]) => {
                if (args[0] === 'show') {
                    return ok(COMMIT_DETAILS_OUTPUT);
                }
                if (args[0] === 'diff-tree') {
                    getChangedFilesCalled = true;
                    return ok('');
                }
                return ok('');
            });
            const details = await cmd.getCommitDetails(sha1);
            assert.strictEqual(details.sha, sha1);
            assert.strictEqual(details.shortSha, 'aaaa111');
            assert.strictEqual(details.parents[0], sha2);
            assert.strictEqual(details.authorName, 'Alice');
            assert.strictEqual(details.authorEmail, 'alice@test.com');
            assert.strictEqual(details.subject, 'Fix the bug');
            assert.ok(details.body.includes('extended body'));
        });

        test('empty body field is parsed as empty string', async () => {
            const cmd = makeCommands(async (args: string[]) => {
                if (args[0] === 'show') {
                    return ok(COMMIT_DETAILS_NO_BODY);
                }
                return ok('');
            });
            const details = await cmd.getCommitDetails(sha1);
            assert.strictEqual(details.body, '');
        });

        test('includes changedFiles from getChangedFiles call', async () => {
            const cmd = makeCommands(async (args: string[]) => {
                if (args[0] === 'show') {
                    return ok(COMMIT_DETAILS_OUTPUT);
                }
                if (args[0] === 'diff-tree' && args.includes('--numstat')) {
                    return ok(`3\t1\tsrc/main.ts\x00`);
                }
                if (args[0] === 'diff-tree' && args.includes('--name-status')) {
                    return ok(`M\x00src/main.ts\x00`);
                }
                return ok('');
            });
            const details = await cmd.getCommitDetails(sha1);
            assert.ok(details.changedFiles.length > 0);
        });

        test('throws on git error', async () => {
            const cmd = makeCommands(async () => fail('fatal: bad object'));
            await assert.rejects(() => cmd.getCommitDetails('badsha'), /git show failed/);
        });
    });

    // ======== getBranches ========

    suite('getBranches', () => {

        test('parses branch names, shas, current flag, upstream', async () => {
            const cmd = makeCommands(async () => ok(BRANCHES_OUTPUT));
            const branches = await cmd.getBranches();
            assert.strictEqual(branches.length, 4);

            const main = branches.find(b => b.name === 'main')!;
            assert.strictEqual(main.sha, 'abc1234');
            assert.strictEqual(main.isCurrent, true);
            assert.strictEqual(main.upstream, 'origin/main');
        });

        test('detects remote branches (name contains /)', async () => {
            const cmd = makeCommands(async () => ok(BRANCHES_OUTPUT));
            const branches = await cmd.getBranches();
            const remote = branches.find(b => b.name === 'origin/main')!;
            assert.strictEqual(remote.isRemote, true);
        });

        test('local branch without upstream has undefined upstream', async () => {
            const cmd = makeCommands(async () => ok(BRANCHES_OUTPUT));
            const branches = await cmd.getBranches();
            const feature = branches.find(b => b.name === 'feature/test')!;
            assert.strictEqual(feature.upstream, undefined);
        });

        test('empty output returns empty array', async () => {
            const cmd = makeCommands(async () => ok(''));
            const branches = await cmd.getBranches();
            assert.strictEqual(branches.length, 0);
        });

        test('git error returns empty array', async () => {
            const cmd = makeCommands(async () => fail());
            const branches = await cmd.getBranches();
            assert.strictEqual(branches.length, 0);
        });
    });

    // ======== getTags ========

    suite('getTags', () => {

        test('lightweight tag has isAnnotated=false', async () => {
            const cmd = makeCommands(async () => ok(TAGS_OUTPUT));
            const tags = await cmd.getTags();
            const lightweight = tags.find(t => t.name === 'v1.0')!;
            assert.strictEqual(lightweight.isAnnotated, false);
            assert.strictEqual(lightweight.sha, 'abc1234');
        });

        test('annotated tag has isAnnotated=true and uses deref sha', async () => {
            const cmd = makeCommands(async () => ok(TAGS_OUTPUT));
            const tags = await cmd.getTags();
            const annotated = tags.find(t => t.name === 'v2.0')!;
            assert.strictEqual(annotated.isAnnotated, true);
            assert.strictEqual(annotated.sha, 'def5678');  // deref sha
            assert.strictEqual(annotated.message, 'Release 2.0');
        });

        test('empty output returns empty array', async () => {
            const cmd = makeCommands(async () => ok(''));
            const tags = await cmd.getTags();
            assert.strictEqual(tags.length, 0);
        });
    });

    // ======== getStashes ========

    suite('getStashes', () => {

        test('stash index extracted from ref', async () => {
            const cmd = makeCommands(async () => ok(STASHES_OUTPUT));
            const stashes = await cmd.getStashes();
            assert.strictEqual(stashes.length, 2);
            assert.strictEqual(stashes[0].index, 0);
            assert.strictEqual(stashes[1].index, 1);
        });

        test('stash fields parsed correctly', async () => {
            const cmd = makeCommands(async () => ok(STASHES_OUTPUT));
            const stashes = await cmd.getStashes();
            assert.strictEqual(stashes[0].sha, sha1);
            assert.ok(stashes[0].message.includes('WIP on main'));
            assert.strictEqual(stashes[0].date, 1700010000);
        });

        test('empty output returns empty array', async () => {
            const cmd = makeCommands(async () => ok(''));
            const stashes = await cmd.getStashes();
            assert.strictEqual(stashes.length, 0);
        });
    });

    // ======== getRepoStatus ========

    suite('getRepoStatus', () => {

        test('assembles correct RepoStatus from 5 parallel calls', async () => {
            const cmd = makeCommands(async (args: string[]) => {
                if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
                    return ok(sha1 + '\n');
                }
                if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) {
                    return ok('main\n');
                }
                if (args[0] === 'status') {
                    return ok(' M src/main.ts\n');
                }
                if (args[0] === 'rev-parse' && args.includes('MERGE_HEAD')) {
                    return fail();  // not merging
                }
                if (args[0] === 'rev-parse' && args.includes('REBASE_HEAD')) {
                    return fail();  // not rebasing
                }
                return ok('');
            });
            const status = await cmd.getRepoStatus();
            assert.strictEqual(status.hasRepo, true);
            assert.strictEqual(status.head, sha1);
            assert.strictEqual(status.branch, 'main');
            assert.strictEqual(status.isDirty, true);
            assert.strictEqual(status.isMerging, false);
            assert.strictEqual(status.isRebasing, false);
        });

        test('detects merge in progress', async () => {
            const cmd = makeCommands(async (args: string[]) => {
                if (args.includes('MERGE_HEAD')) { return ok(sha2 + '\n'); }
                if (args[0] === 'rev-parse' && args[1] === 'HEAD') { return ok(sha1 + '\n'); }
                if (args.includes('--abbrev-ref')) { return ok('main\n'); }
                if (args[0] === 'status') { return ok(''); }
                return fail();
            });
            const status = await cmd.getRepoStatus();
            assert.strictEqual(status.isMerging, true);
        });

        test('detects rebase in progress', async () => {
            const cmd = makeCommands(async (args: string[]) => {
                if (args.includes('REBASE_HEAD')) { return ok(sha2 + '\n'); }
                if (args[0] === 'rev-parse' && args[1] === 'HEAD') { return ok(sha1 + '\n'); }
                if (args.includes('--abbrev-ref')) { return ok('main\n'); }
                if (args[0] === 'status') { return ok(''); }
                return fail();
            });
            const status = await cmd.getRepoStatus();
            assert.strictEqual(status.isRebasing, true);
        });
    });

    // ======== revParse ========

    suite('revParse', () => {

        test('returns trimmed sha on success', async () => {
            const cmd = makeCommands(async () => ok(sha1 + '\n'));
            const result = await cmd.revParse('HEAD');
            assert.strictEqual(result, sha1);
        });

        test('returns null on failure', async () => {
            const cmd = makeCommands(async () => fail());
            const result = await cmd.revParse('INVALID');
            assert.strictEqual(result, null);
        });
    });

    // ======== getDiffBetweenIndexAndCommit / getDiffBetweenIndexAndWorkingTree ========

    suite('index diff methods', () => {

        test('getDiffBetweenIndexAndCommit parses numstat', async () => {
            const cmd = makeCommands(async () => ok(NUMSTAT_SIMPLE));
            const files = await cmd.getDiffBetweenIndexAndCommit(sha1);
            assert.strictEqual(files.length, 3);
        });

        test('getDiffBetweenIndexAndWorkingTree parses numstat', async () => {
            const cmd = makeCommands(async () => ok(NUMSTAT_SIMPLE));
            const files = await cmd.getDiffBetweenIndexAndWorkingTree();
            assert.strictEqual(files.length, 3);
        });
    });

    // ======== getUntrackedFiles ========

    suite('getUntrackedFiles', () => {

        test('parses line-separated file paths', async () => {
            const cmd = makeCommands(async () => ok('untracked1.ts\nuntracked2.ts\n'));
            const files = await cmd.getUntrackedFiles();
            assert.strictEqual(files.length, 2);
            assert.strictEqual(files[0], 'untracked1.ts');
        });

        test('empty output returns empty array', async () => {
            const cmd = makeCommands(async () => ok(''));
            const files = await cmd.getUntrackedFiles();
            assert.strictEqual(files.length, 0);
        });
    });
});
