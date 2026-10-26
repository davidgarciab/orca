import { useMemo } from 'react'
import type { AiVaultSearchSort, AiVaultSession } from '../../../../shared/ai-vault-types'
import { useAppStore } from '@/store'
import { withAiVaultHistoryPreviews } from './ai-vault-search-session'
import { withTerminalTabTitleMatches } from './ai-vault-terminal-tab-title'

/** Host hits with scanned previews, plus rows whose open terminal tab was renamed to match the query. */
export function useAiVaultSearchSessions(
  hitSessions: AiVaultSession[],
  history: readonly AiVaultSession[],
  query: string,
  sort: AiVaultSearchSort
): AiVaultSession[] {
  const agentStatusByPaneKey = useAppStore((state) => state.agentStatusByPaneKey)
  const retainedAgentsByPaneKey = useAppStore((state) => state.retainedAgentsByPaneKey)
  const sleepingAgentSessionsByPaneKey = useAppStore(
    (state) => state.sleepingAgentSessionsByPaneKey
  )
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const terminalLayoutsByTabId = useAppStore((state) => state.terminalLayoutsByTabId)
  return useMemo(
    () =>
      withTerminalTabTitleMatches(
        withAiVaultHistoryPreviews(hitSessions, history),
        history,
        query,
        sort,
        {
          agentStatusByPaneKey,
          retainedAgentsByPaneKey,
          sleepingAgentSessionsByPaneKey,
          tabsByWorktree,
          terminalLayoutsByTabId
        }
      ),
    [
      hitSessions,
      history,
      query,
      sort,
      agentStatusByPaneKey,
      retainedAgentsByPaneKey,
      sleepingAgentSessionsByPaneKey,
      tabsByWorktree,
      terminalLayoutsByTabId
    ]
  )
}
