/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  FolderGit2,
  FileCode,
  FileText,
  Terminal,
  Copy,
  Check,
  Download,
  Play,
  UploadCloud,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface DiskRepoFile {
  path: string;
  sizeBytes: number;
  lines: number;
  content: string;
}

interface GitHubStatus {
  connected: boolean;
  username?: string;
  profileUrl?: string;
  hasOAuthApp?: boolean;
  lastPublishedRepoUrl?: string | null;
}

interface PublishResult {
  owner: string;
  repoName: string;
  branch: string;
  commitSha: string;
  filesPublished: number;
  repoUrl: string;
  skillInstallerCmd: string;
}

export default function App() {
  const [files, setFiles] = useState<DiskRepoFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>(
    'skills/codex-quota-optimizer/SKILL.md'
  );
  const [loadingFiles, setLoadingFiles] = useState<boolean>(true);

  const [copiedFile, setCopiedFile] = useState<boolean>(false);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);

  // GitHub Publishing State
  const [ghStatus, setGhStatus] = useState<GitHubStatus>({ connected: false });
  const [repoNameInput, setRepoNameInput] = useState<string>('codex-quota-optimizer');
  const [publishing, setPublishing] = useState<boolean>(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Live execution state for testing what OpenAI Codex sees when it runs the skill scripts
  const [scriptToRun, setScriptToRun] = useState<
    'check_quota.mjs' | 'optimize_work_plan.mjs'
  >('check_quota.mjs');
  const [fiveHourPct, setFiveHourPct] = useState<number>(86);
  const [weeklyPct, setWeeklyPct] = useState<number>(54);
  const [planType, setPlanType] = useState<'plus' | 'pro'>('plus');
  const [execCommand, setExecCommand] = useState<string>('');
  const [execStdout, setExecStdout] = useState<string>('');
  const [runningScript, setRunningScript] = useState<boolean>(false);

  const fetchGitHubStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/github/status');
      if (res.ok) {
        const data = (await res.json()) as GitHubStatus;
        setGhStatus(data);
      }
    } catch {
      // Ignore transient status error
    }
  }, []);

  useEffect(() => {
    fetch('/api/repo/files')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.files)) {
          setFiles(data.files);
        }
      })
      .finally(() => setLoadingFiles(false));

    fetchGitHubStatus();
  }, [fetchGitHubStatus]);

  const handlePublishToGitHub = useCallback(
    async (targetRepo = repoNameInput) => {
      const cleanName = targetRepo.trim() || 'codex-quota-optimizer';
      setPublishing(true);
      setPublishError(null);
      try {
        const res = await fetch('/api/github/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoName: cleanName }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setPublishError(data.error || 'Failed to publish repository to GitHub.');
        } else {
          setPublishResult(data as PublishResult);
          fetchGitHubStatus();
        }
      } catch (err) {
        setPublishError(err instanceof Error ? err.message : String(err));
      } finally {
        setPublishing(false);
      }
    },
    [repoNameInput, fetchGitHubStatus]
  );

  // Listen for OAuth popup completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchGitHubStatus().then(() => {
          handlePublishToGitHub(repoNameInput);
        });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchGitHubStatus, handlePublishToGitHub, repoNameInput]);

  const handleConnectGitHubOAuth = async () => {
    setPublishError(null);
    try {
      const res = await fetch('/api/auth/github/url');
      const data = await res.json();
      if (!res.ok || !data.url) {
        setPublishError(
          data.error ||
            'GitHub OAuth is not configured yet. Add GITHUB_TOKEN or GITHUB_CLIENT_ID & GITHUB_CLIENT_SECRET in AI Studio Secrets.'
        );
        return;
      }
      window.open(data.url, 'github_oauth_popup', 'width=600,height=720');
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    }
  };

  const executeSkillScript = async (
    targetScript = scriptToRun,
    p5h = fiveHourPct,
    pWeekly = weeklyPct,
    plan = planType
  ) => {
    setRunningScript(true);
    try {
      const res = await fetch('/api/repo/run-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: targetScript,
          fiveHourPct: p5h,
          weeklyPct: pWeekly,
          planType: plan,
        }),
      });
      const data = await res.json();
      setExecCommand(data.command || '');
      setExecStdout(data.stdout || data.error || '');
    } catch (err) {
      setExecStdout(String(err));
    } finally {
      setRunningScript(false);
    }
  };

  useEffect(() => {
    executeSkillScript('check_quota.mjs', 86, 54, 'plus');
  }, []);

  const activeFile =
    files.find((f) => f.path === selectedPath) || files[0] || null;

  const handleCopyFile = () => {
    if (!activeFile) return;
    navigator.clipboard?.writeText(activeFile.content);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 1800);
  };

  const codexSkillInstallCmd = publishResult?.skillInstallerCmd
    ? publishResult.skillInstallerCmd
    : `./install.sh   # Installs skills/codex-quota-optimizer -> ~/.codex/skills/codex-quota-optimizer & updates ~/.codex/AGENTS.md`;

  const handleCopyInstallCmd = () => {
    navigator.clipboard?.writeText(codexSkillInstallCmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1800);
  };

  const handleDownloadRepoArchive = () => {
    const lines: string[] = [
      '#!/usr/bin/env bash',
      '# Self-Extracting GitHub Repository: codex-quota-optimizer (OpenAI Codex Skill)',
      'set -euo pipefail',
      'mkdir -p codex-quota-optimizer/skills/codex-quota-optimizer/agents',
      'mkdir -p codex-quota-optimizer/skills/codex-quota-optimizer/scripts',
      'mkdir -p codex-quota-optimizer/skills/codex-quota-optimizer/references',
      'mkdir -p codex-quota-optimizer/.agents/skills/codex-quota-optimizer',
      'mkdir -p codex-quota-optimizer/tests',
      'cd codex-quota-optimizer',
      '',
    ];

    for (const file of files) {
      lines.push(`cat << 'EOF_CODEX_SKILL_FILE' > "${file.path}"`);
      lines.push(file.content);
      lines.push('EOF_CODEX_SKILL_FILE');
      lines.push('');
    }

    lines.push(
      'cp -R skills/codex-quota-optimizer/* .agents/skills/codex-quota-optimizer/'
    );
    lines.push(
      'chmod +x install.sh skills/codex-quota-optimizer/scripts/*.mjs'
    );
    lines.push(
      `echo "Extracted codex-quota-optimizer GitHub repository (${files.length} files). Run ./install.sh to install into ~/.codex/skills/"`
    );

    const blob = new Blob([lines.join('\n')], {
      type: 'text/x-shellscript;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'codex-quota-optimizer-repo.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 zones */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200 sticky top-0 z-30">
        <a
          href="#repo-root"
          className="text-lg font-bold tracking-tight text-slate-900 font-mono whitespace-nowrap shrink-0"
        >
          codex-quota-optimizer
        </a>

        <nav
          aria-label="Repository Quick File Jump"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
        >
          <button
            type="button"
            onClick={() =>
              setSelectedPath('skills/codex-quota-optimizer/SKILL.md')
            }
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedPath === 'skills/codex-quota-optimizer/SKILL.md'
                ? 'text-blue-600 font-semibold'
                : ''
            }`}
          >
            SKILL.md
          </button>
          <button
            type="button"
            onClick={() =>
              setSelectedPath(
                'skills/codex-quota-optimizer/scripts/check_quota.mjs'
              )
            }
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedPath ===
              'skills/codex-quota-optimizer/scripts/check_quota.mjs'
                ? 'text-blue-600 font-semibold'
                : ''
            }`}
          >
            check_quota.mjs
          </button>
          <button
            type="button"
            onClick={() =>
              setSelectedPath(
                'skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs'
              )
            }
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedPath ===
              'skills/codex-quota-optimizer/scripts/optimize_work_plan.mjs'
                ? 'text-blue-600 font-semibold'
                : ''
            }`}
          >
            optimize_work_plan.mjs
          </button>
          <button
            type="button"
            onClick={() => setSelectedPath('AGENTS.md')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedPath === 'AGENTS.md' ? 'text-blue-600 font-semibold' : ''
            }`}
          >
            AGENTS.md
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleDownloadRepoArchive}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download GitHub Repo (.sh)
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1380px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Repository Header & Public GitHub Publisher Bar */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-200">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>OpenAI Codex Skill Repository</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">Visibility: Public</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">
                  skills/codex-quota-optimizer/SKILL.md
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <FolderGit2 className="w-6 h-6 text-blue-600 shrink-0" />
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
                  codex-quota-optimizer — Skill & Scripts for OpenAI Codex
                </h1>
              </div>
              <p className="text-sm text-slate-600 max-w-3xl">
                Official OpenAI Codex Skill directory (
                <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  skills/codex-quota-optimizer/SKILL.md
                </code>
                ,{' '}
                <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  agents/openai.yaml
                </code>
                ,{' '}
                <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  scripts/check_quota.mjs
                </code>
                ,{' '}
                <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  scripts/optimize_work_plan.mjs
                </code>
                , and root{' '}
                <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  AGENTS.md
                </code>
                ) ready to publish to your public GitHub account.
              </p>
            </div>

            {/* Public GitHub Publish Controls */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <label htmlFor="gh-repo-name" className="sr-only">
                Public GitHub Repository Name
              </label>
              <input
                id="gh-repo-name"
                type="text"
                value={repoNameInput}
                onChange={(e) => setRepoNameInput(e.target.value)}
                placeholder="codex-quota-optimizer"
                className="px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg w-48"
              />
              <button
                type="button"
                disabled={publishing}
                onClick={() => handlePublishToGitHub(repoNameInput)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UploadCloud className="w-4 h-4" />
                {publishing
                  ? 'Publishing Public Repo...'
                  : ghStatus.connected
                  ? `Publish Public to @${ghStatus.username}`
                  : 'Publish to Public GitHub'}
              </button>
              {!ghStatus.connected && ghStatus.hasOAuthApp && (
                <button
                  type="button"
                  onClick={handleConnectGitHubOAuth}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Connect GitHub OAuth
                </button>
              )}
            </div>
          </div>

          {publishResult && (
            <div
              role="status"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-lg text-xs"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Published <strong>{publishResult.filesPublished} files</strong> to public repository{' '}
                  <a
                    href={publishResult.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono font-bold underline inline-flex items-center gap-1"
                  >
                    {publishResult.owner}/{publishResult.repoName}
                    <ExternalLink className="w-3 h-3" />
                  </a>{' '}
                  (commit <code className="font-mono">{publishResult.commitSha.slice(0, 7)}</code>)
                </span>
              </div>
              <span className="font-mono text-emerald-800">
                {publishResult.skillInstallerCmd}
              </span>
            </div>
          )}

          {publishError && (
            <div
              role="alert"
              className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-xs"
            >
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{publishError}</span>
            </div>
          )}

          {/* Install command bar for Codex */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 text-slate-100 px-4 py-3 rounded-lg">
            <div className="flex items-center gap-2.5 overflow-x-auto">
              <Terminal className="w-4 h-4 text-blue-400 shrink-0" />
              <code className="text-xs font-mono whitespace-nowrap">
                {codexSkillInstallCmd}
              </code>
            </div>
            <button
              type="button"
              onClick={handleCopyInstallCmd}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedCmd ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Command
                </>
              )}
            </button>
          </div>
        </section>

        {/* Main Split: Disk Repository File Tree (Left 4 cols) + Raw File Source Viewer (Right 8 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Real Files on Disk */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-800">
                Repository Files on Disk ({files.length})
              </h2>
              <span className="text-xs font-mono text-slate-500">branch: main</span>
            </div>

            {loadingFiles ? (
              <div className="p-6 text-xs text-slate-500 font-mono">
                Loading repository tree from disk...
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {files.map((file) => {
                  const active = file.path === activeFile?.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-3 cursor-pointer ${
                        active
                          ? 'bg-blue-50/80 text-blue-900'
                          : 'hover:bg-slate-50 text-slate-800'
                      }`}
                    >
                      {file.path.endsWith('.md') ? (
                        <FileText
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            active ? 'text-blue-600' : 'text-slate-400'
                          }`}
                        />
                      ) : (
                        <FileCode
                          className={`w-4 h-4 mt-0.5 shrink-0 ${
                            active ? 'text-blue-600' : 'text-slate-400'
                          }`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs font-semibold break-all">
                          {file.path}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                          {file.lines} lines · {file.sizeBytes} bytes
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Raw File Viewer */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            {activeFile ? (
              <>
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm font-bold text-slate-900">
                      {activeFile.path}
                    </div>
                    <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                      {activeFile.lines} lines · {activeFile.sizeBytes} bytes · Read directly by OpenAI Codex
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyFile}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedFile ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        Copied {activeFile.path}
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Raw File
                      </>
                    )}
                  </button>
                </div>

                <pre className="p-5 bg-slate-950 text-slate-100 text-xs font-mono tabular-nums overflow-x-auto leading-relaxed max-h-[560px] whitespace-pre-wrap break-words">
                  {activeFile.content}
                </pre>
              </>
            ) : null}
          </div>
        </div>

        {/* Bottom Panel: Live Execution of the Skill Scripts (Exactly what Codex sees on stdout) */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-900 font-mono">
                Live Skill Script Execution (What OpenAI Codex Receives on stdout)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Runs the actual{' '}
                <code className="font-mono">
                  skills/codex-quota-optimizer/scripts/{scriptToRun}
                </code>{' '}
                binary on the server and displays the exact stdout directive payload that Codex reads during a task.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setScriptToRun('check_quota.mjs');
                    executeSkillScript('check_quota.mjs', fiveHourPct, weeklyPct, planType);
                  }}
                  className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors cursor-pointer ${
                    scriptToRun === 'check_quota.mjs'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  check_quota.mjs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScriptToRun('optimize_work_plan.mjs');
                    executeSkillScript('optimize_work_plan.mjs', fiveHourPct, weeklyPct, planType);
                  }}
                  className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors cursor-pointer ${
                    scriptToRun === 'optimize_work_plan.mjs'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  optimize_work_plan.mjs
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <label htmlFor="sim-5h-input" className="text-slate-600 font-mono">
                  --5h=
                </label>
                <input
                  id="sim-5h-input"
                  type="number"
                  min={0}
                  max={100}
                  value={fiveHourPct}
                  onChange={(e) => setFiveHourPct(Number(e.target.value))}
                  className="w-16 px-2 py-1 font-mono tabular-nums bg-slate-50 border border-slate-200 rounded"
                />
                <label htmlFor="sim-wk-input" className="text-slate-600 font-mono">
                  --weekly=
                </label>
                <input
                  id="sim-wk-input"
                  type="number"
                  min={0}
                  max={100}
                  value={weeklyPct}
                  onChange={(e) => setWeeklyPct(Number(e.target.value))}
                  className="w-16 px-2 py-1 font-mono tabular-nums bg-slate-50 border border-slate-200 rounded"
                />
                <select
                  aria-label="Codex Plan Tier"
                  value={planType}
                  onChange={(e) => setPlanType(e.target.value as 'plus' | 'pro')}
                  className="px-2 py-1 font-mono bg-slate-50 border border-slate-200 rounded"
                >
                  <option value="plus">--plan=plus</option>
                  <option value="pro">--plan=pro</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    executeSkillScript(scriptToRun, fiveHourPct, weeklyPct, planType)
                  }
                  disabled={runningScript}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run Script
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-mono text-slate-600">
              $ {execCommand}
            </div>
            <pre className="p-4 bg-slate-950 text-emerald-400 text-xs font-mono tabular-nums rounded-lg overflow-x-auto leading-relaxed max-h-96">
              {execStdout || 'Executing skill script...'}
            </pre>
          </div>
        </section>
      </main>
    </div>
  );
}
