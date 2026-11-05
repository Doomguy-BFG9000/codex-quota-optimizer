#!/usr/bin/env node
/**
 * Optional Stdio MCP Server for OpenAI Codex (`~/.codex/config.toml`)
 * Exposes `get_codex_usage_limits` and `optimize_codex_task_plan` as native MCP tools
 * backed by the exact same logic in `check_quota.mjs` and `optimize_work_plan.mjs`.
 */

import readline from 'node:readline';
import { loadQuotaReport } from './check_quota.mjs';
import { scheduleTasksAgainstQuota } from './optimize_work_plan.mjs';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
    if (req.method === 'initialize') {
      respond(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'codex-quota-optimizer-mcp', version: '1.0.0' },
      });
    } else if (req.method === 'tools/list') {
      respond(req.id, {
        tools: [
          {
            name: 'get_codex_usage_limits',
            description:
              'Reads OpenAI Codex 5-hour rolling window (300m) and 7-day weekly limit (10080m) and returns the active optimization policy.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'optimize_codex_task_plan',
            description:
              'Schedules and throttles planned subtasks against remaining 5-hour and weekly Codex quotas.',
            inputSchema: {
              type: 'object',
              properties: {
                tasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                      priority: { type: 'string', enum: ['P0', 'P1', 'P2'] },
                      est_5h_pct: { type: 'number' },
                    },
                    required: ['title'],
                  },
                },
              },
              required: ['tasks'],
            },
          },
        ],
      });
    } else if (req.method === 'tools/call') {
      const report = loadQuotaReport([process.execPath, process.argv[1]]);

      if (req.params?.name === 'optimize_codex_task_plan') {
        const plan = scheduleTasksAgainstQuota(req.params?.arguments?.tasks || [], report);
        respond(req.id, {
          content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }],
        });
      } else if (req.params?.name === 'get_codex_usage_limits') {
        respond(req.id, {
          content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
        });
      } else {
        throw new Error('Unknown tool');
      }
    }
  } catch (error) {
    if (req?.id !== undefined) respond(req.id, { isError: true, content: [{type: 'text', text: error.message}] });
  }
});
