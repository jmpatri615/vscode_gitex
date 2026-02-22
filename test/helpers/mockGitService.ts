/**
 * Mock GitService factory for testing GitCommands.
 * Tests pass a handler that receives args and returns a GitResult.
 */

export interface GitResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export type ExecHandler = (args: string[]) => Promise<GitResult>;

export function ok(stdout: string): GitResult {
    return { stdout, stderr: '', exitCode: 0 };
}

export function fail(stderr: string = 'error', exitCode: number = 1): GitResult {
    return { stdout: '', stderr, exitCode };
}

export function createMockGitService(
    handler: ExecHandler,
    repoRoot: string = '/mock/repo',
) {
    return {
        exec: (args: string[]) => handler(args),
        getRepoRoot: () => repoRoot,
        execStream: () => { /* noop */ },
    };
}
