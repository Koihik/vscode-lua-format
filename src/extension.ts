'use strict';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as os from 'os';

const selectors: { language: string; scheme: string }[] = [
    { language: 'lua', scheme: 'file' },
    { language: 'lua', scheme: 'untitled' },
];

let extensionPath = "";

export function activate(context: vscode.ExtensionContext) {
    extensionPath = context.extensionPath;

    vscode.languages.registerDocumentFormattingEditProvider(selectors, new LuaFormatProvider());
}

export function deactivate() {
}

class LuaFormatProvider implements vscode.DocumentFormattingEditProvider {

    constructor() {
    }

    public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Thenable<vscode.TextEdit[]> {
        var data = document.getText();

        return new Promise((resolve, reject) => {

            let configPath = vscode.workspace.getConfiguration().get<string>("vscode-lua-format.configPath");
            
            // if is workspace relative path, convert to absolute path
            if (vscode.workspace.asRelativePath(configPath) == configPath) {
                let workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders != undefined && workspaceFolders.length > 0) {
                    configPath = workspaceFolders[0].uri.fsPath + "/" + configPath;
                }
            }

            const args = ["-si"];

            if (configPath) {
                args.push("-c");
                args.push(configPath);
            }

            let platform = os.platform();
            var path = `${extensionPath}/bin/`;
            if (platform == "linux" || platform == "darwin" || platform == "win32") {
                path += platform;
            } else {
                vscode.window.showErrorMessage(`vscode-lua-format do not support '${platform}'.`);
                reject(new Error(`vscode-lua-format do not support '${platform}'.`));
            }
            path += "/lua-format";

            const cmd = cp.spawn(path, args, {});
            let result = "";
            cmd.on('error', err => {
                console.warn(err);
                vscode.window.showErrorMessage(`Run lua-format error : '${err.message}'`);
                reject(err);
            });
            cmd.stdout.on('data', data => {
                result += data.toString();
            });
            cmd.on('exit', code => {
                if (code) {
                    vscode.window.showErrorMessage(`Run lua-format failed with exit code: ${code}`);
                    return reject(new Error(`Run lua-format failed with exit code: ${code}`));
                }
                const range = document.validateRange(new vscode.Range(0, 0, Infinity, Infinity));
                resolve([new vscode.TextEdit(range, result)]);
            });
            cmd.stdin.write(data);
            cmd.stdin.end();
        });
    }
}
