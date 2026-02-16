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
exports.EnvManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const MANAGER_PATH_SETTING_KEY = {
    conda: 'condaPath',
    uv: 'uvPath',
    poetry: 'poetryPath',
    pipenv: 'pipenvPath'
};
class EnvManager {
    workspaceRoot;
    commandAvailability = new Map();
    commandPathCache = new Map();
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    // ESCANEAR ENTORNOS (venv / conda / poetry / pipenv / uv)
    async scanEnvs() {
        const envMap = new Map();
        const addOrUpdateEnv = (env) => {
            const key = this.normalizeForCompare(env.path);
            const existing = envMap.get(key);
            if (!existing || this.getTypePriority(env.type) >= this.getTypePriority(existing.type)) {
                envMap.set(key, env);
            }
        };
        for (const env of this.detectWorkspaceEnvs()) {
            addOrUpdateEnv(env);
        }
        for (const env of this.detectUvEnvs()) {
            addOrUpdateEnv(env);
        }
        for (const env of this.detectPoetryEnvs()) {
            addOrUpdateEnv(env);
        }
        for (const env of this.detectPipenvEnvs()) {
            addOrUpdateEnv(env);
        }
        for (const env of this.detectCondaEnvs()) {
            addOrUpdateEnv(env);
        }
        const pythonConfig = vscode.workspace.getConfiguration('python');
        const currentInterpreter = pythonConfig.get('defaultInterpreterPath');
        if (currentInterpreter) {
            const inferred = this.inferEnvFromInterpreter(currentInterpreter);
            if (inferred) {
                addOrUpdateEnv(inferred);
            }
        }
        const envs = Array.from(envMap.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        if (currentInterpreter) {
            const currentNormalized = this.normalizeForCompare(currentInterpreter);
            for (const env of envs) {
                env.isActive = this.normalizeForCompare(env.pythonPath) === currentNormalized;
            }
        }
        else {
            for (const env of envs) {
                env.isActive = false;
            }
        }
        return envs;
    }
    detectProjectContext() {
        const pyprojectPath = path.join(this.workspaceRoot, 'pyproject.toml');
        const pipfilePath = path.join(this.workspaceRoot, 'Pipfile');
        const uvLockPath = path.join(this.workspaceRoot, 'uv.lock');
        const condaCandidates = [
            path.join(this.workspaceRoot, 'environment.yml'),
            path.join(this.workspaceRoot, 'environment.yaml'),
            path.join(this.workspaceRoot, 'conda.yml'),
            path.join(this.workspaceRoot, 'conda.yaml')
        ];
        const hasUvLock = fs.existsSync(uvLockPath);
        const hasPipfile = fs.existsSync(pipfilePath);
        const hasPyproject = fs.existsSync(pyprojectPath);
        const hasPoetryConfig = hasPyproject && this.fileContains(pyprojectPath, /\[tool\.poetry\]/);
        const hasCondaEnvFile = condaCandidates.some(file => fs.existsSync(file));
        const dependencySources = [];
        const requirementsCandidates = [
            'requirements.txt',
            'requirements-dev.txt',
            'requirements-dev.in',
            'requirements/base.txt'
        ];
        for (const relPath of requirementsCandidates) {
            const absPath = path.join(this.workspaceRoot, relPath);
            if (fs.existsSync(absPath)) {
                dependencySources.push({
                    kind: 'requirements',
                    label: relPath,
                    args: ['install', '-r', absPath]
                });
            }
        }
        if (hasPyproject) {
            dependencySources.push({
                kind: 'editable',
                label: 'pyproject.toml (editable)',
                args: ['install', '-e', '.']
            });
        }
        let recommendedManager = 'venv';
        if (hasUvLock) {
            recommendedManager = 'uv';
        }
        else if (hasPipfile) {
            recommendedManager = 'pipenv';
        }
        else if (hasPoetryConfig) {
            recommendedManager = 'poetry';
        }
        else if (hasCondaEnvFile) {
            recommendedManager = 'conda';
        }
        return {
            hasUvLock,
            hasPipfile,
            hasPyproject,
            hasPoetryConfig,
            hasCondaEnvFile,
            dependencySources,
            recommendedManager
        };
    }
    getRuntimeDiagnostics() {
        const pythonCommandAvailable = this.commandExists('python') || (process.platform === 'win32' && this.commandExists('py'));
        return {
            pythonCommandAvailable,
            managers: {
                venv: pythonCommandAvailable,
                uv: this.commandExists('uv'),
                conda: this.commandExists('conda'),
                poetry: this.commandExists('poetry'),
                pipenv: this.commandExists('pipenv')
            },
            project: this.detectProjectContext()
        };
    }
    // CREAR ENTORNO VENV
    async createVenv(name) {
        const envPath = this.resolveWorkspaceEnvPath(name);
        const pythonCommand = this.resolveCommandPath('python') ?? this.resolveCommandPath('py');
        if (!pythonCommand) {
            throw new Error('No se encontro comando python/py para crear el entorno venv.');
        }
        vscode.window.showInformationMessage(`Creando entorno venv en ${path.basename(envPath)}...`);
        await this.execFileCommand(pythonCommand, ['-m', 'venv', envPath], this.workspaceRoot);
        vscode.window.showInformationMessage(`Entorno ${path.basename(envPath)} creado con exito.`);
        return envPath;
    }
    // CREAR ENTORNO UV
    async createUvEnv(name) {
        this.ensureCommand('uv');
        const envPath = this.resolveWorkspaceEnvPath(name);
        vscode.window.showInformationMessage(`Creando entorno uv en ${path.basename(envPath)}...`);
        await this.execCommandByCommand('uv', ['venv', envPath], this.workspaceRoot);
        vscode.window.showInformationMessage(`Entorno ${path.basename(envPath)} creado con exito (uv).`);
        return envPath;
    }
    // CREAR ENTORNO CONDA (SIEMPRE CON --prefix DENTRO DEL WORKSPACE)
    async createCondaEnv(name, pythonVersion) {
        this.ensureCommand('conda');
        const envPath = this.resolveWorkspaceEnvPath(name);
        vscode.window.showInformationMessage(`Creando entorno conda en ${path.basename(envPath)}...`);
        const args = ['create', '-y', '--prefix', envPath];
        if (pythonVersion?.trim()) {
            args.push(`python=${pythonVersion.trim()}`);
        }
        else {
            args.push('python');
        }
        await this.execCommandByCommand('conda', args, this.workspaceRoot);
        vscode.window.showInformationMessage(`Entorno ${path.basename(envPath)} creado con exito (conda).`);
        return envPath;
    }
    // CREAR ENTORNO POETRY
    async createPoetryEnv(inProject) {
        this.ensureCommand('poetry');
        const pyprojectPath = path.join(this.workspaceRoot, 'pyproject.toml');
        if (!fs.existsSync(pyprojectPath)) {
            throw new Error('No se encontro pyproject.toml. Poetry requiere ese archivo para crear el entorno.');
        }
        const localMode = inProject ? 'true' : 'false';
        await this.execCommandByCommand('poetry', ['config', 'virtualenvs.in-project', localMode, '--local'], this.workspaceRoot);
        vscode.window.showInformationMessage('Creando entorno poetry...');
        await this.execCommandByCommand('poetry', ['env', 'use', 'python'], this.workspaceRoot);
        vscode.window.showInformationMessage('Entorno creado con exito (poetry).');
        if (inProject) {
            return path.join(this.workspaceRoot, '.venv');
        }
        return undefined;
    }
    // CREAR ENTORNO PIPENV
    async createPipenvEnv(inProject) {
        this.ensureCommand('pipenv');
        vscode.window.showInformationMessage('Creando entorno pipenv...');
        await this.execCommandByCommand('pipenv', ['--python', 'python'], this.workspaceRoot, inProject ? { PIPENV_VENV_IN_PROJECT: '1' } : undefined);
        vscode.window.showInformationMessage('Entorno creado con exito (pipenv).');
        if (inProject) {
            return path.join(this.workspaceRoot, '.venv');
        }
        return undefined;
    }
    async installProjectDependencies(env) {
        const sources = this.detectProjectContext().dependencySources;
        if (!sources.length) {
            return 'No se detectaron archivos de dependencias.';
        }
        let output = '';
        for (const source of sources) {
            output += `\n# ${source.label}\n`;
            try {
                const result = await this.runPip(env, source.args);
                output += result;
            }
            catch (err) {
                output += `${err.message}\n`;
            }
        }
        return output.trim();
    }
    // ACTIVAR ENTORNO EN TERMINAL
    activateEnv(env) {
        const terminal = vscode.window.createTerminal({
            name: `Env: ${env.name}`,
            cwd: this.workspaceRoot
        });
        if (env.type === 'conda') {
            if (process.platform === 'win32') {
                const condaExe = this.resolveCommandPath('conda');
                if (condaExe) {
                    terminal.sendText(`& "${condaExe}" "shell.powershell" "hook" | Out-String | Invoke-Expression`);
                }
            }
            terminal.sendText(`conda activate "${env.path}"`);
            terminal.show();
            return;
        }
        if (process.platform === 'win32') {
            const scriptPath = path.join(env.path, 'Scripts', 'Activate.ps1');
            if (!fs.existsSync(scriptPath)) {
                vscode.window.showErrorMessage(`No se encontro el script de activacion para ${env.name}.`);
                return;
            }
            const setPrompt = `$env:VIRTUAL_ENV_PROMPT = "(${env.name})"`;
            const activate = `& "${scriptPath}"`;
            terminal.sendText(setPrompt);
            terminal.sendText(activate);
        }
        else {
            const scriptPath = path.join(env.path, 'bin', 'activate');
            if (!fs.existsSync(scriptPath)) {
                vscode.window.showErrorMessage(`No se encontro el script de activacion para ${env.name}.`);
                return;
            }
            const cmd = `VIRTUAL_ENV_PROMPT="(${env.name})" source "${scriptPath}"`;
            terminal.sendText(cmd);
        }
        terminal.show();
    }
    // OBTENER PIP LIST (para mostrar paquetes)
    async getPipList(env) {
        return this.execFileCommand(env.pythonPath, ['-m', 'pip', 'list'], this.workspaceRoot);
    }
    // EJECUTAR PIP CON ARGUMENTOS (instalar / desinstalar)
    async runPip(env, args) {
        return this.execFileCommand(env.pythonPath, ['-m', 'pip', ...args], this.workspaceRoot);
    }
    async deleteEnv(env, options) {
        if (env.type === 'conda') {
            if (!this.commandExists('conda')) {
                throw new Error('No se encontro el comando conda. Elimina este entorno manualmente o agrega conda al PATH.');
            }
            await this.execCommandByCommand('conda', ['env', 'remove', '--prefix', env.path, '-y'], this.workspaceRoot);
            return;
        }
        if (!this.isPathInsideWorkspace(env.path) && (env.type === 'poetry' || env.type === 'pipenv')) {
            throw new Error(`Por seguridad, Easy Env no elimina automaticamente entornos ${env.type} fuera del workspace.`);
        }
        if (options?.useTrash) {
            await vscode.workspace.fs.delete(vscode.Uri.file(env.path), { recursive: true, useTrash: true });
            return;
        }
        await fs.promises.rm(env.path, { recursive: true, force: true });
    }
    isManagerAvailable(manager) {
        const diagnostics = this.getRuntimeDiagnostics();
        return diagnostics.managers[manager];
    }
    getManagerExecutable(manager) {
        switch (manager) {
            case 'venv':
                return this.resolveCommandPath('python') ?? this.resolveCommandPath('py');
            case 'uv':
            case 'conda':
            case 'poetry':
            case 'pipenv':
                return this.resolveCommandPath(manager);
            default:
                return undefined;
        }
    }
    refreshCommandCache() {
        this.commandAvailability.clear();
        this.commandPathCache.clear();
    }
    isEnvInsideWorkspace(env) {
        return this.isPathInsideWorkspace(env.path);
    }
    detectWorkspaceEnvs() {
        const envs = [];
        let entries = [];
        try {
            entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });
        }
        catch {
            return envs;
        }
        const hasUvLock = fs.existsSync(path.join(this.workspaceRoot, 'uv.lock'));
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const envDir = path.join(this.workspaceRoot, entry.name);
            const pythonPath = this.resolvePythonPath(envDir);
            if (!pythonPath) {
                continue;
            }
            let type = 'venv';
            if (fs.existsSync(path.join(envDir, 'conda-meta'))) {
                type = 'conda';
            }
            else if (entry.name === '.venv' && hasUvLock) {
                type = 'uv';
            }
            envs.push(this.createPythonEnv(entry.name, type, envDir, pythonPath));
        }
        return envs;
    }
    detectCondaEnvs() {
        const envs = [];
        if (!this.commandExists('conda')) {
            return envs;
        }
        const listOut = this.runCommandByCommand('conda', ['env', 'list', '--json'], this.workspaceRoot);
        if (!listOut) {
            return envs;
        }
        const infoOut = this.runCommandByCommand('conda', ['info', '--json'], this.workspaceRoot);
        let rootPrefix;
        if (infoOut) {
            try {
                rootPrefix = JSON.parse(infoOut).root_prefix;
            }
            catch {
                rootPrefix = undefined;
            }
        }
        let parsed;
        try {
            parsed = JSON.parse(listOut);
        }
        catch {
            return envs;
        }
        for (const envDirRaw of parsed.envs ?? []) {
            const envDir = envDirRaw.trim();
            if (!envDir) {
                continue;
            }
            if (rootPrefix && this.normalizeForCompare(envDir) === this.normalizeForCompare(rootPrefix)) {
                continue;
            }
            const pythonPath = this.resolvePythonPath(envDir);
            if (!pythonPath) {
                continue;
            }
            const envName = path.basename(envDir);
            envs.push(this.createPythonEnv(envName || envDir, 'conda', envDir, pythonPath));
        }
        return envs;
    }
    detectPoetryEnvs() {
        const envs = [];
        const pyprojectPath = path.join(this.workspaceRoot, 'pyproject.toml');
        if (!fs.existsSync(pyprojectPath) || !this.commandExists('poetry')) {
            return envs;
        }
        const listOut = this.runCommandByCommand('poetry', ['env', 'list', '--full-path'], this.workspaceRoot);
        if (!listOut) {
            return envs;
        }
        const lines = listOut
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        for (const rawLine of lines) {
            const envDir = rawLine.replace(/\s+\([^)]+\)\s*$/, '').trim();
            if (!envDir || !path.isAbsolute(envDir)) {
                continue;
            }
            const pythonPath = this.resolvePythonPath(envDir);
            if (!pythonPath) {
                continue;
            }
            const envName = path.basename(envDir);
            envs.push(this.createPythonEnv(envName || envDir, 'poetry', envDir, pythonPath));
        }
        return envs;
    }
    detectPipenvEnvs() {
        const envs = [];
        const pipfilePath = path.join(this.workspaceRoot, 'Pipfile');
        if (!fs.existsSync(pipfilePath) || !this.commandExists('pipenv')) {
            return envs;
        }
        const venvOut = this.runCommandByCommand('pipenv', ['--venv'], this.workspaceRoot);
        if (!venvOut) {
            return envs;
        }
        const envDir = venvOut
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(Boolean);
        if (!envDir || !path.isAbsolute(envDir)) {
            return envs;
        }
        const pythonPath = this.resolvePythonPath(envDir);
        if (!pythonPath) {
            return envs;
        }
        const envName = path.basename(envDir);
        envs.push(this.createPythonEnv(envName || envDir, 'pipenv', envDir, pythonPath));
        return envs;
    }
    detectUvEnvs() {
        const envs = [];
        if (!this.workspaceUsesUv()) {
            return envs;
        }
        const uvEnvDir = path.join(this.workspaceRoot, '.venv');
        const pythonPath = this.resolvePythonPath(uvEnvDir);
        if (!pythonPath) {
            return envs;
        }
        envs.push(this.createPythonEnv('.venv', 'uv', uvEnvDir, pythonPath));
        return envs;
    }
    inferEnvFromInterpreter(interpreterPath) {
        const normalizedInterpreter = path.normalize(interpreterPath);
        const binDir = path.dirname(normalizedInterpreter);
        const binName = path.basename(binDir).toLowerCase();
        const execName = path.basename(normalizedInterpreter).toLowerCase();
        let envDir;
        if (process.platform === 'win32' && binName === 'scripts' && execName === 'python.exe') {
            envDir = path.dirname(binDir);
        }
        else if (process.platform === 'win32' && execName === 'python.exe') {
            // Conda puede usar <env>\\python.exe como interprete.
            envDir = binDir;
        }
        else if ((execName === 'python' || execName === 'python3') && binName === 'bin') {
            envDir = path.dirname(binDir);
        }
        if (!envDir || !fs.existsSync(envDir)) {
            return undefined;
        }
        let type = 'venv';
        if (fs.existsSync(path.join(envDir, 'conda-meta'))) {
            type = 'conda';
        }
        else if (this.workspaceUsesUv() &&
            this.normalizeForCompare(envDir) === this.normalizeForCompare(path.join(this.workspaceRoot, '.venv'))) {
            type = 'uv';
        }
        return this.createPythonEnv(path.basename(envDir) || envDir, type, envDir, normalizedInterpreter);
    }
    workspaceUsesUv() {
        if (fs.existsSync(path.join(this.workspaceRoot, 'uv.lock'))) {
            return true;
        }
        const pyprojectPath = path.join(this.workspaceRoot, 'pyproject.toml');
        return this.fileContains(pyprojectPath, /\[tool\.uv\]/);
    }
    createPythonEnv(name, type, envDir, pythonPath) {
        return {
            name,
            type,
            path: envDir,
            pythonPath,
            version: this.getPythonVersion(pythonPath),
            isActive: false
        };
    }
    resolvePythonPath(envDir) {
        const candidates = process.platform === 'win32'
            ? [
                // Conda en Windows suele tener python.exe en la raiz del entorno.
                path.join(envDir, 'python.exe'),
                path.join(envDir, 'Scripts', 'python.exe')
            ]
            : [path.join(envDir, 'bin', 'python'), path.join(envDir, 'bin', 'python3')];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
    getPythonVersion(pythonPath) {
        const out = this.runCommand(`"${pythonPath}" --version`, this.workspaceRoot);
        return out ? out.trim() : undefined;
    }
    runCommand(command, cwd) {
        try {
            return (0, child_process_1.execSync)(command, {
                cwd,
                encoding: 'utf8',
                timeout: 3000,
                stdio: ['ignore', 'pipe', 'pipe']
            }).trim();
        }
        catch {
            return undefined;
        }
    }
    runCommandByCommand(command, args, cwd) {
        const resolved = this.resolveCommandPath(command);
        if (!resolved) {
            return undefined;
        }
        return this.runFileCommand(resolved, args, cwd);
    }
    runFileCommand(file, args, cwd) {
        try {
            return (0, child_process_1.execSync)(`"${file}" ${args.map(arg => this.quoteArg(arg)).join(' ')}`, {
                cwd,
                encoding: 'utf8',
                timeout: 3000,
                stdio: ['ignore', 'pipe', 'pipe']
            }).trim();
        }
        catch {
            return undefined;
        }
    }
    commandExists(command) {
        const cached = this.commandAvailability.get(command);
        if (cached === true) {
            return true;
        }
        const exists = !!this.resolveCommandPath(command);
        this.commandAvailability.set(command, exists);
        return exists;
    }
    resolveCommandPath(command) {
        if (this.commandPathCache.has(command)) {
            const cached = this.commandPathCache.get(command);
            if (cached) {
                return cached;
            }
        }
        let resolved = this.resolveFromPath(command);
        if (!resolved) {
            resolved = this.resolveConfiguredCommandPath(command);
        }
        if (!resolved) {
            resolved = this.resolveFallbackCommandPath(command);
        }
        this.commandPathCache.set(command, resolved);
        return resolved;
    }
    resolveFromPath(command) {
        const lookupCmd = process.platform === 'win32' ? `where ${command}` : `command -v ${command}`;
        const out = this.runCommand(lookupCmd, this.workspaceRoot);
        if (!out) {
            return undefined;
        }
        const firstLine = out
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(Boolean);
        if (!firstLine) {
            return undefined;
        }
        return firstLine;
    }
    resolveConfiguredCommandPath(command) {
        const settingKey = this.getManagerPathSettingKey(command);
        if (!settingKey) {
            return undefined;
        }
        const configuredPath = vscode.workspace.getConfiguration('easyenv').get(settingKey)?.trim();
        if (configuredPath && fs.existsSync(configuredPath)) {
            return configuredPath;
        }
        return undefined;
    }
    getManagerPathSettingKey(command) {
        if (command === 'conda' || command === 'uv' || command === 'poetry' || command === 'pipenv') {
            return MANAGER_PATH_SETTING_KEY[command];
        }
        return undefined;
    }
    resolveFallbackCommandPath(command) {
        switch (command) {
            case 'conda':
                return this.resolveCondaFallbackPath();
            case 'uv':
            case 'poetry':
            case 'pipenv':
                return this.resolveUserBinaryFallbackPath(command);
            default:
                return undefined;
        }
    }
    resolveCondaFallbackPath() {
        const condaExeEnv = process.env.CONDA_EXE;
        if (condaExeEnv && fs.existsSync(condaExeEnv)) {
            return condaExeEnv;
        }
        const candidates = process.platform === 'win32'
            ? [
                path.join(process.env.USERPROFILE ?? '', 'miniconda3', 'Scripts', 'conda.exe'),
                path.join(process.env.USERPROFILE ?? '', 'anaconda3', 'Scripts', 'conda.exe'),
                path.join(process.env.LOCALAPPDATA ?? '', 'miniconda3', 'Scripts', 'conda.exe'),
                path.join(process.env.LOCALAPPDATA ?? '', 'anaconda3', 'Scripts', 'conda.exe'),
                path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Miniconda3', 'Scripts', 'conda.exe'),
                path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Anaconda3', 'Scripts', 'conda.exe')
            ]
            : [
                path.join(process.env.HOME ?? '', 'miniconda3', 'bin', 'conda'),
                path.join(process.env.HOME ?? '', 'anaconda3', 'bin', 'conda'),
                '/opt/miniconda3/bin/conda',
                '/opt/anaconda3/bin/conda'
            ];
        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
    resolveUserBinaryFallbackPath(command) {
        const executableName = process.platform === 'win32' ? `${command}.exe` : command;
        const candidates = process.platform === 'win32'
            ? [
                ...this.resolveWindowsPythonUserScriptsExecutables(executableName),
                path.join(process.env.USERPROFILE ?? '', '.local', 'bin', executableName),
                path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin', executableName)
            ]
            : [
                path.join(process.env.HOME ?? '', '.local', 'bin', executableName),
                '/opt/homebrew/bin/'.concat(executableName),
                '/usr/local/bin/'.concat(executableName)
            ];
        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
    resolveWindowsPythonUserScriptsExecutables(executableName) {
        const roots = [
            path.join(process.env.APPDATA ?? '', 'Python'),
            path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python')
        ];
        const matches = [];
        for (const root of roots) {
            if (!root || !fs.existsSync(root)) {
                continue;
            }
            try {
                const entries = fs.readdirSync(root, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory() || !/^python/i.test(entry.name)) {
                        continue;
                    }
                    matches.push(path.join(root, entry.name, 'Scripts', executableName));
                }
            }
            catch {
                // Ignora errores de lectura en rutas de usuario.
            }
        }
        return matches;
    }
    fileContains(filePath, pattern) {
        if (!fs.existsSync(filePath)) {
            return false;
        }
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return pattern.test(content);
        }
        catch {
            return false;
        }
    }
    normalizeForCompare(p) {
        const normalized = path.normalize(p);
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }
    getTypePriority(type) {
        switch (type) {
            case 'conda':
                return 50;
            case 'poetry':
            case 'pipenv':
                return 40;
            case 'uv':
                return 30;
            case 'venv':
            default:
                return 10;
        }
    }
    isPathInsideWorkspace(candidatePath) {
        const relative = path.relative(this.workspaceRoot, candidatePath);
        if (!relative) {
            return true;
        }
        return !relative.startsWith('..') && !path.isAbsolute(relative);
    }
    resolveWorkspaceEnvPath(name) {
        const trimmed = name.trim();
        if (path.isAbsolute(trimmed)) {
            return path.normalize(trimmed);
        }
        return path.normalize(path.join(this.workspaceRoot, trimmed));
    }
    ensureCommand(command) {
        if (!this.commandExists(command)) {
            const settingKey = this.getManagerPathSettingKey(command);
            const extra = settingKey
                ? ` Puedes configurar una ruta manual en "easyenv.${settingKey}".`
                : '';
            throw new Error(`No se encontro el comando ${command}. Instala ${command} o agregalo al PATH para crear este entorno.${extra}`);
        }
    }
    async execCommandByCommand(command, args, cwd, extraEnv) {
        const resolved = this.resolveCommandPath(command);
        if (!resolved) {
            throw new Error(`No se encontro el comando ${command}.`);
        }
        return this.execFileCommand(resolved, args, cwd, extraEnv);
    }
    execCommand(command, cwd, extraEnv) {
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(command, {
                cwd,
                env: extraEnv ? { ...process.env, ...extraEnv } : process.env
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                }
                else {
                    resolve(stdout || stderr);
                }
            });
        });
    }
    quoteArg(arg) {
        const escaped = arg.replace(/\"/g, '\\"');
        return `"${escaped}"`;
    }
    execFileCommand(file, args, cwd, extraEnv) {
        return new Promise((resolve, reject) => {
            (0, child_process_1.execFile)(file, args, {
                cwd,
                env: extraEnv ? { ...process.env, ...extraEnv } : process.env
            }, (err, stdout, stderr) => {
                if (err) {
                    reject(new Error(stderr || err.message));
                }
                else {
                    resolve(stdout || stderr);
                }
            });
        });
    }
}
exports.EnvManager = EnvManager;
//# sourceMappingURL=envManager.js.map