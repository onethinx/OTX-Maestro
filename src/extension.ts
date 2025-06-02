

import * as vscode from 'vscode';
////import * as fs from 'fs';
//import { promises as fsp } from 'fs';
import * as path from 'path';
//import * as https from 'https';
import { execSync } from 'child_process';
import * as util from './utils';
import * as io from './fileio';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as chirpstack from './chirpstack';


// The minimum project version
let thisExtensionVersion = '1.0.0';
const minToolsVersion = '1.0.4';
let maestroToolsVersion = '1.0.0';
const updateLocation = 'https://raw.githubusercontent.com/onethinx/Maestro-lib/main/.vscode/update.json';

let currentProject: { version: string, updatePackage: string, excludeFiles: [string] | undefined } = { version: '1.0.0', updatePackage: updateLocation, excludeFiles: undefined };

let notJlink = true;
let creatorProjectChanged = false;
let projectFileChanged = true;
let psocCreatorFolder = 'PSoC_Creator.cydsn';

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
    const sidebarProvider = new SidebarViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
    );
    sidebarProvider.postMessage({
        command: 'addSidebarControl',
        controlType: 'checkbox',
        commandId: 'otx-maestro.toggleStatusbar',
        label: 'OTX-Maestro extension force on',
        tooltip: 'The OTX-Maestro extension activates when a valid project is loaded. This can be overriden to activate always (useful for configuring your tasks and buttons, default: off)',
        initialValue: vscode.workspace.getConfiguration('otx-maestro').get<boolean>('alwaysActivate', false)
    });

    const currentProject = await getCurrentProject();
    if (!getSetting('alwaysActivate') && currentProject.version === '?') { return; }      // Do not activate extension if project is not loaded

    thisExtensionVersion = context.extension.packageJSON.version;
    
    if (currentProject.version !== '?')
    {
        try {
            notJlink = (await getProgrammer()).target !== 'jlink';
        }
        catch {}
    }

    // Define the commands array 
    const commands = [
        { command: 'otx-maestro.getPSoCCreatorFolder',      callback: getPSoCCreatorFolder },
        { command: 'otx-maestro.showInfo',                  callback: showInfo },
        { command: 'otx-maestro.configureProvisioning',     callback: configureProvisioning },
        { command: 'otx-maestro.doProvisioning',            callback: doProvisioning },
        { command: 'otx-maestro.preLaunch',                 callback: preLaunch },
        { command: 'otx-maestro.updateProject',             callback: updateProject },
        { command: 'otx-maestro.selectProgrammer',          callback: selectProgrammer },
        { command: 'otx-maestro.clean',                     callback: clean },
        { command: 'otx-maestro.build',                     callback: build },
        { command: 'otx-maestro.launch',                    callback: launch},
        { command: 'otx-maestro.check',                     callback: check}
    ];

    // Register the commands
    for (const { command, callback } of commands) {
        const disposable = vscode.commands.registerCommand(command, callback);
        context.subscriptions.push(disposable);
    }

    // Read task and add to side/taskbar if necessary
    let tasksLoaded = false;
    const tasksConfig = vscode.workspace.getConfiguration('tasks');
    if (tasksConfig.tasks && Array.isArray(tasksConfig.tasks)) {
        let taskCounter = 0;
        for (const task of tasksConfig.tasks!) {
            if (task.command === undefined && task.script === undefined) { continue; }

            // 1) The label the user sees everywhere:
            const taskLabel = task.label || 'Unnamed Task';

            // 2) Your purely-internal, guaranteed-unique ID:
            const internalId = `otx-maestro.internalTask.${taskCounter++}`;

            // Register the command under your internal ID
            context.subscriptions.push(
                vscode.commands.registerCommand(internalId, async () => {
                    if (task.command && task.command.includes('${command:')) {
                        const extCmd = task.command.replace(/^\$\{command:(.+)\}$/, '$1');
                        await vscode.commands.executeCommand(extCmd, ...(task.args ?? []));
                    } else {
                        const exitCode = await executeTask([taskLabel]);
                    }
                })
            );

            // Status-bar item uses the user label and the internal ID
            if (task.options?.statusbar && evaluateTemplate(task.options.statusbar.hide) !== 'true') {
                tasksLoaded = true;
                const statusBarItem = vscode.window.createStatusBarItem(task.options.statusbar.alignment === 'right'
                    ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left,
                    task.options.statusbar.priority
                );
                statusBarItem.text    = task.options.statusbar.label || taskLabel;
                statusBarItem.tooltip = task.options.statusbar.detail
                    ? new vscode.MarkdownString(evaluateTemplate(task.options.statusbar.detail))
                    : undefined;
                statusBarItem.command = internalId;
                statusBarItem.show();
                context.subscriptions.push(statusBarItem);
            }

            // Sidebar button also uses the same two
            if (task.options?.sidebar && evaluateTemplate(task.options.sidebar.hide) !== 'true') {
                tasksLoaded = true;
                sidebarProvider.postMessage({
                    command:     'addSidebarControl',
                    controlType: 'button',
                    label:       task.options.sidebar.label || taskLabel,
                    commandId:   internalId,
                    color:       task.options.sidebar.color,
                    tooltip:     task.options.sidebar.detail ? evaluateTemplate(task.options.sidebar.detail) : '',
                    spacer:      task.options.sidebar.spacer === true
                });
            }
        }

    }
    activateWatcher(context);
    activateDebugWatcher();
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
    if (!tasksLoaded) { 
        sidebarProvider.postMessage({
            command: 'addSidebarControl',
            controlType: 'button', 
            label: 'No tasks loaded!',
            commandId: 'otx-maestro.showNoTasksInfo', 
            color: 'darkred',
            tooltip: "No valid project is loaded or no tasks are defined in the workspace ('.vscode/tasks.json').",
            spacer: true
        });
    }
   // else {
        if (currentProject.version !== '?') updateProject(true);
   // }
}

function activateDebugWatcher()
{
    vscode.debug.registerDebugConfigurationProvider('cortex-gdb', {
        async resolveDebugConfiguration(folder, config, token) {
            if (config.preLaunchTask !== '${command:otx-maestro.preLaunch}') return config;
            
            if (await getSetProgrammer() == false) return undefined;
        
            const buildSuccess = await preLaunch() == '';
            return buildSuccess? config : undefined;
                vscode.window.showWarningMessage('The build failed. Stopping debug launch.');
                return undefined;	// aborts debugging silently
        }
    });
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

export function deactivate() {
    if (trackerDisposable) trackerDisposable.dispose();
}

// ----- SidebarViewProvider class ------------------------------------------------------------------------------------------------------------------------------------

class SidebarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'otx-maestro.sidebar';
    private _view?: vscode.WebviewView;
    private pendingMessages: any[] = [];
    // Persist dynamic control messages
    private dynamicMessages: any[] = [];

    constructor(private readonly extensionUri: vscode.Uri) {}

    public get view(): vscode.WebviewView | undefined {
        return this._view;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Process any pending messages.
        for (const msg of this.pendingMessages) {
            this._view.webview.postMessage(msg);
        }
        this.pendingMessages = [];

        // When the view becomes visible again, clear and re-send dynamic messages.
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                // Clear the container first.
                this._view?.webview.postMessage({ command: 'clearDynamicMessages' });
                for (const msg of this.dynamicMessages) {
                    this._view?.webview.postMessage(msg);
                }
            }
        });

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'sidebarControlButtonClicked':
                    if (message.commandId === 'otx-maestro.showNoTasksInfo') {
                        if (io.existsFile(['workspace', '.vscode', 'tasks.json'])) {
                            vscode.window.showInformationMessage(
                                'Please check to enable the side/statusbar buttons using "options": {"statusbar": {"hide": false}}',
                                { modal: true }
                            );
                        } else {
                            vscode.window.showInformationMessage(
                                "The currently opened folder must directly contain '.vscode/tasks.json'. " +
                                "Please check that you have opened the correct project folder and not a parent or nested directory.",
                                { modal: true }
                            );
                        }
                    } else {
                        vscode.commands.executeCommand(message.commandId)
                            .then(() => console.log(`Executed control button command: ${message.commandId}`));
                    }
                    break;
                case 'sidebarControlCheckboxToggled':
                    if (message.commandId === 'otx-maestro.toggleStatusbar') {
                        vscode.window.showInformationMessage(
                            'Configuration changed. Do you want to reload the window to apply changes?', { modal: true }, 'Yes', 'No'
                        ).then(confirm => {
                            if (confirm === 'Yes') {
                                const config = vscode.workspace.getConfiguration('otx-maestro');
                                config.update('alwaysActivate', message.value, vscode.ConfigurationTarget.Global).then(() => {
                                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                                });
                            }
                        });
                    }
                    break;
            }
        });
    }

    public postMessage(message: any) {
        // If this is a dynamic control message, store it.
        if (message.command === 'addSidebarControl') {
            this.dynamicMessages.push(message);
        }
        if (this._view) {
            this._view.webview.postMessage(message);
        } else {
            this.pendingMessages.push(message);
        }
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = this.getNonce();
        return /* html */`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!-- Updated CSP with nonce for styles and scripts -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'nonce-${nonce}' ${webview.cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>OTX Maestro Sidebar</title>
                <style nonce="${nonce}">
                    body {
                        padding: 20px;
                    }
                    /* Container for dynamic controls */
                    #dynamicButtons {
                        margin-top: 20px;
                        width: 100%;
                    }
                    button {
                        width: 100%;
                        background-color: #777;
                        border-radius: 4px;
                        color: lightgrey;
                        border: none;
                        padding: 5px;
                        cursor: pointer;
                        margin-bottom: 12px;
                    }
                    /* Style for a checkbox control container */
                    .control-checkbox {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        margin-bottom: 12px;
                        width: 100%;
                    }
                    .control-checkbox label {
                        flex-grow: 1;
                    }
                </style>
            </head>
            <body>
                <!-- Dynamic controls will be added here -->
                <div id="dynamicButtons"></div>
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    
                    // Persist checkbox states in webview state.
                    let state = vscode.getState() || { checkboxStates: {} };
                    
                    function updateCheckboxState(commandId, value) {
                        state.checkboxStates[commandId] = value;
                        vscode.setState(state);
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        const container = document.getElementById('dynamicButtons');
                        if (!container) { return; }

                        // Clear container if requested.
                        if (message.command === 'clearDynamicMessages') {
                            container.innerHTML = '';
                            return;
                        }
                        
                        // Insert spacer if requested.
                        if (message.spacer) {
                            const spacerDiv = document.createElement('div');
                            spacerDiv.style.height = '15px';
                            container.appendChild(spacerDiv);
                        }
                        
                        if (message.command === 'addSidebarControl') {
                            if (message.controlType === 'button') {
                                const btn = document.createElement('button');
                                btn.textContent = message.label || '';
                                if (message.color) btn.style.backgroundColor = message.color;
                                if (message.tooltip) btn.title = message.tooltip;
                                btn.addEventListener('click', () => {
                                    vscode.postMessage({
                                        command: 'sidebarControlButtonClicked',
                                        commandId: message.commandId
                                    });
                                });
                                container.appendChild(btn);
                                try {
                                    const btnTxtColor = getComputedStyle(btn).backgroundColor;
                                    const rgb = btnTxtColor.slice(4, -1).trim().split(",");
                                    if ((parseInt(rgb[0], 10) + parseInt(rgb[1], 10) + parseInt(rgb[2], 10)) > 436) {
                                        btn.style.color = "black";
                                    }
                                } catch (e) {}
                            } else if (message.controlType === 'checkbox') {
                                const div = document.createElement('div');
                                div.className = 'control-checkbox';
            
                                const label = document.createElement('label');
                                label.textContent = message.label || '';
                                if (message.tooltip) label.title = message.tooltip;
                                const checkbox = document.createElement('input');
                                checkbox.type = 'checkbox';
                                // Restore checkbox state from webview state if available.
                                checkbox.checked = (state.checkboxStates[message.commandId] !== undefined)
                                    ? state.checkboxStates[message.commandId]
                                    : !!message.initialValue;
                                checkbox.addEventListener('change', () => {
                                    vscode.postMessage({
                                        command: 'sidebarControlCheckboxToggled',
                                        commandId: message.commandId,
                                        value: checkbox.checked
                                    });
                                    updateCheckboxState(message.commandId, checkbox.checked);
                                });
            
                                div.appendChild(label);
                                div.appendChild(checkbox);
                                container.appendChild(div);
                            }
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}

// ----- showInfo function ------------------------------------------------------------------------------------------------------------------------------------

async function showInfo() {
    let message = `--== OTX Maestro v${thisExtensionVersion} ==--\n\n`;
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

// chirpstack

  
// async function gRPC() {
//     try {
//         // 1) Build an array of .proto files you actually need.
//         //    You can load multiple files at once if they import each other.
//         const protoFiles = [
//             path.join(__dirname, '../src/proto', 'chirpstack', 'api', 'application.proto'),
//             path.join(__dirname, '../src/proto', 'chirpstack', 'api', 'device_profile.proto'),
//             path.join(__dirname, '../src/proto', 'chirpstack', 'api', 'device.proto'),
//             path.join(__dirname, '../src/proto', 'chirpstack', 'api', 'tenant.proto'),
//             path.join(__dirname, '../src/proto', 'chirpstack', 'common', 'common.proto'),
//             path.join(__dirname, '../src/proto', 'google', 'api', 'annotations.proto'),
//             path.join(__dirname, '../src/proto', 'google', 'api', 'http.proto')
//         ];

//         // 2) Load them using protoLoader. 
//         //    'includeDirs' helps the loader resolve imports in subfolders (e.g. 'common', 'google').
//         const packageDefinition = protoLoader.loadSync(protoFiles, {
//             keepCase: false,
//             longs: String,
//             enums: String,
//             defaults: true,
//             oneofs: true,
//             includeDirs: [
//                 path.join(__dirname, '../src/proto'), // so imports can be resolved
//             ],
//         });

//         const settings = await getProvisioningSetting();

//         // 3) Convert the loaded package definition to a gRPC object
//         const chirpstackProto = grpc.loadPackageDefinition(packageDefinition) as any;
        
//         // 4) Access the specific service(s) you need
//         //    If your .proto says `package chirpstack.api;`, you'll have something like:
//         //    chirpstackProto.chirpstack.api.DeviceService
//         const deviceService = chirpstackProto.api.DeviceService;

//         // 5) Create a client instance
//         const client = new deviceService(settings.url, grpc.credentials.createInsecure());

//         const metadata = new grpc.Metadata();
//         metadata.add('authorization', `Bearer ${settings.encryptedApiKey}`);

//         // Build your request object
//         const request = {
//             device:
//             {
//                 devEui: "0000000000000001",
//                 name: "example-device",
//                 description: "Registered via gRPC in C#",
//                 applicationId: settings.applicationId,
//                 deviceProfileId: settings.deviceProfileId,
//                 joinEui: "0102CAFE0102CAFE"
//             }
//         };

//         // Make the call, passing the metadata as the second parameter
//         client.Create(request, metadata, (error: any, response: any) => {
//             if (error) {
//                 vscode.window.showErrorMessage(`Error: ${error.message}`);
//             } else {
//                 vscode.window.showInformationMessage(`Success: ${JSON.stringify(response)}`);
//             }
//         });

//     } catch (err: any) {
//         vscode.window.showErrorMessage(`Failed: ${err.message || err}`);
//     }
// }

// ----- configureProvisioning function ------------------------------------------------------------------------------------------------------------------------------------

// Assume getChirpStackConfig() loads the current settings from provisioning.json, if available.
async function configureProvisioning() {
    let settings: chirpstack.ChirpStackConfig | undefined;
    try {
        // Check if the Chirpstack configuration is available.
        settings = await getChirpStackConfig();
        chirpstack.init(settings);
    }
    catch (error: any) {}

    try {
        // First, ask the user which protocol to use.
        const protocolChoice = await vscode.window.showQuickPick(settings?.protocol == 'rest'? ["REST", "gRPC"] : ["gRPC", "REST"], {
            placeHolder: "Select ChirpStack communication protocol"
        });
        if (!protocolChoice) {
            vscode.window.showWarningMessage("No protocol selected.");
            return;
        }
        // Save protocol in lower case for our unified API (should be 'rest' or 'grpc').
        const newProtocol = protocolChoice.toLowerCase() as "rest" | "grpc";
        chirpstack.updateSetting('protocol', newProtocol);

        // Prompt for Chirpstack URL with prefill.
        const url = await vscode.window.showInputBox({
            placeHolder: `Enter the Chirpstack URL:PORT (e.g., ${newProtocol == 'rest'? "http://your-chirpstack-server.com:8090)" : "your-chirpstack-server.com:8080"})`,
            prompt: 'Chirpstack URL:PORT',
            value: settings?.url
        });
        if (!url) {
            vscode.window.showWarningMessage("No URL provided.");
            return;
        }
        chirpstack.updateSetting('url', url);

        // Prompt for API key (password mode) with prefill if available.
        const apiKey = await vscode.window.showInputBox({
            placeHolder: 'Enter your API key',
            prompt: 'API Key',
            password: true,
            value: settings?.encryptedApiKey || ''
        });
        if (!apiKey) {
            vscode.window.showWarningMessage("No API key provided.");
            return;
        }
        chirpstack.updateSetting('encryptedApiKey', apiKey);

        // Fetch tenants using the unified API function.
        const tenantData = await chirpstack.getTenants();
        if (!tenantData || !Array.isArray(tenantData.result) || tenantData.result.length === 0) {
            vscode.window.showErrorMessage("Unexpected tenant response: no tenants found or unexpected format.", { modal: true });
            return;
        }
        const selectedTenant = await selectItem(
            tenantData.result,
            settings?.tenantId,
            "Select a tenant"
        );
        if (selectedTenant === null) return;
        chirpstack.updateSetting('tenantId', selectedTenant.id);

        // Load applications for the selected tenant using the unified API.
        const appsData = await chirpstack.getApplications(selectedTenant.id);
        if (!appsData || !Array.isArray(appsData.result) || appsData.result.length === 0) {
            vscode.window.showErrorMessage("Unexpected applications response: no applications found or unexpected format.", { modal: true });
            return;
        }
        const selectedApplication = await selectItem(
            appsData.result,
            settings?.applicationId,
            "Select an application"
        );
        if (selectedApplication === null) return;
        chirpstack.updateSetting('applicationId', selectedApplication.id);

        // Load device profiles for the selected tenant using the unified API.
        const dpData = await chirpstack.getDeviceProfiles(selectedTenant.id);
        if (!dpData || !Array.isArray(dpData.result) || dpData.result.length === 0) {
            vscode.window.showErrorMessage("Unexpected device profiles response: no device profiles found or unexpected format.", { modal: true });
            return;
        }
        const selectedDP = await selectItem(
            dpData.result,
            settings?.deviceProfileId,
            "Select a device profile"
        );
        if (selectedDP === null) return;
        chirpstack.updateSetting('deviceProfileId', selectedDP.id);

    } catch (error: any) {
        vscode.window.showErrorMessage(`Error fetching tenants: ${error}`, { modal: true });
    } finally {
        if (chirpstack.settingsChanged) {
            chirpstack.config.encryptedApiKey = encryptApiKey(chirpstack.config.encryptedApiKey ?? '', vscode.env.machineId);
            const provisioning = {
                client: 'chirpstack',
                chirpStackConfig: chirpstack.config
            };
            await io.writeFile(['workspace', '.vscode', 'provisioning.json'], JSON.stringify(provisioning, null, 2));
        }
        vscode.window.showInformationMessage('Provisioning configuration saved.');
    }
}


async function getChirpStackConfig(): Promise<chirpstack.ChirpStackConfig> {  
    let settings = {
        client: 'chirpstack',
        chirpStackConfig: { ...chirpstack.defaultChirpStackConfig }
    };
    try {
        const loadSettings = await io.getFile(['workspace', '.vscode', 'provisioning.json'], io.returnedContent.parsedJson);
        if (loadSettings) {
            settings = loadSettings;
            if (settings.chirpStackConfig.encryptedApiKey) {
                try {
                    settings.chirpStackConfig.encryptedApiKey = decryptApiKey(settings.chirpStackConfig.encryptedApiKey, vscode.env.machineId);
                } catch (e) {
                    settings.chirpStackConfig.encryptedApiKey = '';
                }
            }
            if (settings.chirpStackConfig.protocol)
                settings.chirpStackConfig.protocol = settings.chirpStackConfig.protocol.toLowerCase() as "rest" | "grpc";
        }
    } catch (error) {}
    return settings.chirpStackConfig;
}

import * as crypto from 'crypto';

/**
 * Encrypts the API key using AES-256-CBC.
 * Returns a string in the format: iv:encryptedData (both base64).
 */
function encryptApiKey(apiKey: string, machineId: string): string {
    const key = crypto.createHash('sha256').update(machineId).digest(); // 32-byte key
    const iv = crypto.randomBytes(16); // 16-byte IV
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(apiKey, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return iv.toString('base64') + ':' + encrypted;
}

/**
 * Decrypts the API key previously encrypted with encryptApiKey.
 */
function decryptApiKey(encrypted: string, machineId: string): string {
    const key = crypto.createHash('sha256').update(machineId).digest();
    const [ivString, encryptedData] = encrypted.split(':');
    const iv = Buffer.from(ivString, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

async function selectItem<T extends { name: string; id: string }>(
    items: T[],
    savedId?: string,
    placeholder: string = "Select an item"
): Promise<T | null> {
    if (items.length === 0) {
        vscode.window.showInformationMessage("No items found.");
        return null;
    }

    // Determine the default item: either the saved one (if available) or the first item.
    let defaultItem = items[0];
    if (savedId) {
        const savedItem = items.find(item => item.id === savedId);
        if (savedItem) {
            defaultItem = savedItem;
        }
    }

    const quickPick = vscode.window.createQuickPick();
    // Create the quick pick items from the original items array.
    const quickPickItems = items.map(item => ({ label: item.name }));
    quickPick.items = quickPickItems;
    quickPick.placeholder = placeholder;
    // Set activeItems to the exact object from quickPickItems that matches defaultItem.
    const defaultItemObj = quickPickItems.find(item => item.label === defaultItem.name);
    if (defaultItemObj) {
        quickPick.activeItems = [defaultItemObj];
    }

    const selectedItem = await new Promise<T>(resolve => {
        quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            quickPick.hide();
            // Find the corresponding object from the original array.
            resolve(items.find(item => item.name === selected.label) || defaultItem);
        });
        // If the quick pick is dismissed without a selection, use the default.
        quickPick.onDidHide(() => resolve(defaultItem));
        quickPick.show();
    });

    vscode.window.showInformationMessage(`Selected: ${selectedItem.name}`);
    return selectedItem;
}

// ----- doProvisioning function ------------------------------------------------------------------------------------------------------------------------------------

/**
 * Command: Configure Provisioning.
 * 1. Loads existing settings from .vscode/provisioning.json if available.
 * 2. Prompts for the Chirpstack URL and API key (pre-filling the URL and, if possible, the decrypted API key).
 * 3. Fetches tenants from Chirpstack and shows a QuickPick.
 * 4. Encrypts and saves the settings back to .vscode/provisioning.json.
 */
async function doProvisioning() {
    const editor = vscode.window.activeTextEditor;

    const doc = editor?.document;
    // Get the full text of the active document.
    const text = doc?.getText() || '';
    
    // Define the markers and keys.
    const startMarker = "OTX_Extension_Provisioning_Start";
    const endMarker = "OTX_Extension_Provisioning_End";
    
    // Find the indices of the markers.
    const startIndex = text.indexOf(startMarker);
    const endIndex = text.indexOf(endMarker);
    
    if (editor == null || doc == null || startIndex < 0 || (endIndex - startIndex) <= 1)
    {
        vscode.window.showErrorMessage(
            "Provisioning block not found!\r\n" +
            "Make sure to open the file where the LoRaWAN keys are defined " +
            "and that your code contain the following markers:\r\n\r\n" +
            "OTX_Extension_Provisioning_Start\r\n\r\nOTX_Extension_Provisioning_End", { modal: true });
        return;
    }

    // Extract the block of text between the markers.
    // Adding the length of the start marker ensures we start right after it.
    const blockText = text.substring(startIndex + startMarker.length, endIndex);
    
    
    // Calculate positions right after the start marker and before the end marker.
    const startPos = doc.positionAt(startIndex + startMarker.length);
    const endPos = doc.lineAt(doc.positionAt(endIndex)).range.start;


    let ProvisioningKeys = parseProvisioningBlock(blockText);
    if (ProvisioningKeys.KeyType === "")
    {
        ProvisioningKeys.KeyType                    = "OTAA_10x_key";
        ProvisioningKeys.PublicNetwork              = true;
        ProvisioningKeys.DevEui                     = [ 0, 0, 0, 0, 0, 0, 0, 0 ];
        ProvisioningKeys.AppEui                     = [ 0xC0, 0xFF, 0xEE, 0x00, 0xDE, 0xCA, 0xFB, 0xAD];
    }

    if (ProvisioningKeys.KeyType =="ABP_10x_key")
    {
        vscode.window.showErrorMessage("Currently ABP Provisioning isn't supported. Contact Onethinx to request.", { modal: true });
        return;
    }
    else
    {
        ProvisioningKeys.AppKey = Array.from(crypto.randomBytes(16));
    }

    const insertText = serializeProvisioningKeys(ProvisioningKeys);

    if ( (ProvisioningKeys.DevEui[0] | ProvisioningKeys.DevEui[1] | ProvisioningKeys.DevEui[2] | ProvisioningKeys.DevEui[3] | ProvisioningKeys.DevEui[4] | ProvisioningKeys.DevEui[5] | ProvisioningKeys.DevEui[6] | ProvisioningKeys.DevEui[7]) == 0 )
    {
        // Read DevEUI for provisioning from the device if configured as thisDevEUI
        registerTracker("Check");
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const succeeded = await vscode.debug.startDebugging(workspaceFolder, "Check");
        if (!succeeded)
        {
            vscode.window.showErrorMessage("Unable to read DevEUI from the device. Make sure the device is connected to the debugger.", { modal: true });
            return;
        }
    }
    else
    {
        thisDevEUI = ProvisioningKeys.DevEui.map(n => n.toString(16).padStart(2, '0')).join('');
    }

    const rightPart = thisDevEUI.slice(-4).toUpperCase();
    const provResult = await chirpStackProvision(`OTX-Maestro ${rightPart}`, "Key Provisioned by OTX-Maestro", ProvisioningKeys.AppEui, ProvisioningKeys.AppKey);
    if (provResult.includes("Error")) {
        vscode.window.showErrorMessage(provResult, { modal: true });
        return;
    }
    if (provResult.includes("Warning")) {
        vscode.window.showErrorMessage(provResult);
        return;
    }
    
    editor.edit(editBuilder => {
        // Replace the text between the markers with the new string.
        editBuilder.replace(new vscode.Range(startPos, endPos), '\n' + insertText + '\n');
    }).then(success => {
        if (success) {
            vscode.window.showInformationMessage("Keys provisioned successfully!");
        } else {
            vscode.window.showErrorMessage("Failed to insert text.", { modal: true });
        }
    });
}

async function chirpStackProvision(provName: string, provDescription: string, joinEui: number[], appKey: number[]): Promise<string>  {
    let settings: chirpstack.ChirpStackConfig | undefined;
    try {
        // Check if the Chirpstack configuration is available.
        settings = await getChirpStackConfig();
        chirpstack.init(settings);
    }
    catch (error: any) {}
    if (
        !settings ||
        typeof settings.url !== "string" || settings.url.trim().length < 4 ||
        typeof settings.protocol !== "string" ||
        (settings.protocol.toLowerCase() !== "rest" && settings.protocol.toLowerCase() !== "grpc") ||
        typeof settings.tenantId !== "string" || settings.tenantId.trim().length < 30 ||
        typeof settings.applicationId !== "string" || settings.applicationId.trim().length < 30 ||
        typeof settings.deviceProfileId !== "string" || settings.deviceProfileId.trim().length < 30 ||
        typeof settings.encryptedApiKey !== "string" || settings.encryptedApiKey.trim().length < 28
    ) {
        return "Error: Chirpstack configuration invalid or not available!\r\nPlease configure the provisioning settings.";
    }
      
    
    // Check if DevEUI is already activated
    try {
        const result = await chirpstack.getDevice(thisDevEUI);
        const confirm = await vscode.window.showInformationMessage(
            'The DevEUI is already activated. Do you want to overwrite the existing device?', { modal: true }, 'Yes', 'No'
        );
        if (confirm !== 'Yes') {
            return "Warning: DevEUI already activated, provisioning aborted";
        }
        try {
            const result = await chirpstack.deleteDevice(thisDevEUI);
            console.log("Device deleted successfully.");
    
        } catch (error: any) {
            vscode.window.showInformationMessage("Device NOT deleted successfully.");
        }
    } catch (error: any) {}

    // Build the device creation request.
    const device = {
        applicationId: settings.applicationId,
        devEui: thisDevEUI,
        deviceProfileId: settings.deviceProfileId,
        skipFCntCheck: false,
        joinEui: joinEui.map(n => n.toString(16).padStart(2, '0')).join(''),
        name: provName,
        description: provDescription
    };

    const nwkKey = appKey.map(n => n.toString(16).padStart(2, '0')).join('');
    let apiResult = "";

    try {
        const result = await chirpstack.createDevice(device);
        apiResult += `Successfully created device: ${result}\r\n`;
    } catch (error: any) {
        apiResult += `Error creating device: ${error.message}\r\n`;
    }

    try {
        const result = await chirpstack.setDeviceKeys(thisDevEUI, nwkKey);
        apiResult += `Successfully set nwkKey: ${result}\r\n`;
    } catch (error: any) {
        apiResult += `Error set nwkKey: ${error.message}\r\n`;
    }

    if (apiResult.includes("Error")) {
        if (apiResult.includes("401")) apiResult += "API Key seems to be incorrect!";
        if (apiResult.includes("500")) apiResult += "DevEUI seems to be already activated!";
    }
    return apiResult;
}

// Define an interface for the keys.
interface ProvisioningKeys {
    KeyType: string;         // enum string
    PublicNetwork: boolean;  // bool
    DevEui: number[];        // byte[]
    AppEui: number[];        // byte[]
    JoinEui: number[];       // byte[]
    AppKey: number[];        // byte[]
    NwkKey: number[];        // byte[]
    DevAddr: number;         // uint32
    NwkSkey: number[];       // byte[]
    AppSkey: number[];       // byte[]
}
  
function cleanValue(value: string): string {
    // Remove leading and trailing curly braces and extra whitespace.
    return value.replace(/^[\{\}\s]+|[\{\}\s]+$/g, '');
}
  
/**
 * Helper: Parse a comma‐separated list of numbers into an array.
 * It handles hex (e.g. "0x1A") or decimal.
 */
function parseByteArray(value: string): number[] {
    return value.split(",")
        .map(part => part.trim())
        .filter(part => part.length > 0)
        .map(part => {
            if (part.toLowerCase().startsWith("0x")) {
                return parseInt(part, 16);
            }
            return parseInt(part, 10);
        });
}
  
/**
 * Parses a provisioning block (multiple lines) and returns an object
 * with the expected keys.
 *
 * Note that if a key is missing its value defaults to an empty array (or 0 for DevAddr).
 */
function parseProvisioningBlock(block: string): ProvisioningKeys {
    // Initialize with defaults.
    const keys: ProvisioningKeys = {
        KeyType: "",
        PublicNetwork: false,
        DevEui: [],
        AppEui: [],
        JoinEui: [],
        AppKey: [],
        NwkKey: [],
        DevAddr: 0,
        NwkSkey: [],
        AppSkey: []
    };
  
    // This regex captures lines like:
    //   .[optionalPrefix.]KeyName = value, [optional comment]
    // Group 1: the key name (last identifier after the dot)
    // Group 2: the value (up to a comma or end of line)
    const regex = /^\s*\.(?:\w+\.)?(\w+)\s*=\s*((?:\{\{[\s\S]*?\}\}|\{[\s\S]*?\}|[^\s,]+))\s*(?:,|$)/;

    const lines = block.split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(regex);
        if (!match) continue;
        const keyName = match[1];
        let rawValue = match[2];
        const value = cleanValue(rawValue);
    
        switch (keyName) {
            case "KeyType":
                keys.KeyType = value;
                break;
            case "PublicNetwork":
                keys.PublicNetwork = (value.toLowerCase() === "true");
                break;
            case "DevEui":
                keys.DevEui = parseByteArray(value);
                break;
            case "AppEui":
                keys.AppEui = parseByteArray(value);
                break;
            case "AppKey":
                keys.AppKey = parseByteArray(value);
                break;
            case "DevAddr":
                keys.DevAddr = value.toLowerCase().startsWith("0x") ? parseInt(value, 16) : parseInt(value, 10);
                break;
            case "NwkSkey":
                keys.NwkSkey = parseByteArray(value);
                break;
            case "AppSkey":
                keys.AppSkey = parseByteArray(value);
                break;
            default:
                // Ignore unrecognized keys.
                break;
        }
    }
    return keys;
}
  
/**
 * Serializes a ProvisioningKeys object back into a multi-line string.
 *
 * For output formatting:
 * - For byte[] values:
 *    - DevEui uses single braces: { ... }
 *    - AppEui, AppKey, NwkSkey, AppSkey use double braces: {{ ... }}
 * - Enum, bool, and uint32 are output as-is.
 */
function serializeProvisioningKeys(keys: ProvisioningKeys): string {
    // Helper: Format a byte array into a comma-separated list of hex values.
    function formatByteArray(arr: number[]): string {
        return arr.map(n => "0x" + n.toString(16).padStart(2, "0").toUpperCase()).join(", ");
    }
    function formatHexString(arr: number[]): string {
        return arr.map(n => n.toString(16).padStart(2, "0").toUpperCase()).join('');
    }
  
  
    const devEuiString = keys.DevEui.length == 8 && ( keys.DevEui[0] | keys.DevEui[1] | keys.DevEui[2] | keys.DevEui[3] | keys.DevEui[4] | keys.DevEui[5] | keys.DevEui[6] | keys.DevEui[7] ) !== 0 ? 
        formatByteArray(keys.DevEui) : 'thisDevEUI';
    const lines: string[] = [];
    lines.push(`    .KeyType                    = ${keys.KeyType},`);
    lines.push(`    .PublicNetwork              = ${keys.PublicNetwork},`);
    if (keys.KeyType === "ABP_10x_key") {
        lines.push(`    .ABP_10x = {`);
        lines.push(`        .DevEui                 = { ${devEuiString} },`);
        lines.push(`        .DevAddr                = 0x${keys.DevAddr.toString(16).toUpperCase()},`);
        lines.push(`        .NwkSKey                = {{ ${formatByteArray(keys.NwkSkey)} }}, // ${formatHexString(keys.NwkSkey)}`);
        lines.push(`        .AppSKey                = {{ ${formatByteArray(keys.AppSkey)} }}  // ${formatHexString(keys.AppSkey)}`);
    }
    else if (keys.KeyType === "OTAA_10x_key") {
        lines.push(`    .OTAA_10x = {`);
        lines.push(`        .DevEui                 = { ${devEuiString} },`);
        lines.push(`        .AppEui                 = {{ ${formatByteArray(keys.AppEui)} }}, // ${formatHexString(keys.AppEui)}`);
        lines.push(`        .AppKey                 = {{ ${formatByteArray(keys.AppKey)} }}  // ${formatHexString(keys.AppKey)}`);
    }
    else if (keys.KeyType === "OTAA_11x_key") {
        lines.push(`    .OTAA_11x = {`);
        lines.push(`        .DevEui                 = { ${devEuiString} },`);
        lines.push(`        .JoinEui                = {{ ${formatByteArray(keys.JoinEui)} }}, // ${formatHexString(keys.JoinEui)}`);
        lines.push(`        .AppKey                 = {{ ${formatByteArray(keys.AppKey)} }}, // ${formatHexString(keys.AppKey)}`);
        lines.push(`        .NwkKey                 = {{ ${formatByteArray(keys.NwkKey)} }}  // ${formatHexString(keys.NwkKey)}`);
    }
    lines.push(`    }`);
    return lines.join("\n");
}

// ----- getPSoCCreatorFolder function ------------------------------------------------------------------------------------------------------------------------------------

async function getPSoCCreatorFolder() {
    return psocCreatorFolder;
}

// ----- prelaunch function ------------------------------------------------------------------------------------------------------------------------------------

async function preLaunch() {
    let ret:string | null = '';
    if (projectFileChanged) {
        ret = await build();
        console.log(`prelaunch result" ${ret}`);
        //if (ret === null) ret = "'\n\nResolve problems first";
        if (ret === null) ret = '-';
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
        if (!currentProject.version || !onlineProject.version) { throw new Error(); };
    } catch (error) {
        vscode.window.showErrorMessage(`Error fetching version: ${(error as Error).message || 'unknown error'}`);
        return;
    }

    if (versionCompare(onlineProject.version, currentProject.version) !== 'h') {
        if (startup) return;
        const result = await vscode.window.showInformationMessage('No newer project version found online.\nForce update?', { modal: true }, 'Yes', 'No');
        if (result != 'Yes') return;
    }

    const result = await vscode.window.showInformationMessage(
        `Project update from ${currentProject.version} to ${onlineProject.version}.\n\n\
        This will update the meson build files and the configuration files in .vscode.\n\n\
        Backup your project if unsure.\n\nContinue?`, 
        { modal: true }, 'Yes', 'No'
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
            }
            catch 
            {
                updateUrl = onlineProject.updatePackage;
                updatePackage = await io.getFile([updateUrl], io.returnedContent.parsedJson);
            }
        }
        catch
        {
            vscode.window.showErrorMessage(`Invalid update link. Cannot update.`, { modal: true });
        }
    }

    const secondLastSlashIndex = updateUrl.lastIndexOf('/', updateUrl.lastIndexOf('/') - 1);
    const baseUrl = updateUrl.substring(0, secondLastSlashIndex + 1);
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
	mesonDiagnosticCollection.clear();
    linkerDiagnostics.clear();
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

    const creatorFolders = io.readDir(['workspace']).filter(file => file.endsWith('.cydsn'));
    if (creatorFolders.length === 0) {
        const msg = `Error: No .cydsn folder found inside the workspace!`;
        return taskStatus(msg, taskResult.errorConfirm);
    }
    if (creatorFolders.length > 1) {
        vscode.window.showInformationMessage(`Detected multiple .cydsn folders! Using first found: ${creatorFolders[0]}`);
    }
    psocCreatorFolder = creatorFolders[0];

    let ret = await executeTask(['Creator: postbuild']);
    if (ret !== 0) {
        const msg = `The Creator Postbuild task terminated with exit code: ${JSON.stringify(ret)}`;
        return taskStatus(msg, taskResult.errorInform);
    }

    await updateBuildFile(['workspace', 'cross_gcc.build'], [], [], mapMeson);
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

    creatorProjectChanged = false;
    return taskStatus('', taskResult.ok);
}

// ----- build function ------------------------------------------------------------------------------------------------------------------------------------

async function build(): Promise<string | null>  {
    if (creatorProjectChanged) {
        const msg = `The PSoC Creator project has been changed.\r\nPlease Clean-Reconfigure.`;
        return taskStatus(msg, taskResult.errorConfirm);
    }
    mesonDiagnosticCollection.clear();
    linkerDiagnostics.clear();

    const setupResult = await checkMesonSetup();
    if (setupResult.status !== 'ok') {
        const msg = `The Build task terminated with exit status: ${setupResult.status}\r\n${setupResult.message}\r\nPlease Clean-Reconfigure.`;
        return taskStatus(msg, taskResult.errorConfirm);
    }

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
        await updateBuildFile(cmakeBuildFile, headerContents, sourceContents, mapCMake);
    }

    const ret = await executeTaskGetOutput(['OTX: build', 'Meson: build']);
    creatorProjectChanged = false;
    if (ret.exitCode === null) { return taskStatus("Error task OTX build", taskResult.errorInform); }
    const mesonResult = await parseMesonLog();
    if (ret.exitCode !== 0) 
    {
        vscode.commands.executeCommand('workbench.action.problems.focus');
        parseLinkerLogLines(ret.output);
        const msg = `The Build task terminated with exit code: ${JSON.stringify(ret.exitCode)}`;
        return taskStatus(msg, taskResult.errorInform);
    }
    projectFileChanged = false;
    return taskStatus('', taskResult.ok);
}

// ----- OTX linker output check ----------------------------------------------------------------------------------------------------------------------------

const linkerDiagnostics = vscode.languages.createDiagnosticCollection('otx-linker');

/**
 * Parse an array of linker-output lines and populate `linkerDiagnostics`.
 */
export async function parseLinkerLogLines(output: string): Promise<{ status: string; message: string; errorCount: number }> {
    const diagnosticsMap: { [file: string]: vscode.Diagnostic[] } = {};
    let errorCount = 0;

    let buildFile = '';
    if (io.existsFile(['workspace', 'meson.build'])) { buildFile = io.getPath(['workspace', 'meson.build']); }
    else if (io.existsFile(['workspace', 'CMakeLists.txt'])) { buildFile = io.getPath(['workspace', 'CMakeLists.txt']); }

    const workspacePath = io.getPath(['workspace']);

    const step1 = output.replace(/\r?\n| {3,}/g, '');

        const step2 = step1.replace(/ld: /g, '\nld: ');

    // 4) Split on the remaining newlines and drop any empty entries
    const step3 =  step2
        .split('\n')
        .map(line => line.trim());
       // .filter(line => line.startsWith('ld: '));

    for (const line of step3) {
        //let m: RegExpExecArray | null;
        const diags: Array<{ message: string; filePath: string; lineNumber: string; severity: vscode.DiagnosticSeverity; }> 
            = [{ message: '', filePath: workspacePath, lineNumber: '0', severity: vscode.DiagnosticSeverity.Warning }];

        //let message = '';
        //let filePath = workspacePath;
        //let lineNumber = '0';
        //let severity = vscode.DiagnosticSeverity.Warning;

        if (/undefined reference to/.test(line)) {
            diags[0].message = 'undefined reference';
            diags[0].severity = vscode.DiagnosticSeverity.Error;
            const mMsg = /(undefined reference to `[^']+')/.exec(line);
            if (mMsg) {
                diags[0].message = mMsg[1];  
            }

            //const mLoc = /^.*?ld:\s+[^:]+:\s*in function `[^']+':\s*(\/[^:]+\.[^:]+):(\d+):/.exec(line);
            const mLoc = /ld: (?:.*?: )?(?:in function `[^']+':)?(\/[^:]+):(\d+):/.exec(line);
            if (mLoc) {
                diags[0].filePath   = mLoc[1];
                diags[0].lineNumber = mLoc[2];
            }
        }

        if (/multiple definition of/.test(line)) {
            diags[0].message = 'multiple definition';
            diags[0].severity = vscode.DiagnosticSeverity.Error;

            // Extract all file:line: patterns
            const fileMatches = [...line.matchAll(/(\/[^:\s]+\.c):(\d+):/g)];

            if (fileMatches[0]) {
                diags[0].filePath = fileMatches[0][1];
                diags[0].lineNumber = fileMatches[0][2];
            }

            // Extract symbol name
            const symbolMatch = /multiple definition of [`']([^`']+)[`']/.exec(line);
            diags[0].message += symbolMatch ? ` of '${symbolMatch[1]}'` : '';

            if (fileMatches.length >= 2) {
                diags.push({
                    filePath:   fileMatches[1][1],
                    lineNumber: fileMatches[1][2],
                    message:    (symbolMatch ? ` '${symbolMatch[1]}'` : '') + ` first defined here`,
                    severity:   diags[0].severity
                });
            }
        }

        if (/cannot find entry symbol/.test(line)) {
            diags[0].message = 'cannot find entry symbol';
            const reWarning = /^ld:\s*(warning:\s*cannot find entry symbol [^;]+; defaulting to \d+)/.exec(line);
            if (reWarning) {
                diags[0].message = reWarning[1]; 
            }
        }

        if (/will not fit in region/.test(line)) {
            diags[0].message = 'memory does not fit';
            diags[0].severity = vscode.DiagnosticSeverity.Error;
            const reFit = /^.*?(section\s+`[^`]+'?)\s+(will not fit in region\s+`[^`]+')/.exec(line);
            if (reFit) {
                diags[0].message = (reFit[1]?? '') + ' ' + (reFit[2]?? '');
            }
        }
        
        if (/\b[Rr]egion\b.*?\boverflowed by\b/.test(line)) {
            diags[0].message = 'memory does not fit';
            diags[0].severity = vscode.DiagnosticSeverity.Error;
            const reOf = /\b((?:[Rr]egion)(?:\s+[`']?[^`']+[`']?))\s+(overflowed(?:\s+by\s+\d+\s+bytes?)?)/.exec(line);

            if (reOf) {
                diags[0].message = (reOf[1]?? '') + ' ' + (reOf[2]?? '');
            }
        }

        if (/(?:cannot find directory|[Nn]o such file or directory)/.test(line)) {
            diags[0].message = 'cannot find file or directory';
            diags[0].severity = vscode.DiagnosticSeverity.Error;
            const reDir = /^(?:.*?)(cannot find directory)(\/[^:]+):\s*([Nn]o such file or directory)/.exec(line);

            if (reDir) {
                diags[0].message = (reDir[1]?? '') + ' ' + (reDir[2]?? '') + ' ' + (reDir[3]?? '');
            }
        }

        if (/unrecognized command-line option/.test(line)) {
            diags[0].severity = vscode.DiagnosticSeverity.Error;
            diags[0].message = "unrecognized command-line option";
            diags[0].filePath = buildFile;
            const reGccOption = /^.*?(unrecognized command-line option '[^']+')(?:;\s*(did you mean '[^']+?'\??))?/.exec(line);
            if (reGccOption) {
                diags[0].message = reGccOption[1] + ' ' + (reGccOption[2]?? '');
            }
        }

        if (/cannot open linker script/.test(line)) {
            diags[0].severity = vscode.DiagnosticSeverity.Error;
            diags[0].message = 'Cannot open linker script. Check the linker reference in meson.build or CMakeLists.txt.';
            diags[0].filePath = buildFile;
        }

        if (/error: ld returned /.test(line) && errorCount == 0 && diags[0].message == '') {
            diags[0].severity = vscode.DiagnosticSeverity.Error;
            diags[0].message = 'Linker Error, consult TERMINAL output.';
        }

        if (diags[0].message != '') {
            for (const { filePath, lineNumber, message, severity } of diags) {
                const ln = Math.max(0, parseInt(lineNumber, 10) - 1);
                const range = new vscode.Range(new vscode.Position(ln, 0), new vscode.Position(ln, Number.MAX_SAFE_INTEGER));
                const diag = new vscode.Diagnostic(range, message, severity);
                diag.source = 'otx-linker';
                (diagnosticsMap[filePath] ??= []).push(diag);
            }
            errorCount++;
        }
    }

    // Push collected diagnostics into the global collection
    Object.entries(diagnosticsMap).forEach(([file, diags]) => {
        linkerDiagnostics.set(vscode.Uri.file(file), diags);
    });

    return {
        status: errorCount > 0 ? 'error' : 'ok',
        message: errorCount > 0 ? `Found ${errorCount} linker errors.` : 'No linker errors detected.',
        errorCount
    };
}


// ----- launch function ------------------------------------------------------------------------------------------------------------------------------------
async function launch(mode = "Debug"): Promise<string | null>  {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const ret = await vscode.debug.startDebugging(workspaceFolder, mode);
    console.log(`launch ${ret}`);
    return taskStatus('', taskResult.ok);
};

// ----- check function ------------------------------------------------------------------------------------------------------------------------------------
// Global variable to hold the tracker registration disposable.
let trackerDisposable: vscode.Disposable | undefined;
let thisDevEUI = '';

function registerTracker(sessionName: string) {
    thisDevEUI = '';
    if (!trackerDisposable) {
        const trackerFactory: vscode.DebugAdapterTrackerFactory = {
            createDebugAdapterTracker(session: vscode.DebugSession) {
                if (session.name === sessionName) {
                    return {
                        onDidSendMessage: message => {
                            const text = message?.body?.output || "";
                            const match = text.match(/Detected Dev\.EUI:\s*(\S+)/);
                            if (match && match[1]) {
                                thisDevEUI = match[1];
                                //console.log("Detected DevEUI:", match[1]);
                            }
                        }
                    };
                }
                return undefined;
            }
        };
        trackerDisposable = vscode.debug.registerDebugAdapterTrackerFactory("*", trackerFactory);
    }
}


async function check(): Promise<string | null>  {
    registerTracker("Check");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const started = await vscode.debug.startDebugging(workspaceFolder, "Check");
    console.log(`Debug session launched: ${started}`);
    return taskStatus('', taskResult.ok);
}

// ----- meson config functions ------------------------------------------------------------------------------------------------------------------------------------

const mesonDiagnosticCollection = vscode.languages.createDiagnosticCollection('meson');

async function checkMesonSetup(): Promise<{status: string, message: string}>  {
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
    const buildFileContents = await io.getFile(buildFile, io.returnedContent.stringArray);
    let arr: string[] = [];
    let logOut = true;
    let skipLines = 0;

    buildFileContents.forEach((line: string) => {
        if (line.includes("OTX_Extension_HeaderFiles_End") || line.includes("OTX_Extension_SourceFiles_End")) { logOut = true; }
        if (logOut) { arr.push(line); }
        if (skipLines > 0 && --skipLines === 0) { logOut = true; }
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
            skipLines = 1;
        }
    });

    const contents = arr.join('\n');
    // console.log(contents);
    if (contents !== buildFileContents.join('\n')) { 
        await io.writeFile(buildFile, contents);
    }
}

async function parseMesonLog(): Promise<{ status: string, message: string, errorCount: number}>{
    const logFilePath = ['workspace', 'build', 'meson-logs', 'meson-log.txt'];
    if (!io.existsFile(logFilePath)) {
        vscode.window.showErrorMessage("Meson log file not found.");
        return { status: 'error', message: 'Meson log file not found.', errorCount: 0 };
    }

    const lines = await io.getFile(logFilePath, io.returnedContent.stringArray);
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
            const diag = new vscode.Diagnostic(range, errorMessage, errMatch? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
            diag.source = 'otx-meson';
            
            const absoluteFilePath = io.getPath(['workspace', filePath]);
            if (!diagnosticsMap[absoluteFilePath]) {
                diagnosticsMap[absoluteFilePath] = [];
            }
            diagnosticsMap[absoluteFilePath].push(diag);
            if (errMatch) { errorCount++; }
        }
    }
    Object.keys(diagnosticsMap).forEach(fileUri => {
        mesonDiagnosticCollection.set(vscode.Uri.file(fileUri), diagnosticsMap[fileUri]);
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
    if (!task) { return; }
    console.log(`--- execute task: ${task.name}`);
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


async function executeTaskGetOutput( taskNames: string[] ): Promise<{ exitCode: number | undefined; output: string }> {
    const task = await getTask(taskNames);
    if (!task) { return { exitCode: undefined, output: '' }; }
    console.log(`--- execute task: ${task.name}`);

    return new Promise((resolve, reject) => {
        let capturedExitCode: number | undefined;

        // 1) Listen for the task to finish
        const endDisp = vscode.tasks.onDidEndTaskProcess(async e => {
            if (e.execution.task.name !== task.name) {
                return;
            }
            // only handle once
            endDisp.dispose();

            capturedExitCode = e.exitCode;

            // 2) Find the terminal that ran the task
            const term =
                vscode.window.terminals.find(t => t.name === task.name) ||
                vscode.window.activeTerminal;
            if (!term) {
                return reject(new Error(`Terminal for task "${task.name}" not found.`));
            }
            // ensure it has focus so copy command works
            term.show(true);

            try {
                const originalClipboard = await vscode.env.clipboard.readText();
                // Run the command that overwrites the clipboard
                await vscode.commands.executeCommand('workbench.action.terminal.copyLastCommandOutput');

                const text = await vscode.env.clipboard.readText();
                // Restore original clipboard
                await vscode.env.clipboard.writeText(originalClipboard);

                resolve({ exitCode: capturedExitCode, output: text });
            } catch (err) {
                reject(err);
            }
        });

        // 5) Kick off the task (no need to await here)
        vscode.tasks.executeTask(task);
    });
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
        const versionGet = path.join(util.substituteVariables("${env:ONETHINX_PACK_LOC}"), 'bin', `OTX-Maestro-version ${thisExtensionVersion}`);
        const stdout = execSync(versionGet);
        return stdout.toString().trim();
    } catch (error) {
            return "1.0.0";
    }
}

async function getCurrentProject()
{
    currentProject.version = '?';
    try {
        currentProject = await io.getFile(['workspace', '.vscode', 'project.json'], io.returnedContent.parsedJson);
    } catch {}
    if (currentProject.version === '?') {
        try {
            try {
                if (io.existsExtension(['workspace'],".cydsn")) {
                    currentProject.version = '1.0.0';
                }
            }
            catch{}
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

async function selectProgrammer(): Promise<boolean> {       // Launch programmer picker
    const programmer = await getProgrammer();
    const programmers: { s: string, l: string }[] = [];

    // Conditionally add the "default" option
    if (programmer.global !== undefined) {
        programmers.push(
            { s: "default", l: `Default (${programmer.global}, defined in global settings.json)` }
        );
    }
    programmers.push(
        { s: "kitprog3", l: "Infineon KitProg3 Programmer" },
        { s: "jlink", l: "SEGGER J-Link Programmer" },
        { s: "otx-minidap", l: "Onethinx MiniDap Programmer" },
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
    );

    const index = programmers.findIndex(prog => prog.s === programmer.target);
    const progNames = programmers.map(prog => prog.l);

    return new Promise<boolean>((resolve) => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.canSelectMany = false;
        quickPick.placeholder = 'Select a programmer';
        quickPick.items = progNames.map(name => ({ label: name }));
        let didAccept = false;

        // Pre-select an item if found
        if (index !== -1) {
            quickPick.activeItems = [quickPick.items[index]];
        }

        quickPick.onDidAccept(async () => {
            didAccept = true;
            let result = false;
            const selected = quickPick.selectedItems[0];
            if (selected) {
                const selectedProgrammer = programmers.find(prog => prog.l === selected.label);
                if (selectedProgrammer) {
                    vscode.window.showInformationMessage(`You selected: ${selected.label}`);
                    const defaultProg = selectedProgrammer.s === 'default';
                    result = await setProgrammer(selectedProgrammer.s, defaultProg);
                }
            }
            resolve(result); // Fallback if no valid selection
            quickPick.dispose();
        });

        quickPick.onDidHide(() => {
            if (didAccept) return;
            quickPick.dispose();
            resolve(false); // User cancelled
        });
        quickPick.show();
    });
}

async function getSetProgrammer() {
    const programmer = await getProgrammer();
    if (programmer.notSet)
    {
        if (programmer.board != undefined)
        {
            if (programmer.board == "cmsis-dap-old")
            {
                const setPrgFromBrd = await vscode.window.showInformationMessage(
                    `Programmer not set.\nDo want to set the OTX-Minidap?`, { modal: true }, 'Yes', 'No', 
                );
                if (setPrgFromBrd === 'Yes')
                {
                    return await setProgrammer('otx-minidap', false);
                }
            } else {
                const setPrgFromBrd = await vscode.window.showInformationMessage(
                    `Programmer not set.\nUse '${programmer.board}' from brd.cfg?`, { modal: true }, 'Yes', 'No', 
                );
                if (setPrgFromBrd === 'Yes')
                {
                    return await setProgrammer(programmer.board, false);
                }
            }
        }
        return await selectProgrammer();
    }
    return await setProgrammer(programmer.target!, programmer.useDefault);
}

let boardProgrammer: string | undefined = undefined;

async function getProgrammer(): Promise<{ target: string | undefined; global: string | undefined; board: string | undefined; notSet: boolean; useDefault: boolean;}>{
    const config = vscode.workspace.getConfiguration('otx-maestro');

    let target = config.get<string | undefined>('programmer');

    const inspect = config.inspect<string>('programmer');
    const global = inspect?.globalValue;
    const local = inspect?.workspaceFolderValue ?? inspect?.workspaceValue;

    const useDefault = local === undefined;
    const notSet = global === undefined && useDefault;
    
    if (boardProgrammer == undefined)
    {
        const boardSettingsFile = ['workspace', '.vscode', 'brd.cfg'];
        if (io.existsFile(boardSettingsFile)) {
            // Read the board settings file content
            const boardSettingsLines: string[] = await io.getFile(boardSettingsFile, io.returnedContent.stringArray);
            const boardMatch = boardSettingsLines[0].match(/PROGRAMMER\s+([^\s;]+)/);
            boardProgrammer = boardMatch? boardMatch[1] : undefined;
            const isNewBoard = boardSettingsLines.some(line => line.includes('otx-minidap'));
            if (!isNewBoard && boardProgrammer == 'cmsis-dap') boardProgrammer = 'cmsis-dap-old'
        }
    }
    const board = boardProgrammer;
    return {target, global, board, notSet, useDefault};
}

async function setProgrammer(programmer: string, setDefault: boolean)
{
    let newProg = setDefault? undefined : programmer;
    const config = vscode.workspace.getConfiguration('otx-maestro');
    const inspect = config.inspect<string>('programmer');
    const local = inspect?.workspaceFolderValue ?? inspect?.workspaceValue;
    if (local != newProg) {
        try {
            await config.update('programmer', newProg, vscode.ConfigurationTarget.Workspace);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Error saving default programmer: ${err instanceof Error ? err.message : 'Unknown error'}`);
            return false;
        }
    }

    if (programmer !== boardProgrammer) {
        
        const boardSettingsFile = ['workspace', '.vscode', 'brd.cfg'];

        if (!io.existsFile(boardSettingsFile)) {
            vscode.window.showErrorMessage(`.vscode/brd.cfg is missing.\nPlease update project.`, { modal: true });
            return false;
        }

        // Read the board settings file content
        let boardSettingsLines: string[] = await io.getFile(boardSettingsFile, io.returnedContent.stringArray);

        // Prepare the new line and update settings
        let skipSave = false;
        const newLine = `set PROGRAMMER ${programmer}`;
        if (!boardSettingsLines[0].includes('PROGRAMMER')) {
            boardSettingsLines.unshift(newLine);
        } else {
            if (boardSettingsLines[0] == newLine) skipSave = true;
            else boardSettingsLines[0] = newLine;
        }
        const isNewBoardFile = boardSettingsLines.some(line => line.includes('otx-minidap'));
        if (!skipSave || !isNewBoardFile) {
            const toWrite =  isNewBoardFile? boardSettingsLines : transformTcl(boardSettingsLines);
            await io.writeFile(boardSettingsFile, toWrite.join('\n'));
        }
    }

    // Refresh tasks if JLink configuration is changed
    const isJlink = programmer === 'jlink';
    if (isJlink === notJlink) {
        const confirm = await vscode.window.showInformationMessage(
            'The JLink configuration is changed. Do you want to reload the window to apply changes?', { modal: true }, 'Yes', 'No'
        );
        if (confirm === 'Yes') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        notJlink = !isJlink;
    }
    return true;
}

function transformTcl(lines: string[]): string[] {
    const result: string[] = [];

    for (let line of lines) {
        // Replace `"cmsis-dap" {` → `"otx-minidap" {`
        if (line.includes('"cmsis-dap" {')) {
            line = line.replace('cmsis-dap', 'otx-minidap');
        }

        // Replace source line if matched
        if (line.trim() === 'source [find interface/${PROGRAMMER}.cfg]') {
            result.push('if {${PROGRAMMER} == "otx-minidap"} {');
            result.push('    source [find interface/cmsis-dap.cfg]');
            result.push('} else {');
            result.push('    source [find interface/${PROGRAMMER}.cfg]');
            line = '}';
        }
        result.push(line);
    }
    vscode.window.showInformationMessage('Updated outdated brd.cfg');
    return result;
}

async function selectProgOLD(programmer: string, checkOnly: boolean = false, noWarning: boolean = false): Promise<{useDefault: boolean, currentProgrammer: string}> {
    // Substitute environment variables and get the base path
    const packFolder = util.substituteVariables('${env:ONETHINX_PACK_LOC}');
    
    const boardSettingsFile = ['workspace', '.vscode', 'brd.cfg'];

    // Check if the file exists, if not, copy from the source
    if (!noWarning && !io.existsFile(boardSettingsFile)) {
        vscode.window.showErrorMessage(`.vscode/brd.cfg is missing.\nPlease update project.`, { modal: true });
    }

    // Read the board settings file content
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

