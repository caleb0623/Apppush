// Optional helper: runs a private mysqld on port 3307 with its data in .local/mysql-data.
// It uses the installed MySQL binaries but never touches an existing MySQL service or its data.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(root, '.local');
const dataDir = join(local, 'mysql-data');
const logFile = join(local, 'mysqld.log');
const port = 3307;
const bin = process.env.MYSQL_BIN ?? 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin';
const mysqld = join(bin, 'mysqld.exe');
const mysql = join(bin, 'mysql.exe');
const mysqladmin = join(bin, 'mysqladmin.exe');
const rootArgs = ['--protocol=TCP', '-h', '127.0.0.1', '-P', String(port), '-u', 'root'];

const isUp = () =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

async function start() {
  if (await isUp()) return console.log(`Local MySQL already listening on ${port}.`);
  const log = openSync(logFile, 'a');
  const child = spawn(
    mysqld,
    [
      '--no-defaults',
      `--datadir=${dataDir}`,
      `--port=${port}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=OFF',
      '--console',
    ],
    { detached: true, stdio: ['ignore', log, log], windowsHide: true },
  );
  child.unref();
  for (let i = 0; i < 60; i += 1) {
    if (await isUp()) return console.log(`Local MySQL listening on 127.0.0.1:${port}.`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`mysqld did not start; see ${logFile}`);
}

async function init() {
  mkdirSync(local, { recursive: true });
  if (!existsSync(dataDir)) {
    console.log('Initialising private data directory...');
    execFileSync(mysqld, ['--no-defaults', '--initialize-insecure', `--datadir=${dataDir}`], {
      stdio: 'inherit',
    });
  }
  await start();
  const sql = readFileSync(join(local, 'setup-mysql.sql'), 'utf8');
  execFileSync(mysql, rootArgs, { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
  console.log('Provisioned apppush user and databases.');
}

async function stop() {
  if (!(await isUp())) return console.log('Local MySQL is not running.');
  execFileSync(mysqladmin, [...rootArgs, 'shutdown'], { stdio: 'inherit' });
  console.log('Local MySQL stopped.');
}

const commands = {
  init,
  start,
  stop,
  status: async () => console.log((await isUp()) ? `running on ${port}` : 'stopped'),
};
const command = commands[process.argv[2]];
if (!command) {
  console.error('Usage: local-mysql.mjs <init|start|stop|status>');
  process.exit(1);
}
await command();
