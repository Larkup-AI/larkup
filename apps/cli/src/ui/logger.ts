import chalk from "chalk";

/**
 * Consistent logging utilities for the CLI.
 */
export const log = {
  /** Standard info message (default color) */
  info: (msg: string) => process.stdout.write(msg + "\n"),
  /** Success message (green) */
  success: (msg: string) => process.stdout.write(chalk.green(`✓ ${msg}`) + "\n"),
  /** Error message (red) and exit */
  error: (msg: string): never => {
    process.stderr.write(chalk.red(`✗ ${msg}`) + "\n");
    process.exit(1);
  },
  /** Warning message (yellow) */
  warn: (msg: string) => process.stdout.write(chalk.yellow(`! ${msg}`) + "\n"),
  /** Dimmed/secondary text */
  dim: (msg: string) => process.stdout.write(chalk.dim(msg) + "\n"),
  /** Emphasized text block */
  bold: (msg: string) => process.stdout.write(chalk.bold(msg) + "\n"),
  /** Inline formatting helpers */
  fmt: {
    dim: chalk.dim,
    bold: chalk.bold,
    green: chalk.green,
    red: chalk.red,
    cyan: chalk.cyan,
    yellow: chalk.yellow,
  },
};
