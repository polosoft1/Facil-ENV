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
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const envManager_1 = require("../envManager");
function pythonExecutablePath(envDir) {
    return process.platform === 'win32'
        ? path.join(envDir, 'Scripts', 'python.exe')
        : path.join(envDir, 'bin', 'python');
}
function touchFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf8');
}
suite('EnvManager Detection', () => {
    const tempDirs = [];
    teardown(() => {
        while (tempDirs.length) {
            const dir = tempDirs.pop();
            if (dir) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });
    function createWorkspace() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-env-test-'));
        tempDirs.push(dir);
        return dir;
    }
    test('detects uv workspace via uv.lock and classifies .venv as uv', async () => {
        const workspace = createWorkspace();
        const uvEnvDir = path.join(workspace, '.venv');
        const classicEnvDir = path.join(workspace, '.qa');
        touchFile(path.join(workspace, 'uv.lock'));
        touchFile(pythonExecutablePath(uvEnvDir));
        touchFile(pythonExecutablePath(classicEnvDir));
        const manager = new envManager_1.EnvManager(workspace);
        const managerAny = manager;
        managerAny.commandAvailability.set('conda', false);
        managerAny.commandAvailability.set('poetry', false);
        managerAny.commandAvailability.set('pipenv', false);
        managerAny.runCommand = (command) => {
            if (command.includes('--version')) {
                return 'Python 3.11.9';
            }
            return undefined;
        };
        const envs = await manager.scanEnvs();
        assert.ok(envs.some(env => env.name === '.venv' && env.type === 'uv'));
        assert.ok(envs.some(env => env.name === '.qa' && env.type === 'venv'));
    });
    test('detects pipenv env when Pipfile exists and pipenv returns a path', async () => {
        const workspace = createWorkspace();
        const pipenvEnvDir = path.join(workspace, '.pipenv-env');
        touchFile(path.join(workspace, 'Pipfile'));
        touchFile(pythonExecutablePath(pipenvEnvDir));
        const manager = new envManager_1.EnvManager(workspace);
        const managerAny = manager;
        managerAny.commandExists = (command) => command === 'pipenv';
        managerAny.runCommand = (command) => {
            if (command === 'pipenv --venv') {
                return pipenvEnvDir;
            }
            if (command.includes('--version')) {
                return 'Python 3.10.14';
            }
            return undefined;
        };
        const envs = await manager.scanEnvs();
        assert.ok(envs.some(env => env.path === pipenvEnvDir && env.type === 'pipenv'));
    });
    test('detects conda envs and skips root prefix', async () => {
        const workspace = createWorkspace();
        const condaRoot = path.join(workspace, 'conda-root');
        const condaEnvA = path.join(workspace, 'conda-env-a');
        const condaEnvB = path.join(workspace, 'conda-env-b');
        touchFile(pythonExecutablePath(condaRoot));
        touchFile(pythonExecutablePath(condaEnvA));
        touchFile(pythonExecutablePath(condaEnvB));
        const manager = new envManager_1.EnvManager(workspace);
        const managerAny = manager;
        managerAny.commandExists = (command) => command === 'conda';
        managerAny.runCommand = (command) => {
            if (command === 'conda env list --json') {
                return JSON.stringify({
                    envs: [condaRoot, condaEnvA, condaEnvB]
                });
            }
            if (command === 'conda info --json') {
                return JSON.stringify({
                    root_prefix: condaRoot
                });
            }
            if (command.includes('--version')) {
                return 'Python 3.9.20';
            }
            return undefined;
        };
        const envs = await manager.scanEnvs();
        assert.ok(envs.some(env => env.path === condaEnvA && env.type === 'conda'));
        assert.ok(envs.some(env => env.path === condaEnvB && env.type === 'conda'));
        assert.ok(!envs.some(env => env.path === condaRoot && env.type === 'conda'));
    });
});
//# sourceMappingURL=envManager.test.js.map