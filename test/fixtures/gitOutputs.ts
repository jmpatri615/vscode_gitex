/**
 * Canned git command outputs for deterministic testing.
 * Uses exact delimiter bytes matching the real git output format.
 */

const NUL = '\x00';
const RS = '\x1e';

// --- Log outputs (NUL-delimited fields, RS-delimited records) ---
// Format: %H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%d%x1e

const sha1 = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
const sha2 = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';
const sha3 = 'cccc3333cccc3333cccc3333cccc3333cccc3333';
const sha4 = 'dddd4444dddd4444dddd4444dddd4444dddd4444';
const sha5 = 'eeee5555eeee5555eeee5555eeee5555eeee5555';

export { sha1, sha2, sha3, sha4, sha5 };

/** 3 linear commits: sha1 -> sha2 -> sha3 (parent chain) */
export const LOG_LINEAR_3_COMMITS =
    [sha1, 'aaaa111', sha2, 'Alice', 'alice@test.com', '1700003000', 'Alice', 'alice@test.com', '1700003000', 'Third commit', ''].join(NUL) + RS +
    [sha2, 'bbbb222', sha3, 'Bob', 'bob@test.com', '1700002000', 'Bob', 'bob@test.com', '1700002000', 'Second commit', ''].join(NUL) + RS +
    [sha3, 'cccc333', '', 'Charlie', 'charlie@test.com', '1700001000', 'Charlie', 'charlie@test.com', '1700001000', 'Initial commit', ''].join(NUL) + RS;

/** Merge commit with 2 parents + HEAD/Branch/Tag refs */
export const LOG_MERGE_COMMIT =
    [sha1, 'aaaa111', `${sha2} ${sha3}`, 'Alice', 'alice@test.com', '1700003000', 'Alice', 'alice@test.com', '1700003000', 'Merge branch feature',
        ` (HEAD -> refs/heads/main, tag: refs/tags/v1.0)`].join(NUL) + RS +
    [sha2, 'bbbb222', sha4, 'Bob', 'bob@test.com', '1700002000', 'Bob', 'bob@test.com', '1700002000', 'Feature work', ''].join(NUL) + RS +
    [sha3, 'cccc333', sha4, 'Charlie', 'charlie@test.com', '1700001500', 'Charlie', 'charlie@test.com', '1700001500', 'Main work', ''].join(NUL) + RS +
    [sha4, 'dddd444', '', 'Dave', 'dave@test.com', '1700001000', 'Dave', 'dave@test.com', '1700001000', 'Base commit', ''].join(NUL) + RS;

/** Commit decorated with refs/stash */
export const LOG_WITH_STASH_REF =
    [sha1, 'aaaa111', sha2, 'Alice', 'alice@test.com', '1700003000', 'Alice', 'alice@test.com', '1700003000', 'WIP on main',
        ` (refs/stash)`].join(NUL) + RS +
    [sha2, 'bbbb222', '', 'Bob', 'bob@test.com', '1700002000', 'Bob', 'bob@test.com', '1700002000', 'Some commit', ''].join(NUL) + RS;

/** Commit with (HEAD) only — detached HEAD */
export const LOG_DETACHED_HEAD =
    [sha1, 'aaaa111', sha2, 'Alice', 'alice@test.com', '1700003000', 'Alice', 'alice@test.com', '1700003000', 'Detached commit',
        ' (HEAD)'].join(NUL) + RS +
    [sha2, 'bbbb222', '', 'Bob', 'bob@test.com', '1700002000', 'Bob', 'bob@test.com', '1700002000', 'Earlier commit', ''].join(NUL) + RS;

// --- Numstat outputs (NUL-delimited) ---

/** 3 files including a binary (-\t-\t) */
export const NUMSTAT_SIMPLE = [
    `10\t2\tsrc/main.ts`,
    `5\t0\tsrc/util.ts`,
    `-\t-\tassets/logo.png`,
].join(NUL) + NUL;

/** Rename: empty path then old/new paths */
export const NUMSTAT_RENAME = [
    `3\t1\t`,      // empty path signals rename
    `old/file.ts`, // old path
    `new/file.ts`, // new path
].join(NUL) + NUL;

// --- Name-status outputs (NUL-delimited) ---

/** M/A/D status codes */
export const NAME_STATUS_SIMPLE = [
    'M', 'src/main.ts',
    'A', 'src/new.ts',
    'D', 'src/old.ts',
].join(NUL) + NUL;

/** Rename: R100 + oldPath + newPath */
export const NAME_STATUS_RENAME = [
    'R100', 'old/path.ts', 'new/path.ts',
].join(NUL) + NUL;

/** Copy: C100 + srcPath + destPath */
export const NAME_STATUS_COPY = [
    'C100', 'src/original.ts', 'src/copy.ts',
].join(NUL) + NUL;

// --- Blame output (line-based) ---

/** 2 blame entries from different authors */
export const BLAME_MULTI_ENTRY = [
    `${sha1} 1 1 3`,
    'author Alice',
    'author-mail <alice@test.com>',
    'author-time 1700010000',
    'committer Alice',
    'committer-mail <alice@test.com>',
    'committer-time 1700010000',
    'summary Add main function',
    'filename src/main.ts',
    `${sha2} 4 4 2`,
    'author Bob',
    'author-mail <bob@test.com>',
    'author-time 1700020000',
    'committer Bob',
    'committer-mail <bob@test.com>',
    'committer-time 1700020000',
    'summary Fix error handling',
    'filename src/main.ts',
].join('\n');

/** Blame with continuation line (no numLines field) */
export const BLAME_CONTINUATION = [
    `${sha1} 1 1 3`,
    'author Alice',
    'author-mail <alice@test.com>',
    'author-time 1700010000',
    'committer Alice',
    'committer-mail <alice@test.com>',
    'committer-time 1700010000',
    'summary First commit',
    'filename src/main.ts',
    `${sha1} 2 5`,           // continuation — same sha, no numLines
    'author Alice',
    'author-mail <alice@test.com>',
    'author-time 1700010000',
    'committer Alice',
    'committer-mail <alice@test.com>',
    'committer-time 1700010000',
    'summary First commit',
    'filename src/main.ts',
].join('\n');

/** Blame with boundary commit (all zeros prefix) */
export const BLAME_BOUNDARY = [
    '0000000000000000000000000000000000000000 1 1 1',
    'author Not Committed Yet',
    'author-mail <not.committed.yet>',
    'author-time 1700010000',
    'committer Not Committed Yet',
    'committer-mail <not.committed.yet>',
    'committer-time 1700010000',
    'summary Not Committed Yet',
    'filename src/main.ts',
].join('\n');

/** Blame with filename containing spaces */
export const BLAME_FILENAME_SPACES = [
    `${sha1} 1 1 2`,
    'author Alice',
    'author-mail <alice@test.com>',
    'author-time 1700010000',
    'committer Alice',
    'committer-mail <alice@test.com>',
    'committer-time 1700010000',
    'summary Add docs',
    'filename docs/my file name.md',
].join('\n');

// --- Branches output (for-each-ref format) ---
// Format: %(refname:short)%00%(objectname:short)%00%(HEAD)%00%(upstream:short)

export const BRANCHES_OUTPUT = [
    `main${NUL}abc1234${NUL}*${NUL}origin/main`,
    `feature/test${NUL}def5678${NUL} ${NUL}`,
    `origin/main${NUL}abc1234${NUL} ${NUL}`,
    `origin/develop${NUL}ghi9012${NUL} ${NUL}`,
].join('\n');

// --- Tags output (for-each-ref format) ---
// Format: %(refname:short)%00%(objectname:short)%00%(*objectname:short)%00%(contents:subject)

export const TAGS_OUTPUT = [
    `v1.0${NUL}abc1234${NUL}${NUL}`,                  // lightweight tag
    `v2.0${NUL}tag5678${NUL}def5678${NUL}Release 2.0`, // annotated tag (deref present)
].join('\n');

// --- Stashes output ---
// Format: %H%x00%gd%x00%gs%x00%at

export const STASHES_OUTPUT = [
    `${sha1}${NUL}stash@{0}${NUL}WIP on main: abc1234 Fix bug${NUL}1700010000`,
    `${sha2}${NUL}stash@{1}${NUL}WIP on feature: def5678 Add test${NUL}1700005000`,
].join('\n');

// --- Commit details output (NUL-delimited git show --format=...) ---
// Format: %H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%b%x00%d
// Followed by stat output (which we don't parse directly — getChangedFiles is called separately)

export const COMMIT_DETAILS_OUTPUT =
    [sha1, 'aaaa111', sha2, 'Alice', 'alice@test.com', '1700003000',
        'Alice', 'alice@test.com', '1700003000', 'Fix the bug',
        'This is the extended body\n\nWith multiple paragraphs.', ' (HEAD -> refs/heads/main)'].join(NUL);

/** Commit details with empty body */
export const COMMIT_DETAILS_NO_BODY =
    [sha1, 'aaaa111', sha2, 'Alice', 'alice@test.com', '1700003000',
        'Alice', 'alice@test.com', '1700003000', 'Quick fix', '', ''].join(NUL);

/** Repo status helper outputs */
export const REV_PARSE_HEAD_OUTPUT = sha1;
export const REV_PARSE_BRANCH_OUTPUT = 'main';
export const STATUS_DIRTY_OUTPUT = ' M src/main.ts\n?? untracked.txt';
export const STATUS_CLEAN_OUTPUT = '';
