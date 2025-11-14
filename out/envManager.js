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
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
class EnvManager {
    workspaceRoot;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    // ESCANEAR ENTORNOS EN LA RAÍZ DEL WORKSPACE
    async scanEnvs() {
        const envs = [];
        const entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const envDir = path.join(this.workspaceRoot, entry.name);
            // Detectar ejecutable Python (Windows / Linux / macOS)
            const winPython = path.join(envDir, 'Scripts', 'python.exe');
            const nixPython = path.join(envDir, 'bin', 'python');
            const nixPython3 = path.join(envDir, 'bin', 'python3');
            let pythonPath = '';
            if (fs.existsSync(winPython))
                pythonPath = winPython;
            else if (fs.existsSync(nixPython))
                pythonPath = nixPython;
            else if (fs.existsSync(nixPython3))
                pythonPath = nixPython3;
            if (!pythonPath)
                continue;
            // Obtener versión de Python
            let version;
            try {
                const out = (0, child_process_1.execSync)(`"${pythonPath}" --version`, {
                    encoding: 'utf8'
                });
                version = out.trim(); // Ej: "Python 3.11.9"
            }
            catch {
                version = undefined;
            }
            envs.push({
                name: entry.name,
                type: 'venv',
                path: envDir,
                pythonPath,
                version,
                isActive: false
            });
        }
        // Marcar activo según intérprete del workspace
        const pythonConfig = vscode.workspace.getConfiguration('python');
        const currentInterpreter = pythonConfig.get('defaultInterpreterPath');
        if (currentInterpreter) {
            for (const env of envs) {
                env.isActive = env.pythonPath === currentInterpreter;
            }
        }
        return envs;
    }
    // CREAR ENTORNO VENV
    async createVenv(name) {
        vscode.window.showInformationMessage(`Creando entorno ${name}...`);
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(`python -m venv "${name}"`, { cwd: this.workspaceRoot }, (err) => {
                if (err) {
                    vscode.window.showErrorMessage(`Error creando venv: ${err.message}`);
                    reject(err);
                }
                else {
                    vscode.window.showInformationMessage(`Entorno ${name} creado con éxito.`);
                    resolve();
                }
            });
        });
    }
    // ACTIVAR ENTORNO EN TERMINAL
    activateEnv(env) {
        const terminal = vscode.window.createTerminal({
            name: `Env: ${env.name}`,
            cwd: this.workspaceRoot
        });
        if (process.platform === 'win32') {
            const scriptPath = `${env.path}\\Scripts\\Activate.ps1`;
            // Forzamos el nombre que verá el usuario en el prompt
            const setPrompt = `$env:VIRTUAL_ENV_PROMPT = "(${env.name})"`;
            const activate = `& "${scriptPath}"`;
            terminal.sendText(setPrompt);
            terminal.sendText(activate);
        }
        else {
            const scriptPath = `${env.path}/bin/activate`;
            // En shells tipo bash/zsh también existe VIRTUAL_ENV_PROMPT
            const cmd = `VIRTUAL_ENV_PROMPT="(${env.name})" source "${scriptPath}"`;
            terminal.sendText(cmd);
        }
        terminal.show();
    }
    // OBTENER PIP LIST (para mostrar paquetes)
    async getPipList(env) {
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(`"${env.pythonPath}" -m pip list`, { cwd: this.workspaceRoot }, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(stdout || stderr);
                }
            });
        });
    }
    // EJECUTAR PIP CON ARGUMENTOS (instalar / desinstalar)
    async runPip(env, args) {
        const cmd = `"${env.pythonPath}" -m pip ${args.join(' ')}`;
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(cmd, { cwd: this.workspaceRoot }, (err, stdout, stderr) => {
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