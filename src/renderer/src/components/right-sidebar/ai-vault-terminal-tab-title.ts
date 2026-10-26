import type { AiVaultSearchSort, AiVaultSession } from '../../../../shared/ai-vault-types'
import { findOriginalAiVaultSessionPane, type OriginalPaneState } from './ai-vault-original-pane'

/** The custom title of the open terminal tab running this session, if the user renamed it. */
export function terminalTabTitleForSession(
  state: OriginalPaneState,
  session: AiVaultSession
): string | null {
  const target = findOriginalAiVaultSessionPane(state, session)
  const tab = target
    ? state.tabsByWorktree[target.worktreeId]?.find((candidate) => candidate.id === target.tabId)
    : undefined
  return tab?.customTitle?.trim() || null
}

/** Host search indexes transcripts, not tab renames, so add history rows whose renamed tab matches every term. */
export function withTerminalTabTitleMatches(
  hitSessions: AiVaultSession[],
  history: readonly AiVaultSession[],
  query: string,
  sort: AiVaultSearchSort,
  state: OriginalPaneState
): AiVaultSession[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return hitSessions
  }
  const seen = new Set(hitSessions.map((session) => session.id))
  const extra = history.filter((session) => {
    if (seen.has(session.id) || session.structuredSession) {
      return false
    }
    const title = terminalTabTitleForSession(state, session)?.toLowerCase()
    return title !== undefined && terms.every((term) => title.includes(term))
  })
  if (extra.length === 0) {
    return hitSessions
  }
  const merged = [...hitSessions, ...extra]
  return sort === 'newest' ? merged.sort((a, b) => sessionTime(b) - sessionTime(a)) : merged
}

function sessionTime(session: AiVaultSession): number {
  const time = Date.parse(session.updatedAt ?? session.modifiedAt)
  return Number.isNaN(time) ? 0 : time
}
