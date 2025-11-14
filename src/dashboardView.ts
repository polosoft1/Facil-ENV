import * as vscode from 'vscode';
import { EnvManager, PythonEnv } from './envManager';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'easyEnvDashboard';

  private currentView?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: EnvManager
  ) {
    console.log('[Easy Env] DashboardViewProvider constructor');
  }

  // Permite que extension.ts fuerce un repaint del dashboard
  public async refresh() {
    if (this.currentView) {
      await this.updateHtml(this.currentView);
    }
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    console.log('[Easy Env] resolveWebviewView llamado');

    this.currentView = webviewView;

    // IMPORTANTE: habilitar scripts
    webviewView.webview.options = {
      enableScripts: true
    };

    await this.updateHtml(webviewView);

    // ÚNICO handler para TODOS los mensajes
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      console.log('[Easy Env] Mensaje recibido desde dashboard:', msg);

      switch (msg.command) {
        case 'togglePythonAutoActivate':
          vscode.commands.executeCommand('easyenv.togglePythonAutoActivate');
          break;

        case 'createVenv':
          vscode.commands.executeCommand('easyenv.createVenv');
          break;

        case 'actions':
          vscode.commands.executeCommand('easyenv.actions');
          break;

        case 'showPackages': {
          const env = msg.envName ? await this.pickEnvByName(msg.envName) : undefined;
          vscode.commands.executeCommand('easyenv.showEnvPackages', env);
          break;
        }

        case 'installPackage': {
          const env = msg.envName ? await this.pickEnvByName(msg.envName) : undefined;
          vscode.commands.executeCommand('easyenv.installPackage', env);
          break;
        }

        case 'uninstallPackage': {
          const env = msg.envName ? await this.pickEnvByName(msg.envName) : undefined;
          vscode.commands.executeCommand('easyenv.uninstallPackage', env);
          break;
        }

        case 'openFolder': {
          const env = msg.envName ? await this.pickEnvByName(msg.envName) : undefined;
          if (env) vscode.commands.executeCommand('easyenv.openEnvFolder', env);
          break;
        }

        case 'openTerminal': {
          const env = msg.envName ? await this.pickEnvByName(msg.envName) : undefined;
          if (env) vscode.commands.executeCommand('easyenv.openEnvTerminal', env);
          break;
        }

        case 'activate': {
          const env = msg.envName ? await this.pickEnvByName(msg.envName) : undefined;
          if (env) vscode.commands.executeCommand('easyenv.activateEnv', env);
          break;
        }

        case 'refresh': {
          await this.updateHtml(webviewView);
          vscode.commands.executeCommand('easyenv.refresh');
          break;
        }
      }
    });
  }

  // =============== Helpers ===============

  private async pickEnvByName(name: string): Promise<PythonEnv | undefined> {
    const envs = await this.manager.scanEnvs();
    return envs.find(e => e.name === name);
  }

  private async updateHtml(webviewView: vscode.WebviewView) {
    // Leer configuración de Python
    const pythonConfig = vscode.workspace.getConfiguration('python');
    const autoActivate =
      pythonConfig.get<boolean>('terminal.activateEnvironment') ?? true;

    const autoActivateLabel = autoActivate ? 'Activada' : 'Desactivada';
    const autoActivateDetail = autoActivate
      ? 'VS Code intentará activar automáticamente los entornos en la terminal.'
      : 'Easy Env controla la activación de entornos en la terminal.';

    const envs = await this.manager.scanEnvs();
    const activeEnv = envs.find(e => e.isActive);
    const numEnvs = envs.length;
    const versions = Array.from(new Set(envs.map(e => e.version || 'Desconocida')));

    const activeName = activeEnv ? activeEnv.name : 'Ninguno';
    const activeVersion = activeEnv?.version ?? '—';
    const activePath = activeEnv?.path ?? '—';

    const envSummaryRows = envs.map(e => {
      const estado = e.isActive ? 'Activo' : 'Disponible';
      return `
        <tr>
          <td class="mono">${e.name}</td>
          <td>${e.version ?? 'Python ?'}</td>
          <td>
            <span class="badge ${e.isActive ? 'badge-active' : ''}">${estado}</span>
          </td>
          <td>
            <button data-command="activate" data-env="${e.name}">Activar</button>
            <button data-command="openTerminal" data-env="${e.name}">Terminal</button>
            <button data-command="showPackages" data-env="${e.name}">Paquetes</button>
          </td>
        </tr>
      `;
    }).join('');

    const nonce = Date.now().toString();

    webviewView.webview.html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Easy Env Dashboard</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 8px 10px 16px;
          }
          .card {
            border-radius: 6px;
            padding: 10px 12px;
            margin-bottom: 10px;
            background-color: var(--vscode-editor-background);
            box-shadow: 0 0 0 1px rgba(255,255,255,0.02);
          }
          .card-header {
            font-weight: 600;
            margin-bottom: 6px;
          }
          .muted {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
          }
          .chip {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 999px;
            font-size: 11px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            margin-right: 4px;
          }
          .btn-row {
            margin-top: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
          }
          button {
            border-radius: 4px;
            border: 1px solid var(--vscode-button-border, transparent);
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 4px 8px;
            font-size: 11px;
            cursor: pointer;
          }
          button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          button:hover {
            filter: brightness(1.08);
          }
          .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .mono {
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            word-break: break-all;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            margin-top: 6px;
          }
          th, td {
            padding: 4px 6px;
            text-align: left;
          }
          th {
            border-bottom: 1px solid rgba(255,255,255,0.08);
          }
          tr:nth-child(even) {
            background-color: rgba(255,255,255,0.02);
          }
          .badge {
            padding: 2px 6px;
            border-radius: 999px;
            font-size: 10px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
          }
          .badge-active {
            background-color: #4caf50;
            color: #ffffff;
          }
          .footer {
            margin-top: 8px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="card-header">Easy Env – Python Environments</div>
          <div class="muted">
            Administrador de entornos creado por <strong>Nelson Enrique Polo</strong> (polosoft1@gmail.com),
            con asistencia IA – 2025.
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="card-header">Entorno activo</div>
            <div><strong>${activeName}</strong></div>
            <div class="muted">Python: ${activeVersion}</div>
            <div class="muted mono" style="margin-top:4px;">${activePath}</div>
            <div class="btn-row">
              <button class="primary" data-command="activate" data-env="${activeName}">Activar en terminal</button>
              <button data-command="openFolder" data-env="${activeName}">Abrir carpeta</button>
              <button data-command="openTerminal" data-env="${activeName}">Abrir terminal aquí</button>
              <button data-command="showPackages" data-env="${activeName}">Ver paquetes (pip list)</button>
            </div>
          </div>

          <div class="card">
            <div class="card-header">Estado del proyecto</div>
            <div class="muted">Entornos detectados: <strong>${numEnvs}</strong></div>
            <div class="muted" style="margin-top:4px;">
              Versiones Python:
              ${versions.map(v => `<span class="chip">${v}</span>`).join(' ') || '—'}
            </div>

            <div class="muted" style="margin-top:6px;">
              Auto-activación Python:
              <span class="badge ${autoActivate ? 'badge-active' : ''}">
                ${autoActivateLabel}
              </span>
              <div style="margin-top:3px;">${autoActivateDetail}</div>
            </div>

            <div class="btn-row">
              <button class="primary" data-command="createVenv">Crear nuevo entorno</button>
              <button data-command="actions">Abrir acciones rápidas…</button>
              <button data-command="installPackage">Instalar paquete…</button>
              <button data-command="uninstallPackage">Desinstalar paquete…</button>
              <button data-command="refresh">Refrescar resumen</button>
              <button data-command="togglePythonAutoActivate">
                Alternar auto-activación Python
              </button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">Entornos detectados en el workspace</div>
          ${
            envs.length
              ? `
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Versión</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${envSummaryRows}
                  </tbody>
                </table>`
              : `<div class="muted">No se han detectado entornos en esta carpeta.</div>`
          }
        </div>

        <div class="footer">
          Easy Env – Administrador de entornos Python creado por Nelson Enrique Polo (polosoft1@gmail.com),
          con asistencia IA – 2025.
        </div>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          function wireButtons() {
            const buttons = document.querySelectorAll('button[data-command]');
            buttons.forEach(btn => {
              btn.addEventListener('click', () => {
                const command = btn.getAttribute('data-command');
                const envName = btn.getAttribute('data-env') || undefined;
                vscode.postMessage({ command, envName });
              });
            });
          }

          window.addEventListener('load', wireButtons);
        </script>
      </body>
      </html>
    `;
  }

}
