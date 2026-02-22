/**
 * Mock WebviewView for message-flow tests.
 * Captures onDidReceiveMessage handler and postMessage calls.
 */

import * as vscode from 'vscode';

export function createMockWebviewView() {
    const postedMessages: any[] = [];
    let messageHandler: ((message: any) => Promise<void>) | null = null;
    const disposables: vscode.Disposable[] = [];

    const webview = {
        options: {} as any,
        html: '',
        postMessage: (message: any) => {
            postedMessages.push(message);
            return Promise.resolve(true);
        },
        onDidReceiveMessage: (handler: (message: any) => any) => {
            messageHandler = handler;
            const disposable = { dispose: () => { messageHandler = null; } };
            disposables.push(disposable);
            return disposable;
        },
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource: 'mock-csp',
    };

    const webviewView = {
        webview,
        viewType: 'gitex.graphView',
        visible: true,
        onDidDispose: (_handler: () => void) => ({ dispose: () => {} }),
        onDidChangeVisibility: (_handler: () => void) => ({ dispose: () => {} }),
        show: () => {},
        // Badge is optional
    } as unknown as vscode.WebviewView;

    return {
        webviewView,
        /**
         * Simulate a message from the webview to the extension.
         */
        simulateMessage: async (msg: any): Promise<void> => {
            if (messageHandler) {
                await messageHandler(msg);
            }
        },
        /**
         * Get all messages posted from the extension to the webview.
         */
        getPostedMessages: () => postedMessages,
        /**
         * Clear posted messages (useful between test cases).
         */
        clearPostedMessages: () => { postedMessages.length = 0; },
    };
}
