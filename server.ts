import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer as createViteServer } from 'vite';

const REPO_FILE_PATHS = [
  'README.md',
  'CHANGELOG.md',
  'skills/codex-quota-optimizer/SKILL.md',
  'skills/codex-quota-optimizer/agents/openai.yaml',
  'skills/codex-quota-optimizer/scripts/check_quota.mjs',
  'skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs',
  'skills/codex-quota-optimizer/scripts/mcp_server.mjs',
  'skills/codex-quota-optimizer/references/protocol_and_playbooks.md',
  'AGENTS.md',
  'LICENSE',
  'install.sh',
  'tests/codex_skill.test.ts',
];

const ALL_GIT_PUSH_PATHS = [
  ...REPO_FILE_PATHS,
  '.agents/skills/codex-quota-optimizer/SKILL.md',
  '.agents/skills/codex-quota-optimizer/agents/openai.yaml',
  '.agents/skills/codex-quota-optimizer/scripts/check_quota.mjs',
  '.agents/skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs',
  '.agents/skills/codex-quota-optimizer/scripts/mcp_server.mjs',
  '.agents/skills/codex-quota-optimizer/references/protocol_and_playbooks.md',
];

let oauthAccessToken: string | null = null;
let lastPublishedRepoUrl: string | null = null;

function getActiveGitHubToken(): string | null {
  if (oauthAccessToken) return oauthAccessToken;
  const envToken = process.env.GITHUB_TOKEN?.trim();
  if (envToken && envToken !== 'MY_GITHUB_TOKEN' && envToken.length > 10) {
    return envToken;
  }
  return null;
}

function getRedirectUri(req: express.Request): string {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && appUrl.startsWith('http')) {
    return `${appUrl.replace(/\/$/, '')}/auth/github/callback`;
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:3000';
  return `${proto}://${host}/auth/github/callback`;
}

async function publishPublicGitHubRepository(
  token: string,
  repoName = 'codex-quota-optimizer',
  description = 'OpenAI Codex Skill ($codex-quota-optimizer) to read 5-hour and weekly usage limits and dynamically optimize agentic task execution.'
) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'codex-quota-optimizer-publisher',
    'Content-Type': 'application/json',
  };

  // 1. Identify authenticated GitHub user
  const userRes = await fetch('https://api.github.com/user', { headers });
  if (!userRes.ok) {
    const errText = await userRes.text();
    throw new Error(`GitHub authentication failed (${userRes.status}): ${errText}`);
  }
  const user = (await userRes.json()) as { login: string; html_url: string };
  const owner = user.login;

  // 2. Check if repository already exists; if not, create it as PUBLIC (private: false)
  let repoCheck = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
    headers,
  });

  if (repoCheck.status === 404) {
    const createRes = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: repoName,
        description,
        private: false,
        auto_init: true,
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create public repository (${createRes.status}): ${errText}`);
    }
    // Wait briefly for GitHub to initialize default branch
    await new Promise((r) => setTimeout(r, 1200));
    repoCheck = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
      headers,
    });
  } else if (repoCheck.ok) {
    // Ensure visibility is public if it already existed
    await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ private: false, description }),
    });
  }

  const repoData = (await repoCheck.json()) as {
    default_branch?: string;
    html_url?: string;
  };
  const branch = repoData.default_branch || 'main';

  // 3. Get latest commit SHA on default branch (if any)
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/git/ref/heads/${branch}`,
    { headers }
  );

  let baseCommitSha: string | null = null;
  if (refRes.ok) {
    const refData = (await refRes.json()) as { object?: { sha?: string } };
    baseCommitSha = refData?.object?.sha || null;
  }

  // 4. Build tree entries for all skill repository files
  const treeItems: Array<{
    path: string;
    mode: '100644' | '100755';
    type: 'blob';
    content: string;
  }> = [];

  for (const relPath of ALL_GIT_PUSH_PATHS) {
    const absPath = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(absPath)) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    const isExecutable = relPath.endsWith('.sh') || relPath.endsWith('.mjs');
    treeItems.push({
      path: relPath,
      mode: isExecutable ? '100755' : '100644',
      type: 'blob',
      content,
    });
  }

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/git/trees`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tree: treeItems,
      }),
    }
  );
  if (!treeRes.ok) {
    const errText = await treeRes.text();
    throw new Error(`Failed to create Git tree (${treeRes.status}): ${errText}`);
  }
  const treeData = (await treeRes.json()) as { sha: string };

  // 5. Create commit
  const commitPayload: Record<string, unknown> = {
    message:
      'feat: publish $codex-quota-optimizer skill for OpenAI Codex 5h & weekly usage limits',
    tree: treeData.sha,
  };
  if (baseCommitSha) {
    commitPayload.parents = [baseCommitSha];
  }

  const commitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/git/commits`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(commitPayload),
    }
  );
  if (!commitRes.ok) {
    const errText = await commitRes.text();
    throw new Error(`Failed to create Git commit (${commitRes.status}): ${errText}`);
  }
  const commitData = (await commitRes.json()) as { sha: string };

  // 6. Update or create branch reference
  if (baseCommitSha) {
    const updateRef = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${branch}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ sha: commitData.sha, force: true }),
      }
    );
    if (!updateRef.ok) {
      const errText = await updateRef.text();
      throw new Error(`Failed to update branch ref (${updateRef.status}): ${errText}`);
    }
  } else {
    await fetch(`https://api.github.com/repos/${owner}/${repoName}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: commitData.sha,
      }),
    });
  }

  const repoUrl = `https://github.com/${owner}/${repoName}`;
  lastPublishedRepoUrl = repoUrl;
  return {
    owner,
    repoName,
    branch,
    commitSha: commitData.sha,
    filesPublished: treeItems.length,
    repoUrl,
    skillInstallerCmd: `$skill-installer install https://github.com/${owner}/${repoName}/tree/${branch}/skills/codex-quota-optimizer`,
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // 1. Return the real repository files directly from disk
  app.get('/api/repo/files', (_req, res) => {
    try {
      const files = REPO_FILE_PATHS.map((relPath) => {
        const absPath = path.resolve(process.cwd(), relPath);
        const content = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
        const stat = fs.existsSync(absPath) ? fs.statSync(absPath) : null;
        return {
          path: relPath,
          sizeBytes: stat ? stat.size : 0,
          lines: content ? content.split('\n').length : 0,
          content,
        };
      });
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 2. Execute the actual Codex skill scripts on disk and return real stdout
  app.post('/api/repo/run-skill', (req, res) => {
    try {
      const { script, fiveHourPct, weeklyPct, planType, taskSize, tasksJson } = req.body || {};
      const p5h = Number.isFinite(Number(fiveHourPct)) ? Number(fiveHourPct) : 32;
      const pWeekly = Number.isFinite(Number(weeklyPct)) ? Number(weeklyPct) : 41;
      const plan = ['plus', 'pro', 'team', 'enterprise'].includes(planType) ? planType : 'plus';
      const size = ['XS', 'S', 'M', 'L', 'XL'].includes(taskSize) ? taskSize : 'M';

      if (script === 'optimize_work_plan.mjs') {
        const scriptPath = path.resolve(
          process.cwd(),
          'skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs'
        );
        const args = [scriptPath, `--5h=${p5h}`, `--weekly=${pWeekly}`];
        if (tasksJson && typeof tasksJson === 'string') {
          args.push(`--tasks=${tasksJson}`);
        }
        const stdout = execFileSync('node', args, { encoding: 'utf8', timeout: 5000 });
        res.json({
          command: `node skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs --5h=${p5h} --weekly=${pWeekly}${
            tasksJson ? ` --tasks='${tasksJson}'` : ''
          }`,
          stdout,
        });
      } else {
        const scriptPath = path.resolve(
          process.cwd(),
          'skills/codex-quota-optimizer/scripts/check_quota.mjs'
        );
        const args = [
          scriptPath,
          '--format=agent',
          `--task-size=${size}`,
          `--5h=${p5h}`,
          `--weekly=${pWeekly}`,
          `--plan=${plan}`,
        ];
        const stdout = execFileSync('node', args, { encoding: 'utf8', timeout: 5000 });
        res.json({
          command: `node skills/codex-quota-optimizer/scripts/check_quota.mjs --format=agent --task-size=${size} --5h=${p5h} --weekly=${pWeekly} --plan=${plan}`,
          stdout,
        });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // 3. GitHub connection & publish routes
  app.get('/api/github/status', async (_req, res) => {
    const token = getActiveGitHubToken();
    const hasOAuthApp = Boolean(
      process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim()
    );

    if (!token) {
      res.json({
        connected: false,
        hasOAuthApp,
        lastPublishedRepoUrl,
      });
      return;
    }

    try {
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'codex-quota-optimizer-publisher',
        },
      });
      if (!userRes.ok) {
        res.json({
          connected: false,
          hasOAuthApp,
          lastPublishedRepoUrl,
        });
        return;
      }
      const user = (await userRes.json()) as { login: string; html_url: string };
      res.json({
        connected: true,
        username: user.login,
        profileUrl: user.html_url,
        hasOAuthApp,
        lastPublishedRepoUrl,
      });
    } catch {
      res.json({
        connected: false,
        hasOAuthApp,
        lastPublishedRepoUrl,
      });
    }
  });

  app.get('/api/auth/github/url', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    if (!clientId) {
      res.status(400).json({
        error:
          'GITHUB_CLIENT_ID is not configured. Set GITHUB_TOKEN or GITHUB_CLIENT_ID & GITHUB_CLIENT_SECRET in AI Studio Secrets, or use the top-right AI Studio GitHub export icon.',
      });
      return;
    }
    const redirectUri = getRedirectUri(req);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'public_repo',
    });
    res.json({ url: `https://github.com/login/oauth/authorize?${params.toString()}` });
  });

  const githubCallbackHandler = async (req: express.Request, res: express.Response) => {
    const code = req.query.code as string | undefined;
    const clientId = process.env.GITHUB_CLIENT_ID?.trim();
    const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();

    if (code && clientId && clientSecret) {
      try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: getRedirectUri(req),
          }),
        });
        const tokenData = (await tokenRes.json()) as { access_token?: string };
        if (tokenData.access_token) {
          oauthAccessToken = tokenData.access_token;
        }
      } catch (err) {
        console.error('GitHub OAuth token exchange failed:', err);
      }
    }

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>GitHub authentication successful. This window will close automatically.</p>
        </body>
      </html>
    `);
  };

  app.get(['/auth/github/callback', '/auth/github/callback/'], githubCallbackHandler);

  app.post('/api/github/publish', async (req, res) => {
    const token = getActiveGitHubToken();
    if (!token) {
      res.status(400).json({
        error:
          'No GitHub credentials active yet. Connect via GitHub OAuth, set GITHUB_TOKEN in AI Studio Secrets, or click the GitHub icon in the top-right AI Studio toolbar to push directly.',
      });
      return;
    }

    try {
      const repoName = (req.body?.repoName || 'codex-quota-optimizer').trim();
      const result = await publishPublicGitHubRepository(token, repoName);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
