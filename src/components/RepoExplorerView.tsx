import React, { useState } from 'react';
import {
  FileCode,
  FileText,
  Copy,
  Check,
  Download,
  Terminal,
  FolderGit2,
} from 'lucide-react';
import { type RepoFile } from '../engine/repoGenerator';
import { type PolicyThresholds, type CodexRateLimitSnapshot } from '../engine/quotaEngine';

interface RepoExplorerViewProps {
  files: RepoFile[];
  thresholds: PolicyThresholds;
  snapshot: CodexRateLimitSnapshot;
  onExportBundle: () => void;
}

export const RepoExplorerView: React.FC<RepoExplorerViewProps> = ({
  files,
  thresholds,
  snapshot,
  onExportBundle,
}) => {
  const [selectedPath, setSelectedPath] = useState<string>(files[0]?.path || 'README.md');
  const [copiedFile, setCopiedFile] = useState(false);
  const [copiedInstallCmd, setCopiedInstallCmd] = useState(false);

  const activeFile = files.find((f) => f.path === selectedPath) || files[0];

  const handleCopyFile = () => {
    if (!activeFile) return;
    navigator.clipboard?.writeText(activeFile.content);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 1800);
  };

  const quickInstallSnippet = `git clone https://github.com/openai-community/codex-quota-pilot.git ~/.codex/plugins/codex-quota-pilot && cd ~/.codex/plugins/codex-quota-pilot && npm install && npm run build && ./scripts/install.sh`;

  const handleCopyInstallCmd = () => {
    navigator.clipboard?.writeText(quickInstallSnippet);
    setCopiedInstallCmd(true);
    setTimeout(() => setCopiedInstallCmd(false), 1800);
  };

  const handleDownloadSingleFile = (file: RepoFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.replace(/\//g, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Repository Header & One-Line Installer */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-5 border-b border-slate-200">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>GitHub Repository Blueprint</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">MIT License</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {files.length} files generated with your live thresholds (5h warn: {thresholds.fiveHourWarningPct}%, Weekly warn: {thresholds.weeklyWarningPct}%)
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <FolderGit2 className="w-6 h-6 text-blue-600 shrink-0" />
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
                openai-community / codex-quota-pilot
              </h1>
            </div>
            <p className="text-sm text-slate-600 max-w-3xl">
              Complete Model Context Protocol (MCP) server, <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">rollout-*.jsonl</code> parser, and cascading <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">AGENTS.md</code> policy that lets any OpenAI Codex task inspect its 5-hour and weekly usage limits in real time.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onExportBundle}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download Self-Extracting Repo (.sh)
            </button>
          </div>
        </div>

        {/* One-Line CLI Bootstrap Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 text-slate-100 px-4 py-3 rounded-lg">
          <div className="flex items-center gap-2.5 overflow-x-auto">
            <Terminal className="w-4 h-4 text-blue-400 shrink-0" />
            <code className="text-xs font-mono whitespace-nowrap">
              {quickInstallSnippet}
            </code>
          </div>
          <button
            type="button"
            onClick={handleCopyInstallCmd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedInstallCmd ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copied Command
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy Install Command
              </>
            )}
          </button>
        </div>
      </section>

      {/* Repository File Tree + Source Code Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left File Tree (4 cols) */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="text-xs font-semibold text-slate-700">
              Repository File Tree ({files.length} files)
            </h2>
          </div>
          <div className="divide-y divide-slate-200">
            {files.map((file) => {
              const isSelected = file.path === activeFile?.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50/70 text-blue-900'
                      : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  {file.path.endsWith('.md') ? (
                    <FileText
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isSelected ? 'text-blue-600' : 'text-slate-400'
                      }`}
                    />
                  ) : (
                    <FileCode
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        isSelected ? 'text-blue-600' : 'text-slate-400'
                      }`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-semibold truncate">
                      {file.path}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                      {file.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right File Code Viewer (8 cols) */}
        {activeFile && (
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-mono text-sm font-bold text-slate-900">
                  {activeFile.path}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {activeFile.description} · Live snapshot synced ({snapshot.primary_window.used_percent}% 5h / {snapshot.secondary_window.used_percent}% weekly)
                </div>
              </div>

              <div className="flex items-center gap-2">
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
                      Copy File Content
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadSingleFile(activeFile)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download File
                </button>
              </div>
            </div>

            <pre
              className={`p-5 bg-slate-950 text-slate-100 text-xs font-mono tabular-nums overflow-x-auto leading-relaxed max-h-[640px] ${
                activeFile.language === 'markdown' ? 'whitespace-pre-wrap break-words' : ''
              }`}
            >
              {activeFile.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
