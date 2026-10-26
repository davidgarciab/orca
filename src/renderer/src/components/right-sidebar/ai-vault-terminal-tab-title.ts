import type { AiVaultSession } from '../../../../shared/ai-vault-types'
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
  return extra.length > 0 ? [...hitSessions, ...extra] : hitSessions
}
