"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const https = __importStar(require("https"));
const child_process_1 = require("child_process");
const utils_1 = require("./utils");
// The minimum project version
let thisVersion = '1.0.0';
let minToolsVersion = '1.0.2';
const defaultSettings = {
    defaultDebugger: '',
    someOtherSetting: '',
};
const config = vscode.workspace.getConfiguration('otx-maestro');
function getSetting(setting) {
    const config = vscode.workspace.getConfiguration('otx-maestro');
    return (config.get(setting) || defaultSettings[setting]) ?? '';
}
function activate(context) {
    thisVersion = context.extension.packageJSON.version;
    // Define the commands array with button texts
    const commands = [
        { command: 'otx-maestro.preLaunch', callback: preLaunch, buttonText: "" },
        { command: 'otx-maestro.updateProject', callback: updateProject, buttonText: "$(notebook-render-output) Update Project" },
        { command: 'otx-maestro.selectProgrammer', callback: selectProgrammer, buttonText: "$(wrench) Select Programmer" },
        { command: 'otx-maestro.clean', callback: clean, buttonText: "$(references) Clean-Reconfigure" },
        { command: 'otx-maestro.build', callback: build, buttonText: "$(file-binary) Build" },
        { command: 'otx-maestro.launch', callback: launch, buttonText: "$(rocket) Build-and-Launch" }
    ];
    // Register the commands and create status bar items if buttonText is provided
    for (const { command, callback, buttonText } of commands) {
        const disposable = vscode.commands.registerCommand(command, callback);
        context.subscriptions.push(disposable);
        if (buttonText) {
            const button = vscode.window.createStatusBarItem();
            button.text = buttonText;
            button.command = command;
            button.show();
            context.subscriptions.push(button);
        }
    }
    const maestroToolsVersion = checkToolsVersion();
    const compare = versionCompare(minToolsVersion, maestroToolsVersion);
    if (compare === 'h') {
        vscode.window.showErrorMessage(`Please update OTX Maestro Tools\nneeded: ${minToolsVersion}\n got: ${maestroToolsVersion}`, { modal: true });
        return;
    }
    vscode.window.showInformationMessage(`OTX-Maestro Tools Version: ${maestroToolsVersion}`);
}
function deactivate() { }
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function getDate() {
    const dateTime = new Date();
    const year = dateTime.getFullYear();
    const month = ("0" + (dateTime.getMonth() + 1)).slice(-2);
    const day = ("0" + dateTime.getDate()).slice(-2);
    const hour = ("0" + dateTime.getHours()).slice(-2);
    const minute = ("0" + dateTime.getMinutes()).slice(-2);
    const seconds = ("0" + dateTime.getSeconds()).slice(-2);
    return `${year}-${month}-${day}_${hour}-${minute}-${seconds}`;
}
function getFileFromUrl(url, destPath, firstLineOnly = false) {
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
                        resolve(''); // Resolve with an empty string when saving to disk
                    });
                }).on('error', err => {
                    fs.unlink(destPath, () => { }); // Delete the file on error
                    reject(err); // Reject the promise with the error
                });
            }
            else {
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
                    resolve(data); // Resolve with the file content as a string
                });
                response.on('error', err => {
                    reject(err); // Reject the promise with the error
                });
            }
        }).on('error', err => {
            reject(err); // Reject the promise with the error
        });
    });
}
async function updateFile(folder, file) {
    const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!basePath) {
        throw new Error("Workspace folder is not defined.");
    }
    ;
    const vsCodePath = path.join(basePath, folder, file);
    const folderWithSlash = folder ? folder + '/' : '';
    //await downloadFile(`https://raw.githubusercontent.com/onethinx/Maestro-lib/main/${folderWithSlash}${file}`, vsCodePath);
    await getFileFromUrl(`https://raw.githubusercontent.com/onethinx/Maestro-lib/main/${folderWithSlash}${file}`, vsCodePath).catch(err => console.error('Error downloading file:', err));
}
async function removeFile(folder, file) {
    try {
        const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!basePath) {
            throw new Error("Workspace folder is not defined.");
        }
        ;
        const vsCodePath = path.join(basePath, folder, file);
        await fs.unlink(vsCodePath, () => { });
        //console.log(`Successfully deleted ${vsCodePath}`);
    }
    catch (error) {
        console.error(`Error deleting file ${folder}/${file}:`, error);
    }
}
function getProject() {
    const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!basePath) {
        throw new Error("Workspace folder is not defined.");
    }
    ;
    const packageJsonPath = path.join(basePath, '.vscode', 'project.json');
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
    return JSON.parse(packageJsonContent);
}
async function updateProject() {
    //let onlinePrjVersion = '1.0.0';
    //let currentPrjVersion = '1.0.0';
    let updateLocation = 'https://raw.githubusercontent.com/onethinx/Maestro-lib/main/.vscode/update.json';
    let currentProject = { version: '1.0.0', updatePackage: updateLocation };
    let onlineProject = currentProject;
    let updatePackage;
    try {
        const onlinePrjFile = await getFileFromUrl("https://raw.githubusercontent.com/onethinx/Maestro-lib/main/.vscode/project.json", '', false);
        onlineProject = JSON.parse(onlinePrjFile);
        currentProject = getProject();
        if (!currentProject.version || !onlineProject.version) {
            throw new Error();
        }
        ;
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error fetching version: ${error.message || 'unknown error'}`);
        return;
    }
    if (versionCompare(onlineProject.version, currentProject.version) !== 'h') {
        await vscode.window.showInformationMessage('No newer project version found online.', { modal: true });
        return;
    }
    const result = await vscode.window.showInformationMessage(`Project update from ${currentProject.version} to ${onlineProject.version}.\n\n\
        This might need an OTX-Meastro update and will update the meson build files and the configuration files in .vscode.\n\n\
        Backup your project if unsure.\n\nContinue?`, { modal: true }, 'Yes', 'No');
    if (result !== 'Yes') {
        return;
    }
    try {
        const updatePackageFile = await getFileFromUrl(currentProject.updatePackage, '');
        updatePackage = JSON.parse(updatePackageFile);
    }
    catch {
        const result = await vscode.window.showInformationMessage(`Invalid updatePackage file.\nCheck link in .vscode/project.json\
            \n\nContinue with default?`, { modal: true }, 'Yes', 'No');
        if (result !== 'Yes') {
            return;
        }
        try {
            try {
                const updatePackageFile = await getFileFromUrl(updateLocation, '');
                updatePackage = JSON.parse(updatePackageFile);
            }
            catch {
                const updatePackageFile = await getFileFromUrl(onlineProject.updatePackage, '');
                updatePackage = JSON.parse(updatePackageFile);
            }
        }
        catch {
            vscode.window.showErrorMessage(`Invalid update link. Cannot update.`, { modal: true });
        }
    }
    for (const file of updatePackage.updateFiles) {
        let dir = path.dirname(file);
        dir = dir === '.' ? '' : dir[0] === '.' ? dir.substring(2) : dir;
        const filename = path.basename(file);
        console.log(`update: ${dir} ${filename}`);
        await updateFile(dir, filename);
    }
    for (const file of updatePackage.removeFiles) {
        let dir = path.dirname(file);
        dir = dir === '.' ? '' : dir[0] === '.' ? dir.substring(2) : dir;
        const filename = path.basename(file);
        console.log(`remove: ${dir} ${filename}`);
        await removeFile(dir, filename);
    }
    // await updateFile("", 'meson.build');
    // await updateFile("", 'cross_gcc.build');
    // await updateFile(".vscode", 'launch.json');
    // await updateFile(".vscode", 'settings.json');
    // await updateFile(".vscode", 'tasks.json');
    // await updateFile(".vscode", 'c_cpp_properties.json');
    // await updateFile(".vscode", 'meson.js');
    vscode.window.showInformationMessage(`Project updated to Version: ${onlineProject.version}`);
}
function versionCompare(versionIn, versionMinimum) {
    const vIn = String(versionIn).split('.').map(Number).reduce((acc, val) => acc * 1000 + val, 0);
    const vRef = String(versionMinimum).split('.').map(Number).reduce((acc, val) => acc * 1000 + val, 0);
    return vIn < vRef ? 'l' : vIn > vRef ? 'h' : 'e';
}
async function clean() {
    diagnosticCollection.clear();
    const setupResult = checkSetup();
    if (setupResult.status === 'error') {
        vscode.window.showErrorMessage(`The Clean task terminated with exit status: ${setupResult.status}\r\n${setupResult.message}\r\nPlease Clean-Reconfigure.`, { modal: true });
        return;
    }
    const buildFolder = path.join(setupResult.basePath, "build");
    if (setupResult.status === 'missing') {
        await fs.promises.mkdir(buildFolder);
    }
    else {
        const elfFiles = fs.readdirSync(buildFolder).filter(file => file.endsWith('.elf'));
        const copy = elfFiles.length > 0;
        const backupFolder = path.join(buildFolder, "backup");
        const nowFolder = path.join(backupFolder, getDate());
        if (!fs.existsSync(backupFolder)) {
            await fs.promises.mkdir(backupFolder);
        }
        for (const file of fs.readdirSync(buildFolder)) {
            const current = path.join(buildFolder, file);
            if (copy && fs.statSync(current).isFile()) {
                if (current.endsWith(".elf") || current.endsWith(".hex") || current.endsWith(".txt") || current.endsWith(".json")) {
                    if (!fs.existsSync(nowFolder)) {
                        await fs.promises.mkdir(nowFolder);
                    }
                    const destFile = path.join(nowFolder, file);
                    await fs.promises.copyFile(current, destFile);
                }
            }
            if (file !== 'backup') {
                fs.rmSync(current, { recursive: true, force: true });
            }
        }
        ;
    }
    let ret = await executeTask("Creator: postbuild");
    if (ret === undefined) {
        return;
    }
    if (ret !== 0) {
        vscode.window.showErrorMessage("The Creator Postbuild task terminated with exit code:" + JSON.stringify(ret));
        return;
    }
    const crossBuildFile = path.join(setupResult.basePath, "cross_gcc.build");
    await updateMeson(crossBuildFile, [], []);
    const mesonBuildFile = path.join(setupResult.basePath, "meson.build");
    await updateMeson(mesonBuildFile, [], []);
    ret = await executeTask("Meson: configure");
    if (ret === undefined) {
        return;
    }
    const mesonResult = await parseMesonLog();
    if (ret !== 0) {
        vscode.window.showErrorMessage(`The Configure task terminated with exit code: ${JSON.stringify(ret)}`);
        if (mesonResult.errorCount > 0) {
            vscode.commands.executeCommand('workbench.action.problems.focus');
        }
    }
    const selProgResult = selectProg("", true);
    if (selProgResult === "" || selProgResult === "default") { // Current programmer is default or not set?
        var currentProgrammer = getSetting('defaultDebugger');
        if (currentProgrammer === "") { // Default programmer isn't set > show picker
            await selectProgrammer();
        }
        else { // Default set, select programmer
            //console.log(`default: ${currentProgrammer}`);
            selectProg("default");
        }
    }
    return '';
}
async function build() {
    diagnosticCollection.clear();
    const setupResult = checkSetup();
    if (setupResult.status !== 'ok') {
        vscode.window.showErrorMessage(`The Build task terminated with exit status: ${setupResult.status}\r\n${setupResult.message}\r\nPlease Clean-Reconfigure.`, { modal: true });
        return;
    }
    const sourcePath = path.join(setupResult.basePath, "source");
    const mesonBuildFile = path.join(setupResult.basePath, "meson.build");
    if (!fs.existsSync(mesonBuildFile)) {
        vscode.window.showErrorMessage("meson.build file not found!");
        return;
    }
    const headerContents = readDirectory(setupResult.basePath, [], sourcePath, '.h', true);
    const sourceContents = readDirectory(setupResult.basePath, [], sourcePath, '.c', false);
    console.log(headerContents);
    updateMeson(mesonBuildFile, headerContents, sourceContents);
    const ret = await executeTask("Meson: build");
    if (ret === undefined) {
        return;
    }
    const mesonResult = await parseMesonLog();
    if (ret !== 0) {
        vscode.window.showErrorMessage(`The Build task terminated with exit code: ${JSON.stringify(ret)}`);
        // if (mesonResult.errorCount > 0) {
        vscode.commands.executeCommand('workbench.action.problems.focus');
        //  }
        return;
    }
    return '';
}
async function launch() {
    // var ret = await vscode.commands.executeCommand('workbench.action.debug.run');
    // var ret = await vscode.commands.executeCommand('workbench.action.debug.selectandstart');
    //vscode.commands.executeCommand('workbench.action.terminal.focus');
    var ret = await vscode.commands.executeCommand('workbench.action.debug.start');
    //var ret = await build();
    console.log(`launch ${ret}`);
    return ret;
}
;
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
    var currentProgrammer = getSetting('defaultDebugger');
    if (currentProgrammer === '') {
        currentProgrammer = selectProg("", true);
    }
    if (currentProgrammer === '') {
        return;
    }
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
    quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
            // Handle the selected value here
            //console.log("Selected programmer:", selected.label);
            const programmer = programmers.find(prog => prog.l === selected.label);
            if (programmer) {
                vscode.window.showInformationMessage(`You selected: ${selected.label}`);
                selectProg(programmer.s);
            }
            quickPick.dispose();
        }
    });
}
function checkSetup() {
    const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!basePath) {
        return { status: 'error', message: 'No workspace opened!', basePath: '' };
    }
    const buildDir = path.join(basePath, "build");
    if (!fs.existsSync(buildDir)) {
        return { 'status': 'missing', 'message': "Missing Build Folder", 'basePath': basePath };
    }
    if (!fs.existsSync(path.join(buildDir, "meson-private"))) {
        return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath };
    }
    if (!fs.existsSync(path.join(buildDir, "meson-info"))) {
        return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath };
    }
    if (!fs.existsSync(path.join(buildDir, "meson-logs"))) {
        return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath };
    }
    if (!fs.existsSync(path.join(buildDir, "build.ninja"))) {
        return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath };
    }
    if (!fs.existsSync(path.join(buildDir, "compile_commands.json"))) {
        return { 'status': 'unconfigured', 'message': "Unconfigured Build Folder", 'basePath': basePath };
    }
    return { 'status': 'ok', 'message': "OK", 'basePath': basePath };
}
function updateMeson(mesonFile, headerContents, sourceContents) {
    const mesonContents = fs.readFileSync(mesonFile, 'utf-8');
    let arr = [];
    let logOut = true;
    let linesStripped = 0;
    mesonContents.split(/\r?\n/).forEach((line) => {
        if (line.includes("OTX_Extension_HeaderFiles_End") || line.includes("OTX_Extension_SourceFiles_End")) {
            logOut = true;
        }
        if (logOut) {
            arr.push(line);
        }
        if (linesStripped > 0 && --linesStripped === 0) {
            logOut = true;
        }
        if (line.includes("OTX_Extension_HeaderFiles_Start")) {
            arr = arr.concat(headerContents);
            logOut = false;
        }
        else if (line.includes("OTX_Extension_SourceFiles_Start")) {
            arr = arr.concat(sourceContents);
            logOut = false;
        }
        else if (line.includes("OTX_Extension_print")) {
            const regexp = /\(\s*(.*[^ ])[ )]+$/;
            const array = line.match(regexp);
            if (array !== null) {
                arr = arr.concat((0, utils_1.substituteVariables)(array[1]));
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
    if (contents === mesonContents) {
        return;
    }
    writeFile(mesonFile, contents);
}
async function executeTask(taskName) {
    const tasks = await vscode.tasks.fetchTasks();
    let task = undefined;
    for (const t of tasks) {
        if (t.name === taskName) {
            task = t;
            break;
        }
    }
    if (!task) {
        vscode.window.showErrorMessage(`Cannot find ${taskName} task.`);
        return;
    }
    const taskExecution = await vscode.tasks.executeTask(task);
    return new Promise((resolve) => {
        const disposable = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === taskExecution || e.execution.task === task) {
                disposable.dispose();
                resolve(e.exitCode);
            }
        });
    });
}
function checkToolsVersion() {
    try {
        const versionGet = path.join((0, utils_1.substituteVariables)("${env:ONETHINX_PACK_LOC}"), 'bin', `OTX-Maestro-version ${thisVersion}`);
        const stdout = (0, child_process_1.execSync)(versionGet);
        return stdout.toString().trim();
    }
    catch (error) {
        //console.error("Error:", error);
        return "1.0.0";
    }
}
function selectProg(programmer, checkOnly = false) {
    // Substitute environment variables and get the base path
    const basePath = (0, utils_1.substituteVariables)('${env:ONETHINX_PACK_LOC}');
    const sourceFile = path.join(basePath, 'config', 'scripts', 'brd.cfg');
    // Get the workspace base path
    const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
    const boardSettingsFile = path.join(workspaceFolder, '.vscode', 'brd.cfg');
    // Check if the file exists, if not, copy from the source
    if (!fs.existsSync(boardSettingsFile)) {
        try {
            fs.copyFileSync(sourceFile, boardSettingsFile);
        }
        catch (err) {
            vscode.window.showErrorMessage(`File copy error: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return '';
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
        return currentProgrammer === '' ? '' : (currentUseDefault ? 'default' : currentProgrammer);
    }
    // Determine if the new programmer is 'default'
    currentUseDefault = programmer === 'default';
    if (currentUseDefault) {
        programmer = getSetting('defaultDebugger');
        if (programmer === '') {
            vscode.window.showErrorMessage('No default programmer set! Please set the correct programmer in settings.json\nExample: "otx-maestro.defaultDebugger": "cmsis-dap"', { modal: true });
            return '';
        }
    }
    // Prepare the new line and update settings
    const newLine = `set PROGRAMMER ${programmer}; set USE_DEFAULT ${currentUseDefault}`;
    if (!lines[0].includes('PROGRAMMER')) {
        lines.unshift(newLine);
    }
    else {
        lines[0] = newLine;
    }
    const contents = lines.join('\n');
    if (contents === boardSettingsContent) {
        return '';
    }
    writeFile(boardSettingsFile, contents);
    return currentProgrammer;
}
async function writeFile(fileName, contents) {
    try {
        await fs_1.promises.writeFile(fileName, contents, { encoding: 'utf-8' });
    }
    catch (err) {
        console.error('Error writing file:', err);
        throw err;
    }
}
function readDirectory(basePath, refArray, dir, extension, foldersOnly) {
    let pushed = false;
    fs.readdirSync(dir).forEach(file => {
        const current = path.join(dir, file);
        if (fs.statSync(current).isFile()) {
            if (current.endsWith(extension)) {
                const fle = path.relative(basePath, dir).replace(/\\/g, '/');
                if (foldersOnly) {
                    if (!pushed) {
                        refArray.push(`\t'${fle}',`);
                    }
                    pushed = true;
                }
                else {
                    const fleFile = path.relative(basePath, current).replace(/\\/g, '/');
                    refArray.push(`\t'${fleFile}',`);
                }
            }
        }
        else {
            readDirectory(basePath, refArray, current, extension, foldersOnly);
        }
    });
    return refArray;
}
const diagnosticCollection = vscode.languages.createDiagnosticCollection('meson');
function parseMesonLog() {
    const basePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!basePath) {
        return { status: 'error', message: 'No workspace opened!', errorCount: 0 };
    }
    const logFilePath = path.join(basePath, 'build', 'meson-logs', 'meson-log.txt');
    if (!fs.existsSync(logFilePath)) {
        vscode.window.showErrorMessage("Meson log file not found.");
        return { status: 'error', message: 'Meson log file not found.', errorCount: 0 };
    }
    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    const lines = logContent.split(/\r?\n/);
    const diagnosticsMap = {};
    let errorCount = 0;
    lines.forEach(line => {
        const wrnMatch = line.match(/^(.*?):(\d+):(\d+)?:?\s+WARNING:\s+(.+)$/);
        const errMatch = line.match(/^(.*?):(\d+):(\d+)?:?\s+ERROR:\s+(.+)$/);
        const match = errMatch ? errMatch : wrnMatch;
        if (match) {
            const filePath = match[1].includes('meson.build') ? 'meson.build' : match[1];
            let lineNumber = parseInt(match[2]) - 1; // Convert to zero-based index
            let columnNumber = parseInt(match[3]) - 1; // Convert to zero-based index
            const errorMessage = match[4];
            if (lineNumber < 0) {
                lineNumber = 0;
            }
            if (columnNumber < 0) {
                columnNumber = 0;
            }
            const range = new vscode.Range(new vscode.Position(lineNumber, columnNumber), new vscode.Position(lineNumber, columnNumber + 1));
            const diagnostic = new vscode.Diagnostic(range, errorMessage, errMatch ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
            const absoluteFilePath = path.join(basePath, filePath);
            if (!diagnosticsMap[absoluteFilePath]) {
                diagnosticsMap[absoluteFilePath] = [];
            }
            diagnosticsMap[absoluteFilePath].push(diagnostic);
            if (errMatch) {
                errorCount++;
            }
        }
    });
    Object.keys(diagnosticsMap).forEach(fileUri => {
        diagnosticCollection.set(vscode.Uri.file(fileUri), diagnosticsMap[fileUri]);
    });
    return { status: 'ok', message: 'OK', errorCount: errorCount };
}
//# sourceMappingURL=extension.js.map