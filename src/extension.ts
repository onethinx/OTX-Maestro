

import * as vscode from 'vscode';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as https from 'https';
import { execSync } from 'child_process';
import { substituteVariables, substituteVariableRecursive } from './utils';

// The minimum project version
let thisVersion = '1.0.0';
const minToolsVersion = '1.0.2';
let maestroToolsVersion = '1.0.0';
const updateLocation = 'https://raw.githubusercontent.com/onethinx/Maestro-lib/main/.vscode/update.json';

const defaultSettings: { [key: string]: string } = {
    defaultDebugger: '',
   //' someOtherSetting: '',
};

let notJlink = true;

const config = vscode.workspace.getConfiguration('otx-maestro');

function getSetting(setting: string): string {
    const config = vscode.workspace.getConfiguration('otx-maestro');
    return (config.get<string>(setting) || defaultSettings[setting]) ?? '';
}

function evaluateTemplate(val: any) {
    try{
        const match = val.match(/\$\{(\w+)\}/);
        return match ? eval(match[1]) : val;
    }
    catch{}
    return val;
}

export function activate2(context: vscode.ExtensionContext) {
}

export function activate(context: vscode.ExtensionContext) {
    thisVersion = context.extension.packageJSON.version;
    notJlink = selectProg('', true).currentProgrammer !== 'jlink';

    const statusBarItem = vscode.window.createStatusBarItem();
    statusBarItem.text = `$(zap)OTX-Maestro$(zap)`;
    statusBarItem.tooltip = new vscode.MarkdownString(`OTX-Maestro v${thisVersion}\n\n[Learn More](https://github.com/onethinx/OTX-Maestro/blob/main/README.md)`);
    statusBarItem.command = 'extension.showDetails';
    statusBarItem.color = '#25C0D8';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(vscode.commands.registerCommand('extension.showDetails', () => {
        const currentProject = getCurrentProject();
        let message = `OTX Maestro v${thisVersion}
        OTX Maestro Tools v${maestroToolsVersion}
        OTX Maestro Project v${currentProject.version}`;
        
        const deprecatedExtensions = [
            //'ms-vscode.cpptools',
            'rolfnoot.cortex-meson-builder',
            'marus25.cortex-debug',
            'egomobile.vscode-powertools',
            'actboy168.tasks'
        ];
        
        const installedExtensions = vscode.extensions.all.map(ext => ext.id.toLowerCase());
        const foundExtensions = deprecatedExtensions.filter(extId => installedExtensions.includes(extId));
        
        if (foundExtensions.length > 0)
        {
            message += `\n\nOTX-Maestro doesn't need these extensions anymore:\n${foundExtensions.join('\n')}`;
        }
        
        vscode.window.showInformationMessage(message, { modal: true });
    }));



    updateProject(true) ;

    // Read task and add to taskbar if necessary 
    const tasksConfig = vscode.workspace.getConfiguration('tasks');
    if (tasksConfig.tasks && Array.isArray(tasksConfig.tasks)) {
        tasksConfig.tasks.forEach(task => {
            //console.log('Task:', task); // Print each task to verify its structure
            const taskOptions = task.options || {};
            const itemHide = evaluateTemplate(taskOptions.statusbar?.hide);
            //const itemHide =taskOptions.statusbar?.hide;
            if (itemHide === undefined || itemHide === false) {
                const statusBarItem = vscode.window.createStatusBarItem();
                statusBarItem.text =  (taskOptions.statusbar?.label ?? '' !== '')? taskOptions.statusbar.label : task.label;
                
                statusBarItem.command = {
                    command: 'otx-maestro.runTask',
                    title: task.label,
                    arguments: [task],
                };
                if (taskOptions.statusbar?.color ?? '' !== '') { statusBarItem.color = taskOptions.statusbar.color; }
                if (taskOptions.statusbar?.detail ?? '' !== '') { statusBarItem.tooltip = taskOptions.statusbar.detail; }
                statusBarItem.show();
                context.subscriptions.push(statusBarItem);
            }
        });

        context.subscriptions.push(vscode.commands.registerCommand('otx-maestro.runTask', async (task: any) => {
            if (task.command === '${command:otx-maestro.clean}')
            {
                clean();
            }
            else if (task.command=== '${command:otx-maestro.build}')
            {
                build();
            }
            else if (task.command=== '${command:otx-maestro.launch}')
            {
                launch();
            }
            else if (task.command=== '${command:otx-maestro.prelaunch}')
            {
                preLaunch();
            }
            else {
                vscode.tasks.executeTask(new vscode.Task(
                    { type: task.type, task: task.label },
                    vscode.TaskScope.Workspace,
                    task.label,
                    'Workspace',
                    new vscode.ShellExecution(task.command, task.args)
                ));
            }
        }));
    }

    // Define the commands array 
    const commands = [
        { command: 'otx-maestro.preLaunch',         callback: preLaunch },
        { command: 'otx-maestro.updateProject',     callback: updateProject },
        { command: 'otx-maestro.selectProgrammer',  callback: selectProgrammer },
        { command: 'otx-maestro.clean',             callback: clean },
        { command: 'otx-maestro.build',             callback: build },
        { command: 'otx-maestro.launch',            callback: launch}
    ];

    // Register the commands
    for (const { command, callback } of commands) {
        const disposable = vscode.commands.registerCommand(command, callback);
        context.subscriptions.push(disposable);
    }

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('tasks')) {
            // Refresh tasks if the tasks configuration has changed
            const confirm = await vscode.window.showInformationMessage(
                'Tasks configuration changed. Do you want to reload the window to apply changes?', { modal: true }, 'Yes', 'No'
            );
            if (confirm === 'Yes') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
    }));

    maestroToolsVersion = checkToolsVersion();
    const compare = versionCompare(minToolsVersion, maestroToolsVersion);
    if (compare === 'h') {
        vscode.window.showErrorMessage(`Please update OTX Maestro Tools\nneeded: ${minToolsVersion}\n got: ${maestroToolsVersion}`, { modal: true });
        return;
    }
}

export function deactivate() {}

// Command callback functions
async function preLaunch() {
    const ret = await build();
    console.log(`prelaunch result" ${ret}`);
    if (ret === '') {
        (async () => {
            for (let cnt = 0; cnt < 10; cnt++) {
                    await sleep(300);
                    await vscode.commands.executeCommand('workbench.debug.action.focusRepl');
            }
        })();
    }
    return ret;
}


function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getDate(): string {
    const dateTime = new Date();
    const year = dateTime.getFullYear();
    const month = ("0" + (dateTime.getMonth() + 1)).slice(-2);
    const day = ("0" + dateTime.getDate()).slice(-2);
    const hour = ("0" + dateTime.getHours()).slice(-2);
    const minute = ("0" + dateTime.getMinutes()).slice(-2);
    const seconds = ("0" + dateTime.getSeconds()).slice(-2);
    return `${year}-${month}-${day}_${hour}-${minute}-${seconds}`;
}


function getFileFromUrl(url: string, destPath: string, firstLineOnly: boolean = false): Promise<string> {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'Cache-Control': 'no-cache'
            }
        };

        https.get(url, options, response => {
            if (destPath) {
                // Save the file to disk
                const file = fs.createWriteStream(destPath);
                response.pipe(file);
                file.on('finish', () => {
                    file.close(() => {
                        resolve('');  // Resolve with an empty string when saving to disk
                    });
                }).on('error', err => {
                    fs.unlink(destPath, () => {});  // Delete the file on error
                    reject(err);  // Reject the promise with the error
                });
            } else {
                // Collect the file content as a string, optionally returning only the first line
                let data = '';
                response.setEncoding('utf8');
                response.on('data', chunk => {
                    data += chunk;
                    if (firstLineOnly) {
                        const newlineIndex = data.indexOf('\n');
                        if (newlineIndex !== -1) {
                            resolve(data.slice(0, newlineIndex));
                            response.destroy(); // Stop further data reception
                        }
                    }
                });
                response.on('end', () => {
                    resolve(data);  // Resolve with the file content as a string
                });
                response.on('error', err => {
                    reject(err);  // Reject the promise with the error
                });
            }
        }).on('error', err => {
            reject(err);  // Reject the promise with the error
        });
    });
}

async function updateFile(folder: string, file: string): Promise<void> {
    const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!basePath) { throw new Error("Workspace folder is not defined."); };
    const vsCodePath = path.join(basePath, folder, file);
    const folderWithSlash = folder ? folder + '/' : '';
    await getFileFromUrl(`https://raw.githubusercontent.com/onethinx/Maestro-lib/main/${folderWithSlash}${file}`, vsCodePath).catch(err => console.error('Error downloading file:', err));
}

async function removeFile(folder: string, file: string): Promise<void> {
    try {
        const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!basePath) { throw new Error("Workspace folder is not defined."); };
        const vsCodePath = path.join(basePath, folder, file);
        await fs.unlink(vsCodePath, () => {});
        //console.log(`Successfully deleted ${vsCodePath}`);
    } catch (error) {
        console.error(`Error deleting file ${folder}/${file}:`, error);
    }
}

enum returnedContent {
    fullString,
    firstLine,
    parsedJson
}

function getFile(pathSegments: string[], content: returnedContent) {
    const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!basePath) {
        throw new Error("Workspace folder is not defined.");
    }
    const packageJsonPath = path.join(basePath, ...pathSegments);
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');

    switch (content) {
        case returnedContent.fullString:
            return packageJsonContent;
        case returnedContent.firstLine:
            return packageJsonContent.split('\n')[0];
        case returnedContent.parsedJson:
            return JSON.parse(packageJsonContent);
    }
}

async function updateProject(startup = false) {
    let currentProject = getCurrentProject();
    let onlineProject = currentProject;
    let updatePackage;
    try {
        const onlinePrjFile = await getFileFromUrl("https://raw.githubusercontent.com/onethinx/Maestro-lib/main/.vscode/project.json", '', false);
        onlineProject = JSON.parse(onlinePrjFile);
        if (!currentProject.version || !onlineProject.version) { throw new Error(); };
    } catch (error) {
        vscode.window.showErrorMessage(`Error fetching version: ${(error as Error).message || 'unknown error'}`);
        return;
    }
    if (versionCompare(onlineProject.version, currentProject.version) !== 'h') {
        if (!startup)
        {
            await vscode.window.showInformationMessage(
                'No newer project version found online.', 
                { modal: true }
            );
        }
        return;
    }

    const result = await vscode.window.showInformationMessage(
        `Project update from ${currentProject.version} to ${onlineProject.version}.\n\n\
        This might need an OTX-Meastro update and will update the meson build files and the configuration files in .vscode.\n\n\
        Backup your project if unsure.\n\nContinue?`, 
        { modal: true }, 
        'Yes', 'No'
    );
    if (result !== 'Yes') {return;}

    try {
        const updatePackageFile = await getFileFromUrl(currentProject.updatePackage, '');
        updatePackage = JSON.parse(updatePackageFile);
    }
    catch
    {
        const result = await vscode.window.showInformationMessage(`Invalid updatePackage file.\nCheck link in .vscode/project.json\
            \n\nContinue with default?`, { modal: true },'Yes', 'No'
        );
        if (result !== 'Yes') {return;}

        try
        {
            try {
                const updatePackageFile = await getFileFromUrl(updateLocation, '');
                updatePackage = JSON.parse(updatePackageFile);
            }
            catch 
            {
                const updatePackageFile = await getFileFromUrl(onlineProject.updatePackage, '');
                updatePackage = JSON.parse(updatePackageFile);
            }
        }
        catch
        {
            vscode.window.showErrorMessage(`Invalid update link. Cannot update.`, { modal: true });
        }
    }
    for (const file of updatePackage.updateFiles) {
        let dir = path.dirname(file);
        dir = dir === '.' ? '' : dir[0] === '.'? dir.substring(2) : dir;
        const filename = path.basename(file);
        console.log(`update: ${dir} ${filename}`);
        await updateFile(dir, filename);
    }
    for (const file of updatePackage.removeFiles) {
        let dir = path.dirname(file);
        dir = dir === '.' ? '' : dir[0] === '.'? dir.substring(2) : dir;
        const filename = path.basename(file);
        console.log(`remove: ${dir} ${filename}`);
        await removeFile(dir, filename);
    }
    vscode.window.showInformationMessage(`Project updated to Version: ${onlineProject.version}`);
}

function getCurrentProject()
{
    let currentProject: { version: string, updatePackage: string } = { version: '1.0.0', updatePackage: updateLocation };
    try {
        currentProject = getFile(['.vscode', 'project.json'], returnedContent.parsedJson);
    } catch {}
    if (currentProject.version === '1.0.0') {
        try {
            const firstMesonLine = getFile(['.vscode', 'meson.js'], returnedContent.firstLine);
            currentProject.version = firstMesonLine.match(/"([^"]+)"/)[1]; // Find the first match of the text inside double quotes in the string
        }
        catch{}
    }
    return currentProject;
}

function versionCompare(versionIn: string, versionMinimum: string): 'l' | 'h' | 'e' {
    const vIn = String(versionIn).split('.').map(Number).reduce((acc, val) => acc * 1000 + val, 0);
    const vRef = String(versionMinimum).split('.').map(Number).reduce((acc, val) => acc * 1000 + val, 0);
    return vIn < vRef ? 'l' : vIn > vRef ? 'h' : 'e';
}

enum taskResult {
    ok,
    errorSilent,
    errorInform,
    errorConfirm
}
function taskStatus(message: string, succeeded: taskResult): string | null {
    if (succeeded !== taskResult.ok && succeeded !== taskResult.errorSilent )
    {
        vscode.window.showErrorMessage(message, { modal: succeeded === taskResult.errorConfirm });
    }
    return succeeded === taskResult.ok? '' : null;
}

async function clean(): Promise<string | null>  {
	diagnosticCollection.clear();
    const setupResult = checkSetup();
    if (setupResult.status === 'error') {
        const msg = `The Clean task terminated with exit status: ${setupResult.status}\r\n${setupResult.message}\r\nPlease Clean-Reconfigure.`;
        return taskStatus(msg, taskResult.errorConfirm);
    }
    
    const buildFolder = path.join(setupResult.basePath, "build");
    if (setupResult.status === 'missing') {await fs.promises.mkdir(buildFolder);}
    else {
        const elfFiles = fs.readdirSync(buildFolder).filter(file => file.endsWith('.elf'));
        const copy = elfFiles.length > 0;
        const backupFolder = path.join(buildFolder, "backup");
        const nowFolder = path.join(backupFolder, getDate());
        if (!fs.existsSync(backupFolder)) {await fs.promises.mkdir(backupFolder);}
        for (const file of fs.readdirSync(buildFolder))
        {
            const current = path.join(buildFolder, file);
            if (copy && fs.statSync(current).isFile()) {
                if (current.endsWith(".elf") || current.endsWith(".hex") || current.endsWith(".txt") || current.endsWith(".json")) {
                    if (!fs.existsSync(nowFolder)) {await fs.promises.mkdir(nowFolder);}
                    const destFile = path.join(nowFolder, file);
                    await fs.promises.copyFile(current, destFile); 
                }
            } 
            if (file !== 'backup') {
                fs.rmSync(current, { recursive: true, force: true });
            }
        };
    }

    let ret = await executeTask("Creator: postbuild");
    //if (ret === undefined) { return taskStatus('Clean', false); }
    if (ret !== 0) {
        const msg = `The Creator Postbuild task terminated with exit code: ${JSON.stringify(ret)}`;
        return taskStatus(msg, taskResult.errorInform);
    }
    
    const crossBuildFile = path.join(setupResult.basePath, "cross_gcc.build");
    await updateMeson(crossBuildFile, [], []);
    const mesonBuildFile = path.join(setupResult.basePath, "meson.build");
    await updateMeson(mesonBuildFile, [], []);

    ret = await executeTask("Meson: configure");
    if (ret === null) { return taskStatus('Error Task Meson Configure', taskResult.errorInform); }
    const mesonResult = await parseMesonLog();
    if (ret !== 0) 
    {
        //vscode.window.showErrorMessage(`The Configure task terminated with exit code: ${JSON.stringify(ret)}`);
        if (mesonResult.errorCount > 0) {
            vscode.commands.executeCommand('workbench.action.problems.focus');
        }
        const msg = `The Configure task terminated with exit code: ${JSON.stringify(ret)}`;
        return taskStatus(msg, taskResult.errorInform);
    }
    const selProgResult = selectProg("", true);
    if (selProgResult.useDefault === true || selProgResult.currentProgrammer === "") {	// Current programmer is default or not set?
        var currentProgrammer = getSetting('defaultDebugger');
        //console.log(`default: ${currentProgrammer}`);
        if (currentProgrammer === "")
        { // Default programmer isn't set > show picker
            await selectProgrammer();
        }
        else
        {	// Default set, select programmer
            selectProg("default");
        }
    }
    return taskStatus('', taskResult.ok);
}

async function build(): Promise<string | null>  {
    diagnosticCollection.clear();
    const setupResult = checkSetup();
    if (setupResult.status !== 'ok') {
        const msg = `The Clean task terminated with exit status: ${setupResult.status}\r\n${setupResult.message}\r\nPlease Clean-Reconfigure.`;
        return taskStatus(msg, taskResult.errorConfirm);
    }

    const sourcePath = path.join(setupResult.basePath, "source");
    const mesonBuildFile = path.join(setupResult.basePath, "meson.build");
    if (!fs.existsSync(mesonBuildFile)) {
        const msg = `meson.build file not found!`;
        return taskStatus(msg, taskResult.errorInform);
    }

    const headerContents = readDirectory(setupResult.basePath, [], sourcePath, '.h', true);
    const sourceContents = readDirectory(setupResult.basePath, [], sourcePath, '.c', false);
    console.log(headerContents);

    updateMeson(mesonBuildFile, headerContents, sourceContents);

    const ret = await executeTask("Meson: build");
    if (ret === null) { return taskStatus("error meson build", taskResult.errorInform); }
    const mesonResult = await parseMesonLog();
    if (ret !== 0) 
    {
        //vscode.window.showErrorMessage(`The Build task terminated with exit code: ${JSON.stringify(ret)}`);
       // if (mesonResult.errorCount > 0) {
        vscode.commands.executeCommand('workbench.action.problems.focus');
        const msg = `The Build task terminated with exit code: ${JSON.stringify(ret)}`;
        return taskStatus(msg, taskResult.errorInform);
    }
    return taskStatus('', taskResult.ok);
}

async function launch(): Promise<string | null>  {
    // var ret = await vscode.commands.executeCommand('workbench.action.debug.run');
    // var ret = await vscode.commands.executeCommand('workbench.action.debug.selectandstart');
    //vscode.commands.executeCommand('workbench.action.terminal.focus');
    var ret = await vscode.commands.executeCommand('workbench.action.debug.start');
    console.log(`launch ${ret}`);
    return taskStatus('', taskResult.ok);
};


async function selectProgrammer() {
    const programmers = [
        { s: "default", l: "Default (defined in settings.json)" },
        { s: "kitprog3", l: "Infineon KitProg3 Programmer" },
        { s: "jlink", l: "SEGGER J-Link Programmer" },
        { s: "cmsis-dap", l: "CMSIS-DAP Compliant Debugger" },
        { s: "kitprog", l: "Infineon KitProg Programmer" },
        { s: "ulink", l: "Keil ULINK JTAG Programmer" },
        { s: "stlink", l: "ST-Link Programmer" },
        { s: "ft232r", l: "Bitbang mode of FT232R based devices" },
        { s: "ftdi", l: "MPSSE mode of FTDI based devices" },
        { s: "buspirate", l: "Bus Pirate" },
        { s: "altera-usb-blaster", l: "Altera USB-Blaster Compatible" },
        { s: "altera-usb-blaster2", l: "Altera USB-Blaster II Compatible" },
        { s: "usbprog", l: "USBProg JTAG Programmer" },
        { s: "arm-jtag-ew", l: "Olimex ARM-JTAG-EW Programmer" },
        { s: "angie", l: "ANGIE Adapter" },
        { s: "vsllink", l: "Versaloon-Link JTAG Programmer" },
        { s: "osbdm", l: "OSBDM (JTAG only) Programmer" },
        { s: "opendous", l: "eStick/opendous JTAG Programmer" },
        { s: "rlink", l: "Raisonance RLink JTAG Programmer" },
        { s: "nulink", l: "Nu-Link Programmer" },
        { s: "presto", l: "ASIX Presto Adapter" },
        { s: "openjtag", l: "OpenJTAG Adapter" },
        { s: "linuxgpiod", l: "Linux GPIO bitbang through libgpiod" },
        { s: "xds110", l: "TI XDS110 Debug Probe" },
        { s: "ti-icdi", l: "TI ICDI JTAG Programmer" },
    ];
    // Check for default programmer
    let currentProgrammer = getSetting('defaultDebugger');
    let useDefault = false;
    if (currentProgrammer === '') { ( {useDefault, currentProgrammer} = selectProg("", true)); }

    const index = programmers.findIndex(prog => prog.s === currentProgrammer);
    console.log(`${currentProgrammer} - ${index}`);
    const progNames = programmers.map(prog => prog.l);
    // Create a Quick Pick instance
    const quickPick = vscode.window.createQuickPick();
    quickPick.canSelectMany = false;
    quickPick.placeholder = 'Select a programmer';

    // Set Quick Pick items
    quickPick.items = progNames.map(name => ({ label: name }));

    // Pre-select an item
    quickPick.activeItems = [quickPick.items[index]];

    // Show the Quick Pick
    quickPick.show();

    // Handle the selection
    quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            //console.log("Selected programmer:", selected.label);
            const programmer = programmers.find(prog => prog.l === selected.label);
            if (programmer)
            {
                const currentProg = selectProg(programmer.s).currentProgrammer;
                const msg = (programmer.s === 'default')? `Default ('${currentProg}' in settings.json)` : selected.label;
                vscode.window.showInformationMessage(`You selected: ${msg}`);
                const isJlink = currentProg === 'jlink';
                if (isJlink === notJlink) {
                // Refresh tasks if the tasks configuration has changed
                    const confirm = await vscode.window.showInformationMessage(
                        'The JLink configuration is changed. Do you want to reload the window to apply changes?', { modal: true }, 'Yes', 'No'
                    );
                    if (confirm === 'Yes') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                    notJlink = !isJlink;
                }
            }
            quickPick.dispose();
        }
    });
}

function checkSetup(): {status: string, message: string, basePath: string} {
    const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!basePath) { return { status: 'error', message: 'No workspace opened!', basePath: '' }; }
    const buildDir = path.join(basePath, "build");
    if (!fs.existsSync(buildDir)) { return { 'status': 'missing', 'message': "Missing Build Folder", 'basePath': basePath }; }
    if (!fs.existsSync(path.join(buildDir, "meson-private"))) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath }; }
    if (!fs.existsSync(path.join(buildDir, "meson-info"))) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath }; }
    if (!fs.existsSync(path.join(buildDir, "meson-logs"))) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath }; }
    if (!fs.existsSync(path.join(buildDir, "build.ninja"))) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath }; }
    if (!fs.existsSync(path.join(buildDir, "compile_commands.json"))) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath }; }
    try{
        const mesonInfo = getFile(['build', 'meson-info', 'meson-info.json'], returnedContent.parsedJson);
        const source = mesonInfo.directories.source;
        let resPath1 = '1'; 
        let resPath2 = '2';
        try {
            resPath1 = fs.realpathSync.native(mesonInfo.directories.source);
            resPath2 = fs.realpathSync.native(basePath);
        } catch  { }
        console.log(`source ${resPath1} !== basePath ${resPath2}`);
        if (resPath1 !== resPath2) { return { 'status': 'mismatch', 'message': "Path mismatch, probably some folders changed", 'basePath': basePath }; }
    }
    catch{};
    return { 'status': 'ok', 'message': "OK", 'basePath': basePath };
}

function updateMeson(mesonFile: string, headerContents: string[], sourceContents: string[]) {
    const mesonContents = fs.readFileSync(mesonFile, 'utf-8');
    let arr: string[] = [];
    let logOut = true;
    let linesStripped = 0;

    mesonContents.split(/\r?\n/).forEach((line: string) => {
            if (line.includes("OTX_Extension_HeaderFiles_End") || line.includes("OTX_Extension_SourceFiles_End")) { logOut = true; }
            if (logOut) { arr.push(line); }
            if (linesStripped > 0 && --linesStripped === 0) { logOut = true; }
            if (line.includes("OTX_Extension_HeaderFiles_Start")) {
                    arr = arr.concat(headerContents);
                    logOut = false;
            } else if (line.includes("OTX_Extension_SourceFiles_Start")) {
                    arr = arr.concat(sourceContents);
                    logOut = false;
            } else if (line.includes("OTX_Extension_print")) {
                    const regexp = /\(\s*(.*[^ ])[ )]+$/;
                    const array = line.match(regexp);
                    if (array !== null)
                            { arr = arr.concat(substituteVariables(array[1])); }
                    else
                            { arr = arr.concat('Not found!'); }
                    logOut = false;
                    linesStripped = 1;
            }
    });

    const contents = arr.join('\n');
    // console.log(contents);
    if (contents === mesonContents) {return;}
    writeFile(mesonFile, contents);
}

async function getTask(taskName: string): Promise<vscode.Task | undefined> {   
    const tasks = await vscode.tasks.fetchTasks();
    for (const task of tasks) {
        if (task.name === taskName) {
            return task;
        }
    }
    vscode.window.showErrorMessage(`Cannot find ${taskName} task.`);
}

async function executeTask(taskName: string): Promise<number | undefined> {   
    const task = await getTask(taskName);
    console.log(`--- execute task: ${taskName}`);
    if (task) {
        const taskExecution = await vscode.tasks.executeTask(task);
        return new Promise<number | undefined>((resolve) => {
            const disposable = vscode.tasks.onDidEndTaskProcess(e => {
                if (e.execution === taskExecution || e.execution.task === task) {
                    disposable.dispose();
                    resolve(e.exitCode);
                }
            });
        });
    }
}


function checkToolsVersion(): string {
    try {
        const versionGet = path.join(substituteVariables("${env:ONETHINX_PACK_LOC}"), 'bin', `OTX-Maestro-version ${thisVersion}`);
        const stdout = execSync(versionGet);
        return stdout.toString().trim();
    } catch (error) {
            return "1.0.0";
    }
}

function selectProg(programmer: string, checkOnly: boolean = false): {useDefault: boolean, currentProgrammer: string} {
    // Substitute environment variables and get the base path
    const basePath = substituteVariables('${env:ONETHINX_PACK_LOC}');
    const sourceFile = path.join(basePath, 'config', 'scripts', 'brd.cfg');

    // Get the workspace base path
    const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
    const boardSettingsFile = path.join(workspaceFolder, '.vscode', 'brd.cfg');

    // Check if the file exists, if not, copy from the source
    if (!fs.existsSync(boardSettingsFile)) {
        try {
            fs.copyFileSync(sourceFile, boardSettingsFile);
        } catch (err) {
            vscode.window.showErrorMessage(`File copy error: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return {useDefault: false, currentProgrammer: ''};
        }
    }

    // Read the board settings file content
    const boardSettingsContent = fs.readFileSync(boardSettingsFile, 'utf-8');
    const lines = boardSettingsContent.split(/\r?\n/);

    // Match the PROGRAMMER and USE_DEFAULT settings
    const prgMatch = lines[0].match(/PROGRAMMER\s+([^\s;]+)/);
    const useDefaultMatch = lines[0].match(/USE_DEFAULT\s+([^\s;]+)/);

    // Determine the current programmer and default usage
    const currentProgrammer = prgMatch ? prgMatch[1] : '';
    let currentUseDefault = useDefaultMatch ? useDefaultMatch[1] === 'true' : true;

    if (checkOnly) {
        return {useDefault: currentUseDefault, currentProgrammer: currentProgrammer};
    }

    // Determine if the new programmer is 'default'
    currentUseDefault = programmer === 'default';
    if (currentUseDefault) {
        programmer = getSetting('defaultDebugger');
        if (programmer === '') {
            vscode.window.showErrorMessage(
                'No default programmer set! Please set the correct programmer in settings.json\nExample: "otx-maestro.defaultDebugger": "cmsis-dap"',
                { modal: true }
            );
            return {useDefault: true, currentProgrammer: ''};
        }
    }

    // Prepare the new line and update settings
    const newLine = `set PROGRAMMER ${programmer}; set USE_DEFAULT ${currentUseDefault}`;
    if (!lines[0].includes('PROGRAMMER')) {
        lines.unshift(newLine);
    } else {
        lines[0] = newLine;
    }

    const contents = lines.join('\n');
    if (contents === boardSettingsContent) {return {useDefault: currentUseDefault, currentProgrammer: programmer};}

    writeFile(boardSettingsFile, contents);

    return {useDefault: currentUseDefault, currentProgrammer: programmer};
}

async function writeFile(fileName: string, contents: string): Promise<void> {
    try {
            await fsp.writeFile(fileName, contents, { encoding: 'utf-8' });
        } catch (err) {
            console.error('Error writing file:', err);
            throw err;
    }
}

function readDirectory(basePath: string, refArray: string[], dir: string, extension: string, foldersOnly: boolean): string[] {
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
            readDirectory(basePath, refArray, current, extension, foldersOnly);
        }
    });
    return refArray;
}

const diagnosticCollection = vscode.languages.createDiagnosticCollection('meson');

function parseMesonLog(): { status: string, message: string, errorCount: number} {
    const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!basePath) { return { status: 'error', message: 'No workspace opened!', errorCount: 0 }; }
    const logFilePath = path.join(basePath, 'build', 'meson-logs', 'meson-log.txt');
    if (!fs.existsSync(logFilePath)) {
        vscode.window.showErrorMessage("Meson log file not found.");
        return { status: 'error', message: 'Meson log file not found.', errorCount: 0 };
    }

    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    const lines = logContent.split(/\r?\n/);
    const diagnosticsMap: { [key: string]: vscode.Diagnostic[] } = {};
    let errorCount = 0;

    lines.forEach(line => {
        const wrnMatch = line.match(/^(.*?):(\d+):(\d+)?:?\s+WARNING:\s+(.+)$/);
        const errMatch = line.match(/^(.*?):(\d+):(\d+)?:?\s+ERROR:\s+(.+)$/);
        const match = errMatch? errMatch : wrnMatch;
        if (match) {
            const filePath = match[1].includes('meson.build') ? 'meson.build' : match[1];
            let lineNumber = parseInt(match[2]) - 1; // Convert to zero-based index
            let columnNumber = parseInt(match[3]) - 1; // Convert to zero-based index
            const errorMessage = match[4];
            if (lineNumber < 0 ) { lineNumber = 0; }
            if (columnNumber < 0 ) { columnNumber = 0; }
            const range = new vscode.Range(new vscode.Position(lineNumber, columnNumber), new vscode.Position(lineNumber, columnNumber + 1));
            const diagnostic = new vscode.Diagnostic(range, errorMessage, errMatch? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);

            const absoluteFilePath = path.join(basePath, filePath);
            if (!diagnosticsMap[absoluteFilePath]) {
                diagnosticsMap[absoluteFilePath] = [];
            }
            diagnosticsMap[absoluteFilePath].push(diagnostic);
            if (errMatch) { errorCount++; }
        }
    });
    Object.keys(diagnosticsMap).forEach(fileUri => {
        diagnosticCollection.set(vscode.Uri.file(fileUri), diagnosticsMap[fileUri]);
    });
    return { status: 'ok', message: 'OK', errorCount: errorCount };
}