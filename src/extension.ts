import * as vscode from 'vscode';
import * as fs from 'fs';
import { EnvManager, PythonEnv } from './envManager';
import { EnvTreeProvider } from './envTree';
import { DashboardViewProvider } from './dashboardView';

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Easy Env: abre primero una carpeta de proyecto.');
    return;
  }
  // --- Desactivar auto-activación de Python la primera vez ---
  const alreadyDisabled = context.globalState.get<boolean>('easyenv.disabledPythonAutoActivate');

  if (!alreadyDisabled) {
    const pythonConfig = vscode.workspace.getConfiguration('python');
    const current = pythonConfig.get<boolean>('terminal.activateEnvironment');

    if (current !== false) {
      pythonConfig.update(
        'terminal.activateEnvironment',
        false,
        vscode.ConfigurationTarget.Global
      );
      vscode.window.showInformationMessage(
        'Easy Env: se ha desactivado la auto-activación de entornos Python en la terminal (una sola vez).'
      );
    }

    context.globalState.update('easyenv.disabledPythonAutoActivate', true);
  }

  const manager = new EnvManager(workspaceRoot);

  // Vista de entornos (árbol)
  const treeProvider = new EnvTreeProvider([]);
  vscode.window.registerTreeDataProvider('easyEnvView', treeProvider);

  // Dashboard
  const dashboardProvider = new DashboardViewProvider(context, manager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardViewProvider.viewId,
      dashboardProvider
    )
  );
  console.log('[Easy Env] DashboardViewProvider registrado');

  // Tip primera vez
  const hasShownTip = context.globalState.get<boolean>('easyenv.tipShown');
  if (!hasShownTip) {
    vscode.window.showInformationMessage(
      'Tip Easy Env: haz clic derecho sobre un entorno para ver opciones como ' +
        'activar, usar como intérprete, ver paquetes o eliminar.'
    );
    context.globalState.update('easyenv.tipShown', true);
  }

  // Carga inicial de entornos
  manager.scanEnvs().then(envs => {
    treeProvider.refresh(envs);
  });

  // ==================== COMANDOS ====================

  // Refrescar lista de entornos
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.refresh', async () => {
      const newEnvs = await manager.scanEnvs();
      treeProvider.refresh(newEnvs);
      await dashboardProvider.refresh();
    })
  );

  // Crear venv (wizard)
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.createVenv', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Nombre del entorno (ej: .venv, .dev, .qa)',
        value: '.venv'
      });
      if (!name) return;

      const setAsInterpreter = await vscode.window.showQuickPick(
        ['Sí, usar como intérprete del workspace', 'No, solo crearlo'],
        { placeHolder: '¿Quieres usar este entorno como intérprete del workspace?' }
      );
      const shouldSetInterpreter = setAsInterpreter?.startsWith('Sí') ?? false;

      const activateAfter = await vscode.window.showQuickPick(
        ['Sí, abrir terminal con el venv activado', 'No, solo crearlo'],
        { placeHolder: '¿Quieres abrir una terminal con el entorno activado al terminar?' }
      );
      const shouldActivate = activateAfter?.startsWith('Sí') ?? false;

      await manager.createVenv(name);

      let newEnvs = await manager.scanEnvs();
      treeProvider.refresh(newEnvs);
      await dashboardProvider.refresh();

      const created = newEnvs.find(e => e.name === name);
      if (!created) return;

      if (shouldSetInterpreter) {
        await vscode.workspace
          .getConfiguration('python')
          .update('defaultInterpreterPath', created.pythonPath, vscode.ConfigurationTarget.Workspace);

        vscode.window.showInformationMessage(`Intérprete del workspace cambiado a ${created.name}.`);
        newEnvs = await manager.scanEnvs();
        treeProvider.refresh(newEnvs);
        await dashboardProvider.refresh();
      }

      if (shouldActivate) {
        manager.activateEnv(created);
      }
    })
  );

  // Activar entorno
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.activateEnv', (env: PythonEnv) => {
      manager.activateEnv(env);
    })
  );

  // Usar como intérprete del workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.setWorkspaceInterpreter', async (env: PythonEnv) => {
      await vscode.workspace
        .getConfiguration('python')
        .update('defaultInterpreterPath', env.pythonPath, vscode.ConfigurationTarget.Workspace);

      vscode.window.showInformationMessage(`Intérprete del workspace cambiado a ${env.name}.`);

      const newEnvs = await manager.scanEnvs();
      treeProvider.refresh(newEnvs);
      await dashboardProvider.refresh();
    })
  );

  // Eliminar entorno
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.deleteEnv', async (env: PythonEnv) => {
      const confirm = await vscode.window.showWarningMessage(
        `¿Eliminar permanentemente el entorno "${env.name}"?\nRuta: ${env.path}`,
        { modal: true },
        'Eliminar'
      );

      if (confirm !== 'Eliminar') {
        return;
      }

      try {
        await fs.promises.rm(env.path, { recursive: true, force: true });
        vscode.window.showInformationMessage(`Entorno ${env.name} eliminado.`);
        const newEnvs = await manager.scanEnvs();
        treeProvider.refresh(newEnvs);
        await dashboardProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Error eliminando el entorno ${env.name}: ${err.message}`);
      }
    })
  );

  // Abrir carpeta del entorno
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.openEnvFolder', (env: PythonEnv) => {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(env.path));
    })
  );

  // Abrir terminal en la ruta del entorno
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.openEnvTerminal', (env: PythonEnv) => {
      const terminal = vscode.window.createTerminal({
        name: `Shell: ${env.name}`,
        cwd: env.path
      });
      terminal.show();
    })
  );

  // Ver paquetes (pip list)
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.showEnvPackages', async (env?: PythonEnv) => {
      const targetEnv = await ensureEnvSelected(env, manager);
      if (!targetEnv) return;

      try {
        const pipOutput = await manager.getPipList(targetEnv);
        const channel = vscode.window.createOutputChannel(`Pip: ${targetEnv.name}`);
        channel.clear();
        channel.appendLine(`# pip list - entorno ${targetEnv.name}`);
        channel.appendLine('');
        channel.append(pipOutput);
        channel.show(true);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Error ejecutando pip list: ${err.message}`);
      }
    })
  );

  // Instalar paquete
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.installPackage', async (env?: PythonEnv) => {
      const targetEnv = await ensureEnvSelected(env, manager);
      if (!targetEnv) return;

      const pkg = await vscode.window.showInputBox({
        prompt: 'Nombre del paquete a instalar (ej: requests, fastapi==0.115.0)',
        placeHolder: 'requests'
      });
      if (!pkg) return;

      const channel = vscode.window.createOutputChannel(`pip install - ${targetEnv.name}`);
      channel.show(true);
      channel.appendLine(`# pip install ${pkg} en ${targetEnv.name}`);
      channel.appendLine('');

      try {
        const out = await manager.runPip(targetEnv, ['install', pkg]);
        channel.append(out);
        vscode.window.showInformationMessage(`Paquete "${pkg}" instalado en ${targetEnv.name}.`);
      } catch (err: any) {
        channel.appendLine(err.message);
        vscode.window.showErrorMessage(`Error instalando paquete: ${err.message}`);
      }
    })
  );

  // Desinstalar paquete
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.uninstallPackage', async (env?: PythonEnv) => {
      const targetEnv = await ensureEnvSelected(env, manager);
      if (!targetEnv) return;

      const pkg = await vscode.window.showInputBox({
        prompt: 'Nombre del paquete a desinstalar (ej: requests)',
        placeHolder: 'requests'
      });
      if (!pkg) return;

      const channel = vscode.window.createOutputChannel(`pip uninstall - ${targetEnv.name}`);
      channel.show(true);
      channel.appendLine(`# pip uninstall ${pkg} en ${targetEnv.name}`);
      channel.appendLine('');

      try {
        const out = await manager.runPip(targetEnv, ['uninstall', pkg, '-y']);
        channel.append(out);
        vscode.window.showInformationMessage(`Paquete "${pkg}" desinstalado de ${targetEnv.name}.`);
      } catch (err: any) {
        channel.appendLine(err.message);
        vscode.window.showErrorMessage(`Error desinstalando paquete: ${err.message}`);
      }
    })
  );

  // Acciones rápidas
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.actions', async () => {
      const envsList = await manager.scanEnvs();
      if (!envsList.length) {
        vscode.window.showWarningMessage('No se encontraron entornos en esta carpeta.');
        return;
      }

      const envPick = await vscode.window.showQuickPick(
        envsList.map(e => ({
          label: e.name,
          description: e.version ?? e.pythonPath,
          env: e
        })),
        { placeHolder: 'Selecciona un entorno' }
      );
      if (!envPick) return;

      const env = envPick.env as PythonEnv;

      const action = await vscode.window.showQuickPick(
        [
          'Activar entorno',
          'Usar como intérprete del workspace',
          'Ver paquetes (pip list)',
          'Instalar paquete…',
          'Desinstalar paquete…',
          'Abrir carpeta del entorno',
          'Abrir terminal en la ruta del entorno',
          'Eliminar entorno'
        ],
        { placeHolder: `Acción sobre "${env.name}"` }
      );
      if (!action) return;

      switch (action) {
        case 'Activar entorno':
          manager.activateEnv(env);
          break;
        case 'Usar como intérprete del workspace':
          await vscode.commands.executeCommand('easyenv.setWorkspaceInterpreter', env);
          break;
        case 'Ver paquetes (pip list)':
          await vscode.commands.executeCommand('easyenv.showEnvPackages', env);
          break;
        case 'Instalar paquete…':
          await vscode.commands.executeCommand('easyenv.installPackage', env);
          break;
        case 'Desinstalar paquete…':
          await vscode.commands.executeCommand('easyenv.uninstallPackage', env);
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
    })
  );

  // Alternar auto-activación de la extensión Python
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.togglePythonAutoActivate', async () => {
      const config = vscode.workspace.getConfiguration('python');
      const current =
        config.get<boolean>('terminal.activateEnvironment') ?? true;
      const newValue = !current;

      await config.update(
        'terminal.activateEnvironment',
        newValue,
        vscode.ConfigurationTarget.Global
      );

      vscode.window.showInformationMessage(
        `Auto-activación de entornos Python ahora está: ${
          newValue ? 'ACTIVADA' : 'DESACTIVADA'
        }.`
      );

      await dashboardProvider.refresh();
    })
  );

  // Acerca de
  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.about', () => {
      vscode.window.showInformationMessage(
        'Easy Env – Administrador de entornos Python\n\n' +
        'Creado por Nelson Enrique Polo (polosoft1@gmail.com)\n' +
        'Con la asistencia de ChatGPT – 2025'
      );
    })
  );
}

async function ensureEnvSelected(env: PythonEnv | undefined, manager: EnvManager): Promise<PythonEnv | undefined> {
  if (env) return env;

  const envsList = await manager.scanEnvs();
  if (!envsList.length) {
    vscode.window.showWarningMessage('No se encontraron entornos en esta carpeta.');
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(
    envsList.map(e => ({
      label: e.name,
      description: e.version ?? e.pythonPath,
      env: e
    })),
    { placeHolder: 'Selecciona un entorno' }
  );
  return pick?.env as PythonEnv | undefined;
}

export function deactivate() {}
