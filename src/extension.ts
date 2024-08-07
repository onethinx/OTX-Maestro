

import * as vscode from 'vscode';
////import * as fs from 'fs';
//import { promises as fsp } from 'fs';
import * as path from 'path';
//import * as https from 'https';
import { execSync } from 'child_process';
import * as util from './utils';
import * as io from './fileio';

// The minimum project version
let thisVersion = '1.0.0';
const minToolsVersion = '1.0.4';
let maestroToolsVersion = '1.0.0';
const updateLocation = 'https://raw.githubusercontent.com/onethinx/Maestro-lib/main/.vscode/update.json';

let currentProject: { version: string, updatePackage: string, excludeFiles: [string] | undefined } = { version: '1.0.0', updatePackage: updateLocation, excludeFiles: undefined };

let notJlink = true;
let creatorProjectChanged = false;
let projectFileChanged = true;

const defaultSettings: { [key: string]: string | boolean } = {
    defaultDebugger: '',
    alwaysActivate: false
};

function getSetting(setting: string): string | boolean {
    const config = vscode.workspace.getConfiguration('otx-maestro');
    const value = config.get<string | boolean>(setting);
    return value !== undefined ? value : defaultSettings[setting];
}

function evaluateTemplate(val: string): string {
    try {
        return val.replace(/\$\{(\w+)\}/g, (_, variable: string) => {
            const evaluated = eval(variable);
            return String(evaluated);
        });
    } catch (error) {
        return JSON.stringify(val);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const currentProject = await getCurrentProject();
    if (!getSetting('alwaysActivate') && currentProject.version === '1.0.0') { return; }      // Do not activate extension if project is not loaded

    thisVersion = context.extension.packageJSON.version;
    try {
        notJlink = (await selectProg('', true)).currentProgrammer !== 'jlink';
    }
    catch {}

    // Define the commands array 
    const commands = [
        { command: 'otx-maestro.showInfo',          callback: showInfo },
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

    // Read task and add to taskbar if necessary 
    const tasksConfig = vscode.workspace.getConfiguration('tasks');
    if (tasksConfig.tasks && Array.isArray(tasksConfig.tasks)) {
        for (const task of tasksConfig.tasks) {
            //console.log('Task:', task); // Print each task to verify its structure
            const taskOptions = task.options || {};
            const itemHide = evaluateTemplate(taskOptions.statusbar?.hide);
            const itemAlignment = taskOptions.statusbar?.alignment === 'right'? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;

            if (itemHide === undefined || itemHide === 'false') {
                const statusBarItem = vscode.window.createStatusBarItem(itemAlignment, taskOptions.statusbar?.priority);
                statusBarItem.text =  (taskOptions.statusbar?.label ?? '' !== '')? taskOptions.statusbar.label : task.label;
                
                // Register a new command for the statusbar click
                const statusBarCommand: vscode.Command = {
                    command : `otx-maestro.statusBarCommand.${task.label.replace(/\s+/g, '-')}`,
                    title: task.label
                };
                //console.log('statusBarCommand:', statusBarCommand); 

                // Extract the command name and check for a matching command in the commands array
                const commandName = task.command.replace('${command:', '').replace('}', '');
                const commandEntry = commands.find(cmd => cmd.command === commandName);
                if (commandEntry) {
                    vscode.commands.registerCommand(statusBarCommand.command, () => {
                        commandEntry.callback();
                    });
                } else {
                    const executeTask = await getTask([task.label]);
                    if (executeTask !== undefined)
                    {
                        vscode.commands.registerCommand(statusBarCommand.command, async () => {
                            console.log('Executing task:', task.label);
                            await vscode.tasks.executeTask(executeTask);
                        });
                    }
                }
                statusBarItem.command = statusBarCommand;

                if (taskOptions.statusbar?.color ?? '' !== '') { statusBarItem.color = taskOptions.statusbar.color; }
                if (taskOptions.statusbar?.detail ?? '' !== '') { 
                    const evaluatedText = evaluateTemplate(taskOptions.statusbar.detail);
                    statusBarItem.tooltip = new vscode.MarkdownString(evaluatedText);
                }
                statusBarItem.show();
                context.subscriptions.push(statusBarItem);
            }
        }
    }
    activateWatcher(context);
    // Refresh tasks if the tasks configuration has changed
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('tasks')) {
            
            const confirm = await vscode.window.showInformationMessage(
                'Tasks configuration changed. Do you want to reload the window to apply changes?', { modal: true }, 'Yes', 'No'
            );
            if (confirm === 'Yes') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
    }));
    updateProject(true);
}

function activateWatcher(context: vscode.ExtensionContext) {
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

    fileWatcher.onDidChange((uri) => {
        projectFileChanged = true;
    });

    fileWatcher.onDidCreate((uri) => {
        if(uri.fsPath.includes('.cydsn')) { creatorProjectChanged = true; }
        projectFileChanged = true;
    });

    fileWatcher.onDidDelete((uri) => {
        if(uri.fsPath.includes('.cydsn')) { creatorProjectChanged = true; }
        projectFileChanged = true;
    });

    vscode.workspace.onDidChangeTextDocument(event => {
        projectFileChanged = true;
    });

    context.subscriptions.push(fileWatcher);
}

export function deactivate() {}

// ----- showInfo function ------------------------------------------------------------------------------------------------------------------------------------

async function showInfo() {
    let message = `--== OTX Maestro v${thisVersion} ==--\n\n`;
    message += maestroToolsVersion !== '1.0.0'? `OTX Maestro Tools v${maestroToolsVersion}` : 'OTX Maestro Tools not installed!';
    message += currentProject.version !== '1.0.0'? `\nOTX Maestro Project v${currentProject.version}`: '\nProject not loaded';

    const deprecatedExtensions = [
        //'ms-vscode.cpptools',
        'rolfnoot.cortex-meson-builder',
        'onethinx.cortex-meson-builder',
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
}

// ----- prelaunch function ------------------------------------------------------------------------------------------------------------------------------------

async function preLaunch() {
    let ret:string | null = '';
    if (projectFileChanged) {
        ret = await build();
        console.log(`prelaunch result" ${ret}`);
    }
    if (ret === '') {
        (async () => {
            for (let cnt = 0; cnt < 10; cnt++) {
                    await util.sleep(300);
                    await vscode.commands.executeCommand('workbench.debug.action.focusRepl');
            }
        })();
    }
    return ret;
}

// ----- update project function ------------------------------------------------------------------------------------------------------------------------------------

async function updateProject(startup = false) {
    let currentProject = await getCurrentProject();
    if (startup && currentProject.version === '1.0.0') { return; }    // Do not check / update if project is not loaded or too old at startup

    maestroToolsVersion = checkToolsVersion();
    const compare = versionCompare(minToolsVersion, maestroToolsVersion);
    if (compare === 'h') {
        vscode.window.showErrorMessage(`Please update OTX Maestro Tools${startup? '': ' first'}.\nNeeded: v${minToolsVersion} (got v${maestroToolsVersion})\nVisit https://github.com/onethinx/OTX-Maestro/releases`, { modal: !startup });
        return;
    }

    let onlineProject = currentProject;
    let updatePackage;
    let updateUrl = updateLocation;

    try {
        onlineProject = await io.getFile(["https://raw.githubusercontent.com/onethinx/Maestro-lib/main/.vscode/project.json"], io.returnedContent.parsedJson);
        //onlineProject = JSON.parse(onlinePrjFile);
        if (!currentProject.version || !onlineProject.version) { throw new Error(); };
    } catch (error) {
        vscode.window.showErrorMessage(`Error fetching version: ${(error as Error).message || 'unknown error'}`);
        return;
    }

    if (versionCompare(onlineProject.version, currentProject.version) !== 'h') {
        if (!startup)
        {
            await vscode.window.showInformationMessage('No newer project version found online.', { modal: true });
        }
        return;
    }

    const result = await vscode.window.showInformationMessage(
        `Project update from ${currentProject.version} to ${onlineProject.version}.\n\n\
        This will update the meson build files and the configuration files in .vscode.\n\n\
        Backup your project if unsure.\n\nContinue?`, 
        { modal: true }, 
        'Yes', 'No'
    );
    if (result !== 'Yes') {return;}

    try {
        updateUrl = currentProject.updatePackage;
        updatePackage = await io.getFile([updateUrl], io.returnedContent.parsedJson);
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
                updateUrl = updateLocation;
                updatePackage = await io.getFile([updateUrl], io.returnedContent.parsedJson);
                //updatePackage = JSON.parse(updatePackageFile);
            }
            catch 
            {
                updateUrl = onlineProject.updatePackage;
                updatePackage = await io.getFile([updateUrl], io.returnedContent.parsedJson);
                //const updatePackageFile = await getFileFromUrl(onlineProject.updatePackage, '');
                //updatePackage = JSON.parse(updatePackageFile);
            }
        }
        catch
        {
            vscode.window.showErrorMessage(`Invalid update link. Cannot update.`, { modal: true });
        }
    }

    const secondLastSlashIndex = updateUrl.lastIndexOf('/', updateUrl.lastIndexOf('/') - 1);
    const baseUrl = updateUrl.substring(0, secondLastSlashIndex + 1);
    //const paths = currentProject.excludeFiles || [''];
    const excludeFiles: string[] = (currentProject.excludeFiles || ['']).map(path => 
        path.split(/[\/\\]/).filter((segment: string) => segment && segment !== '.').join('/') // Split by both forward slashes and backslashes Remove empty segments and single dots
    );

    let updateProjectJson = false;

    try
    {
        io.removeFile(['workspace', 'build', 'build.ninja']);   // remove build file to have users reconficure the workspace after a project update
        for (const file of updatePackage.updateFiles) {
            const currentFilePath = file.split(/[\/\\]/).filter((segment: string) => segment && segment !== '.');
            const currentFile = currentFilePath.join('/');
            if (excludeFiles.includes(currentFile)) { continue; }

            console.log(`update: ${currentFile}`);
            if (currentFile === '.vscode/project.json') {
                updateProjectJson = true;
                continue;
            }
            await io.copyFile([baseUrl].concat(currentFilePath), ['workspace'].concat(currentFilePath));
        }
        for (const file of updatePackage.removeFiles) {
            const currentFilePath = file.split(/[\/\\]/).filter((segment: string) => segment && segment !== '.');
            const currentFile = currentFilePath.join('/');
            if (excludeFiles.includes(currentFile)) { continue; }

            console.log(`remove: ${currentFile}`);
            await io.removeFile(['workspace'].concat(currentFilePath));
        }
        if (!io.existsFile(['workspace', '.vscode', 'project.json'])) {
            await io.copyFile([baseUrl, '.vscode', 'project.json'], ['workspace', '.vscode', 'project.json']);
        }
        else if (updateProjectJson) {
            updateVersionInFile(['workspace', '.vscode', 'project.json'], onlineProject.version);
        }
    }
    catch (err) {
        vscode.window.showErrorMessage(`Error updating project: ${err}`);
        return;
    }
    vscode.window.showInformationMessage(`Project updated to Version: ${onlineProject.version}`);
}

// ----- clean function ------------------------------------------------------------------------------------------------------------------------------------

async function clean(): Promise<string | null>  {
	diagnosticCollection.clear();
    const setupResult = await checkMesonSetup();
    if (setupResult.status === 'error') {
        const msg = `The Clean task terminated with exit status: ${setupResult.status}\r\n${setupResult.message}\r\nPlease Clean-Reconfigure.`;
        return taskStatus(msg, taskResult.errorConfirm);
    }
    
    const buildFolder = ['workspace', 'build'];
    if (setupResult.status === 'missing') {await io.mkDir(buildFolder);}
    else {
        const elfFiles = io.readDir(buildFolder).filter(file => file.endsWith('.elf'));
        const copy = elfFiles.length > 0;
        const backupFolder = buildFolder.concat(['backup']);
        const nowFolder = backupFolder.concat([util.getDate()]);
        if (!io.existsFile(backupFolder)) {await io.mkDir(backupFolder);}
        for (const file of io.readDir(buildFolder))
        {
            const current = buildFolder.concat([file]);
            if (copy && io.statSync(current).isFile()) {
                if (file.endsWith(".elf") || file.endsWith(".hex") || file.endsWith(".txt") || file.endsWith(".json")) {
                    if (!io.existsFile(nowFolder)) {await io.mkDir(nowFolder);}
                    //const destFile = path.join(nowFolder, file);
                    await io.copyFile(current, nowFolder.concat([file])); 
                }
            } 
            if (file !== 'backup') {
                io.rmSync(current);
            }
        };
    }

    let ret = await executeTask(['Creator: postbuild']);
    //if (ret === undefined) { return taskStatus('Clean', false); }
    if (ret !== 0) {
        const msg = `The Creator Postbuild task terminated with exit code: ${JSON.stringify(ret)}`;
        return taskStatus(msg, taskResult.errorInform);
    }
    
    //const crossBuildFile = path.join(setupResult.basePath, "cross_gcc.build");
    await updateBuildFile(['workspace', 'cross_gcc.build'], [], [], mapMeson);
    //const mesonBuildFile = path.join(setupResult.basePath, "meson.build");
    await updateBuildFile(['workspace', 'meson.build'], [], [], mapMeson);

    ret = await executeTask(['OTX: configure', 'Meson: configure']);
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
    const selProgResult = await selectProg("", true);
    if (selProgResult.useDefault === true || selProgResult.currentProgrammer === "") {	// Current programmer is default or not set?
        var currentProgrammer = getSetting('defaultDebugger');
        //console.log(`default: ${currentProgrammer}`);
        if (currentProgrammer === "")
        { // Default programmer isn't set > show picker
            await selectProgrammer();
        }
        else
        {	// Default set, select programmer
            await selectProg("default");
        }
    }
    creatorProjectChanged = false;
    return taskStatus('', taskResult.ok);
}

// ----- build function ------------------------------------------------------------------------------------------------------------------------------------

async function build(): Promise<string | null>  {
    if (creatorProjectChanged) {
        const msg = `The PSoC Creator project has been changed.\r\nPlease Clean-Reconfigure.`;
        return taskStatus(msg, taskResult.errorConfirm);
    }
    diagnosticCollection.clear();
    const setupResult = await checkMesonSetup();
    if (setupResult.status !== 'ok') {
        const msg = `The Clean task terminated with exit status: ${setupResult.status}\r\n${setupResult.message}\r\nPlease Clean-Reconfigure.`;
        return taskStatus(msg, taskResult.errorConfirm);
    }

    //const sourcePath = path.join(setupResult.basePath, "source");
    //const mesonBuildFile = path.join(setupResult.basePath, "meson.build");
    let mesonBuildFile;
    let cmakeBuildFile;
    let maestroHeaderFile;
    if (io.existsFile(['workspace', 'meson.build'])) { mesonBuildFile = ['workspace', 'meson.build']; }
    if (io.existsFile(['workspace', 'CMakeLists.txt'])) { cmakeBuildFile = ['workspace', 'CMakeLists.txt']; }
    if (io.existsFile(['workspace', 'source', 'maestro.h'])) { maestroHeaderFile = ['workspace', 'source', 'maestro.h']; }

    if (mesonBuildFile === undefined && mesonBuildFile === undefined) {
        const msg = `Build file not found!`;
        return taskStatus(msg, taskResult.errorInform);
    }

    let headerContents, sourceContents;
    try {
        headerContents = io.readDirectory(['workspace'], [], ['workspace', 'source'], '.h', true);
        sourceContents = io.readDirectory(['workspace'], [], ['workspace', 'source'], '.c', false);
    }
    catch (err) {
        return taskStatus(`Reading source folders error: ${err}`, taskResult.errorInform);
    }
    //console.log(headerContents);

    if (maestroHeaderFile !== undefined) {
        await updateMaestro(maestroHeaderFile);
    }

    if (mesonBuildFile !== undefined) {
        await updateBuildFile(mesonBuildFile, headerContents, sourceContents, mapMeson);
    }

    if (cmakeBuildFile !== undefined) {
        await updateBuildFile(mesonBuildFile, headerContents, sourceContents, mapCMake);
    }

    //const ret = await executeTask("Meson: build");
    const ret = await executeTask(['OTX: build', 'Meson: build']);
    creatorProjectChanged = false;
    if (ret === null) { return taskStatus("Error task OTX build", taskResult.errorInform); }
    const mesonResult = await parseMesonLog();
    if (ret !== 0) 
    {
        vscode.commands.executeCommand('workbench.action.problems.focus');
        const msg = `The Build task terminated with exit code: ${JSON.stringify(ret)}`;
        return taskStatus(msg, taskResult.errorInform);
    }
    projectFileChanged = false;
    return taskStatus('', taskResult.ok);
}

// ----- launch function ------------------------------------------------------------------------------------------------------------------------------------

async function launch(): Promise<string | null>  {
    // var ret = await vscode.commands.executeCommand('workbench.action.debug.run');
    // var ret = await vscode.commands.executeCommand('workbench.action.debug.selectandstart');
    //vscode.commands.executeCommand('workbench.action.terminal.focus');
    var ret = await vscode.commands.executeCommand('workbench.action.debug.start');
    console.log(`launch ${ret}`);
    return taskStatus('', taskResult.ok);
};

// ----- select programmer function ------------------------------------------------------------------------------------------------------------------------------------

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
    if (currentProgrammer === '') { ( {useDefault, currentProgrammer} = await selectProg("", true)); }

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
                const currentProg = (await selectProg(programmer.s)).currentProgrammer;
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

// ----- meson config functions ------------------------------------------------------------------------------------------------------------------------------------

const diagnosticCollection = vscode.languages.createDiagnosticCollection('meson');

async function checkMesonSetup(): Promise<{status: string, message: string}>  {
    //const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
   // if (!basePath) { return { status: 'error', message: 'No workspace opened!', basePath: '' }; }
    if (!io.existsFile(['workspace', 'build'])) { return { 'status': 'missing', 'message': "Missing Build Folder" }; }
    if (!io.existsFile(['workspace', 'build', 'meson-private'])) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder" }; }
    if (!io.existsFile(['workspace', 'build', 'meson-info'])) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder" }; }
    if (!io.existsFile(['workspace', 'build', 'meson-logs'])) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder" }; }
    if (!io.existsFile(['workspace', 'build', 'build.ninja'])) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder" }; }
    if (!io.existsFile(['workspace', 'build', 'compile_commands.json'])) { return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder" }; }
    try{
        const mesonInfo = await io.getFile(['workspace', 'build', 'meson-info', 'meson-info.json'], io.returnedContent.parsedJson);
        const source = mesonInfo.directories.source;
        let resPath1 = '1'; 
        let resPath2 = '2';
        try {
            resPath1 = io.realpathSyncNative([mesonInfo.directories.source]);
            resPath2 = io.realpathSyncNative(['workspace']);
        } catch  { }
        //console.log(`source ${resPath1} <=> basePath ${resPath2}`);
        if (resPath1 !== resPath2) { return { 'status': 'mismatch', 'message': "Path mismatch, probably some folders changed" }; }
    }
    catch{};
    return { 'status': 'ok', 'message': "OK" };
}

const mapMeson = (line: string) => `\t'${line}',`;
const mapCMake = (line: string) => `\t${line}`;

async function updateBuildFile(buildFile: string[], headerContents: string[], sourceContents: string[], lineMapping: (line: string) => string) {
    //const mesonContents = fs.readFileSync(buildFile, 'utf-8');
    const mesonContents = await io.getFile(buildFile, io.returnedContent.stringArray);
    let arr: string[] = [];
    let logOut = true;
    let linesStripped = 0;

    mesonContents.forEach((line: string) => {
        if (line.includes("OTX_Extension_HeaderFiles_End") || line.includes("OTX_Extension_SourceFiles_End")) { logOut = true; }
        if (logOut) { arr.push(line); }
        if (linesStripped > 0 && --linesStripped === 0) { logOut = true; }
        if (line.includes("OTX_Extension_HeaderFiles_Start")) {
            const match = /\(folder:(.*?)\)/.exec(line);
            if (match) {
                const filteredContents = headerContents.filter(header => header.startsWith(match[1]));
                arr = arr.concat(filteredContents.map(lineMapping));
            }
            else {
                arr = arr.concat(headerContents.map(lineMapping));
            }
            logOut = false;
        } else if (line.includes("OTX_Extension_SourceFiles_Start")) {
            const match = /\(folder:(.*?)\)/.exec(line);
            if (match) {
                const filteredContents = sourceContents.filter(source => source.startsWith(match[1]));
                arr = arr.concat(filteredContents.map(lineMapping));
            }
            else {
                arr = arr.concat(sourceContents.map(lineMapping));
            }
            logOut = false;
        } else if (line.includes("OTX_Extension_print")) {
            const regexp = /\(\s*(.*[^ ])[ )]+$/;
            const array = line.match(regexp);
            if (array !== null)
                { arr = arr.concat(util.substituteVariables(array[1])); }
            else
                { arr = arr.concat('Not found!'); }
            logOut = false;
            linesStripped = 1;
        }
    });

    const contents = arr.join('\n');
    // console.log(contents);
    if (contents === mesonContents) {return;}
    io.writeFile(buildFile, contents);
}

async function parseMesonLog(): Promise<{ status: string, message: string, errorCount: number}>{
    //const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    //if (!basePath) { return { status: 'error', message: 'No workspace opened!', errorCount: 0 }; }
    const logFilePath = ['workspace', 'build', 'meson-logs', 'meson-log.txt'];
    if (!io.existsFile(logFilePath)) {
        vscode.window.showErrorMessage("Meson log file not found.");
        return { status: 'error', message: 'Meson log file not found.', errorCount: 0 };
    }

    const lines = await io.getFile(logFilePath, io.returnedContent.stringArray);
    //const lines = logContent.split(/\r?\n/);
    const diagnosticsMap: { [key: string]: vscode.Diagnostic[] } = {};
    let errorCount = 0;

    for (const line of lines) {
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

            const absoluteFilePath = io.getPath(['workspace', filePath]);
            if (!diagnosticsMap[absoluteFilePath]) {
                diagnosticsMap[absoluteFilePath] = [];
            }
            diagnosticsMap[absoluteFilePath].push(diagnostic);
            if (errMatch) { errorCount++; }
        }
    }
    Object.keys(diagnosticsMap).forEach(fileUri => {
        diagnosticCollection.set(vscode.Uri.file(fileUri), diagnosticsMap[fileUri]);
    });
    return { status: 'ok', message: 'OK', errorCount: errorCount };
}

// ----- parse Maestro header file ------------------------------------------------------------------------------------------------------------------------------------

async function updateMaestro(maestroFile: string[]) {
    const maestroContents = await io.getFile(maestroFile, io.returnedContent.stringArray);
    let arr: string[] = [];
    let logOut = true;
    let linesStripped = 0;

    maestroContents.forEach((line: string, index: number) => {
        if (logOut) { arr.push(line); }
        if (linesStripped > 0 && --linesStripped === 0) { logOut = true; }
        if (line.includes("OTX_Extension_print") || line.includes("OTX_Extension_eval")) {
            const regexp = /\(\s*(.*[^ ])[ )]+$/;
            const array = line.match(regexp);
            if (array !== null) {
                try {
                    if (array[1].includes('${nextLineValue}')) {
                        // Ensure the next line exists
                        const nextLine = maestroContents[index + 1];
                        if (nextLine) {
                            // Extract the first occurrence of one or more whitespaces followed by a number
                            const numberMatch = nextLine.match(/\s+(\d+)/);
                            if (numberMatch) {
                                array[1] = array[1].replace('${nextLineValue}', numberMatch[1]) ;//= numberMatch[1]; // Extract the number
                            } 
                        } 
                    }
                    let val = util.substituteVariables(array[1]);
                    if (line.includes("OTX_Extension_eval")) { val = eval(val); }
                    arr = arr.concat(val);
                }
                catch (err) {
                    arr = arr.concat(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
            }
            else { 
                arr = arr.concat('Not found!');
            }
            logOut = false;
            linesStripped = 1;
        }
    });

    const contents = arr.join('\n');
    // console.log(contents);
    if (contents === maestroContents) {return;}
    io.writeFile(maestroFile, contents);
}
// ----- task helper functions ------------------------------------------------------------------------------------------------------------------------------------

async function getTask2(taskName: string): Promise<vscode.Task | undefined> {   
    const tasks = await vscode.tasks.fetchTasks();
    for (const task of tasks) {
        if (task.name === taskName) {
            return task;
        }
    }
    vscode.window.showErrorMessage(`Cannot find ${taskName} task.`);
}

async function getTask(taskNames: string[]): Promise<vscode.Task | undefined> {
    const tasks = await vscode.tasks.fetchTasks();
    for (const taskName of taskNames) {
        const task = tasks.find(t => t.name === taskName);
        if (task) { return task; }
    }
    vscode.window.showErrorMessage(`Cannot find any of the specified tasks: ${taskNames.join(', ')}`);
    return undefined;
}

async function executeTask(taskNames: string[]): Promise<number | undefined> {   
    const task = await getTask(taskNames);
    if (task === undefined) { return; }
    console.log(`--- execute task: ${task.name}`);
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

// ----- versioniong helper functions ------------------------------------------------------------------------------------------------------------------------------------

function versionCompare(versionIn: string, versionMinimum: string): 'l' | 'h' | 'e' {
    const vIn = String(versionIn).split('.').map(Number).reduce((acc, val) => acc * 1000 + val, 0);
    const vRef = String(versionMinimum).split('.').map(Number).reduce((acc, val) => acc * 1000 + val, 0);
    return vIn < vRef ? 'l' : vIn > vRef ? 'h' : 'e';
}

function checkToolsVersion(): string {
    try {
        const versionGet = path.join(util.substituteVariables("${env:ONETHINX_PACK_LOC}"), 'bin', `OTX-Maestro-version ${thisVersion}`);
        const stdout = execSync(versionGet);
        return stdout.toString().trim();
    } catch (error) {
            return "1.0.0";
    }
}

async function getCurrentProject()
{
    try {
        currentProject = await io.getFile(['workspace', '.vscode', 'project.json'], io.returnedContent.parsedJson);
    } catch (err) {
        console.log(`Error in file .vscode/project.json, loading defaults.\nError: ${err}`);
    }
    if (currentProject.version === '1.0.0') {
        try {
            let firstMesonLine = null;
            try {
                firstMesonLine = await io.getFile(['workspace', '.vscode', 'meson.js'], io.returnedContent.firstLine);
            }
            catch {
                try {
                    firstMesonLine = await io.getFile(['workspace', '.vscode', 'otxC.js'], io.returnedContent.firstLine);
                }
                catch {}
            }
            if (firstMesonLine !== null) { 
                currentProject.version = '1.0.1';
                currentProject.version = firstMesonLine.match(/"([^"]+)"/)[1]; // Find the first match of the text inside double quotes in the string
            }
        }
        catch{}
    }
    return currentProject;
}

async function updateVersionInFile(file: string[], newVersion: string) {
    const fileContent = await io.getFile(file, io.returnedContent.stringArray);
    let newContent = [];
    for (let line of fileContent) {
        if (line.trim().startsWith('"version"')) {
            line = `    "version": \"${newVersion}\",`;
        }
        newContent.push(line);
    }
    io.writeFile(file, newContent.join('\n'));
}

// ----- programmer selection functions ------------------------------------------------------------------------------------------------------------------------------------

async function selectProg(programmer: string, checkOnly: boolean = false): Promise<{useDefault: boolean, currentProgrammer: string}> {
    // Substitute environment variables and get the base path
    const packFolder = util.substituteVariables('${env:ONETHINX_PACK_LOC}');
    

    // Get the workspace base path
    //const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
    const boardSettingsFile = ['workspace', '.vscode', 'brd.cfg'];

    // Check if the file exists, if not, copy from the source
    if (!io.existsFile(boardSettingsFile)) {
        vscode.window.showErrorMessage(`.vscode/brd.cfg is missing.\nPlease update project.`, { modal: true });
        // try {
        //     const sourceFile = [packFolder, 'config', 'scripts', 'brd.cfg'];
        //     await io.copyFile(sourceFile, boardSettingsFile);
        // } catch (err) {
        //     vscode.window.showErrorMessage(`File copy error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        //     return {useDefault: false, currentProgrammer: ''};
        // }
    }

    // Read the board settings file content
    //const boardSettingsContent = fs.readFileSync(boardSettingsFile, 'utf-8');
    const boardSettingsContent = await io.getFile(boardSettingsFile, io.returnedContent.fullString);
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
        programmer = getSetting('defaultDebugger') as string;
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

    io.writeFile(boardSettingsFile, contents);

    return {useDefault: currentUseDefault, currentProgrammer: programmer};
}

