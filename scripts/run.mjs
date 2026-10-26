import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
if (existsSync('.env'))
  for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8'))))
    process.env[key] ??= value;
if (process.argv.includes('start') || process.argv.includes('build'))
  process.env.NODE_ENV = 'production';
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.PRISMA_CLI_QUERY_ENGINE_TYPE = 'client';

const tool = process.argv[2];
let cli;
try {
  if (tool === 'npm') {
    cli =
      process.env.npm_execpath ??
      resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  } else {
    const require = createRequire(resolve('package.json'));
    const packagePath = require.resolve(tool + '/package.json');
    const metadata = JSON.parse(readFileSync(packagePath, 'utf8'));
    const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.[tool];
    if (!bin) throw new Error('Missing CLI entry');
    cli = resolve(dirname(packagePath), bin);
  }
  if (!existsSync(cli)) throw new Error('Missing CLI file');
} catch {
  console.error('Tool is not installed. Run npm ci successfully, then retry through npm run.');
  process.exit(1);
}
// Windows .cmd shims cannot be spawned like Unix executables. Run the JS CLI
// through Node on every platform, preserving arguments without a shell.
const child = spawn(process.execPath, [cli, ...process.argv.slice(3)], {
  stdio: 'inherit',
  env: process.env,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));

child.on('error', () => {
  console.error('Unable to start Node.js for the requested tool. Check the Node.js installation.');
  process.exitCode = 1;
});
