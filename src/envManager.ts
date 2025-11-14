import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, execSync } from 'child_process';

export interface PythonEnv {
  name: string;
  type: 'venv' | 'conda' | 'poetry';
  path: string;
  pythonPath: string;
  version?: string;
  isActive?: boolean;
}

export class EnvManager {
  constructor(private workspaceRoot: string) {}

  // ESCANEAR ENTORNOS EN LA RAÍZ DEL WORKSPACE
  public async scanEnvs(): Promise<PythonEnv[]> {
    const envs: PythonEnv[] = [];

    const entries = fs.readdirSync(this.workspaceRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const envDir = path.join(this.workspaceRoot, entry.name);

      // Detectar ejecutable Python (Windows / Linux / macOS)
      const winPython = path.join(envDir, 'Scripts', 'python.exe');
      const nixPython = path.join(envDir, 'bin', 'python');
      const nixPython3 = path.join(envDir, 'bin', 'python3');

      let pythonPath = '';
      if (fs.existsSync(winPython)) pythonPath = winPython;
      else if (fs.existsSync(nixPython)) pythonPath = nixPython;
      else if (fs.existsSync(nixPython3)) pythonPath = nixPython3;

      if (!pythonPath) continue;

      // Obtener versión de Python
      let version: string | undefined;
      try {
        const out = execSync(`"${pythonPath}" --version`, {
          encoding: 'utf8'
        });
        version = out.trim(); // Ej: "Python 3.11.9"
      } catch {
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
    const currentInterpreter = pythonConfig.get<string>('defaultInterpreterPath');

    if (currentInterpreter) {
      for (const env of envs) {
        env.isActive = env.pythonPath === currentInterpreter;
      }
    }

    return envs;
  }

  // CREAR ENTORNO VENV
  public async createVenv(name: string): Promise<void> {
    vscode.window.showInformationMessage(`Creando entorno ${name}...`);

    return new Promise((resolve, reject) => {
      exec(`python -m venv "${name}"`, { cwd: this.workspaceRoot }, (err) => {
        if (err) {
          vscode.window.showErrorMessage(`Error creando venv: ${err.message}`);
          reject(err);
        } else {
          vscode.window.showInformationMessage(`Entorno ${name} creado con éxito.`);
          resolve();
        }
      });
    });
  }

  // ACTIVAR ENTORNO EN TERMINAL
  public activateEnv(env: PythonEnv) {
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
    } else {
      const scriptPath = `${env.path}/bin/activate`;

      // En shells tipo bash/zsh también existe VIRTUAL_ENV_PROMPT
      const cmd = `VIRTUAL_ENV_PROMPT="(${env.name})" source "${scriptPath}"`;
      terminal.sendText(cmd);
    }

    terminal.show();
  }


  // OBTENER PIP LIST (para mostrar paquetes)
  public async getPipList(env: PythonEnv): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(
        `"${env.pythonPath}" -m pip list`,
        { cwd: this.workspaceRoot },
        (err, stdout, stderr) => {
          if (err) {
            reject(err);
          } else {
            resolve(stdout || stderr);
          }
        }
      );
    });
  }

  // EJECUTAR PIP CON ARGUMENTOS (instalar / desinstalar)
  public async runPip(env: PythonEnv, args: string[]): Promise<string> {
    const cmd = `"${env.pythonPath}" -m pip ${args.join(' ')}`;
    return new Promise((resolve, reject) => {
      exec(cmd, { cwd: this.workspaceRoot }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
        } else {
          resolve(stdout || stderr);
        }
      });
    });
  }
}
