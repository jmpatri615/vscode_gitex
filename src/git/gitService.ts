import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { configuration } from '../common/configuration';
import { logCommand, logError, logTiming } from '../common/outputChannel';

export interface GitResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface GitStreamOptions {
    args: string[];
    cwd: string;
    onData: (data: Buffer) => void;
    onError?: (data: string) => void;
    onClose?: (code: number) => void;
}

export class GitService {
    private gitBinary: string = 'git';
    private repoRoot: string = '';

    constructor(private workspaceRoot: string) {}

    async initialize(): Promise<boolean> {
        // Resolve git binary
        const configPath = configuration.gitPath;
        if (configPath) {
            this.gitBinary = configPath;
        } else {
            const vscodeGitPath = vscode.workspace.getConfiguration('git').get<string>('path');
            if (vscodeGitPath) {
                this.gitBinary = vscodeGitPath;
            }
        }

        // Verify git is available
        try {
            const result = await this.exec(['--version']);
            if (result.exitCode !== 0) {
                return false;
            }
        } catch {
            return false;
        }

        // Find repo root
        try {
            const result = await this.exec(['rev-parse', '--show-toplevel'], this.workspaceRoot);
            if (result.exitCode === 0) {
                this.repoRoot = result.stdout.trim();
                return true;
            }
        } catch {
            // Not a git repo
        }
        return false;
    }

    getRepoRoot(): string {
        return this.repoRoot;
    }

    async exec(args: string[], cwd?: string): Promise<GitResult> {
        const startMs = Date.now();
        const workDir = cwd || this.repoRoot || this.workspaceRoot;
        logCommand(this.gitBinary, args);

        return new Promise<GitResult>((resolve, reject) => {
            const proc = spawn(this.gitBinary, args, {
                cwd: workDir,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            proc.stdout.on('data', (data: Buffer) => stdoutChunks.push(data));
            proc.stderr.on('data', (data: Buffer) => stderrChunks.push(data));

            proc.on('error', (err) => {
                logError(`Git process error: ${err.message}`);
                reject(err);
            });

            proc.on('close', (code) => {
                const stdout = Buffer.concat(stdoutChunks).toString('utf8');
                const stderr = Buffer.concat(stderrChunks).toString('utf8');
                logTiming(`git ${args[0]}`, startMs);
                resolve({ stdout, stderr, exitCode: code ?? 1 });
            });

            // Close stdin immediately
            proc.stdin.end();
        });
    }

    execStream(options: GitStreamOptions): ChildProcess {
        logCommand(this.gitBinary, options.args);
        const proc = spawn(this.gitBinary, options.args, {
            cwd: options.cwd || this.repoRoot,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        proc.stdout.on('data', options.onData);
        if (options.onError) {
            proc.stderr.on('data', (data: Buffer) => options.onError!(data.toString()));
        }
        if (options.onClose) {
            proc.on('close', (code) => options.onClose!(code ?? 1));
        }
        proc.on('error', (err) => {
            logError(`Git stream error: ${err.message}`);
        });

        proc.stdin.end();
        return proc;
    }

    async execWithInput(args: string[], input: string): Promise<GitResult> {
        const startMs = Date.now();
        logCommand(this.gitBinary, args);

        return new Promise<GitResult>((resolve, reject) => {
            const proc = spawn(this.gitBinary, args, {
                cwd: this.repoRoot,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            proc.stdout.on('data', (data: Buffer) => stdoutChunks.push(data));
            proc.stderr.on('data', (data: Buffer) => stderrChunks.push(data));

            proc.on('error', reject);
            proc.on('close', (code) => {
                logTiming(`git ${args[0]}`, startMs);
                resolve({
                    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                    stderr: Buffer.concat(stderrChunks).toString('utf8'),
                    exitCode: code ?? 1,
                });
            });

            proc.stdin.write(input);
            proc.stdin.end();
        });
    }
}
