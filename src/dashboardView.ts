import * as vscode from 'vscode';
import { EnvManager, PythonEnv } from './envManager';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'easyEnvDashboard';
  private currentView?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly manager: EnvManager
  ) {}

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
    this.currentView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    await this.updateHtml(webviewView);

    webviewView.webview.onDidReceiveMessage(async msg => {
      switch (msg.command) {
        case 'togglePythonAutoActivate':
          void vscode.commands.executeCommand('easyenv.togglePythonAutoActivate');
          break;
        case 'createVenv':
          void vscode.commands.executeCommand('easyenv.createVenv');
          break;
        case 'actions':
          void vscode.commands.executeCommand('easyenv.actions');
          break;
        case 'runDiagnostics':
          void vscode.commands.executeCommand('easyenv.runDiagnostics');
          break;
        case 'installProjectDeps': {
          const env = await this.pickEnv(msg.envPath, msg.envName);
          void vscode.commands.executeCommand('easyenv.installProjectDeps', env);
          break;
        }
        case 'showPackages': {
          const env = await this.pickEnv(msg.envPath, msg.envName);
          void vscode.commands.executeCommand('easyenv.showEnvPackages', env);
          break;
        }
        case 'installPackage': {
          const env = await this.pickEnv(msg.envPath, msg.envName);
          void vscode.commands.executeCommand('easyenv.installPackage', env);
          break;
        }
        case 'uninstallPackage': {
          const env = await this.pickEnv(msg.envPath, msg.envName);
          void vscode.commands.executeCommand('easyenv.uninstallPackage', env);
          break;
        }
        case 'openFolder': {
          const env = await this.pickEnv(msg.envPath, msg.envName);
          if (env) {
            void vscode.commands.executeCommand('easyenv.openEnvFolder', env);
          }
          break;
        }
        case 'openTerminal': {
          const env = await this.pickEnv(msg.envPath, msg.envName);
          if (env) {
            void vscode.commands.executeCommand('easyenv.openEnvTerminal', env);
          }
          break;
        }
        case 'activate': {
          const env = await this.pickEnv(msg.envPath, msg.envName);
          if (env) {
            void vscode.commands.executeCommand('easyenv.activateEnv', env);
          }
          break;
        }
        case 'refresh':
          await this.updateHtml(webviewView);
          void vscode.commands.executeCommand('easyenv.refresh');
          break;
      }
    });
  }

  private async pickEnv(envPath?: string, name?: string): Promise<PythonEnv | undefined> {
    const envs = await this.manager.scanEnvs();
    if (envPath) {
      const normalized = normalizeForCompare(envPath);
      const byPath = envs.find(e => normalizeForCompare(e.path) === normalized);
      if (byPath) {
        return byPath;
      }
    }
    if (name) {
      return envs.find(e => e.name === name);
    }
    return undefined;
  }

  private async updateHtml(webviewView: vscode.WebviewView) {
    const pythonConfig = vscode.workspace.getConfiguration('python');
    const autoActivate = pythonConfig.get<boolean>('terminal.activateEnvironment') ?? true;
    const autoActivateLabel = autoActivate ? 'Activada' : 'Desactivada';
    const autoActivateDetail = autoActivate
      ? 'VS Code intentara activar automaticamente los entornos en terminal.'
      : 'Easy Env controla la activacion de entornos en terminal.';

    const envs = await this.manager.scanEnvs();
    const activeEnv = envs.find(e => e.isActive);
    const numEnvs = envs.length;
    const versions = Array.from(new Set(envs.map(e => e.version || 'Desconocida')));
    const managerFilters = ['all', ...Array.from(new Set(envs.map(e => e.type))).sort()];
    const managerFilterOptions = managerFilters
      .map(filter => {
        const label = filter === 'all' ? 'Todos' : filter;
        return `<option value="${escapeHtml(filter)}">${escapeHtml(label)}</option>`;
      })
      .join('');

    const activeName = activeEnv ? activeEnv.name : 'Ninguno';
    const activeVersion = activeEnv?.version ?? '-';
    const activePath = activeEnv?.path ?? '-';
    const activeType = activeEnv?.type ?? 'N/D';
    const activePathEncoded = activeEnv ? encodeURIComponent(activeEnv.path) : '';

    const envSummaryRows = envs
      .map(e => {
        const estado = e.isActive ? 'Activo' : 'Disponible';
        const encodedPath = encodeURIComponent(e.path);
        const versionText = e.version ?? 'Python ?';
        return `
        <tr
          data-manager="${escapeHtml(e.type)}"
          data-name="${escapeHtml(e.name.toLowerCase())}"
          data-version="${escapeHtml(versionText.toLowerCase())}"
          data-path="${escapeHtml(e.path.toLowerCase())}"
          data-active="${e.isActive ? '1' : '0'}"
        >
          <td class="mono">${escapeHtml(e.name)}</td>
          <td><span class="chip">${escapeHtml(e.type)}</span></td>
          <td>${escapeHtml(versionText)}</td>
          <td><span class="badge ${e.isActive ? 'badge-active' : ''}">${escapeHtml(estado)}</span></td>
          <td>
            <button data-command="activate" data-env-name="${escapeHtml(e.name)}" data-env-path="${encodedPath}">Activar</button>
            <button data-command="openTerminal" data-env-name="${escapeHtml(e.name)}" data-env-path="${encodedPath}">Terminal</button>
            <button data-command="showPackages" data-env-name="${escapeHtml(e.name)}" data-env-path="${encodedPath}">Paquetes</button>
          </td>
        </tr>`;
      })
      .join('');

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
          .control-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 6px;
            margin-bottom: 6px;
            flex-wrap: wrap;
          }
          .input, .select {
            border-radius: 4px;
            border: 1px solid var(--vscode-dropdown-border, transparent);
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            font-size: 11px;
            padding: 3px 6px;
          }
          .input {
            min-width: 180px;
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
          <div class="card-header">Easy Env - Python Environments</div>
          <div class="muted">
            Administrador de entornos creado por <strong>Nelson Enrique Polo</strong> (polosoft1@gmail.com).
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="card-header">Entorno activo</div>
            <div><strong>${escapeHtml(activeName)}</strong></div>
            <div class="muted">Manager: ${escapeHtml(activeType)}</div>
            <div class="muted">Python: ${escapeHtml(activeVersion)}</div>
            <div class="muted mono" style="margin-top:4px;">${escapeHtml(activePath)}</div>
            <div class="btn-row">
              <button class="primary" data-command="activate" data-env-name="${escapeHtml(activeName)}" data-env-path="${activePathEncoded}">Activar en terminal</button>
              <button data-command="openFolder" data-env-name="${escapeHtml(activeName)}" data-env-path="${activePathEncoded}">Abrir carpeta</button>
              <button data-command="openTerminal" data-env-name="${escapeHtml(activeName)}" data-env-path="${activePathEncoded}">Abrir terminal</button>
              <button data-command="showPackages" data-env-name="${escapeHtml(activeName)}" data-env-path="${activePathEncoded}">Ver paquetes</button>
              <button data-command="installProjectDeps" data-env-name="${escapeHtml(activeName)}" data-env-path="${activePathEncoded}">Instalar deps proyecto</button>
            </div>
          </div>

          <div class="card">
            <div class="card-header">Estado del proyecto</div>
            <div class="muted">Entornos detectados: <strong>${numEnvs}</strong></div>
            <div class="muted" style="margin-top:4px;">
              Versiones Python:
              ${versions.map(v => `<span class="chip">${escapeHtml(v)}</span>`).join(' ') || '-'}
            </div>
            <div class="muted" style="margin-top:6px;">
              Auto-activacion Python:
              <span class="badge ${autoActivate ? 'badge-active' : ''}">${escapeHtml(autoActivateLabel)}</span>
              <div style="margin-top:3px;">${escapeHtml(autoActivateDetail)}</div>
            </div>
            <div class="btn-row">
              <button class="primary" data-command="createVenv">Crear entorno</button>
              <button data-command="actions">Acciones rapidas...</button>
              <button data-command="installPackage">Instalar paquete...</button>
              <button data-command="uninstallPackage">Desinstalar paquete...</button>
              <button data-command="runDiagnostics">Diagnostico</button>
              <button data-command="refresh">Refrescar</button>
              <button data-command="togglePythonAutoActivate">Alternar auto-activacion</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">Entornos detectados en el workspace</div>
          ${
            envs.length
              ? `
                <div class="control-row">
                  <label class="muted" for="managerFilter">Manager:</label>
                  <select id="managerFilter" class="select">${managerFilterOptions}</select>
                  <label class="muted" for="envSearch">Buscar:</label>
                  <input id="envSearch" class="input" placeholder="nombre, version o ruta" />
                  <label class="muted" for="envSort">Orden:</label>
                  <select id="envSort" class="select">
                    <option value="name-asc">Nombre (A-Z)</option>
                    <option value="name-desc">Nombre (Z-A)</option>
                    <option value="manager">Manager</option>
                    <option value="version">Version</option>
                    <option value="active">Activo primero</option>
                  </select>
                  <button id="resetFilters" type="button">Reset</button>
                  <span id="filterCount" class="muted"></span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Manager</th>
                      <th>Version</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody id="envSummaryBody">${envSummaryRows}</tbody>
                </table>`
              : `<div class="muted">No se detectaron entornos en esta carpeta.</div>`
          }
        </div>

        <div class="footer">Easy Env - Dashboard.</div>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          function wireButtons() {
            const buttons = document.querySelectorAll('button[data-command]');
            buttons.forEach(btn => {
              btn.addEventListener('click', () => {
                const command = btn.getAttribute('data-command');
                const envName = btn.getAttribute('data-env-name') || undefined;
                const encodedPath = btn.getAttribute('data-env-path') || '';
                const envPath = encodedPath ? decodeURIComponent(encodedPath) : undefined;
                vscode.postMessage({ command, envName, envPath });
              });
            });
          }

          function compareRows(sortMode, a, b) {
            const nameA = a.getAttribute('data-name') || '';
            const nameB = b.getAttribute('data-name') || '';
            const managerA = a.getAttribute('data-manager') || '';
            const managerB = b.getAttribute('data-manager') || '';
            const versionA = a.getAttribute('data-version') || '';
            const versionB = b.getAttribute('data-version') || '';
            const activeA = a.getAttribute('data-active') === '1' ? 1 : 0;
            const activeB = b.getAttribute('data-active') === '1' ? 1 : 0;

            if (sortMode === 'name-desc') {
              return nameB.localeCompare(nameA);
            }
            if (sortMode === 'manager') {
              const managerCmp = managerA.localeCompare(managerB);
              if (managerCmp !== 0) {
                return managerCmp;
              }
              return nameA.localeCompare(nameB);
            }
            if (sortMode === 'version') {
              const versionCmp = versionB.localeCompare(versionA);
              if (versionCmp !== 0) {
                return versionCmp;
              }
              return nameA.localeCompare(nameB);
            }
            if (sortMode === 'active') {
              if (activeA !== activeB) {
                return activeB - activeA;
              }
              return nameA.localeCompare(nameB);
            }
            return nameA.localeCompare(nameB);
          }

          function applyTableControls() {
            const managerFilter = document.getElementById('managerFilter');
            const envSearch = document.getElementById('envSearch');
            const envSort = document.getElementById('envSort');
            const body = document.getElementById('envSummaryBody');
            const counter = document.getElementById('filterCount');
            if (!managerFilter || !envSearch || !envSort || !body) {
              return;
            }

            const selectedManager = managerFilter.value;
            const search = envSearch.value.trim().toLowerCase();
            const sortMode = envSort.value;
            const rows = Array.from(body.querySelectorAll('tr[data-manager]'));

            const visibleRows = [];
            const hiddenRows = [];

            rows.forEach(row => {
              const manager = row.getAttribute('data-manager') || '';
              const name = row.getAttribute('data-name') || '';
              const version = row.getAttribute('data-version') || '';
              const path = row.getAttribute('data-path') || '';

              const managerOk = selectedManager === 'all' || manager === selectedManager;
              const searchOk =
                !search || name.includes(search) || version.includes(search) || path.includes(search);
              if (managerOk && searchOk) {
                visibleRows.push(row);
              } else {
                hiddenRows.push(row);
              }
            });

            visibleRows.sort((a, b) => compareRows(sortMode, a, b));

            visibleRows.forEach(row => {
              row.style.display = '';
              body.appendChild(row);
            });
            hiddenRows.forEach(row => {
              row.style.display = 'none';
              body.appendChild(row);
            });

            if (counter) {
              counter.textContent = 'Mostrando ' + visibleRows.length + ' de ' + rows.length;
            }

            vscode.setState({
              selectedManager,
              search,
              sortMode
            });
          }

          function initTableControls() {
            const managerFilter = document.getElementById('managerFilter');
            const envSearch = document.getElementById('envSearch');
            const envSort = document.getElementById('envSort');
            const resetFilters = document.getElementById('resetFilters');
            if (!managerFilter || !envSearch || !envSort) {
              return;
            }

            const state = vscode.getState() || {};
            if (state.selectedManager) {
              const hasManager = Array.from(managerFilter.options).some(o => o.value === state.selectedManager);
              if (hasManager) {
                managerFilter.value = state.selectedManager;
              }
            }
            if (state.search) {
              envSearch.value = state.search;
            }
            if (state.sortMode) {
              const hasSort = Array.from(envSort.options).some(o => o.value === state.sortMode);
              if (hasSort) {
                envSort.value = state.sortMode;
              }
            }

            managerFilter.addEventListener('change', applyTableControls);
            envSearch.addEventListener('input', applyTableControls);
            envSort.addEventListener('change', applyTableControls);
            if (resetFilters) {
              resetFilters.addEventListener('click', () => {
                managerFilter.value = 'all';
                envSearch.value = '';
                envSort.value = 'name-asc';
                applyTableControls();
              });
            }

            applyTableControls();
          }

          window.addEventListener('load', () => {
            wireButtons();
            initTableControls();
          });
        </script>
      </body>
      </html>`;
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeForCompare(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
