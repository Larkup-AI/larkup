import path from 'node:path';
import { spawn } from 'node:child_process';
import { readConfig } from '@larkup/core/config-store';
import { emitToDisk } from '@larkup/core/generator/server-runtime';
import { log } from '../ui/logger';
import { inServerScope, requireActive } from '../lib/scope';

export async function serveCommand(options: { server?: string }) {
  await inServerScope(options.server, async () => {
    const server = await requireActive();
    const config = await readConfig();

    const isLocalLance =
      config.vectorStore === 'lancedb' && (config.storeConfig.mode ?? 'local') === 'local';

    const dir = await emitToDisk(config);
    log.info(log.fmt.cyan('Installing minimal server dependencies…'));

    await new Promise<void>((resolve, reject) => {
      const child = spawn('npm', ['install', '--omit=dev'], { cwd: dir, stdio: 'inherit' });
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`npm install exited with code ${code}`)),
      );
      child.on('error', reject);
    });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(server.port),
      TOP_K: String(config.topK),
    };

    if (isLocalLance) {
      const dbPath = config.storeConfig.dbPath || './.larkup/lancedb';
      env.LANCEDB_MODE = 'local';
      env.LANCEDB_PATH = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
      env.LANCEDB_TABLE = config.storeConfig.tableName || 'documents';
    } else if (config.vectorStore === 'lancedb') {
      env.LANCEDB_MODE = config.storeConfig.mode || 'cloud';
      env.LANCEDB_TABLE = config.storeConfig.tableName || 'documents';
      env.LANCEDB_URI = config.storeConfig.uri || '';
      env.LANCEDB_API_KEY = config.storeConfig.apiKey || '';
      env.LANCEDB_S3_URI = config.storeConfig.s3Uri || '';
      env.AWS_ENDPOINT = config.storeConfig.s3Endpoint || '';
      env.AWS_REGION = config.storeConfig.s3Region || '';
      env.AWS_ACCESS_KEY_ID = config.storeConfig.s3AccessKeyId || '';
      env.AWS_SECRET_ACCESS_KEY = config.storeConfig.s3SecretAccessKey || '';
    }

    log.success(`Serving ${log.fmt.bold(config.projectName)} on http://localhost:${server.port}`);
    log.dim('  POST /query  ·  POST /chat  ·  GET /health  ·  Ctrl+C to stop');

    const child = spawn('node', ['--env-file=.env', 'server.mjs'], {
      cwd: dir,
      stdio: 'inherit',
      env,
    });

    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve());
      process.on('SIGINT', () => child.kill('SIGINT'));
      process.on('SIGTERM', () => child.kill('SIGTERM'));
    });
  });
}
