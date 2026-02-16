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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const envManager_1 = require("./envManager");
const dashboardView_1 = require("./dashboardView");
const envTree_1 = require("./envTree");
const POST_CREATE_PREFS_KEY = 'easyenv.postCreatePrefs';
const SUPPRESSED_MISSING_MANAGER_KEY = 'easyenv.suppressedMissingManagers';
const STARTUP_DIAGNOSTICS_KEY = 'easyenv.startupDiagnosticsShown';
const AUTO_DISABLE_PYTHON_KEY = 'easyenv.disabledPythonAutoActivate';
const TIP_SHOWN_KEY = 'easyenv.tipShown';
const CREATION_PROFILES = [
    {
        id: 'none',
        label: 'Sin perfil',
        description: 'No instala paquetes extra',
        packages: []
    },
    {
        id: 'api',
        label: 'API (FastAPI)',
        description: 'Instala fastapi y uvicorn',
        packages: ['fastapi', 'uvicorn']
    },
    {
        id: 'data',
        label: 'Data Science',
        description: 'Instala numpy, pandas, matplotlib y jupyter',
        packages: ['numpy', 'pandas', 'matplotlib', 'jupyter']
    },
    {
        id: 'testing',
        label: 'Testing',
        description: 'Instala pytest y pytest-cov',
        packages: ['pytest', 'pytest-cov']
    }
];
const DEFAULT_POST_CREATE_PREFS = {
    setInterpreter: true,
    activateTerminal: true,
    installProjectDependencies: false,
    profileId: 'none'
};
function activate(context) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Easy Env: abre primero una carpeta de proyecto.');
        return;
    }
    const manager = new envManager_1.EnvManager(workspaceRoot);
    const treeProvider = new envTree_1.EnvTreeProvider([]);
    vscode.window.registerTreeDataProvider('easyEnvView', treeProvider);
    const dashboardProvider = new dashboardView_1.DashboardViewProvider(context, manager);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(dashboardView_1.DashboardViewProvider.viewId, dashboardProvider));
    disablePythonAutoActivateOnFirstRun(context);
    showFirstRunTip(context);
    manager.scanEnvs().then(envs => {
        treeProvider.refresh(envs);
    });
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.refresh', async () => {
        await refreshViews(manager, treeProvider, dashboardProvider);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.createVenv', async () => {
        await runCreateEnvWizard(context, manager, treeProvider, dashboardProvider);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.configurePostCreateDefaults', async () => {
        const prefs = await promptPostCreatePreferences(context, loadPostCreatePreferences(context), 'Configura acciones automaticas post-creacion');
        if (!prefs) {
            return;
        }
        await context.globalState.update(POST_CREATE_PREFS_KEY, prefs);
        vscode.window.showInformationMessage('Preferencias post-creacion guardadas.');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.runDiagnostics', async () => {
        await runDiagnostics(context, manager, true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.installManager', async (managerType) => {
        const selected = managerType ?? (await pickExternalManager());
        if (!selected) {
            return;
        }
        const guidance = getManagerGuidance(selected);
        if (manager.isManagerAvailable(selected)) {
            const action = await vscode.window.showInformationMessage(`"${selected}" ya esta disponible en Easy Env.`, 'Reinstalar desde Easy Env', 'Configurar ruta manual', 'Abrir docs');
            if (action === 'Reinstalar desde Easy Env' && guidance.installCommand) {
                runInstallCommandInTerminal(manager, selected, guidance.installCommand, guidance.docsUrl);
            }
            else if (action === 'Configurar ruta manual') {
                await promptManagerExecutablePath(manager, selected);
            }
            else if (action === 'Abrir docs') {
                await vscode.env.openExternal(vscode.Uri.parse(guidance.docsUrl));
            }
            return;
        }
        await installManagerFromEasyEnv(manager, selected);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.activateEnv', (env) => {
        manager.activateEnv(env);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.setWorkspaceInterpreter', async (env) => {
        await setWorkspaceInterpreter(env);
        vscode.window.showInformationMessage(`Interprete del workspace cambiado a ${env.name}.`);
        await refreshViews(manager, treeProvider, dashboardProvider);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.deleteEnv', async (env) => {
        await safeDeleteEnv(manager, env);
        await refreshViews(manager, treeProvider, dashboardProvider);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.openEnvFolder', (env) => {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(env.path));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.openEnvTerminal', (env) => {
        const terminal = vscode.window.createTerminal({
            name: `Shell: ${env.name}`,
            cwd: env.path
        });
        terminal.show();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.showEnvPackages', async (env) => {
        const targetEnv = await ensureEnvSelected(env, manager);
        if (!targetEnv) {
            return;
        }
        await showPipList(manager, targetEnv);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.installPackage', async (env) => {
        const targetEnv = await ensureEnvSelected(env, manager);
        if (!targetEnv) {
            return;
        }
        const pkg = await vscode.window.showInputBox({
            prompt: 'Nombre del paquete a instalar (ej: requests, fastapi==0.115.0)',
            placeHolder: 'requests'
        });
        if (!pkg) {
            return;
        }
        const channel = vscode.window.createOutputChannel(`pip install - ${targetEnv.name}`);
        channel.show(true);
        channel.appendLine(`# pip install ${pkg} en ${targetEnv.name}`);
        channel.appendLine('');
        try {
            const out = await manager.runPip(targetEnv, ['install', pkg]);
            channel.append(out);
            vscode.window.showInformationMessage(`Paquete "${pkg}" instalado en ${targetEnv.name}.`);
        }
        catch (err) {
            channel.appendLine(err.message);
            vscode.window.showErrorMessage(`Error instalando paquete: ${err.message}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.uninstallPackage', async (env) => {
        const targetEnv = await ensureEnvSelected(env, manager);
        if (!targetEnv) {
            return;
        }
        const pkg = await vscode.window.showInputBox({
            prompt: 'Nombre del paquete a desinstalar (ej: requests)',
            placeHolder: 'requests'
        });
        if (!pkg) {
            return;
        }
        const channel = vscode.window.createOutputChannel(`pip uninstall - ${targetEnv.name}`);
        channel.show(true);
        channel.appendLine(`# pip uninstall ${pkg} en ${targetEnv.name}`);
        channel.appendLine('');
        try {
            const out = await manager.runPip(targetEnv, ['uninstall', pkg, '-y']);
            channel.append(out);
            vscode.window.showInformationMessage(`Paquete "${pkg}" desinstalado de ${targetEnv.name}.`);
        }
        catch (err) {
            channel.appendLine(err.message);
            vscode.window.showErrorMessage(`Error desinstalando paquete: ${err.message}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.installProjectDeps', async (env) => {
        const targetEnv = await ensureEnvSelected(env, manager);
        if (!targetEnv) {
            return;
        }
        await installProjectDependencies(manager, targetEnv);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.actions', async () => {
        const envsList = await manager.scanEnvs();
        if (!envsList.length) {
            vscode.window.showWarningMessage('No se encontraron entornos en esta carpeta.');
            return;
        }
        const envPick = await vscode.window.showQuickPick(envsList.map(e => ({
            label: e.name,
            description: `${e.type} | ${e.version ?? e.pythonPath}`,
            env: e
        })), { placeHolder: 'Selecciona un entorno' });
        if (!envPick) {
            return;
        }
        const env = envPick.env;
        const action = await vscode.window.showQuickPick([
            'Activar entorno',
            'Usar como interprete del workspace',
            'Ver paquetes (pip list)',
            'Instalar paquete...',
            'Desinstalar paquete...',
            'Instalar dependencias del proyecto',
            'Abrir carpeta del entorno',
            'Abrir terminal en la ruta del entorno',
            'Eliminar entorno'
        ], { placeHolder: `Accion sobre "${env.name}"` });
        if (!action) {
            return;
        }
        switch (action) {
            case 'Activar entorno':
                manager.activateEnv(env);
                break;
            case 'Usar como interprete del workspace':
                await vscode.commands.executeCommand('easyenv.setWorkspaceInterpreter', env);
                break;
            case 'Ver paquetes (pip list)':
                await vscode.commands.executeCommand('easyenv.showEnvPackages', env);
                break;
            case 'Instalar paquete...':
                await vscode.commands.executeCommand('easyenv.installPackage', env);
                break;
            case 'Desinstalar paquete...':
                await vscode.commands.executeCommand('easyenv.uninstallPackage', env);
                break;
            case 'Instalar dependencias del proyecto':
                await vscode.commands.executeCommand('easyenv.installProjectDeps', env);
                break;
            case 'Abrir carpeta del entorno':
                await vscode.commands.executeCommand('easyenv.openEnvFolder', env);
                break;
            case 'Abrir terminal en la ruta del entorno':
                await vscode.commands.executeCommand('easyenv.openEnvTerminal', env);
                break;
            case 'Eliminar entorno':
                await vscode.commands.executeCommand('easyenv.deleteEnv', env);
                break;
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.togglePythonAutoActivate', async () => {
        const config = vscode.workspace.getConfiguration('python');
        const current = config.get('terminal.activateEnvironment') ?? true;
        const newValue = !current;
        await config.update('terminal.activateEnvironment', newValue, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Auto-activacion de entornos Python: ${newValue ? 'ACTIVADA' : 'DESACTIVADA'}.`);
        await dashboardProvider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('easyenv.about', () => {
        vscode.window.showInformationMessage('Easy Env - Administrador de entornos Python.\n\n' +
            'Creado por Nelson Enrique Polo (polosoft1@gmail.com) con asistencia de IA.');
    }));
    maybeRunStartupDiagnostics(context, manager);
}
async function runCreateEnvWizard(context, manager, treeProvider, dashboardProvider) {
    const diagnostics = manager.getRuntimeDiagnostics();
    const project = diagnostics.project;
    const managerPick = await promptManagerSelection(diagnostics);
    if (!managerPick) {
        return;
    }
    const selectedManager = managerPick.value;
    if (!diagnostics.managers[selectedManager]) {
        if (selectedManager === 'venv') {
            vscode.window.showErrorMessage('No se encontro comando python en PATH para crear venv.');
            return;
        }
        const missingResult = await handleMissingManager(context, manager, selectedManager);
        if (missingResult === 'use-venv') {
            await runCreateEnvWizardWithManager(context, manager, treeProvider, dashboardProvider, project, diagnostics, 'venv');
        }
        return;
    }
    await runCreateEnvWizardWithManager(context, manager, treeProvider, dashboardProvider, project, diagnostics, selectedManager);
}
async function runCreateEnvWizardWithManager(context, manager, treeProvider, dashboardProvider, project, diagnostics, selectedManager) {
    const beforeEnvs = await manager.scanEnvs();
    let expectedPath;
    let expectedName;
    try {
        switch (selectedManager) {
            case 'venv': {
                const name = await vscode.window.showInputBox({
                    prompt: 'Nombre del entorno venv (ej: .venv, .dev, .qa)',
                    value: '.venv'
                });
                if (!name) {
                    return;
                }
                expectedName = name;
                expectedPath = await manager.createVenv(name);
                break;
            }
            case 'uv': {
                const name = await vscode.window.showInputBox({
                    prompt: 'Nombre del entorno uv (ej: .venv, .dev, .qa)',
                    value: '.venv'
                });
                if (!name) {
                    return;
                }
                expectedName = name;
                expectedPath = await manager.createUvEnv(name);
                break;
            }
            case 'conda': {
                const name = await vscode.window.showInputBox({
                    prompt: 'Nombre/carpeta para conda (se crea dentro del workspace)',
                    value: '.conda'
                });
                if (!name) {
                    return;
                }
                expectedName = name;
                const pyVersion = await vscode.window.showInputBox({
                    prompt: 'Version de Python para conda (opcional, ej: 3.11)',
                    placeHolder: '3.11'
                });
                if (pyVersion === undefined) {
                    return;
                }
                expectedPath = await manager.createCondaEnv(name, pyVersion || undefined);
                break;
            }
            case 'poetry': {
                const mode = await vscode.window.showQuickPick(['Si, en el proyecto (.venv)', 'No, usar configuracion actual de Poetry'], { placeHolder: 'Donde quieres que Poetry cree el entorno?' });
                if (!mode) {
                    return;
                }
                const inProject = mode.startsWith('Si');
                expectedPath = await manager.createPoetryEnv(inProject);
                expectedName = inProject ? '.venv' : undefined;
                break;
            }
            case 'pipenv': {
                const mode = await vscode.window.showQuickPick(['Si, en el proyecto (.venv)', 'No, en la ruta global de Pipenv'], { placeHolder: 'Donde quieres que Pipenv cree el entorno?' });
                if (!mode) {
                    return;
                }
                const inProject = mode.startsWith('Si');
                expectedPath = await manager.createPipenvEnv(inProject);
                expectedName = inProject ? '.venv' : undefined;
                break;
            }
        }
    }
    catch (err) {
        if (selectedManager === 'conda' && isCondaTermsError(err.message)) {
            await handleCondaTermsError(manager, err.message);
            return;
        }
        const choice = await vscode.window.showErrorMessage(`Error creando entorno (${selectedManager}): ${err.message}`, 'Abrir docs', 'Instalar desde Easy Env', 'Seleccionar ejecutable');
        if (selectedManager !== 'venv' && choice) {
            if (choice === 'Seleccionar ejecutable') {
                await promptManagerExecutablePath(manager, selectedManager);
            }
            else {
                await handleMissingManager(context, manager, selectedManager, choice === 'Instalar desde Easy Env');
            }
        }
        return;
    }
    const postPrefs = await resolvePostCreatePreferences(context, project, diagnostics);
    if (!postPrefs) {
        return;
    }
    const createdSearch = await waitForCreatedEnv(manager, beforeEnvs, selectedManager, expectedPath, expectedName);
    let newEnvs = createdSearch.envs;
    await refreshViews(manager, treeProvider, dashboardProvider, newEnvs);
    let created = createdSearch.created;
    if (!created && (postPrefs.setInterpreter || postPrefs.activateTerminal || hasProfilePackages(postPrefs.profileId))) {
        vscode.window.showWarningMessage('No se pudo inferir automaticamente el entorno creado. Selecciona uno manualmente.');
        created = await ensureEnvSelected(undefined, manager);
    }
    if (!created) {
        return;
    }
    if (postPrefs.setInterpreter) {
        await setWorkspaceInterpreter(created);
        vscode.window.showInformationMessage(`Interprete del workspace cambiado a ${created.name}.`);
    }
    if (hasProfilePackages(postPrefs.profileId)) {
        await installProfilePackages(manager, created, postPrefs.profileId);
    }
    if (postPrefs.installProjectDependencies) {
        await installProjectDependencies(manager, created);
    }
    if (postPrefs.activateTerminal) {
        manager.activateEnv(created);
    }
    newEnvs = await manager.scanEnvs();
    await refreshViews(manager, treeProvider, dashboardProvider, newEnvs);
}
async function promptManagerSelection(diagnostics) {
    const recommended = diagnostics.project.recommendedManager;
    const detailFor = (type) => {
        const available = diagnostics.managers[type] ? 'Disponible' : 'No instalado en PATH';
        const recommendation = type === recommended ? ' • Recomendado para este proyecto' : '';
        return `${available}${recommendation}`;
    };
    return vscode.window.showQuickPick([
        {
            label: 'venv',
            description: 'python -m venv (local en workspace)',
            detail: detailFor('venv'),
            value: 'venv'
        },
        {
            label: 'uv',
            description: 'uv venv (rapido)',
            detail: detailFor('uv'),
            value: 'uv'
        },
        {
            label: 'conda',
            description: 'conda create --prefix (local en workspace)',
            detail: detailFor('conda'),
            value: 'conda'
        },
        {
            label: 'poetry',
            description: 'poetry env use python',
            detail: detailFor('poetry'),
            value: 'poetry'
        },
        {
            label: 'pipenv',
            description: 'pipenv --python python',
            detail: detailFor('pipenv'),
            value: 'pipenv'
        }
    ], { placeHolder: 'Selecciona el gestor para crear el entorno' });
}
async function resolvePostCreatePreferences(context, project, diagnostics) {
    const saved = loadPostCreatePreferences(context);
    const mode = await vscode.window.showQuickPick([
        { label: 'Usar preferencias guardadas', value: 'saved' },
        { label: 'Ajustar solo esta vez', value: 'once' },
        { label: 'Actualizar preferencias por defecto', value: 'update' }
    ], { placeHolder: 'Acciones post-creacion' });
    if (!mode) {
        return undefined;
    }
    if (mode.value === 'saved') {
        return saved;
    }
    const suggestedProfileId = project.hasPyproject ? 'testing' : 'none';
    const configured = await promptPostCreatePreferences(context, { ...saved, profileId: saved.profileId === 'none' ? suggestedProfileId : saved.profileId }, mode.value === 'update'
        ? 'Configura y guarda preferencias por defecto'
        : `Configura acciones para esta creacion (${diagnostics.project.recommendedManager} recomendado)`);
    if (!configured) {
        return undefined;
    }
    if (mode.value === 'update') {
        await context.globalState.update(POST_CREATE_PREFS_KEY, configured);
    }
    return configured;
}
async function promptPostCreatePreferences(context, base, title) {
    const setInterpreter = await pickYesNo(`${title}: usar como interprete del workspace?`, base.setInterpreter);
    if (setInterpreter === undefined) {
        return undefined;
    }
    const activateTerminal = await pickYesNo(`${title}: abrir terminal con entorno activado?`, base.activateTerminal);
    if (activateTerminal === undefined) {
        return undefined;
    }
    const installProjectDependencies = await pickYesNo(`${title}: instalar dependencias del proyecto?`, base.installProjectDependencies);
    if (installProjectDependencies === undefined) {
        return undefined;
    }
    const profilePick = await vscode.window.showQuickPick(CREATION_PROFILES.map(p => ({
        label: p.label,
        description: p.description,
        value: p.id
    })), {
        placeHolder: `${title}: perfil rapido de paquetes`,
        title
    });
    if (!profilePick) {
        return undefined;
    }
    return {
        setInterpreter,
        activateTerminal,
        installProjectDependencies,
        profileId: profilePick.value
    };
}
async function pickYesNo(prompt, defaultValue) {
    const yes = `Si${defaultValue ? ' (default)' : ''}`;
    const no = `No${!defaultValue ? ' (default)' : ''}`;
    const pick = await vscode.window.showQuickPick([yes, no], { placeHolder: prompt });
    if (!pick) {
        return undefined;
    }
    return pick.startsWith('Si');
}
function loadPostCreatePreferences(context) {
    const saved = context.globalState.get(POST_CREATE_PREFS_KEY);
    if (!saved) {
        return { ...DEFAULT_POST_CREATE_PREFS };
    }
    return {
        setInterpreter: saved.setInterpreter ?? DEFAULT_POST_CREATE_PREFS.setInterpreter,
        activateTerminal: saved.activateTerminal ?? DEFAULT_POST_CREATE_PREFS.activateTerminal,
        installProjectDependencies: saved.installProjectDependencies ?? DEFAULT_POST_CREATE_PREFS.installProjectDependencies,
        profileId: saved.profileId ?? DEFAULT_POST_CREATE_PREFS.profileId
    };
}
function hasProfilePackages(profileId) {
    const profile = CREATION_PROFILES.find(p => p.id === profileId);
    return !!profile?.packages.length;
}
async function installProfilePackages(manager, env, profileId) {
    const profile = CREATION_PROFILES.find(p => p.id === profileId);
    if (!profile || !profile.packages.length) {
        return;
    }
    const channel = vscode.window.createOutputChannel(`Perfil paquetes - ${env.name}`);
    channel.show(true);
    channel.appendLine(`# Instalando perfil ${profile.label} en ${env.name}`);
    channel.appendLine(`# Paquetes: ${profile.packages.join(', ')}`);
    channel.appendLine('');
    try {
        const out = await manager.runPip(env, ['install', ...profile.packages]);
        channel.append(out);
        vscode.window.showInformationMessage(`Perfil "${profile.label}" instalado en ${env.name}.`);
    }
    catch (err) {
        channel.appendLine(err.message);
        vscode.window.showErrorMessage(`Error instalando perfil "${profile.label}": ${err.message}`);
    }
}
async function installProjectDependencies(manager, env) {
    const channel = vscode.window.createOutputChannel(`Dependencias proyecto - ${env.name}`);
    channel.show(true);
    channel.appendLine(`# Instalando dependencias detectadas en ${env.name}`);
    channel.appendLine('');
    try {
        const out = await manager.installProjectDependencies(env);
        channel.appendLine(out || 'Sin salida.');
        vscode.window.showInformationMessage(`Dependencias del proyecto procesadas en ${env.name}.`);
    }
    catch (err) {
        channel.appendLine(err.message);
        vscode.window.showErrorMessage(`Error instalando dependencias del proyecto: ${err.message}`);
    }
}
async function safeDeleteEnv(manager, env) {
    const insideWorkspace = manager.isEnvInsideWorkspace(env);
    const deleteModeOptions = env.type === 'conda'
        ? ['Eliminar entorno conda', 'Cancelar']
        : ['Mover a papelera (recomendado)', 'Eliminar permanentemente', 'Cancelar'];
    if (!insideWorkspace) {
        const typed = await vscode.window.showInputBox({
            prompt: `El entorno esta fuera del workspace.\nEscribe "${env.name}" para confirmar eliminacion segura.`,
            ignoreFocusOut: true
        });
        if (typed !== env.name) {
            vscode.window.showWarningMessage('Confirmacion cancelada. No se elimino el entorno.');
            return;
        }
    }
    const mode = await vscode.window.showQuickPick(deleteModeOptions, {
        placeHolder: `Eliminar "${env.name}" (${env.type})`
    });
    if (!mode || mode === 'Cancelar') {
        return;
    }
    try {
        if (mode.startsWith('Mover')) {
            await manager.deleteEnv(env, { useTrash: true });
        }
        else {
            await manager.deleteEnv(env, { useTrash: false });
        }
        vscode.window.showInformationMessage(`Entorno ${env.name} eliminado.`);
    }
    catch (err) {
        if (mode.startsWith('Mover')) {
            const fallback = await vscode.window.showWarningMessage(`No se pudo mover a papelera (${err.message}). Deseas eliminar permanentemente?`, 'Eliminar permanentemente');
            if (fallback === 'Eliminar permanentemente') {
                try {
                    await manager.deleteEnv(env, { useTrash: false });
                    vscode.window.showInformationMessage(`Entorno ${env.name} eliminado permanentemente.`);
                    return;
                }
                catch (finalErr) {
                    vscode.window.showErrorMessage(`Error eliminando el entorno ${env.name}: ${finalErr.message}`);
                    return;
                }
            }
            return;
        }
        vscode.window.showErrorMessage(`Error eliminando el entorno ${env.name}: ${err.message}`);
    }
}
async function runDiagnostics(context, manager, showToastSummary) {
    const diagnostics = manager.getRuntimeDiagnostics();
    const channel = vscode.window.createOutputChannel('Easy Env Diagnostics');
    channel.clear();
    channel.appendLine('# Easy Env Diagnostics');
    channel.appendLine('');
    channel.appendLine(`Workspace: ${vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? 'N/A'}`);
    channel.appendLine(`Python CLI: ${diagnostics.pythonCommandAvailable ? 'OK' : 'MISSING'}`);
    channel.appendLine('');
    channel.appendLine('Managers:');
    channel.appendLine(`- venv: ${diagnostics.managers.venv ? 'OK' : 'MISSING'}`);
    channel.appendLine(`- uv: ${diagnostics.managers.uv ? 'OK' : 'MISSING'}`);
    channel.appendLine(`- conda: ${diagnostics.managers.conda ? 'OK' : 'MISSING'}`);
    channel.appendLine(`- poetry: ${diagnostics.managers.poetry ? 'OK' : 'MISSING'}`);
    channel.appendLine(`- pipenv: ${diagnostics.managers.pipenv ? 'OK' : 'MISSING'}`);
    channel.appendLine('');
    channel.appendLine(`Python extension (ms-python.python): ${isPythonExtensionInstalled() ? 'OK' : 'MISSING'}`);
    channel.appendLine('');
    channel.appendLine('Project signals:');
    channel.appendLine(`- recommended manager: ${diagnostics.project.recommendedManager}`);
    channel.appendLine(`- uv.lock: ${diagnostics.project.hasUvLock ? 'YES' : 'NO'}`);
    channel.appendLine(`- Pipfile: ${diagnostics.project.hasPipfile ? 'YES' : 'NO'}`);
    channel.appendLine(`- pyproject.toml: ${diagnostics.project.hasPyproject ? 'YES' : 'NO'}`);
    channel.appendLine(`- [tool.poetry]: ${diagnostics.project.hasPoetryConfig ? 'YES' : 'NO'}`);
    channel.appendLine(`- conda env file: ${diagnostics.project.hasCondaEnvFile ? 'YES' : 'NO'}`);
    channel.appendLine('');
    channel.appendLine('Dependency sources:');
    if (diagnostics.project.dependencySources.length) {
        for (const dep of diagnostics.project.dependencySources) {
            channel.appendLine(`- ${dep.label}`);
        }
    }
    else {
        channel.appendLine('- none detected');
    }
    channel.show(true);
    if (showToastSummary) {
        const missingManagers = Object.entries(diagnostics.managers)
            .filter(([_, ok]) => !ok)
            .map(([name]) => name);
        if (!diagnostics.pythonCommandAvailable) {
            vscode.window.showWarningMessage('Diagnostico: no se detecto comando python en PATH. venv y pip pueden fallar.');
        }
        else if (missingManagers.length) {
            const action = await vscode.window.showWarningMessage(`Diagnostico: faltan gestores (${missingManagers.join(', ')}).`, 'Instalar o configurar gestor');
            if (action === 'Instalar o configurar gestor') {
                await vscode.commands.executeCommand('easyenv.installManager');
            }
        }
        else {
            vscode.window.showInformationMessage('Diagnostico completo: entorno listo para trabajar.');
        }
    }
    await context.globalState.update(STARTUP_DIAGNOSTICS_KEY, true);
}
function maybeRunStartupDiagnostics(context, manager) {
    const alreadyShown = context.globalState.get(STARTUP_DIAGNOSTICS_KEY);
    if (alreadyShown) {
        return;
    }
    void runDiagnostics(context, manager, true);
}
function disablePythonAutoActivateOnFirstRun(context) {
    const alreadyDisabled = context.globalState.get(AUTO_DISABLE_PYTHON_KEY);
    if (alreadyDisabled) {
        return;
    }
    const pythonConfig = vscode.workspace.getConfiguration('python');
    const current = pythonConfig.get('terminal.activateEnvironment');
    if (current !== false) {
        void pythonConfig.update('terminal.activateEnvironment', false, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Easy Env: se desactivo la auto-activacion de Python en terminal (primera ejecucion).');
    }
    void context.globalState.update(AUTO_DISABLE_PYTHON_KEY, true);
}
function showFirstRunTip(context) {
    const shown = context.globalState.get(TIP_SHOWN_KEY);
    if (shown) {
        return;
    }
    vscode.window.showInformationMessage('Tip Easy Env: click derecho sobre un entorno para ver activar, paquetes, dependencias y eliminar.');
    void context.globalState.update(TIP_SHOWN_KEY, true);
}
async function showPipList(manager, targetEnv) {
    try {
        const pipOutput = await manager.getPipList(targetEnv);
        const channel = vscode.window.createOutputChannel(`Pip: ${targetEnv.name}`);
        channel.clear();
        channel.appendLine(`# pip list - entorno ${targetEnv.name}`);
        channel.appendLine('');
        channel.append(pipOutput);
        channel.show(true);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Error ejecutando pip list: ${err.message}`);
    }
}
async function setWorkspaceInterpreter(env) {
    await vscode.workspace
        .getConfiguration('python')
        .update('defaultInterpreterPath', env.pythonPath, vscode.ConfigurationTarget.Workspace);
}
async function refreshViews(manager, treeProvider, dashboardProvider, preloadedEnvs) {
    const envs = preloadedEnvs ?? (await manager.scanEnvs());
    treeProvider.refresh(envs);
    await dashboardProvider.refresh();
}
async function ensureEnvSelected(env, manager) {
    if (env) {
        return env;
    }
    const envsList = await manager.scanEnvs();
    if (!envsList.length) {
        vscode.window.showWarningMessage('No se encontraron entornos en esta carpeta.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(envsList.map(e => ({
        label: e.name,
        description: `${e.type} | ${e.version ?? e.pythonPath}`,
        env: e
    })), { placeHolder: 'Selecciona un entorno' });
    return pick?.env;
}
async function handleMissingManager(context, manager, managerType, forceInstallFromEasyEnv = false) {
    const suppressed = new Set(context.globalState.get(SUPPRESSED_MISSING_MANAGER_KEY) ?? []);
    const guidance = getManagerGuidance(managerType);
    if (forceInstallFromEasyEnv) {
        await installManagerFromEasyEnv(manager, managerType);
        return 'cancel';
    }
    if (suppressed.has(managerType)) {
        vscode.window.showWarningMessage(`No se encontro "${managerType}" ni en PATH ni en configuracion de Easy Env.`);
        return 'cancel';
    }
    const action = await vscode.window.showErrorMessage(`No se encontro "${managerType}" ni en PATH ni en configuracion de Easy Env.`, 'Instalar desde Easy Env', 'Seleccionar ejecutable', 'Copiar comando', 'Abrir docs', 'Usar venv', 'No mostrar este aviso');
    if (action === 'Instalar desde Easy Env') {
        await installManagerFromEasyEnv(manager, managerType);
        return 'cancel';
    }
    if (action === 'Seleccionar ejecutable') {
        await promptManagerExecutablePath(manager, managerType);
        return 'cancel';
    }
    if (action === 'Copiar comando') {
        if (guidance.installCommand) {
            await vscode.env.clipboard.writeText(guidance.installCommand);
            vscode.window.showInformationMessage(`Comando copiado. Ejecutalo en terminal y reinicia VS Code: ${guidance.installCommand}`);
        }
        else {
            vscode.window.showInformationMessage('Este gestor no tiene comando unico. Se abrira documentacion.');
            await vscode.env.openExternal(vscode.Uri.parse(guidance.docsUrl));
        }
        return 'cancel';
    }
    if (action === 'Abrir docs') {
        await vscode.env.openExternal(vscode.Uri.parse(guidance.docsUrl));
        return 'cancel';
    }
    if (action === 'No mostrar este aviso') {
        suppressed.add(managerType);
        await context.globalState.update(SUPPRESSED_MISSING_MANAGER_KEY, Array.from(suppressed));
        return 'cancel';
    }
    if (action === 'Usar venv') {
        return 'use-venv';
    }
    return 'cancel';
}
async function installManagerFromEasyEnv(manager, managerType) {
    const guidance = getManagerGuidance(managerType);
    if (guidance.installCommand) {
        runInstallCommandInTerminal(manager, managerType, guidance.installCommand, guidance.docsUrl);
        return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(guidance.docsUrl));
}
function runInstallCommandInTerminal(manager, managerType, command, docsUrl) {
    const terminal = vscode.window.createTerminal({ name: `Install ${managerType} (Easy Env)` });
    terminal.show(true);
    terminal.sendText(command);
    void vscode.window.showInformationMessage(`Easy Env inicio la instalacion de "${managerType}" en terminal integrada.`, 'Configurar ruta manual', 'Abrir docs').then(async (action) => {
        if (action === 'Configurar ruta manual') {
            await promptManagerExecutablePath(manager, managerType);
        }
        else if (action === 'Abrir docs') {
            await vscode.env.openExternal(vscode.Uri.parse(docsUrl));
        }
    });
}
function getManagerGuidance(managerType) {
    switch (managerType) {
        case 'uv':
            return {
                docsUrl: 'https://docs.astral.sh/uv/getting-started/installation/',
                installCommand: buildUserPipInstallCommand('uv')
            };
        case 'poetry':
            return {
                docsUrl: 'https://python-poetry.org/docs/#installation',
                installCommand: buildUserPipInstallCommand('poetry')
            };
        case 'pipenv':
            return {
                docsUrl: 'https://pipenv.pypa.io/en/latest/installation.html',
                installCommand: buildUserPipInstallCommand('pipenv')
            };
        case 'conda':
            if (process.platform === 'win32') {
                return {
                    docsUrl: 'https://docs.conda.io/projects/conda/en/latest/user-guide/install/windows.html',
                    installCommand: 'winget install -e --id Anaconda.Miniconda3 --accept-source-agreements --accept-package-agreements'
                };
            }
            if (process.platform === 'darwin') {
                return {
                    docsUrl: 'https://docs.conda.io/projects/conda/en/latest/user-guide/install/macos.html',
                    installCommand: 'brew install --cask miniconda'
                };
            }
            return {
                docsUrl: 'https://docs.conda.io/projects/conda/en/latest/user-guide/install/linux.html'
            };
        default:
            return { docsUrl: 'https://www.python.org/' };
    }
}
function buildUserPipInstallCommand(packageName) {
    if (process.platform === 'win32') {
        return [
            '$ok=$false',
            `if (Get-Command python -ErrorAction SilentlyContinue) { python -m pip install --user --upgrade ${packageName}; if ($LASTEXITCODE -eq 0) { $ok=$true } }`,
            `if (-not $ok -and (Get-Command py -ErrorAction SilentlyContinue)) { py -m pip install --user --upgrade ${packageName}; if ($LASTEXITCODE -eq 0) { $ok=$true } }`,
            `if (-not $ok -and (Get-Command pip -ErrorAction SilentlyContinue)) { pip install --user --upgrade ${packageName}; if ($LASTEXITCODE -eq 0) { $ok=$true } }`,
            'if (-not $ok) { Write-Error "No se encontro una instalacion util de Python/pip en PATH." }'
        ].join('; ');
    }
    if (process.platform === 'darwin') {
        return `python3 -m pip install --user --upgrade ${packageName}`;
    }
    return `python3 -m pip install --user --upgrade ${packageName}`;
}
async function pickExternalManager() {
    const pick = await vscode.window.showQuickPick([
        {
            label: 'uv',
            description: 'Rapido para crear/gestionar virtualenv',
            value: 'uv'
        },
        {
            label: 'conda',
            description: 'Miniconda / Anaconda',
            value: 'conda'
        },
        {
            label: 'poetry',
            description: 'Gestor pyproject.toml',
            value: 'poetry'
        },
        {
            label: 'pipenv',
            description: 'Gestor Pipfile',
            value: 'pipenv'
        }
    ], { placeHolder: 'Selecciona el gestor a instalar o configurar en Easy Env' });
    return pick?.value;
}
async function promptManagerExecutablePath(manager, managerType) {
    const settingKey = getManagerPathSettingKey(managerType);
    const filters = process.platform === 'win32'
        ? { Ejecutables: ['exe', 'cmd', 'bat'] }
        : undefined;
    const selected = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: `Usar ${managerType}`,
        title: `Selecciona el ejecutable de ${managerType}`,
        filters
    });
    if (!selected?.length) {
        return;
    }
    const executablePath = selected[0].fsPath;
    await vscode.workspace
        .getConfiguration('easyenv')
        .update(settingKey, executablePath, vscode.ConfigurationTarget.Global);
    manager.refreshCommandCache();
    const available = manager.isManagerAvailable(managerType);
    if (available) {
        vscode.window.showInformationMessage(`Ruta guardada en easyenv.${settingKey}. "${managerType}" ya esta disponible en Easy Env.`);
        return;
    }
    vscode.window.showWarningMessage(`Ruta guardada en easyenv.${settingKey}, pero "${managerType}" aun no se detecta. Revisa que sea el ejecutable correcto.`);
}
function getManagerPathSettingKey(managerType) {
    switch (managerType) {
        case 'conda':
            return 'condaPath';
        case 'uv':
            return 'uvPath';
        case 'poetry':
            return 'poetryPath';
        case 'pipenv':
            return 'pipenvPath';
        default:
            return 'condaPath';
    }
}
async function waitForCreatedEnv(manager, beforeEnvs, expectedType, expectedPath, expectedName) {
    let latestEnvs = await manager.scanEnvs();
    let created = findCreatedEnv(beforeEnvs, latestEnvs, expectedType, expectedPath, expectedName);
    if (created) {
        return { envs: latestEnvs, created };
    }
    // Conda/poetry/pipenv pueden tardar unos segundos en quedar visibles.
    for (let i = 0; i < 4; i += 1) {
        await delay(700);
        latestEnvs = await manager.scanEnvs();
        created = findCreatedEnv(beforeEnvs, latestEnvs, expectedType, expectedPath, expectedName);
        if (created) {
            return { envs: latestEnvs, created };
        }
    }
    return { envs: latestEnvs, created: undefined };
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function isCondaTermsError(message) {
    return (/CondaToSNonInteractiveError/i.test(message) ||
        /Terms of Service have not been accepted/i.test(message) ||
        /conda tos accept/i.test(message));
}
async function handleCondaTermsError(manager, rawMessage) {
    const channels = extractCondaChannels(rawMessage);
    const choice = await vscode.window.showErrorMessage('Conda requiere aceptar Terms of Service de canales antes de crear el entorno.', 'Aceptar ToS en terminal', 'Abrir docs');
    if (choice === 'Abrir docs') {
        await vscode.env.openExternal(vscode.Uri.parse('https://www.anaconda.com/docs/tools/working-with-conda/channels'));
        return;
    }
    if (choice !== 'Aceptar ToS en terminal') {
        return;
    }
    const condaExe = manager.getManagerExecutable('conda');
    const runConda = condaExe ? `& "${condaExe}"` : 'conda';
    const terminal = vscode.window.createTerminal({ name: 'Conda ToS Accept' });
    terminal.show(true);
    for (const channel of channels) {
        terminal.sendText(`${runConda} tos accept --override-channels --channel "${channel}"`);
    }
    vscode.window.showInformationMessage('Se enviaron comandos para aceptar ToS en terminal. Cuando terminen, vuelve a crear el entorno conda.');
}
function extractCondaChannels(message) {
    const urls = message.match(/https?:\/\/[^\s]+/gi) ?? [];
    const cleaned = urls
        .map(url => url.replace(/[)\],.;-]+$/g, '').trim())
        .filter(url => /^https?:\/\/repo\.anaconda\.com\/pkgs\//i.test(url));
    const unique = [];
    for (const url of cleaned) {
        if (!unique.includes(url)) {
            unique.push(url);
        }
    }
    if (!unique.length) {
        return [
            'https://repo.anaconda.com/pkgs/main',
            'https://repo.anaconda.com/pkgs/r',
            'https://repo.anaconda.com/pkgs/msys2'
        ];
    }
    return unique;
}
function findCreatedEnv(beforeEnvs, afterEnvs, expectedType, expectedPath, expectedName) {
    if (expectedPath) {
        const expectedNormalized = normalizePathForCompare(expectedPath);
        const byPath = afterEnvs.find(e => normalizePathForCompare(e.path) === expectedNormalized);
        if (byPath) {
            return byPath;
        }
    }
    const beforePathSet = new Set(beforeEnvs.map(e => normalizePathForCompare(e.path)));
    const addedEnvs = afterEnvs.filter(e => !beforePathSet.has(normalizePathForCompare(e.path)));
    const addedByType = addedEnvs.filter(e => e.type === expectedType);
    if (expectedName) {
        const byNameAndType = addedByType.find(e => e.name === expectedName);
        if (byNameAndType) {
            return byNameAndType;
        }
    }
    if (addedByType.length === 1) {
        return addedByType[0];
    }
    if (addedEnvs.length === 1) {
        return addedEnvs[0];
    }
    if (expectedName) {
        const expectedNormalizedName = path.basename(expectedName);
        const byNameAny = afterEnvs.find(e => path.basename(e.name) === expectedNormalizedName && e.type === expectedType);
        if (byNameAny) {
            return byNameAny;
        }
    }
    return afterEnvs.find(e => e.type === expectedType);
}
function normalizePathForCompare(inputPath) {
    const normalized = path.normalize(inputPath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function isPythonExtensionInstalled() {
    return !!vscode.extensions.getExtension('ms-python.python');
}
function deactivate() { }
//# sourceMappingURL=extension.js.map