import * as path from 'path';
import * as vscode from 'vscode';
import {
  EnvManager,
  ExternalManagerType,
  PythonEnv,
  PythonEnvType,
  RuntimeDiagnostics
} from './envManager';
import { DashboardViewProvider } from './dashboardView';
import { EnvTreeProvider } from './envTree';

const POST_CREATE_PREFS_KEY = 'easyenv.postCreatePrefs';
const SUPPRESSED_MISSING_MANAGER_KEY = 'easyenv.suppressedMissingManagers';
const STARTUP_DIAGNOSTICS_KEY = 'easyenv.startupDiagnosticsShown';
const AUTO_DISABLE_PYTHON_KEY = 'easyenv.disabledPythonAutoActivate';
const TIP_SHOWN_KEY = 'easyenv.tipShown';

interface CreationProfile {
  id: string;
  label: string;
  description: string;
  packages: string[];
}

interface PostCreatePreferences {
  setInterpreter: boolean;
  activateTerminal: boolean;
  installProjectDependencies: boolean;
  profileId: string;
}

const CREATION_PROFILES: CreationProfile[] = [
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

const DEFAULT_POST_CREATE_PREFS: PostCreatePreferences = {
  setInterpreter: true,
  activateTerminal: true,
  installProjectDependencies: false,
  profileId: 'none'
};

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Easy Env: abre primero una carpeta de proyecto.');
    return;
  }

  const manager = new EnvManager(workspaceRoot);
  const treeProvider = new EnvTreeProvider([]);
  vscode.window.registerTreeDataProvider('easyEnvView', treeProvider);

  const dashboardProvider = new DashboardViewProvider(context, manager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, dashboardProvider)
  );

  disablePythonAutoActivateOnFirstRun(context);
  showFirstRunTip(context);

  manager.scanEnvs().then(envs => {
    treeProvider.refresh(envs);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.refresh', async () => {
      await refreshViews(manager, treeProvider, dashboardProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.createVenv', async () => {
      await runCreateEnvWizard(context, manager, treeProvider, dashboardProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.configurePostCreateDefaults', async () => {
      const prefs = await promptPostCreatePreferences(
        context,
        loadPostCreatePreferences(context),
        'Configura acciones automaticas post-creacion'
      );
      if (!prefs) {
        return;
      }
      await context.globalState.update(POST_CREATE_PREFS_KEY, prefs);
      vscode.window.showInformationMessage('Preferencias post-creacion guardadas.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.runDiagnostics', async () => {
      await runDiagnostics(context, manager, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.installManager', async (managerType?: ExternalManagerType) => {
      const selected = managerType ?? (await pickExternalManager());
      if (!selected) {
        return;
      }

      const guidance = getManagerGuidance(selected);
      if (manager.isManagerAvailable(selected)) {
        const action = await vscode.window.showInformationMessage(
          `"${selected}" ya esta disponible en Easy Env.`,
          'Reinstalar desde Easy Env',
          'Configurar ruta manual',
          'Abrir docs'
        );
        if (action === 'Reinstalar desde Easy Env' && guidance.installCommand) {
          runInstallCommandInTerminal(manager, selected, guidance.installCommand, guidance.docsUrl);
        } else if (action === 'Configurar ruta manual') {
          await promptManagerExecutablePath(manager, selected);
        } else if (action === 'Abrir docs') {
          await vscode.env.openExternal(vscode.Uri.parse(guidance.docsUrl));
        }
        return;
      }

      await installManagerFromEasyEnv(manager, selected);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.activateEnv', (env: PythonEnv) => {
      manager.activateEnv(env);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.setWorkspaceInterpreter', async (env: PythonEnv) => {
      await setWorkspaceInterpreter(env);
      vscode.window.showInformationMessage(`Interprete del workspace cambiado a ${env.name}.`);
      await refreshViews(manager, treeProvider, dashboardProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.deleteEnv', async (env: PythonEnv) => {
      await safeDeleteEnv(manager, env);
      await refreshViews(manager, treeProvider, dashboardProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.openEnvFolder', (env: PythonEnv) => {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(env.path));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.openEnvTerminal', (env: PythonEnv) => {
      const terminal = vscode.window.createTerminal({
        name: `Shell: ${env.name}`,
        cwd: env.path
      });
      terminal.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.showEnvPackages', async (env?: PythonEnv) => {
      const targetEnv = await ensureEnvSelected(env, manager);
      if (!targetEnv) {
        return;
      }
      await showPipList(manager, targetEnv);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.installPackage', async (env?: PythonEnv) => {
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
      } catch (err: any) {
        channel.appendLine(err.message);
        vscode.window.showErrorMessage(`Error instalando paquete: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.uninstallPackage', async (env?: PythonEnv) => {
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
      } catch (err: any) {
        channel.appendLine(err.message);
        vscode.window.showErrorMessage(`Error desinstalando paquete: ${err.message}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.installProjectDeps', async (env?: PythonEnv) => {
      const targetEnv = await ensureEnvSelected(env, manager);
      if (!targetEnv) {
        return;
      }
      await installProjectDependencies(manager, targetEnv);
    })
  );

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
          description: `${e.type} | ${e.version ?? e.pythonPath}`,
          env: e
        })),
        { placeHolder: 'Selecciona un entorno' }
      );
      if (!envPick) {
        return;
      }

      const env = envPick.env as PythonEnv;
      const action = await vscode.window.showQuickPick(
        [
          'Activar entorno',
          'Usar como interprete del workspace',
          'Ver paquetes (pip list)',
          'Instalar paquete...',
          'Desinstalar paquete...',
          'Instalar dependencias del proyecto',
          'Abrir carpeta del entorno',
          'Abrir terminal en la ruta del entorno',
          'Eliminar entorno'
        ],
        { placeHolder: `Accion sobre "${env.name}"` }
      );
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
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.togglePythonAutoActivate', async () => {
      const config = vscode.workspace.getConfiguration('python');
      const current = config.get<boolean>('terminal.activateEnvironment') ?? true;
      const newValue = !current;
      await config.update('terminal.activateEnvironment', newValue, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `Auto-activacion de entornos Python: ${newValue ? 'ACTIVADA' : 'DESACTIVADA'}.`
      );
      await dashboardProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('easyenv.about', () => {
      vscode.window.showInformationMessage(
        'Easy Env - Administrador de entornos Python.\n\n' +
          'Creado por Nelson Enrique Polo (polosoft1@gmail.com) con asistencia de IA.'
      );
    })
  );

  maybeRunStartupDiagnostics(context, manager);
}

async function runCreateEnvWizard(
  context: vscode.ExtensionContext,
  manager: EnvManager,
  treeProvider: EnvTreeProvider,
  dashboardProvider: DashboardViewProvider
): Promise<void> {
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
      await runCreateEnvWizardWithManager(
        context,
        manager,
        treeProvider,
        dashboardProvider,
        project,
        diagnostics,
        'venv'
      );
    }
    return;
  }

  await runCreateEnvWizardWithManager(
    context,
    manager,
    treeProvider,
    dashboardProvider,
    project,
    diagnostics,
    selectedManager
  );
}

async function runCreateEnvWizardWithManager(
  context: vscode.ExtensionContext,
  manager: EnvManager,
  treeProvider: EnvTreeProvider,
  dashboardProvider: DashboardViewProvider,
  project: RuntimeDiagnostics['project'],
  diagnostics: RuntimeDiagnostics,
  selectedManager: PythonEnvType
): Promise<void> {
  const beforeEnvs = await manager.scanEnvs();
  let expectedPath: string | undefined;
  let expectedName: string | undefined;

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
        const mode = await vscode.window.showQuickPick(
          ['Si, en el proyecto (.venv)', 'No, usar configuracion actual de Poetry'],
          { placeHolder: 'Donde quieres que Poetry cree el entorno?' }
        );
        if (!mode) {
          return;
        }
        const inProject = mode.startsWith('Si');
        expectedPath = await manager.createPoetryEnv(inProject);
        expectedName = inProject ? '.venv' : undefined;
        break;
      }
      case 'pipenv': {
        const mode = await vscode.window.showQuickPick(
          ['Si, en el proyecto (.venv)', 'No, en la ruta global de Pipenv'],
          { placeHolder: 'Donde quieres que Pipenv cree el entorno?' }
        );
        if (!mode) {
          return;
        }
        const inProject = mode.startsWith('Si');
        expectedPath = await manager.createPipenvEnv(inProject);
        expectedName = inProject ? '.venv' : undefined;
        break;
      }
    }
  } catch (err: any) {
    if (selectedManager === 'conda' && isCondaTermsError(err.message)) {
      await handleCondaTermsError(manager, err.message);
      return;
    }

    const choice = await vscode.window.showErrorMessage(
      `Error creando entorno (${selectedManager}): ${err.message}`,
      'Abrir docs',
      'Instalar desde Easy Env',
      'Seleccionar ejecutable'
    );
    if (selectedManager !== 'venv' && choice) {
      if (choice === 'Seleccionar ejecutable') {
        await promptManagerExecutablePath(manager, selectedManager as ExternalManagerType);
      } else {
        await handleMissingManager(
          context,
          manager,
          selectedManager as ExternalManagerType,
          choice === 'Instalar desde Easy Env'
        );
      }
    }
    return;
  }

  const postPrefs = await resolvePostCreatePreferences(context, project, diagnostics);
  if (!postPrefs) {
    return;
  }

  const createdSearch = await waitForCreatedEnv(
    manager,
    beforeEnvs,
    selectedManager,
    expectedPath,
    expectedName
  );
  let newEnvs = createdSearch.envs;
  await refreshViews(manager, treeProvider, dashboardProvider, newEnvs);

  let created = createdSearch.created;
  if (!created && (postPrefs.setInterpreter || postPrefs.activateTerminal || hasProfilePackages(postPrefs.profileId))) {
    vscode.window.showWarningMessage(
      'No se pudo inferir automaticamente el entorno creado. Selecciona uno manualmente.'
    );
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

async function promptManagerSelection(diagnostics: RuntimeDiagnostics): Promise<
  { value: PythonEnvType } | undefined
> {
  const recommended = diagnostics.project.recommendedManager;
  const detailFor = (type: PythonEnvType): string => {
    const available = diagnostics.managers[type] ? 'Disponible' : 'No instalado en PATH';
    const recommendation = type === recommended ? ' • Recomendado para este proyecto' : '';
    return `${available}${recommendation}`;
  };

  return vscode.window.showQuickPick(
    [
      {
        label: 'venv',
        description: 'python -m venv (local en workspace)',
        detail: detailFor('venv'),
        value: 'venv' as const
      },
      {
        label: 'uv',
        description: 'uv venv (rapido)',
        detail: detailFor('uv'),
        value: 'uv' as const
      },
      {
        label: 'conda',
        description: 'conda create --prefix (local en workspace)',
        detail: detailFor('conda'),
        value: 'conda' as const
      },
      {
        label: 'poetry',
        description: 'poetry env use python',
        detail: detailFor('poetry'),
        value: 'poetry' as const
      },
      {
        label: 'pipenv',
        description: 'pipenv --python python',
        detail: detailFor('pipenv'),
        value: 'pipenv' as const
      }
    ],
    { placeHolder: 'Selecciona el gestor para crear el entorno' }
  );
}

async function resolvePostCreatePreferences(
  context: vscode.ExtensionContext,
  project: RuntimeDiagnostics['project'],
  diagnostics: RuntimeDiagnostics
): Promise<PostCreatePreferences | undefined> {
  const saved = loadPostCreatePreferences(context);
  const mode = await vscode.window.showQuickPick(
    [
      { label: 'Usar preferencias guardadas', value: 'saved' as const },
      { label: 'Ajustar solo esta vez', value: 'once' as const },
      { label: 'Actualizar preferencias por defecto', value: 'update' as const }
    ],
    { placeHolder: 'Acciones post-creacion' }
  );

  if (!mode) {
    return undefined;
  }

  if (mode.value === 'saved') {
    return saved;
  }

  const suggestedProfileId = project.hasPyproject ? 'testing' : 'none';
  const configured = await promptPostCreatePreferences(
    context,
    { ...saved, profileId: saved.profileId === 'none' ? suggestedProfileId : saved.profileId },
    mode.value === 'update'
      ? 'Configura y guarda preferencias por defecto'
      : `Configura acciones para esta creacion (${diagnostics.project.recommendedManager} recomendado)`
  );

  if (!configured) {
    return undefined;
  }

  if (mode.value === 'update') {
    await context.globalState.update(POST_CREATE_PREFS_KEY, configured);
  }
  return configured;
}

async function promptPostCreatePreferences(
  context: vscode.ExtensionContext,
  base: PostCreatePreferences,
  title: string
): Promise<PostCreatePreferences | undefined> {
  const setInterpreter = await pickYesNo(
    `${title}: usar como interprete del workspace?`,
    base.setInterpreter
  );
  if (setInterpreter === undefined) {
    return undefined;
  }

  const activateTerminal = await pickYesNo(
    `${title}: abrir terminal con entorno activado?`,
    base.activateTerminal
  );
  if (activateTerminal === undefined) {
    return undefined;
  }

  const installProjectDependencies = await pickYesNo(
    `${title}: instalar dependencias del proyecto?`,
    base.installProjectDependencies
  );
  if (installProjectDependencies === undefined) {
    return undefined;
  }

  const profilePick = await vscode.window.showQuickPick(
    CREATION_PROFILES.map(p => ({
      label: p.label,
      description: p.description,
      value: p.id
    })),
    {
      placeHolder: `${title}: perfil rapido de paquetes`,
      title
    }
  );
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

async function pickYesNo(prompt: string, defaultValue: boolean): Promise<boolean | undefined> {
  const yes = `Si${defaultValue ? ' (default)' : ''}`;
  const no = `No${!defaultValue ? ' (default)' : ''}`;
  const pick = await vscode.window.showQuickPick([yes, no], { placeHolder: prompt });
  if (!pick) {
    return undefined;
  }
  return pick.startsWith('Si');
}

function loadPostCreatePreferences(context: vscode.ExtensionContext): PostCreatePreferences {
  const saved = context.globalState.get<PostCreatePreferences>(POST_CREATE_PREFS_KEY);
  if (!saved) {
    return { ...DEFAULT_POST_CREATE_PREFS };
  }
  return {
    setInterpreter: saved.setInterpreter ?? DEFAULT_POST_CREATE_PREFS.setInterpreter,
    activateTerminal: saved.activateTerminal ?? DEFAULT_POST_CREATE_PREFS.activateTerminal,
    installProjectDependencies:
      saved.installProjectDependencies ?? DEFAULT_POST_CREATE_PREFS.installProjectDependencies,
    profileId: saved.profileId ?? DEFAULT_POST_CREATE_PREFS.profileId
  };
}

function hasProfilePackages(profileId: string): boolean {
  const profile = CREATION_PROFILES.find(p => p.id === profileId);
  return !!profile?.packages.length;
}

async function installProfilePackages(
  manager: EnvManager,
  env: PythonEnv,
  profileId: string
): Promise<void> {
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
  } catch (err: any) {
    channel.appendLine(err.message);
    vscode.window.showErrorMessage(`Error instalando perfil "${profile.label}": ${err.message}`);
  }
}

async function installProjectDependencies(manager: EnvManager, env: PythonEnv): Promise<void> {
  const channel = vscode.window.createOutputChannel(`Dependencias proyecto - ${env.name}`);
  channel.show(true);
  channel.appendLine(`# Instalando dependencias detectadas en ${env.name}`);
  channel.appendLine('');

  try {
    const out = await manager.installProjectDependencies(env);
    channel.appendLine(out || 'Sin salida.');
    vscode.window.showInformationMessage(`Dependencias del proyecto procesadas en ${env.name}.`);
  } catch (err: any) {
    channel.appendLine(err.message);
    vscode.window.showErrorMessage(`Error instalando dependencias del proyecto: ${err.message}`);
  }
}

async function safeDeleteEnv(manager: EnvManager, env: PythonEnv): Promise<void> {
  const insideWorkspace = manager.isEnvInsideWorkspace(env);
  const deleteModeOptions =
    env.type === 'conda'
      ? ['Eliminar entorno conda', 'Cancelar']
      : ['Mover a papelera (recomendado)', 'Eliminar permanentemente', 'Cancelar'];

  if (!insideWorkspace) {
    const typed = await vscode.window.showInputBox({
      prompt:
        `El entorno esta fuera del workspace.\nEscribe "${env.name}" para confirmar eliminacion segura.`,
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
    } else {
      await manager.deleteEnv(env, { useTrash: false });
    }
    vscode.window.showInformationMessage(`Entorno ${env.name} eliminado.`);
  } catch (err: any) {
    if (mode.startsWith('Mover')) {
      const fallback = await vscode.window.showWarningMessage(
        `No se pudo mover a papelera (${err.message}). Deseas eliminar permanentemente?`,
        'Eliminar permanentemente'
      );
      if (fallback === 'Eliminar permanentemente') {
        try {
          await manager.deleteEnv(env, { useTrash: false });
          vscode.window.showInformationMessage(`Entorno ${env.name} eliminado permanentemente.`);
          return;
        } catch (finalErr: any) {
          vscode.window.showErrorMessage(`Error eliminando el entorno ${env.name}: ${finalErr.message}`);
          return;
        }
      }
      return;
    }
    vscode.window.showErrorMessage(`Error eliminando el entorno ${env.name}: ${err.message}`);
  }
}

async function runDiagnostics(
  context: vscode.ExtensionContext,
  manager: EnvManager,
  showToastSummary: boolean
): Promise<void> {
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
  } else {
    channel.appendLine('- none detected');
  }
  channel.show(true);

  if (showToastSummary) {
    const missingManagers = Object.entries(diagnostics.managers)
      .filter(([_, ok]) => !ok)
      .map(([name]) => name);

    if (!diagnostics.pythonCommandAvailable) {
      vscode.window.showWarningMessage(
        'Diagnostico: no se detecto comando python en PATH. venv y pip pueden fallar.'
      );
    } else if (missingManagers.length) {
      const action = await vscode.window.showWarningMessage(
        `Diagnostico: faltan gestores (${missingManagers.join(', ')}).`,
        'Instalar o configurar gestor'
      );
      if (action === 'Instalar o configurar gestor') {
        await vscode.commands.executeCommand('easyenv.installManager');
      }
    } else {
      vscode.window.showInformationMessage('Diagnostico completo: entorno listo para trabajar.');
    }
  }

  await context.globalState.update(STARTUP_DIAGNOSTICS_KEY, true);
}

function maybeRunStartupDiagnostics(context: vscode.ExtensionContext, manager: EnvManager): void {
  const alreadyShown = context.globalState.get<boolean>(STARTUP_DIAGNOSTICS_KEY);
  if (alreadyShown) {
    return;
  }

  void runDiagnostics(context, manager, true);
}

function disablePythonAutoActivateOnFirstRun(context: vscode.ExtensionContext): void {
  const alreadyDisabled = context.globalState.get<boolean>(AUTO_DISABLE_PYTHON_KEY);
  if (alreadyDisabled) {
    return;
  }

  const pythonConfig = vscode.workspace.getConfiguration('python');
  const current = pythonConfig.get<boolean>('terminal.activateEnvironment');
  if (current !== false) {
    void pythonConfig.update(
      'terminal.activateEnvironment',
      false,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage(
      'Easy Env: se desactivo la auto-activacion de Python en terminal (primera ejecucion).'
    );
  }
  void context.globalState.update(AUTO_DISABLE_PYTHON_KEY, true);
}

function showFirstRunTip(context: vscode.ExtensionContext): void {
  const shown = context.globalState.get<boolean>(TIP_SHOWN_KEY);
  if (shown) {
    return;
  }
  vscode.window.showInformationMessage(
    'Tip Easy Env: click derecho sobre un entorno para ver activar, paquetes, dependencias y eliminar.'
  );
  void context.globalState.update(TIP_SHOWN_KEY, true);
}

async function showPipList(manager: EnvManager, targetEnv: PythonEnv): Promise<void> {
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
}

async function setWorkspaceInterpreter(env: PythonEnv): Promise<void> {
  await vscode.workspace
    .getConfiguration('python')
    .update('defaultInterpreterPath', env.pythonPath, vscode.ConfigurationTarget.Workspace);
}

async function refreshViews(
  manager: EnvManager,
  treeProvider: EnvTreeProvider,
  dashboardProvider: DashboardViewProvider,
  preloadedEnvs?: PythonEnv[]
): Promise<void> {
  const envs = preloadedEnvs ?? (await manager.scanEnvs());
  treeProvider.refresh(envs);
  await dashboardProvider.refresh();
}

async function ensureEnvSelected(
  env: PythonEnv | undefined,
  manager: EnvManager
): Promise<PythonEnv | undefined> {
  if (env) {
    return env;
  }

  const envsList = await manager.scanEnvs();
  if (!envsList.length) {
    vscode.window.showWarningMessage('No se encontraron entornos en esta carpeta.');
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(
    envsList.map(e => ({
      label: e.name,
      description: `${e.type} | ${e.version ?? e.pythonPath}`,
      env: e
    })),
    { placeHolder: 'Selecciona un entorno' }
  );
  return pick?.env as PythonEnv | undefined;
}

async function handleMissingManager(
  context: vscode.ExtensionContext,
  manager: EnvManager,
  managerType: ExternalManagerType,
  forceInstallFromEasyEnv = false
): Promise<'use-venv' | 'cancel'> {
  const suppressed = new Set(context.globalState.get<string[]>(SUPPRESSED_MISSING_MANAGER_KEY) ?? []);
  const guidance = getManagerGuidance(managerType);

  if (forceInstallFromEasyEnv) {
    await installManagerFromEasyEnv(manager, managerType);
    return 'cancel';
  }

  if (suppressed.has(managerType)) {
    vscode.window.showWarningMessage(
      `No se encontro "${managerType}" ni en PATH ni en configuracion de Easy Env.`
    );
    return 'cancel';
  }

  const action = await vscode.window.showErrorMessage(
    `No se encontro "${managerType}" ni en PATH ni en configuracion de Easy Env.`,
    'Instalar desde Easy Env',
    'Seleccionar ejecutable',
    'Copiar comando',
    'Abrir docs',
    'Usar venv',
    'No mostrar este aviso'
  );

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
      vscode.window.showInformationMessage(
        `Comando copiado. Ejecutalo en terminal y reinicia VS Code: ${guidance.installCommand}`
      );
    } else {
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

async function installManagerFromEasyEnv(
  manager: EnvManager,
  managerType: ExternalManagerType
): Promise<void> {
  const guidance = getManagerGuidance(managerType);
  if (guidance.installCommand) {
    runInstallCommandInTerminal(manager, managerType, guidance.installCommand, guidance.docsUrl);
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(guidance.docsUrl));
}

function runInstallCommandInTerminal(
  manager: EnvManager,
  managerType: ExternalManagerType,
  command: string,
  docsUrl: string
): void {
  const terminal = vscode.window.createTerminal({ name: `Install ${managerType} (Easy Env)` });
  terminal.show(true);
  terminal.sendText(command);

  void vscode.window.showInformationMessage(
    `Easy Env inicio la instalacion de "${managerType}" en terminal integrada.`,
    'Configurar ruta manual',
    'Abrir docs'
  ).then(async action => {
    if (action === 'Configurar ruta manual') {
      await promptManagerExecutablePath(manager, managerType);
    } else if (action === 'Abrir docs') {
      await vscode.env.openExternal(vscode.Uri.parse(docsUrl));
    }
  });
}

function getManagerGuidance(managerType: ExternalManagerType): {
  docsUrl: string;
  installCommand?: string;
} {
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
          installCommand:
            'winget install -e --id Anaconda.Miniconda3 --accept-source-agreements --accept-package-agreements'
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

function buildUserPipInstallCommand(packageName: string): string {
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

async function pickExternalManager(): Promise<ExternalManagerType | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: 'uv',
        description: 'Rapido para crear/gestionar virtualenv',
        value: 'uv' as const
      },
      {
        label: 'conda',
        description: 'Miniconda / Anaconda',
        value: 'conda' as const
      },
      {
        label: 'poetry',
        description: 'Gestor pyproject.toml',
        value: 'poetry' as const
      },
      {
        label: 'pipenv',
        description: 'Gestor Pipfile',
        value: 'pipenv' as const
      }
    ],
    { placeHolder: 'Selecciona el gestor a instalar o configurar en Easy Env' }
  );
  return pick?.value;
}

async function promptManagerExecutablePath(
  manager: EnvManager,
  managerType: ExternalManagerType
): Promise<void> {
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
    vscode.window.showInformationMessage(
      `Ruta guardada en easyenv.${settingKey}. "${managerType}" ya esta disponible en Easy Env.`
    );
    return;
  }

  vscode.window.showWarningMessage(
    `Ruta guardada en easyenv.${settingKey}, pero "${managerType}" aun no se detecta. Revisa que sea el ejecutable correcto.`
  );
}

function getManagerPathSettingKey(managerType: ExternalManagerType): string {
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

async function waitForCreatedEnv(
  manager: EnvManager,
  beforeEnvs: PythonEnv[],
  expectedType: PythonEnvType,
  expectedPath?: string,
  expectedName?: string
): Promise<{ envs: PythonEnv[]; created?: PythonEnv }> {
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isCondaTermsError(message: string): boolean {
  return (
    /CondaToSNonInteractiveError/i.test(message) ||
    /Terms of Service have not been accepted/i.test(message) ||
    /conda tos accept/i.test(message)
  );
}

async function handleCondaTermsError(manager: EnvManager, rawMessage: string): Promise<void> {
  const channels = extractCondaChannels(rawMessage);
  const choice = await vscode.window.showErrorMessage(
    'Conda requiere aceptar Terms of Service de canales antes de crear el entorno.',
    'Aceptar ToS en terminal',
    'Abrir docs'
  );

  if (choice === 'Abrir docs') {
    await vscode.env.openExternal(
      vscode.Uri.parse('https://www.anaconda.com/docs/tools/working-with-conda/channels')
    );
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

  vscode.window.showInformationMessage(
    'Se enviaron comandos para aceptar ToS en terminal. Cuando terminen, vuelve a crear el entorno conda.'
  );
}

function extractCondaChannels(message: string): string[] {
  const urls = message.match(/https?:\/\/[^\s]+/gi) ?? [];
  const cleaned = urls
    .map(url => url.replace(/[)\],.;-]+$/g, '').trim())
    .filter(url => /^https?:\/\/repo\.anaconda\.com\/pkgs\//i.test(url));

  const unique: string[] = [];
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

function findCreatedEnv(
  beforeEnvs: PythonEnv[],
  afterEnvs: PythonEnv[],
  expectedType: PythonEnvType,
  expectedPath?: string,
  expectedName?: string
): PythonEnv | undefined {
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
    const byNameAny = afterEnvs.find(
      e => path.basename(e.name) === expectedNormalizedName && e.type === expectedType
    );
    if (byNameAny) {
      return byNameAny;
    }
  }

  return afterEnvs.find(e => e.type === expectedType);
}

function normalizePathForCompare(inputPath: string): string {
  const normalized = path.normalize(inputPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPythonExtensionInstalled(): boolean {
  return !!vscode.extensions.getExtension('ms-python.python');
}

export function deactivate() {}

