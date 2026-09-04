import { spawn } from 'node:child_process';
import chalk from 'chalk';
import pkg from '../../package.json' with { type: 'json' };
import { getLatestVersion, isVersionNewer } from '../updater';
import { log } from '../ui/logger';
import { prompts } from '../ui/prompts';
import { updateEnterpriseCommand } from './enterprise-update';

export async function updateCommand(options: { check?: boolean; ee?: boolean }) {
  if (options.ee) {
    await updateEnterpriseCommand();
    return;
  }

  const latest = await getLatestVersion();
  if (!latest) {
    log.warn('Could not check for an update. Try again when you are online.');
    return;
  }

  if (!isVersionNewer(latest, pkg.version)) {
    // Already up to date — show a prominent banner
    console.log('');
    log.info(chalk.bold('╭──────────────────────────────────────────────╮'));
    log.info(chalk.bold(`│  ✓ Already up to date!                       │`));
    log.info(
      chalk.bold(
        `│    Larkup CLI  ${pkg.version}${' '.repeat(Math.max(1, 30 - pkg.version.length))}│`,
      ),
    );
    log.info(chalk.bold('╰──────────────────────────────────────────────╯'));
    console.log('');
    return;
  }

  log.info(`Update available: ${pkg.version} → ${latest}`);
  if (options.check) return;

  // Show a spinner with dark/black text while npm installs
  const s = prompts.spinner();
  s.start(chalk.black(`Updating Larkup CLI  ${pkg.version} → ${latest} …`));

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('npm', ['install', '-g', `@larkup/cli@${latest}`], { stdio: 'pipe' });
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`npm exited with code ${code}`)),
      );
    });
  } catch (err) {
    s.stop(chalk.red(`✗ Update failed`));
    throw err;
  }

  s.stop(chalk.black(`Done!`));

  // Big success banner
  console.log('');
  log.info(chalk.bold('╭──────────────────────────────────────────────╮'));
  log.info(chalk.bold(`│  ✓ Updated to ${latest}!${' '.repeat(Math.max(1, 31 - latest.length))}│`));
  log.info(chalk.bold('│    Restart your terminal to apply the update. │'));
  log.info(chalk.bold('╰──────────────────────────────────────────────╯'));
  console.log('');
}
