import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getActiveServer } from '@larkup/core/workspace';
import { NodeSSH } from 'node-ssh';
import crypto from 'crypto';

function getFilesRecursively(dir: string, baseDir: string): any[] {
  let results: any[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (file === 'node_modules' || file === '.git' || file === 'server.log') continue;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath, baseDir));
    } else {
      const data = fs.readFileSync(filePath);
      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
      results.push({ file: relativePath, data: data.toString('utf8') });
    }
  }
  return results;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  let {
    serverId,
    host,
    username,
    privateKeyOrPassword,
    envVars,
    newPassword: userNewPassword,
  } = body;

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: any) {
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (e) {}
      }
      function log(msg: string) {
        sendEvent({ type: 'log', message: msg });
      }
      function done(result: any) {
        sendEvent({ type: 'done', ...result });
        try {
          controller.close();
        } catch (e) {}
      }
      function errorMsg(err: string) {
        sendEvent({ type: 'error', error: err });
        try {
          controller.close();
        } catch (e) {}
      }

      let activeId = serverId;
      if (activeId === 'default') {
        const server = await getActiveServer();
        if (server) activeId = server.id;
      }

      if (!host || !username || !privateKeyOrPassword.value) {
        return errorMsg('Host, username, and credentials are required.');
      }

      try {
        log(`Preparing deployment for server ${activeId}...`);
        const cwd = process.cwd();
        let config: any = null;
        const configCandidates = [
          path.join(cwd, '.larkup', 'servers', activeId, 'config.json'),
          path.join(cwd, '.larkup', 'config.json'),
        ];
        for (const cfgPath of configCandidates) {
          if (fs.existsSync(cfgPath)) {
            try {
              config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
              break;
            } catch {}
          }
        }

        if (!config) {
          return errorMsg('Configuration not found. Please save your settings first.');
        }

        const { generateServer } = await import('@larkup/core/generator/generate-server');
        const generated = generateServer(config);

        const filesToUpload: { localPath?: string; contents?: string; remotePath: string }[] = [];

        for (const f of generated.files) {
          filesToUpload.push({ contents: f.contents, remotePath: f.path });
        }

        const envLines = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);
        const isLanceLocal =
          config.vectorStore === 'lancedb' && config.storeConfig?.mode !== 'cloud';
        if (isLanceLocal) {
          envLines.push('LANCEDB_PATH=./.larkup/lancedb');
        }
        filesToUpload.push({ contents: envLines.join('\n'), remotePath: '.env' });

        if (isLanceLocal) {
          const lancedbDir = path.join(cwd, '.larkup', 'servers', activeId, 'lancedb');
          if (fs.existsSync(lancedbDir)) {
            const lancedbFiles = getFilesRecursively(
              lancedbDir,
              path.join(cwd, '.larkup', 'servers', activeId),
            );
            for (const f of lancedbFiles) {
              filesToUpload.push({
                localPath: path.join(cwd, '.larkup', 'servers', activeId, f.file),
                remotePath: f.file,
              });
            }
          }
        }

        let updatedPassword = userNewPassword || '';
        let ssh = new NodeSSH();
        log(`Connecting to ${username}@${host} via SSH...`);

        const connectOpts = {
          host,
          username,
          privateKey: privateKeyOrPassword.type === 'key' ? privateKeyOrPassword.value : undefined,
          password:
            privateKeyOrPassword.type === 'password' ? privateKeyOrPassword.value : undefined,
          readyTimeout: 20000,
          tryKeyboard: true,
          onKeyboardInteractive: (
            _name: string,
            _instructions: string,
            _instructionsLang: string,
            prompts: { prompt: string; echo: boolean }[],
            finish: (responses: string[]) => void,
          ) => {
            if (prompts.length > 0 && privateKeyOrPassword.type === 'password') {
              const answers = prompts.map((p) => {
                return privateKeyOrPassword.value;
              });
              finish(answers);
            } else {
              finish([]);
            }
          },
        };

        await ssh.connect(connectOpts);
        log(`Connected successfully.`);

        // Helper to run commands and stream output
        const runCommand = async (cmd: string, opts?: { cwd?: string; ignoreErrors?: boolean }) => {
          log(`$ ${cmd}`);
          const res = await ssh.execCommand(cmd, {
            cwd: opts?.cwd,
            onStdout: (chunk: Buffer) => log(chunk.toString('utf8').trimEnd()),
            onStderr: (chunk: Buffer) => log(chunk.toString('utf8').trimEnd()),
          });
          const combined = `${res.stdout} ${res.stderr}`.toLowerCase();
          if (
            combined.includes('password change required') ||
            combined.includes('password has expired')
          ) {
            throw new Error('PASSWORD_EXPIRED');
          }
          if (res.code !== 0 && !opts?.ignoreErrors) {
            throw new Error(`Command failed (exit ${res.code}): ${cmd}\n${res.stderr}`);
          }
          return res;
        };

        const remoteDir = `/opt/buddyhere-rag-${activeId}`;

        let needsPasswordChange = false;
        try {
          await runCommand('echo ok');
        } catch (err: any) {
          if (err.message === 'PASSWORD_EXPIRED') {
            needsPasswordChange = true;
          } else {
            throw err;
          }
        }

        if (needsPasswordChange) {
          if (!updatedPassword) {
            log(`⚠️ Password has expired! A new password is required.`);
            sendEvent({ type: 'password_change_required' });
            try {
              controller.close();
            } catch (e) {}
            return;
          }

          log(`⚠️ Password has expired! Changing password...`);

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Password change timed out after 30 seconds.'));
            }, 30000);

            ssh
              .requestShell({ term: 'xterm' })
              .then((shell) => {
                let buffer = '';
                let stage = 0; // 0=waiting for current, 1=waiting for new, 2=waiting for retype, 3=done

                shell.on('data', (data: Buffer) => {
                  const text = data.toString('utf8');
                  buffer += text;
                  const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
                  if (clean) log(clean);

                  const lower = buffer.toLowerCase();

                  if (stage === 0) {
                    if (
                      (lower.includes('current') || lower.includes('old')) &&
                      lower.includes('password')
                    ) {
                      shell.write(privateKeyOrPassword.value + '\n');
                      buffer = '';
                      stage = 1;
                    } else if (lower.includes('new') && lower.includes('password')) {
                      // Hetzner sometimes skips asking for the current password
                      shell.write(updatedPassword + '\n');
                      buffer = '';
                      stage = 2;
                    }
                  } else if (stage === 1 && lower.includes('new') && lower.includes('password')) {
                    shell.write(updatedPassword + '\n');
                    buffer = '';
                    stage = 2;
                  } else if (
                    stage === 2 &&
                    (lower.includes('retype') ||
                      lower.includes('re-enter') ||
                      lower.includes('confirm') ||
                      (lower.includes('new') && lower.includes('password')))
                  ) {
                    shell.write(updatedPassword + '\n');
                    buffer = '';
                    stage = 3;
                  } else if (
                    stage === 3 &&
                    (lower.includes('updated successfully') ||
                      lower.includes('password changed') ||
                      lower.includes('$') ||
                      lower.includes('#'))
                  ) {
                    clearTimeout(timeout);
                    shell.end();
                    resolve();
                  }
                });

                shell.on('close', () => {
                  clearTimeout(timeout);
                  resolve();
                });
                shell.on('error', (err: Error) => {
                  clearTimeout(timeout);
                  reject(err);
                });
              })
              .catch((err: Error) => {
                clearTimeout(timeout);
                reject(err);
              });
          });

          log('✅ Password changed successfully.');
          sendEvent({ type: 'password_changed', newPassword: updatedPassword });

          // Disconnect and reconnect with the new password
          ssh.dispose();
          log('Reconnecting with new password...');
          ssh = new NodeSSH();
          await ssh.connect({
            ...connectOpts,
            password: updatedPassword,
            onKeyboardInteractive: (
              _name: string,
              _instructions: string,
              _instructionsLang: string,
              prompts: { prompt: string; echo: boolean }[],
              finish: (responses: string[]) => void,
            ) => {
              if (prompts.length > 0) {
                finish(prompts.map(() => updatedPassword));
              } else {
                finish([]);
              }
            },
          });
          log('Reconnected successfully.');
        }

        // ── Step 3: Ensure Docker is installed ──
        log('Checking for Docker...');
        const dockerCheck = await runCommand('docker --version', { ignoreErrors: true });
        if (dockerCheck.code !== 0) {
          log('Docker not found. Installing Docker (this may take a few minutes)...');
          await runCommand(
            'curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh',
          );
        }

        // ── Step 4: Upload files ──
        log(`Creating remote directory ${remoteDir}...`);
        await runCommand(`mkdir -p ${remoteDir}`);

        log(`Uploading ${filesToUpload.length} files...`);
        for (const f of filesToUpload) {
          const dir = path.posix.dirname(f.remotePath);
          if (dir && dir !== '.') {
            await runCommand(`mkdir -p ${remoteDir}/${dir}`, { ignoreErrors: true });
          }

          const target = `${remoteDir}/${f.remotePath}`;
          if (f.localPath) {
            log(`  ↑ ${f.remotePath}`);
            await ssh.putFile(f.localPath, target);
          } else if (f.contents) {
            log(`  ↑ ${f.remotePath}`);
            const tempPath = path.join(
              '/tmp',
              `buddyhere-upload-${Date.now()}-${Math.random().toString(36).substring(7)}`,
            );
            fs.writeFileSync(tempPath, f.contents);
            await ssh.putFile(tempPath, target);
            fs.unlinkSync(tempPath);
          }
        }

        // ── Step 5: Docker Compose ──
        log(`Starting Docker containers...`);
        await runCommand('docker compose down 2>/dev/null || true', {
          cwd: remoteDir,
          ignoreErrors: true,
        });

        const composeRes = await runCommand('docker compose up -d --build', {
          cwd: remoteDir,
          ignoreErrors: true,
        });
        if (composeRes.code !== 0) {
          log('docker compose v2 failed, trying docker-compose v1...');
          await runCommand('docker-compose up -d --build', { cwd: remoteDir });
        }

        ssh.dispose();
        log(`🎉 Deployment completed successfully!`);

        done({
          success: true,
          url: `http://${host}:8080`,
          newPassword: updatedPassword || undefined,
        });
      } catch (error: any) {
        console.error('SSH Deploy Error:', error);
        errorMsg(error.message || 'Failed to deploy via SSH.');
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
