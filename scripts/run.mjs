import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
if (existsSync('.env'))
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8'))))
    process.env[key] ??= value;
if (process.argv.includes('start') || process.argv.includes('build'))
  process.env.NODE_ENV = 'production';
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.PRISMA_CLI_QUERY_ENGINE_TYPE = 'client';

const executable = existsSync('node_modules/.bin/' + process.argv[2])
  ? resolve('node_modules/.bin/' + process.argv[2])
  : process.argv[2];
const child = spawn(executable, process.argv.slice(3), { stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));

child.on('error', () => {
  console.error('Unable to start requested tool. Run npm ci first.');
  process.exitCode = 1;
});
