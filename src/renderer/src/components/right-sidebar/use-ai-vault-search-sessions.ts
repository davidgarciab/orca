import { useCallback, useMemo } from 'react'
import type { AiVaultSearchSort, AiVaultSession } from '../../../../shared/ai-vault-types'
import type { ExecutionHostScope } from '../../../../shared/execution-host'
import { useAppStore } from '@/store'
import { withAiVaultHistoryPreviews } from './ai-vault-search-session'
import {
  terminalTabTitleForSession,
  withTerminalTabTitleMatches
} from './ai-vault-terminal-tab-title'
import { useAiVaultOpenTabSessions } from './use-ai-vault-open-tab-sessions'

/** Host hits with scanned previews, plus rows whose open terminal tab was renamed to match the query. */
export function useAiVaultSearchSessions(
  hitSessions: AiVaultSession[],
  history: readonly AiVaultSession[],
  query: string,
  sort: AiVaultSearchSort,
  executionHostScope: ExecutionHostScope,
  worktrees: readonly { id: string; path: string }[],
  onHitDeleted: (session: AiVaultSession) => void
): {
  sessions: AiVaultSession[]
  terminalTabTitleFor: (session: AiVaultSession) => string | null
  onDeleted: (session: AiVaultSession) => void
} {
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
  const { sessions: openTabSessions, forget } = useAiVaultOpenTabSessions(
    history,
    query,
    executionHostScope,
    worktrees,
    paneState
  )
  const terminalTabTitleFor = useCallback(
    (session: AiVaultSession) => terminalTabTitleForSession(paneState, session),
    [paneState]
  )
  const sessions = useMemo(
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
  const onDeleted = useCallback(
    (session: AiVaultSession) => {
      onHitDeleted(session)
      forget(session)
    },
    [onHitDeleted, forget]
  )
  return { sessions, terminalTabTitleFor, onDeleted }
}
