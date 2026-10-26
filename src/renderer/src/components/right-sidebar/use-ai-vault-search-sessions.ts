import { useMemo } from 'react'
import type { AiVaultSearchSort, AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostScope } from '../../../../shared/execution-host'
import { useAppStore } from '@/store'
import { withAiVaultHistoryPreviews } from './ai-vault-search-session'
import { withTerminalTabTitleMatches } from './ai-vault-terminal-tab-title'
import { useAiVaultOpenTabSessions } from './use-ai-vault-open-tab-sessions'

/** Host hits with scanned previews, plus rows whose open terminal tab was renamed to match the query. */
export function useAiVaultSearchSessions(
  hitSessions: AiVaultSession[],
  history: readonly AiVaultSession[],
  query: string,
  sort: AiVaultSearchSort,
  executionHostScope: ExecutionHostScope,
  worktrees: readonly { id: string; path: string }[]
): AiVaultSession[] {
  const agentStatusByPaneKey = useAppStore((state) => state.agentStatusByPaneKey)
  const retainedAgentsByPaneKey = useAppStore((state) => state.retainedAgentsByPaneKey)
  const sleepingAgentSessionsByPaneKey = useAppStore(
    (state) => state.sleepingAgentSessionsByPaneKey
  )
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const terminalLayoutsByTabId = useAppStore((state) => state.terminalLayoutsByTabId)
  const paneState = useMemo(
    () => ({
      agentStatusByPaneKey,
      retainedAgentsByPaneKey,
      sleepingAgentSessionsByPaneKey,
      tabsByWorktree,
      terminalLayoutsByTabId
    }),
    [
      agentStatusByPaneKey,
      retainedAgentsByPaneKey,
      sleepingAgentSessionsByPaneKey,
      tabsByWorktree,
      terminalLayoutsByTabId
    ]
  )
  const openTabSessions = useAiVaultOpenTabSessions(
    history,
    query,
    executionHostScope,
    worktrees,
    paneState
  )
  return useMemo(
    () =>
      withTerminalTabTitleMatches(
        withAiVaultHistoryPreviews(hitSessions, history),
        [...history, ...openTabSessions],
        query,
        sort,
        paneState
      ),
    [hitSessions, history, openTabSessions, query, sort, paneState]
  )
}
