import { describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { OriginalPaneState } from './ai-vault-original-pane'

vi.mock('./ai-vault-original-pane', () => ({
  findOriginalAiVaultSessionPane: (_state: unknown, session: AiVaultSession) =>
    session.sessionId === 'unmatched'
      ? null
      : { paneKey: 'tab-1:leaf', worktreeId: 'w1', tabId: 'tab-1', leafId: 'leaf' }
}))

import { withTerminalTabTitleMatches } from './ai-vault-terminal-tab-title'

function session(sessionId: string): AiVaultSession {
  return {
    id: `local:${sessionId}`,
    executionHostId: 'local',
    agent: 'claude',
    sessionId,
    title: 'Original prompt',
    cwd: '/folder',
    branch: null,
    model: null,
    filePath: `/sessions/${sessionId}.jsonl`,
    codexHome: null,
    createdAt: null,
    updatedAt: null,
    modifiedAt: '2026-10-06T00:00:00Z',
    messageCount: 1,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: '',
    subagent: null
  }
}

const state: OriginalPaneState = {
  agentStatusByPaneKey: {},
  retainedAgentsByPaneKey: {},
  sleepingAgentSessionsByPaneKey: {},
  terminalLayoutsByTabId: {},
  tabsByWorktree: {
    w1: [
      {
        id: 'tab-1',
        ptyId: null,
        worktreeId: 'w1',
        title: 'Terminal 1',
        customTitle: 'Billing Refactor',
        color: null,
        sortOrder: 0,
        createdAt: 0
      }
    ]
  }
}

describe('withTerminalTabTitleMatches', () => {
  it('adds history rows whose renamed tab matches every term', () => {
    const history = [session('a'), session('unmatched')]
    const result = withTerminalTabTitleMatches([], history, 'billing refactor', state)
    expect(result.map((row) => row.sessionId)).toEqual(['a'])
  })

  it('keeps host hits and does not duplicate them', () => {
    const hit = session('a')
    expect(withTerminalTabTitleMatches([hit], [session('a')], 'billing', state)).toEqual([hit])
  })

  it('ignores queries that do not match the tab title', () => {
    expect(withTerminalTabTitleMatches([], [session('a')], 'payments', state)).toEqual([])
  })
})
