import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const runner = resolve('scripts/run.mjs');
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'kpi runner '));
  temporary.push(cwd);
  writeFileSync(join(cwd, 'package.json'), '{}');
  const dir = join(cwd, 'node_modules', 'fixture-tool');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ bin: { 'fixture-tool': 'cli file.cjs' } }),
  );
  const cli = join(dir, 'cli file.cjs');
  writeFileSync(
    cli,
    'console.log(JSON.stringify({args:process.argv.slice(2), value:process.env.RUNNER_TEST_VALUE}));process.exitCode=Number(process.env.RUNNER_TEST_EXIT??0);',
  );
  return { cwd, cli };
}

test('runs a package CLI without executable shims and preserves shell characters and env precedence', () => {
  const { cwd } = fixture();
  writeFileSync(join(cwd, '.env'), 'RUNNER_TEST_VALUE=from-file\n');
  const args = ['space argument', 'literal&|<>^%', '$(echo must-stay-literal)'];
  const result = spawnSync(process.execPath, [runner, 'fixture-tool', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, RUNNER_TEST_VALUE: 'exported' },
  });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ args, value: 'exported' });
});

test('launches npm via npm_execpath even when its path contains spaces and propagates exit status', () => {
  const { cwd, cli } = fixture();
  const result = spawnSync(process.execPath, [runner, 'npm', 'run', 'dev'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_execpath: cli, RUNNER_TEST_EXIT: '7' },
  });
  expect(result.status).toBe(7);
  expect(JSON.parse(result.stdout).args).toEqual(['run', 'dev']);
});

test('reports missing dependencies before attempting to launch a command', () => {
  const { cwd } = fixture();
  const result = spawnSync(process.execPath, [runner, 'missing-kpi-tool'], {
    cwd,
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Run npm ci successfully');
});
