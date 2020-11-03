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

    protected resolvePath(fileName: string) {
        if (path.isAbsolute(fileName)) {
            if (fs.existsSync(fileName)) {
                return fileName;
            }
        } else {
            for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
                const fullPath = path.resolve(workspaceFolder.uri.fsPath, fileName);
                if (fs.existsSync(fullPath)) {
                    return fullPath;
                }
            }
        }
        throw new Error(`Cannot find file: '${fileName}'`);
    }

    public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
        const data = document.getText();

        return new Promise((resolve, reject) => {
            let configPath = vscode.workspace.getConfiguration().get<string>("vscode-lua-format.configPath");
            let binaryPath = vscode.workspace.getConfiguration().get<string>("vscode-lua-format.binaryPath");

            const args = [];

            if (configPath) {
                try {
                    configPath = this.resolvePath(configPath);
                    args.push("-c");
                    args.push(configPath);
                } catch (error) {
                    vscode.window.showWarningMessage(`Cannot find config file '${configPath}', fallback to default config.`);
                }
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
                binaryPath = this.resolvePath(binaryPath);
            }

            let cwd = undefined;
            if (document.uri.toString().startsWith('file://')) {
                cwd = path.dirname(document.fileName);
            }

            const cmd = cp.spawn(binaryPath, args, { cwd });
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
