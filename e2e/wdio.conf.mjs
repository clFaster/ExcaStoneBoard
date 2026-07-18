import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactsDir = path.resolve(__dirname, '.wdio-artifacts');
const tauriDriverPort = 4444;

const appBinaryName = process.platform === 'win32' ? 'excastoneboard.exe' : 'excastoneboard';
const defaultAppBinaryPath = path.resolve(
  repoRoot,
  'src-tauri',
  'target',
  'debug',
  appBinaryName,
);
const appBinaryPath = process.env.TAURI_APP_BINARY_PATH
  ? path.resolve(process.env.TAURI_APP_BINARY_PATH)
  : defaultAppBinaryPath;

const tauriDriverBinary = path.resolve(
  os.homedir(),
  '.cargo',
  'bin',
  process.platform === 'win32' ? 'tauri-driver.exe' : 'tauri-driver',
);

// keep track of the `tauri-driver` child process
let tauriDriver;
let tauriDriverShuttingDown = false;

// The application reads these variables to isolate its data under a temporary
// directory instead of the real app-data folder. The persistence specs rely on
// them staying stable across `browser.reloadSession()` restarts.
function setupTestEnvironment() {
  if (!process.env.TAURI_TEST_MODE) {
    process.env.TAURI_TEST_MODE = '1';
  }
  if (!process.env.TAURI_TEST_RUN_ID) {
    process.env.TAURI_TEST_RUN_ID = `wdio-${Date.now()}`;
  }
  if (!process.env.TAURI_TEST_DATA_ROOT) {
    process.env.TAURI_TEST_DATA_ROOT = path.resolve(repoRoot, '.system-test-data');
  }
}

function cleanupTestData() {
  if (process.env.TAURI_TEST_KEEP_DATA === '1') {
    return;
  }
  const dataRoot = process.env.TAURI_TEST_DATA_ROOT;
  if (dataRoot) {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

// CI supplies the release binary built in the preceding job. For local runs,
// retain the convenient fallback of building a debug binary on demand.
function ensureAppAvailable() {
  if (process.env.TAURI_APP_BINARY_PATH) {
    if (!fs.existsSync(appBinaryPath)) {
      throw new Error(`Supplied Tauri app binary was not found at ${appBinaryPath}.`);
    }
    return;
  }

  const result = spawnSync('pnpm', ['tauri', 'build', '--debug', '--no-bundle'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error('Failed to build the Tauri debug binary for the system tests.');
  }
  if (!fs.existsSync(appBinaryPath)) {
    throw new Error(`Expected Tauri debug binary at ${appBinaryPath}, but it was not found.`);
  }
}

function waitForPort(port, timeoutMs) {
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
          reject(new Error(`Timed out waiting for tauri-driver on port ${port}.`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

// ensure we are running `tauri-driver` before the session starts so that we can proxy the webdriver requests
function startTauriDriver() {
  tauriDriverShuttingDown = false;

  const logStream = fs.createWriteStream(path.join(artifactsDir, 'tauri-driver.log'), {
    flags: 'a',
  });

  tauriDriver = spawn(tauriDriverBinary, [], { stdio: [null, 'pipe', 'pipe'] });

  tauriDriver.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    logStream.write(chunk);
  });
  tauriDriver.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });

  tauriDriver.on('error', (error) => {
    console.error('tauri-driver error:', error);
    process.exit(1);
  });
  tauriDriver.on('exit', (code) => {
    logStream.end();
    if (!tauriDriverShuttingDown && code !== 0) {
      console.error(`tauri-driver exited unexpectedly with code ${code}.`);
      process.exit(1);
    }
  });

  return waitForPort(tauriDriverPort, 30000);
}

// clean up the `tauri-driver` process we spawned at the start of the session
function closeTauriDriver() {
  tauriDriverShuttingDown = true;
  tauriDriver?.kill();
  tauriDriver = undefined;
}

export const config = {
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
  outputDir: artifactsDir,
  logLevel: 'warn',
  connectionRetryTimeout: 120000,
  connectionRetryCount: 2,
  waitforTimeout: 10000,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },

  onPrepare: () => {
    setupTestEnvironment();
    fs.mkdirSync(path.join(artifactsDir, 'screenshots'), { recursive: true });
    cleanupTestData();
    ensureAppAvailable();
  },

  beforeSession: () => startTauriDriver(),

  afterSession: () => closeTauriDriver(),

  onComplete: () => cleanupTestData(),

  afterTest: async (test, _context, result) => {
    if (result.passed) {
      return;
    }
    const testName = (test.fullTitle || test.title || 'test-failure').replace(
      /[^a-zA-Z0-9_.-]/g,
      '_',
    );
    await browser.saveScreenshot(path.join(artifactsDir, 'screenshots', `${testName}.png`));
  },
};

// note that `afterSession` might not run if the session fails to start, so we
// also run the cleanup on shutdown to avoid leaking the `tauri-driver` process
function onShutdown(fn) {
  const cleanup = () => {
    try {
      fn();
    } finally {
      process.exit();
    }
  };

  process.on('exit', fn);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGHUP', cleanup);
  process.on('SIGBREAK', cleanup);
}

onShutdown(() => closeTauriDriver());
