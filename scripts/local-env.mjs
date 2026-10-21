import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env')) {
  let text = readFileSync('.env.example', 'utf8');
  const password = randomBytes(24).toString('hex');
  text = text
    .replace('CHANGE_ME', password)
    .replace('POSTGRES_PASSWORD=', 'POSTGRES_PASSWORD=' + password)
    .replace('AUTH_SECRET=', 'AUTH_SECRET=' + randomBytes(32).toString('hex'));
  writeFileSync('.env', text, { mode: 0o600 });
  console.log('Created local .env with random credentials; demo users disabled.');
}
