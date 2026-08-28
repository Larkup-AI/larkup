import { NextRequest, NextResponse } from 'next/server';
import { NodeSSH } from 'node-ssh';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { target, credentials, createProject } = body;

    if (!target || !credentials) {
      return NextResponse.json({ success: false, error: 'Missing target or credentials' }, { status: 400 });
    }

    if (target === 'Vercel') {
      const { vercelToken, vercelProject } = credentials;
      if (!vercelToken || !vercelProject) {
        return NextResponse.json({ success: false, error: 'Missing Vercel token or project' }, { status: 400 });
      }

      const res = await fetch(`https://api.vercel.com/v9/projects/${vercelProject}`, {
        headers: {
          Authorization: `Bearer ${vercelToken}`,
        },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return NextResponse.json({ success: false, error: 'Invalid Vercel token or insufficient permissions' }, { status: 401 });
        }
        if (res.status === 404) {
          if (createProject) {
            // Attempt to create the project
            const createRes = await fetch(`https://api.vercel.com/v10/projects`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${vercelToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ name: vercelProject }),
            });

            if (!createRes.ok) {
              if (createRes.status === 401 || createRes.status === 403) {
                return NextResponse.json({ success: false, error: 'Insufficient permissions to create project. Please create it first on Vercel.' }, { status: 403 });
              }
              const errorBody = await createRes.json().catch(() => ({}));
              return NextResponse.json({ success: false, error: errorBody.error?.message || `Failed to create project: ${createRes.statusText}` }, { status: createRes.status });
            }
            return NextResponse.json({ success: true, created: true });
          }
          return NextResponse.json({ success: false, error: `Project '${vercelProject}' not found`, projectNotFound: true }, { status: 404 });
        }
        return NextResponse.json({ success: false, error: `Vercel API error: ${res.statusText}` }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    } else if (target === 'AWS EC2' || target === 'Raspberry Pi' || target === 'DigitalOcean' || target === 'Hetzner' || target === 'GCP' || target === 'Azure') {
      const { sshHost, sshUsername, sshAuthType, sshKeyOrPassword } = credentials;
      if (!sshHost || !sshUsername || !sshAuthType || !sshKeyOrPassword) {
        return NextResponse.json({ success: false, error: 'Missing SSH credentials' }, { status: 400 });
      }

      const ssh = new NodeSSH();
      
      try {
        await ssh.connect({
          host: sshHost,
          username: sshUsername,
          [sshAuthType === 'key' ? 'privateKey' : 'password']: sshKeyOrPassword,
          readyTimeout: 10000,
        });

        // Test a simple command to ensure it's fully connected and working
        await ssh.execCommand('echo "verified"');
        ssh.dispose();
        
        return NextResponse.json({ success: true });
      } catch (err: any) {
        console.error('SSH Verification Error:', err);
        let errorMsg = 'Failed to connect to SSH host';
        if (err.level === 'client-authentication') {
          errorMsg = 'Authentication failed (Invalid password or key)';
        } else if (err.code === 'ETIMEDOUT') {
          errorMsg = 'Connection timed out';
        } else if (err.code === 'ENOTFOUND') {
          errorMsg = 'Host not found';
        }
        return NextResponse.json({ success: false, error: errorMsg }, { status: 401 });
      }
    } else if (target === 'env') {
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Unsupported target' }, { status: 400 });
  } catch (error: any) {
    console.error('Deploy verify error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
