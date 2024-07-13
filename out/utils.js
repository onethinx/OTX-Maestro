"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.substituteVariableRecursive = exports.substituteVariables = void 0;
const vscode = require("vscode");
const path = require("path");
// Define variable names and regular expressions
const variableNames = {
    file: '${file}',
    fileBasename: '${fileBasename}',
    fileBasenameNoExtension: '${fileBasenameNoExtension}',
    fileExtname: '${fileExtname}',
    fileDirname: '${fileDirname}',
    fileWorkspaceFolder: '${fileWorkspaceFolder}',
    workspaceFolder: '${workspaceFolder}',
    workspaceFolderBasename: '${workspaceFolderBasename}',
    execPath: '${execPath}',
    pathSeparator: '${pathSeparator}',
    lineNumber: '${lineNumber}',
    selectedText: '${selectedText}',
    environmentVariable: '${env}',
    singleEnvironmentVariable: 'env',
    configurationVariable: '${config}',
    singleConfigurationVariable: 'config',
};
const variableRegexps = {
    [variableNames.file]: new RegExp(escapeRegExp(variableNames.file), 'ig'),
    [variableNames.fileBasename]: new RegExp(escapeRegExp(variableNames.fileBasename), 'ig'),
    [variableNames.fileBasenameNoExtension]: new RegExp(escapeRegExp(variableNames.fileBasenameNoExtension), 'ig'),
    [variableNames.fileDirname]: new RegExp(escapeRegExp(variableNames.fileDirname), 'ig'),
    [variableNames.fileExtname]: new RegExp(escapeRegExp(variableNames.fileExtname), 'ig'),
    [variableNames.fileWorkspaceFolder]: new RegExp(escapeRegExp(variableNames.fileWorkspaceFolder), 'ig'),
    [variableNames.workspaceFolder]: new RegExp(escapeRegExp(variableNames.workspaceFolder), 'ig'),
    [variableNames.workspaceFolderBasename]: new RegExp(escapeRegExp(variableNames.workspaceFolderBasename), 'ig'),
    [variableNames.execPath]: new RegExp(escapeRegExp(variableNames.execPath), 'ig'),
    [variableNames.pathSeparator]: new RegExp(escapeRegExp(variableNames.pathSeparator), 'ig'),
    [variableNames.lineNumber]: new RegExp(escapeRegExp(variableNames.lineNumber), 'ig'),
    [variableNames.selectedText]: new RegExp(escapeRegExp(variableNames.selectedText), 'ig'),
    [variableNames.singleEnvironmentVariable]: /\${env:([a-zA-Z_]+[a-zA-Z0-9_]*)}/i,
    [variableNames.environmentVariable]: /\${env:([a-zA-Z_]+[a-zA-Z0-9_]*)}/ig,
    [variableNames.singleConfigurationVariable]: /\${config:([^}]+?)}/i,
    [variableNames.configurationVariable]: /\${config:([^}]+?)}/ig,
};
function escapeRegExp(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}
/**
 * Substitute variables in a string based on the current VS Code environment and configuration.
 * @param str The string with variables to substitute.
 * @returns The string with substituted variables.
 */
function substituteVariables(str) {
    const activeTextEditor = vscode.window.activeTextEditor;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (str.includes(variableNames.selectedText) && activeTextEditor) {
        const selection = activeTextEditor.selection;
        const selectedText = activeTextEditor.document.getText(selection);
        str = str.replace(variableRegexps[variableNames.selectedText], selectedText);
    }
    if (str.includes(variableNames.pathSeparator)) {
        str = str.replace(variableRegexps[variableNames.pathSeparator], path.sep);
    }
    if (str.includes(variableNames.lineNumber) && activeTextEditor) {
        str = str.replace(variableRegexps[variableNames.lineNumber], String(activeTextEditor.selection.active.line + 1));
    }
    if (str.includes(variableNames.execPath)) {
        str = str.replace(variableRegexps[variableNames.execPath], vscode.env.appRoot);
    }
    if (str.includes(variableNames.file) && activeTextEditor) {
        str = str.replace(variableRegexps[variableNames.file], activeTextEditor.document.uri.fsPath);
    }
    if (str.includes(variableNames.fileBasename) && activeTextEditor) {
        str = str.replace(variableRegexps[variableNames.fileBasename], path.basename(activeTextEditor.document.uri.fsPath));
    }
    if (str.includes(variableNames.fileBasenameNoExtension) && activeTextEditor) {
        str = str.replace(variableRegexps[variableNames.fileBasenameNoExtension], path.basename(activeTextEditor.document.uri.fsPath, path.extname(activeTextEditor.document.uri.fsPath)));
    }
    if (str.includes(variableNames.fileExtname) && activeTextEditor) {
        str = str.replace(variableRegexps[variableNames.fileExtname], path.extname(activeTextEditor.document.uri.fsPath));
    }
    if (str.includes(variableNames.fileDirname) && activeTextEditor) {
        str = str.replace(variableRegexps[variableNames.fileDirname], path.dirname(activeTextEditor.document.uri.fsPath));
    }
    if (str.includes(variableNames.workspaceFolder) && workspaceFolder) {
        str = str.replace(variableRegexps[variableNames.workspaceFolder], workspaceFolder);
    }
    if (str.includes(variableNames.workspaceFolderBasename) && workspaceFolder) {
        str = str.replace(variableRegexps[variableNames.workspaceFolderBasename], path.basename(workspaceFolder));
    }
    if (str.includes(variableNames.fileWorkspaceFolder) && activeTextEditor && workspaceFolder) {
        const fileWorkspaceFolder = vscode.workspace.getWorkspaceFolder(activeTextEditor.document.uri)?.uri.fsPath;
        if (fileWorkspaceFolder) {
            str = str.replace(variableRegexps[variableNames.fileWorkspaceFolder], fileWorkspaceFolder);
        }
    }
    if (variableRegexps[variableNames.environmentVariable].test(str)) {
        const match = str.match(variableRegexps[variableNames.environmentVariable]);
        for (const _ of match || []) {
            str = str.replace(variableRegexps[variableNames.singleEnvironmentVariable], (__, g1) => process.env[g1] || g1);
        }
    }
    if (variableRegexps[variableNames.configurationVariable].test(str)) {
        const match = str.match(variableRegexps[variableNames.configurationVariable]);
        for (const _ of match || []) {
            str = str.replace(variableRegexps[variableNames.singleConfigurationVariable], (__, g1) => replaceConfigurationVariable(g1));
        }
    }
    return str;
}
exports.substituteVariables = substituteVariables;
/**
 * Replace configuration variables in a string.
 * @param configName The configuration variable name.
 * @returns The value of the configuration variable.
 */
function replaceConfigurationVariable(configName) {
    if (!configName.includes('.')) {
        vscode.window.showErrorMessage(`Configuration variable must include a dot (.) in the name: "${configName}"`);
        return configName;
    }
    const configParts = configName.split('.');
    const configValue = vscode.workspace.getConfiguration(configParts[0]).get(configParts.slice(1).join('.'));
    if (typeof configValue !== 'string' && typeof configValue !== 'number') {
        vscode.window.showErrorMessage(`Configuration variable must be of type string or number: "${configName}"`);
        return configName;
    }
    return String(configValue);
}
/**
 * Recursively walk through an object/array and substitute variables in strings.
 * @param arg The object/array/string to process.
 * @returns The processed object/array/string with substituted variables.
 */
function substituteVariableRecursive(arg) {
    if (typeof arg === 'string') {
        return substituteVariables(arg);
    }
    if (Array.isArray(arg)) {
        for (const [key, value] of arg.entries()) {
            arg[key] = substituteVariableRecursive(value);
        }
    }
    else if (typeof arg === 'object' && arg !== null) {
        for (const key in arg) {
            arg[key] = substituteVariableRecursive(arg[key]);
        }
    }
    return arg;
}
exports.substituteVariableRecursive = substituteVariableRecursive;
//# sourceMappingURL=utils.js.map