import * as vscode from 'vscode';
import { PythonEnv } from './envManager';

export class EnvTreeProvider implements vscode.TreeDataProvider<PythonEnv> {

  private _onDidChangeTreeData: vscode.EventEmitter<PythonEnv | undefined | null> =
    new vscode.EventEmitter<PythonEnv | undefined | null>();

  readonly onDidChangeTreeData: vscode.Event<PythonEnv | undefined | null> =
    this._onDidChangeTreeData.event;

  constructor(private envs: PythonEnv[]) {}

  refresh(envs: PythonEnv[]): void {
    this.envs = envs;
    this._onDidChangeTreeData.fire(null);
  }

  getTreeItem(env: PythonEnv): vscode.TreeItem {
    const item = new vscode.TreeItem(env.name, vscode.TreeItemCollapsibleState.None);

    // Descripción: versión de Python si la tenemos
    item.description = env.version ?? env.type;

    // Icono: check si es intérprete activo, terminal si no
    item.iconPath = new vscode.ThemeIcon(env.isActive ? 'check-all' : 'debug-console');

    // Tooltip con detalles
    item.tooltip = `Nombre: ${env.name}
Tipo: ${env.type}
Python: ${env.pythonPath}
Versión: ${env.version ?? 'N/D'}`;

    // Contexto para menús
    item.contextValue = 'pythonEnv';

    // Clic: activar entorno
    item.command = {
      command: 'easyenv.activateEnv',
      title: 'Activar entorno',
      arguments: [env]
    };

    return item;
  }

  getChildren(): PythonEnv[] {
    return this.envs;
  }
}
