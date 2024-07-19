import * as vscode from 'vscode';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execSync } from 'child_process';
import * as util from './utils';

export enum returnedContent {
    fullString,
    stringArray,
    firstLine,
    parsedJson
}

export function getPath(pathSegments: string[]) {
    if (pathSegments[0] === 'workspace')
    {
        pathSegments[0] = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '=';
        if (pathSegments[0] === '=') { throw new Error("Workspace folder is not defined."); }
    }
    return path.join(...pathSegments);
}

export function existsFile(pathSegments: string[])
{
    const fileName = getPath(pathSegments);
    return fs.existsSync(fileName);
}

export async function writeFile(pathSegments: string[], contents: string): Promise<void> {
    const fileName = getPath(pathSegments);
    try {
        await fsp.writeFile(fileName, contents, { encoding: 'utf-8' });
    } catch (err) {
        console.error('Error writing file:', err);
        throw err;
    }
}

export function readDirectory(basePath: string[], refArray: string[], dir: string[], extension: string, foldersOnly: boolean): string[] {
    const basePath_ = getPath(basePath);
    const dir_ = getPath(dir);
    return readDirectory_(basePath_, refArray, dir_, extension, foldersOnly);
}

function readDirectory_(basePath: string, refArray: string[], dir: string, extension: string, foldersOnly: boolean): string[] {
    let pushed = false;
    fs.readdirSync(dir).forEach(file => {
        const current = path.join(dir, file);

        if (fs.statSync(current).isFile()) {
            if (current.endsWith(extension)) {
                const fle = path.relative(basePath, dir).replace(/\\/g, '/');

                if (foldersOnly) {
                    if (!pushed) {refArray.push(`\t'${fle}',`);}
                    pushed = true;
                } else {
                    const fleFile = path.relative(basePath, current).replace(/\\/g, '/');
                    refArray.push(`\t'${fleFile}',`);
                }
            }
        } else {
            readDirectory_(basePath, refArray, current, extension, foldersOnly);
        }
    });
    return refArray;
}


export async function getFile(pathSegments: string[], content: returnedContent) {
    let fileContent = '';
    if (pathSegments[0].toLowerCase().startsWith('http'))
    {
        const url = pathSegments.map(segment => segment.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/'); // Remove leading and trailing slashes, empty segments
        fileContent = await getFileFromUrl(url);
    }
    else
    {
        pathSegments[0] = pathSegments[0].replace(/^file:\/*/, '');
        const fileName = getPath(pathSegments);
        fileContent = fs.readFileSync(fileName, 'utf8');
    }

    switch (content) {
        case returnedContent.fullString:
            return fileContent;
        case returnedContent.stringArray:
            return fileContent.split(/\r?\n/);
        case returnedContent.firstLine:
            return fileContent.split(/\r?\n/)[0];
        case returnedContent.parsedJson:
            return JSON.parse(fileContent);
    }
}

function getFileFromUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'Cache-Control': 'no-cache'
            }
        };

        https.get(url, options, response => {
            const { statusCode } = response;

            // Check for non-success status codes (outside the range 200-299)
            if (!statusCode || statusCode < 200 || statusCode >= 300) {
                reject(new Error(`Request failed with status code: ${statusCode}`));
                response.resume(); // Consume the response data to free up memory
                return;
            }

            response.setEncoding('utf8'); // Ensure the data is received as a string
            let rawData = '';

            // Accumulate the data chunks
            response.on('data', chunk => {
                rawData += chunk;
            });

            // Resolve the promise once the response ends
            response.on('end', () => {
                resolve(rawData);
            });
        }).on('error', err => {
            // Handle request errors
            reject(err);
        });
    });
}

// function getFileFromUrl(url: string, destPath: string, firstLineOnly: boolean = false): Promise<string> {
//     return new Promise((resolve, reject) => {
//         const options = {
//             headers: {
//                 'Cache-Control': 'no-cache'
//             }
//         };
//         https.get(url, options, response => {
//             const { statusCode } = response;
//             // Check for non-success status codes (outside the range 200-299)
//             if (!statusCode || statusCode < 200 || statusCode >= 300) {
//                 reject(new Error(`Request failed with status code: ${statusCode}`));
//                 response.resume(); // Consume the response data to free up memory
//                 return;
//             }
//             if (destPath) {
//                 // Save the file to disk
//                 const file = fs.createWriteStream(destPath);
//                 response.pipe(file);
//                 file.on('finish', () => {
//                     file.close(() => {
//                         resolve('');  // Resolve with an empty string when saving to disk
//                     });
//                 }).on('error', err => {
//                     fs.unlink(destPath, () => {});  // Delete the file on error
//                     reject(err);  // Reject the promise with the error
//                 });
//             } else {
//                 // Collect the file content as a string, optionally returning only the first line
//                 let data = '';
//                 response.setEncoding('utf8');
//                 response.on('data', chunk => {
//                     data += chunk;
//                     if (firstLineOnly) {
//                         const newlineIndex = data.indexOf('\n');
//                         if (newlineIndex !== -1) {
//                             resolve(data.slice(0, newlineIndex));
//                             response.destroy(); // Stop further data reception
//                         }
//                     }
//                 });
//                 response.on('end', () => {
//                     resolve(data);  // Resolve with the file content as a string
//                 });
//                 response.on('error', err => {
//                     reject(err);  // Reject the promise with the error
//                 });
//             }
//         }).on('error', err => {
//             reject(err);  // Reject the promise with the error
//         });
//     });
// }

// export async function updateFile2(baseUrl: string, folder: string, file: string): Promise<void> {
//     const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
//     if (!basePath) { throw new Error("Workspace folder is not defined."); };
//     const vsCodePath = path.join(basePath, folder, file);
//     const folderWithSlash = folder ? folder + '/' : '';
//     await getFileFromUrl(`${baseUrl}${folderWithSlash}${file}`, vsCodePath).catch(err => console.error(`Error downloading file: ${baseUrl}${folderWithSlash}${file}\n`, err));
// }

export async function copyFile(sourcePathSegments: string[], destPathSegments: string[]): Promise<void> {
    const fileContent = await getFile(sourcePathSegments, returnedContent.fullString);
    await writeFile(destPathSegments, fileContent);
}

export function removeFile(pathSegments: string[]) {
    try {
        const fileName = getPath(pathSegments);
        fs.unlink(fileName, () => {});
    } catch (error) {
        console.error(`Error deleting file ${pathSegments}:`, error);
    }
}

export async function mkDir(pathSegments: string[]) {
    try {
        const fileName = getPath(pathSegments);
        await fs.promises.mkdir(fileName);
    } catch (error) {
        console.error(`Error creating folder ${pathSegments}:`, error);
    }
}

export function readDir(pathSegments: string[]) {
    try {
        const path = getPath(pathSegments);
        return fs.readdirSync(path);
    } catch (error) {
        console.error(`Error creating folder ${pathSegments}:`, error);
    }
    return [];
}

export function statSync(pathSegments: string[]) {
    const path = getPath(pathSegments);
    return fs.statSync(path);
}

export function rmSync(pathSegments: string[]) {
    const path = getPath(pathSegments);
    return fs.rmSync(path, { recursive: true, force: true });
}

export function realpathSyncNative(pathSegments: string[]) {
    const path = getPath(pathSegments);
    return fs.realpathSync.native(path);
}
