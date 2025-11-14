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
exports.EnvTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class EnvTreeProvider {
    envs;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    constructor(envs) {
        this.envs = envs;
    }
    refresh(envs) {
        this.envs = envs;
        this._onDidChangeTreeData.fire(null);
    }
    getTreeItem(env) {
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
    getChildren() {
        return this.envs;
    }
}
exports.EnvTreeProvider = EnvTreeProvider;
//# sourceMappingURL=envTree.js.map