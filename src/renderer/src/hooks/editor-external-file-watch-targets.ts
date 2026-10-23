import type { OpenFile } from '@/store/slices/editor'
import { findRepoForHost } from '@/store/slices/repo-host-identity'
import { getIndexedAllWorktrees } from '@/store/worktree-repo-index'
import { selectFolderWorkspaces, selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import {
  findRuntimeWorkspaceFileOwner,
  type RuntimeWorkspaceFileRoot
} from '../../../shared/runtime-workspace-file-owner'
import {
  relativePathInsideRoot,
  normalizeRuntimePathForComparison
} from '../../../shared/cross-platform-path'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import type {
  EditorExternalWatchTarget,
  EditorExternalWatchTargetState
} from './editor-external-watch-targets'
import { WARM_RECURSIVE_WATCH_WORKSPACE_COUNT } from './editor-external-watch-scope'

function isLocalFile(file: OpenFile): boolean {
  const capturedHost = file.operationProvenance?.generation.route.executionHostId
  return (
    (file.mode === 'edit' || file.mode === 'markdown-preview') &&
    !file.runtimeEnvironmentId?.trim() &&
    !file.externalSshTargetId &&
    (file.runtimeEnvironmentId === null || capturedHost === 'local') &&
    (!capturedHost || capturedHost === 'local')
  )
}

export function selectLocalExternalFileWatchTargets(
  state: EditorExternalWatchTargetState,
  eligibleIds: ReadonlySet<string>
): { watched: EditorExternalWatchTarget[]; unwatched: EditorExternalWatchTarget[] } {
  const roots: RuntimeWorkspaceFileRoot[] = []
  for (const worktree of getIndexedAllWorktrees(selectWorktreesByRepo(state))) {
    const repo = findRepoForHost(state.repos, worktree.repoId, { hostId: 'local' })
    if (worktree.hostId === 'local' && repo?.executionHostId === 'local' && !repo.connectionId) {
      roots.push({ workspaceId: worktree.id, rootPath: worktree.path, executionHostId: 'local' })
    }
  }
  for (const workspace of selectFolderWorkspaces(state)) {
    if (workspace.executionHostId === 'local') {
      roots.push({
        workspaceId: folderWorkspaceKey(workspace.id),
        rootPath: workspace.folderPath,
        executionHostId: 'local'
      })
    }
  }
  const sourceRoots = new Map(roots.map((root) => [root.workspaceId, root]))
  const targets = new Map<string, EditorExternalWatchTarget & { openFileIds: Set<string> }>()
  const activeRoots = new Set<string>()
  for (const file of state.openFiles.toReversed()) {
    if (!isLocalFile(file)) {
      continue
    }
    const source = sourceRoots.get(file.worktreeId)
    if (!source || relativePathInsideRoot(source.rootPath, file.filePath) !== null) {
      continue
    }
    const owner = findRuntimeWorkspaceFileOwner(roots, file.filePath, 'local')
    if (!owner || owner.relativePath === '') {
      continue
    }
    const rootKey = normalizeRuntimePathForComparison(owner.rootPath)
    const key = `${file.worktreeId}::${rootKey}`
    let target = targets.get(key)
    if (!target) {
      target = {
        worktreeId: file.worktreeId,
        worktreePath: owner.rootPath,
        connectionId: undefined,
        runtimeEnvironmentId: null,
        openFileIds: new Set()
      }
      targets.set(key, target)
    }
    target.openFileIds.add(file.id)
    if (file.id === state.activeFileId) {
      activeRoots.add(rootKey)
    }
  }
  const ordered = [...targets.values()]
    .map((target) => ({ target, rootKey: normalizeRuntimePathForComparison(target.worktreePath) }))
    .sort(
      (left, right) =>
        Number(activeRoots.has(right.rootKey)) - Number(activeRoots.has(left.rootKey))
    )
  const watched: EditorExternalWatchTarget[] = []
  const unwatched: EditorExternalWatchTarget[] = []
  const heldRoots = new Set<string>()
  for (const { target, rootKey } of ordered) {
    // Why: many external tabs in one workspace must not create unbounded recursive watches.
    if (
      eligibleIds.has(target.worktreeId) &&
      (heldRoots.has(rootKey) || heldRoots.size < WARM_RECURSIVE_WATCH_WORKSPACE_COUNT)
    ) {
      heldRoots.add(rootKey)
      watched.push(target)
    } else {
      unwatched.push(target)
    }
  }
  return { watched, unwatched }
}
