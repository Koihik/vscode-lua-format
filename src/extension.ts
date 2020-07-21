'use strict';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';

const selectors: { language: string; scheme: string }[] = [
    { language: 'lua', scheme: 'file' },
    { language: 'lua', scheme: 'untitled' },
];

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('lua-format');
    vscode.languages.registerDocumentFormattingEditProvider(selectors, new LuaFormatProvider(context));
}

// show info in problem panel
function updateDiagnostics(document: vscode.TextDocument, errorMsg: string | void): void {
    if (errorMsg) {
        const errs: vscode.Diagnostic[] = [];
        errorMsg.split('\n').forEach(err => {
            let pos: any[] | null = /^line (\d+):(\d+)/.exec(err);
            if (!pos || pos.length !== 3) { return; }
            // LuaFormatter: row start from 1, col start from 0
            pos = [parseInt(pos[1]) - 1, parseInt(pos[2])];
            const range = new vscode.Range(new vscode.Position(pos[0], pos[1]), new vscode.Position(pos[0], pos[1]));
            errs.push({
                message: err,
                range,
                severity: vscode.DiagnosticSeverity.Error,
            });
        });
        diagnosticCollection.set(document.uri, errs);
    } else {
        diagnosticCollection.clear();
    }
}

class LuaFormatProvider implements vscode.DocumentFormattingEditProvider {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
        const data = document.getText();

        return new Promise((resolve, reject) => {
            let configPath = vscode.workspace.getConfiguration().get<string>("vscode-lua-format.configPath");
            let binaryPath = vscode.workspace.getConfiguration().get<string>("vscode-lua-format.binaryPath");

            const args = [];

            if (configPath) {
                if (!path.isAbsolute(configPath) && vscode.workspace.workspaceFolders[0]) {
                    configPath = path.resolve(vscode.workspace.workspaceFolders[0], configPath);
                }
                args.push("-c");
                args.push(configPath);
            }

            if (!binaryPath) {
                const platform = os.platform();
                binaryPath = `${this.context.extensionPath}/bin/`;
                if (platform === "linux" || platform === "darwin" || platform === "win32") {
                    binaryPath += platform;
                } else {
                    reject(`vscode-lua-format do not support '${platform}'.`);
                    return;
                }
                binaryPath += "/lua-format";
            } else {
                if (!path.isAbsolute(binaryPath) && vscode.workspace.workspaceFolders[0]) {
                    binaryPath = path.resolve(vscode.workspace.workspaceFolders[0], binaryPath);
                }
            }
            const cmd = cp.spawn(binaryPath, args, {});
            const result: Buffer[] = [], errorMsg: Buffer[] = [];
            cmd.on('error', err => {
                vscode.window.showErrorMessage(`Run lua-format error: '${err.message}'`);
                reject(err);
            });
            cmd.stdout.on('data', data => {
                result.push(Buffer.from(data));
            });
            cmd.stderr.on('data', data => {
                errorMsg.push(Buffer.from(data));
            });
            cmd.on('exit', code => {
                const resultStr = Buffer.concat(result).toString();
                const errorMsgStr = Buffer.concat(errorMsg).toString();
                updateDiagnostics(document, errorMsgStr);
                if (code) {
                    reject();
                    return;
                }
                if (resultStr.length > 0) {
                    const range = document.validateRange(new vscode.Range(0, 0, Infinity, Infinity));
                    resolve([new vscode.TextEdit(range, resultStr)]);
                } else {
                    reject(`unexpected error: ${errorMsgStr}`);
                }
            });
            cmd.stdin.write(data);
            cmd.stdin.end();
        });
    }
}
