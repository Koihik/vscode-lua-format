'use strict';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const selectors: { language: string; scheme: string }[] = [
    { language: 'lua', scheme: 'file' },
    { language: 'lua', scheme: 'untitled' },
];

let extensionPath = "";
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    extensionPath = context.extensionPath;
    diagnosticCollection = vscode.languages.createDiagnosticCollection('lua-format');
    vscode.languages.registerDocumentFormattingEditProvider(selectors, new LuaFormatProvider());
}

export function deactivate() {
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

    constructor() {
    }

    public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
        var data = document.getText();

        return new Promise((resolve, reject) => {

            let configPath = vscode.workspace.getConfiguration().get<string>("vscode-lua-format.configPath");
            const binaryPath = vscode.workspace.getConfiguration().get<string>("vscode-lua-format.binaryPath");

            if (binaryPath) {
                exepath = binaryPath;
            } else {
                let platform = os.platform();
                var exepath = `${extensionPath}/bin/`;
                if (platform === "linux" || platform === "darwin" || platform === "win32") {
                    exepath += platform;
                } else {
                    vscode.window.showErrorMessage(`vscode-lua-format do not support '${platform}'.`);
                    reject(new Error(`vscode-lua-format do not support '${platform}'.`));
                }
                exepath += "/lua-format";
            }

            const args = ["-si"];

            function process() {
                const cmd = cp.spawn(exepath, args, {});
                const result: Buffer[] = [], errorMsg: Buffer[] = [];
                cmd.on('error', err => {
                    console.warn(err);
                    vscode.window.showErrorMessage(`Run lua-format error : '${err.message}'`);
                    reject(err);
                });
                cmd.stdout.on('data', data => {
                    result.push(Buffer.from(data));
                });
                cmd.stderr.on('data', data => {
                    errorMsg.push(Buffer.from(data));
                });
                cmd.on('close', code => {
                    const resultStr = Buffer.concat(result).toString();
                    const errorMsgStr = Buffer.concat(errorMsg).toString("utf8");
                    updateDiagnostics(document, errorMsgStr);
                    if (code) {
                        vscode.window.showErrorMessage(`Run lua-format failed with exit code: ${code} ${errorMsgStr}`);
                        return reject(new Error(`Run lua-format failed with exit code: ${code}`));
                    }
                    if (resultStr.length > 0) {
                        const range = document.validateRange(new vscode.Range(0, 0, Infinity, Infinity));
                        resolve([new vscode.TextEdit(range, resultStr)]);
                    }
                });
                cmd.stdin.write(data);
                cmd.stdin.end();
            }

            if (configPath) {
                args.push("-c");
                args.push(configPath);
                process();
            } else {
                var rootpath = vscode.workspace.getWorkspaceFolder(document.uri);
                if (rootpath) {
                    let configPath = path.join(rootpath.uri.fsPath, ".lua-format")
                    fs.exists(configPath, function (exists: boolean) {
                        if (exists) {
                            args.push("-c");
                            args.push(configPath);
                        }
                        process();
                    })
                } else {
                    process()
                }
            }
        });
    }
}