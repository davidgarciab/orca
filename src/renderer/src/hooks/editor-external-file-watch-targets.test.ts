import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import {
  makeFolderWorkspace,
  makeWorktree,
  TEST_REPO
} from '@/store/slices/worktrees-slice-test-fixtures'
import { getDefaultSettings } from '../../../shared/constants'
import {
  selectEditorExternalWatchTargets,
  type EditorExternalWatchTargetState
} from './editor-external-watch-targets'
import { WARM_RECURSIVE_WATCH_WORKSPACE_COUNT } from './editor-external-watch-scope'
import { indexEditorExternalWatchBatchPaths } from '@/components/editor/editor-external-watch-path-index'
import { mapTerminalFilePath } from '@/components/terminal-pane/terminal-file-path-mapping'
import { buildHydratedEditorSessionState } from '@/store/slices/editor/actions/hydrated-editor-session-state'
import { getRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'

const source = makeWorktree({ id: 'a', repoId: 'repo', path: '/container/a', hostId: 'local' })
const repo = {
  ...TEST_REPO,
  id: 'repo',
  path: '/container/a',
  executionHostId: 'local' as const,
  connectionId: null
}
function tab(id: string, path = '/container/report.txt'): OpenFile {
  return {
    id,
    worktreeId: 'a',
    filePath: path,
    relativePath: path,
    language: 'plaintext',
    mode: 'edit',
    isDirty: false,
    runtimeEnvironmentId: null
  }
}
function state(openFiles: OpenFile[]): EditorExternalWatchTargetState {
  return {
    settings: getDefaultSettings('/home/test'),
    openFiles,
    activeWorktreeId: 'a',
    activeWorkspaceExecutionHostId: 'local',
    activeFileId: openFiles[0]?.id ?? null,
    repos: [repo],
    worktreesByRepo: { repo: [source] },
    folderWorkspaces: [
      makeFolderWorkspace({ id: 'b', folderPath: '/container', executionHostId: 'local' })
    ],
    projectGroups: [],
    rightSidebarOpen: false,
    rightSidebarTab: 'explorer',
    rightSidebarExplorerView: 'files',
    gitStatusHugeByWorktree: {},
    sshConnectionStates: new Map()
  }
}
const external = (s: EditorExternalWatchTargetState) =>
  selectEditorExternalWatchTargets(s).targets.filter((t) => t.openFileIds)

afterEach(() => vi.unstubAllGlobals())

describe('local external editor watch targets', () => {
  it('retains the logical owner while watching the containing local folder', () => {
    const s = state([tab('external'), tab('inside', '/container/a/report.txt')])
    expect(external(s)).toEqual([
      {
        worktreeId: 'a',
        worktreePath: '/container',
        connectionId: undefined,
        runtimeEnvironmentId: null,
        openFileIds: new Set(['external'])
      }
    ])
    expect(selectEditorExternalWatchTargets(s).targets).toHaveLength(2)
    expect(selectEditorExternalWatchTargets({ ...s })).toBe(selectEditorExternalWatchTargets(s))
  })

  it.each([
    { runtimeEnvironmentId: 'env' },
    { externalSshTargetId: 'ssh' },
    { mode: 'diff' as const, diffSource: 'unstaged' as const },
    { mode: 'check-details' as const }
  ])('does not add a local root for nonlocal or nonfile consumers %j', (patch) => {
    expect(external(state([{ ...tab('external'), ...patch }]))).toEqual([])
  })

  it('excludes captured host twins and remote containing roots', () => {
    const captured = tab('captured')
    captured.operationProvenance = {
      generation: {
        route: { executionHostId: 'runtime:env', runtimeEnvironmentId: 'env' },
        runtimeConnectionGeneration: null,
        runtimePairingRevision: undefined,
        runtimeSshGeneration: null,
        nestedSshGeneration: null,
        directSshGeneration: null
      },
      ownershipProjection: 'explicit'
    }
    expect(external(state([captured]))).toEqual([])
    const s = state([tab('external')])
    s.folderWorkspaces = [
      makeFolderWorkspace({ id: 'b', folderPath: '/container', executionHostId: 'runtime:env' })
    ]
    expect(external(s)).toEqual([])
    s.worktreesByRepo = { repo: [{ ...source, hostId: 'runtime:env' }] }
    s.folderWorkspaces = [
      makeFolderWorkspace({ id: 'b', folderPath: '/container', executionHostId: 'local' })
    ]
    expect(external(s)).toEqual([])
  })

  it('uses the captured local root when a same-id remote folder is selected', () => {
    const s = state([tab('external')])
    s.openFiles[0].operationProvenance = {
      generation: {
        route: { executionHostId: 'local', runtimeEnvironmentId: null },
        runtimeConnectionGeneration: null,
        runtimePairingRevision: undefined,
        runtimeSshGeneration: null,
        nestedSshGeneration: null,
        directSshGeneration: null
      },
      ownershipProjection: 'explicit'
    }
    s.activeWorkspaceExecutionHostId = 'runtime:env'
    s.folderWorkspaces = [
      ...s.folderWorkspaces,
      makeFolderWorkspace({ id: 'b', folderPath: '/remote', executionHostId: 'runtime:env' })
    ]
    expect(external(s).map((t) => t.worktreePath)).toEqual(['/container'])
  })

  it.each(['a', 'folder:source'])(
    'watches a restored legacy external tab with an unambiguous local owner %s',
    (worktreeId) => {
      const hydrated = buildHydratedEditorSessionState(
        {
          activeRepoId: 'repo',
          activeWorktreeId: worktreeId,
          activeTabId: null,
          tabsByWorktree: {},
          terminalLayoutsByTabId: {},
          openFilesByWorktree: {
            [worktreeId]: [
              {
                filePath: '/container/report.txt',
                relativePath: '/container/report.txt',
                worktreeId,
                language: 'plaintext'
              }
            ]
          }
        },
        new Set([worktreeId]),
        worktreeId
      ).state.openFiles[0]
      expect(hydrated.runtimeEnvironmentId).toBeUndefined()
      expect(hydrated.operationProvenance).toBeUndefined()
      const s = state([hydrated])
      s.activeWorktreeId = worktreeId
      if (worktreeId === 'folder:source') {
        s.folderWorkspaces = [
          ...s.folderWorkspaces,
          makeFolderWorkspace({
            id: 'source',
            folderPath: '/container/a',
            executionHostId: 'local'
          })
        ]
      }
      expect(getRuntimeTargetForFileOwner(s, worktreeId, undefined)).toEqual({ kind: 'local' })
      expect(external(s)[0]?.openFileIds).toEqual(new Set([hydrated.id]))
    }
  )

  it.each(['local', 'runtime:env'] as const)(
    'leaves an unstamped legacy tab alone when same-id host twins exist and %s is selected',
    (selectedHost) => {
      const s = state([{ ...tab('legacy'), runtimeEnvironmentId: undefined }])
      s.activeWorkspaceExecutionHostId = selectedHost
      s.worktreesByRepo = {
        repo: [source, { ...source, path: '/remote/a', hostId: 'runtime:env' }]
      }
      expect(external(s)).toEqual([])
    }
  )

  it('rechecks legacy ownership when a detected same-id remote owner appears or disappears', () => {
    const s = state([{ ...tab('legacy'), runtimeEnvironmentId: undefined }])
    expect(external(s)).toHaveLength(1)
    const contested: EditorExternalWatchTargetState = {
      ...s,
      detectedWorktreesByRepo: {
        repo: {
          repoId: 'repo',
          authoritative: true,
          source: 'git',
          worktrees: [
            {
              ...source,
              path: '/remote/a',
              hostId: 'runtime:env',
              ownership: 'external',
              selectedCheckout: false,
              visible: true
            }
          ]
        }
      }
    }
    expect(external(contested)).toEqual([])
    expect(external(s)).toHaveLength(1)
  })

  it('caps supplemental physical roots, prioritizes the selected tab and records trimmed roots for catch-up', () => {
    const tabs = Array.from({ length: WARM_RECURSIVE_WATCH_WORKSPACE_COUNT + 2 }, (_, i) =>
      tab(`file-${i}`, `/external-${i}/report.txt`)
    )
    const s = state(tabs)
    s.folderWorkspaces = tabs.map((_, i) =>
      makeFolderWorkspace({ id: `b-${i}`, folderPath: `/external-${i}`, executionHostId: 'local' })
    )
    const first = selectEditorExternalWatchTargets(s)
    expect(external(s)).toHaveLength(WARM_RECURSIVE_WATCH_WORKSPACE_COUNT)
    expect(external(s).some((t) => t.openFileIds?.has('file-0'))).toBe(true)
    const trimmed = '/external-1'
    expect([...first.unwatchedTargetKeys].some((key) => key.includes(`${trimmed}::`))).toBe(true)
    const next = selectEditorExternalWatchTargets({ ...s, activeFileId: 'file-1' })
    const selected = next.targets.find((t) => t.openFileIds?.has('file-1'))
    expect(selected?.worktreePath).toBe(trimmed)
    expect(next.targetsKey).not.toBe(first.targetsKey)
    expect(external({ ...s, activeFileId: 'file-1' })).toHaveLength(
      WARM_RECURSIVE_WATCH_WORKSPACE_COUNT
    )
  })

  it('charges a shared physical root once and retains ordinary workspace trim eligibility', () => {
    const s = state([tab('first'), { ...tab('second'), worktreeId: 'c' }])
    s.worktreesByRepo = { repo: [source, { ...source, id: 'c', path: '/container/c' }] }
    expect(external(s).map((t) => t.worktreeId)).toEqual(['a'])
    expect(
      external({ ...s, lastVisitedAtByWorktreeId: { c: 1 } })
        .map((t) => t.worktreeId)
        .sort()
    ).toEqual(['a', 'c'])
    expect(external({ ...s, openFiles: [] })).toEqual([])
  })

  it('supports native Windows roots without treating a same-prefix sibling as contained', () => {
    const s = state([tab('windows', 'C:\\container\\b\\report.txt')])
    s.worktreesByRepo = { repo: [{ ...source, path: 'C:\\container\\a' }] }
    s.folderWorkspaces = [
      makeFolderWorkspace({ id: 'b', folderPath: 'C:\\container\\b', executionHostId: 'local' })
    ]
    expect(external(s).map((t) => t.worktreePath)).toEqual(['C:\\container\\b'])
  })

  it.each([
    '//wsl.localhost/Ubuntu/container/report.txt',
    String.raw`\\wsl$\Ubuntu\container\report.txt`
  ])('retains ordinary owner WSL watch matching for terminal path %s', (filePath) => {
    vi.stubGlobal('navigator', { userAgent: 'Windows' })
    const ownerRoot = String.raw`\\wsl.localhost\Ubuntu\container`
    const sourceRoot = `${ownerRoot}\\a`
    expect(mapTerminalFilePath(filePath, sourceRoot, null)).toBe(filePath)
    const file = tab('external', filePath)
    const s = state([file])
    s.folderWorkspaces = []
    s.worktreesByRepo = {
      repo: [
        { ...source, path: sourceRoot },
        { ...source, id: 'b', path: ownerRoot }
      ]
    }
    const supplemental = external(s)[0]
    expect(supplemental.allowLocalWindowsWslAliases).toBe(true)
    const payload = {
      worktreePath: ownerRoot,
      events: [{ kind: 'update' as const, absolutePath: `${ownerRoot}\\report.txt` }]
    }
    const batch = indexEditorExternalWatchBatchPaths(payload, [file], supplemental)
    expect(batch.matchingOpenFiles(batch.changes[0])).toEqual([file])
    const ownedFile = { ...file, worktreeId: 'b', relativePath: 'report.txt' }
    const ordinary = selectEditorExternalWatchTargets({
      ...s,
      activeWorktreeId: 'b',
      openFiles: [ownedFile]
    }).targets[0]
    const ordinaryBatch = indexEditorExternalWatchBatchPaths(payload, [ownedFile], ordinary)
    expect(ordinaryBatch.matchingOpenFiles(ordinaryBatch.changes[0])).toEqual([ownedFile])
  })
})
