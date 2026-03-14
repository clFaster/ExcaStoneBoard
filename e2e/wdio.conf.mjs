import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tauriDriverPort = 4444;

const appBinaryName = process.platform === 'win32' ? 'excastoneboard.exe' : 'excastoneboard';
const appBinaryPath = path.resolve(repoRoot, 'src-tauri', 'target', 'debug', appBinaryName);

const defaultTauriDriverPath = path.resolve(
  os.homedir(),
  '.cargo',
  'bin',
  process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver',
);

const tauriDriverBinary =
  process.env.TAURI_DRIVER_PATH ||
  (fs.existsSync(defaultTauriDriverPath) ? defaultTauriDriverPath : 'tauri-driver');

let tauriDriverProcess;
let tauriDriverExitExpected = false;

function ensureSystemTestEnvironment() {
  if (!process.env.TAURI_TEST_MODE) {
    process.env.TAURI_TEST_MODE = '1';
  }

  const reuseRunId = process.env.TAURI_TEST_REUSE_RUN_ID === '1';
  if (!reuseRunId || !process.env.TAURI_TEST_RUN_ID) {
    process.env.TAURI_TEST_RUN_ID = `wdio-${Date.now()}`;
  }

  if (!process.env.TAURI_TEST_DATA_ROOT) {
    process.env.TAURI_TEST_DATA_ROOT = path.resolve(repoRoot, '.system-test-data');
  }
}

function sanitizeRunId(value) {
  return value
    .split('')
    .map((character) => (/^[a-zA-Z0-9_-]$/.test(character) ? character : '_'))
    .join('');
}

function getCurrentRunDataDir() {
  const dataRoot = process.env.TAURI_TEST_DATA_ROOT;
  const runId = process.env.TAURI_TEST_RUN_ID;

  if (!dataRoot || !runId) {
    return null;
  }

  return path.join(dataRoot, sanitizeRunId(runId));
}

async function cleanupCurrentRunData() {
  const runDataDir = getCurrentRunDataDir();
  if (!runDataDir) {
    return;
  }

  await fs.promises.rm(runDataDir, { recursive: true, force: true });
}

function shouldCleanupTestData() {
  const keepData = process.env.TAURI_TEST_KEEP_DATA === '1';
  return !keepData;
}

function buildDebugTauriApp() {
  const result =
    process.platform === 'win32'
      ? spawnSync('pnpm run tauri build --debug --no-bundle', {
          cwd: repoRoot,
          stdio: 'inherit',
          shell: true,
          env: process.env,
        })
      : spawnSync('pnpm', ['run', 'tauri', 'build', '--debug', '--no-bundle'], {
          cwd: repoRoot,
          stdio: 'inherit',
          env: process.env,
        });

  if (result.status !== 0) {
    const details = result.error ? ` (${result.error.message})` : '';
    throw new Error(`Failed to build Tauri app for system tests${details}`);
  }

  if (!fs.existsSync(appBinaryPath)) {
    throw new Error(`Expected Tauri debug binary at ${appBinaryPath}, but it was not found.`);
  }
}

function ensureBinaryAvailable(commandName) {
  const lookup =
    process.platform === 'win32'
      ? spawnSync('where', [commandName], { stdio: 'ignore', shell: true })
      : spawnSync('which', [commandName], { stdio: 'ignore' });

  return lookup.status === 0;
}

function verifyDriverPrerequisites() {
  if (path.isAbsolute(tauriDriverBinary) && !fs.existsSync(tauriDriverBinary)) {
    throw new Error(`TAURI_DRIVER_PATH points to a missing binary: ${tauriDriverBinary}`);
  }

  if (!path.isAbsolute(tauriDriverBinary) && !ensureBinaryAvailable('tauri-driver')) {
    throw new Error('tauri-driver not found. Install it with: cargo install tauri-driver --locked');
  }

  if (process.platform === 'win32' && !process.env.TAURI_NATIVE_DRIVER_PATH) {
    const hasEdgeDriver = ensureBinaryAvailable('msedgedriver');
    if (!hasEdgeDriver) {
      throw new Error(
        'msedgedriver not found in PATH. Install a version matching Edge or set TAURI_NATIVE_DRIVER_PATH.',
      );
    }
  }
}

function waitForDriverReady(port, timeoutMs) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port });

      socket.once('connect', () => {
        socket.end();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();

        if (Date.now() - start >= timeoutMs) {
          reject(
            new Error(
              `Timed out waiting for tauri-driver on port ${port}. Ensure msedgedriver is available and matches Edge version.`,
            ),
          );
          return;
        }

        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

async function startTauriDriver() {
  verifyDriverPrerequisites();

  if (tauriDriverProcess && tauriDriverProcess.exitCode === null) {
    return;
  }

  tauriDriverExitExpected = false;
  tauriDriverProcess = spawn(tauriDriverBinary, [], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  tauriDriverProcess.on('exit', (code) => {
    tauriDriverProcess = undefined;

    if (code === 0) {
      return;
    }

    if (!tauriDriverExitExpected) {
      console.error(`tauri-driver exited unexpectedly with code ${code}.`);
      process.exitCode = 1;
    }
  });

  await waitForDriverReady(tauriDriverPort, 10000);
}

function stopTauriDriver() {
  tauriDriverExitExpected = true;
  tauriDriverProcess?.kill();
  tauriDriverProcess = undefined;
}

export const config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: tauriDriverPort,
  specs: ['./specs/system.e2e.mjs'],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: appBinaryPath,
      },
    },
  ],
  logLevel: 'warn',
  bail: 0,
  maxInstancesPerCapability: 1,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  services: [],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  onPrepare: async () => {
    ensureSystemTestEnvironment();
    if (shouldCleanupTestData()) {
      await cleanupCurrentRunData();
    }
    try {
      verifyDriverPrerequisites();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    }
    buildDebugTauriApp();
    await startTauriDriver();
  },
  onComplete: () => {
    stopTauriDriver();
    if (shouldCleanupTestData()) {
      const runDataDir = getCurrentRunDataDir();
      if (runDataDir) {
        fs.rmSync(runDataDir, { recursive: true, force: true });
      }
    }
  },
};
