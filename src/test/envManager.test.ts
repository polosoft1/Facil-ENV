import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EnvManager } from '../envManager';

function pythonExecutablePath(envDir: string): string {
  return process.platform === 'win32'
    ? path.join(envDir, 'Scripts', 'python.exe')
    : path.join(envDir, 'bin', 'python');
}

function touchFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '', 'utf8');
}

suite('EnvManager Detection', () => {
  const tempDirs: string[] = [];

  teardown(() => {
    while (tempDirs.length) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function createWorkspace(): string {
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

    const manager = new EnvManager(workspace);
    const managerAny = manager as any;
    managerAny.commandAvailability.set('conda', false);
    managerAny.commandAvailability.set('poetry', false);
    managerAny.commandAvailability.set('pipenv', false);
    managerAny.runCommand = (command: string) => {
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

    const manager = new EnvManager(workspace);
    const managerAny = manager as any;
    managerAny.commandExists = (command: string) => command === 'pipenv';
    managerAny.runCommand = (command: string) => {
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

    const manager = new EnvManager(workspace);
    const managerAny = manager as any;
    managerAny.commandExists = (command: string) => command === 'conda';
    managerAny.runCommand = (command: string) => {
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
