// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor'
import type { FsChangedPayload } from '../../../shared/filesystem-entry-types'

const harness = vi.hoisted(() => {
  const state: { current?: AppState } = {}
  return { state }
})
function currentState(): AppState {
  if (!harness.state.current) {
    throw new Error('missing watch test state')
  }
  return harness.state.current
}
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: AppState) => unknown) => {
      if (!harness.state.current) {
        throw new Error('missing watch test state')
      }
      return selector(harness.state.current)
    },
    {
      getState: () => {
        if (!harness.state.current) {
          throw new Error('missing watch test state')
        }
        return harness.state.current
      }
    }
  )
}))
vi.mock('./editor-runtime-file-watch', () => ({
  subscribeEditorRuntimeFileWatch: () => vi.fn()
}))

import { createTestStore } from '@/store/slices/store-test-helpers'
import {
  makeFolderWorkspace,
  makeWorktree,
  TEST_REPO
} from '@/store/slices/worktrees-slice-test-fixtures'
import { useEditorExternalWatch } from './useEditorExternalWatch'
import { selectEditorExternalWatchTargets } from './editor-external-watch-targets'
import {
  ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
  getOpenFilesForExternalFileChange,
  type EditorPathMutationTarget
} from '@/components/editor/editor-autosave'
import { WARM_RECURSIVE_WATCH_WORKSPACE_COUNT } from './editor-external-watch-scope'
import { __clearSelfWriteRegistryForTests } from '@/components/editor/editor-self-write-registry'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'

function tab(
  id: string,
  filePath = '/container/report.txt',
  patch: Partial<OpenFile> = {}
): OpenFile {
  return {
    id,
    worktreeId: 'a',
    filePath,
    relativePath: filePath,
    language: 'plaintext',
    mode: 'edit',
    isDirty: false,
    runtimeEnvironmentId: null,
    ...patch
  }
}
function WatchProbe(): null {
  useEditorExternalWatch()
  return null
}

describe('external local files through the real watcher selector and event pipeline', () => {
  let container: HTMLDivElement
  let root: Root
  let emit: (payload: FsChangedPayload) => void
  let reloads: string[]
  const watch = vi.fn().mockResolvedValue(undefined)
  const unwatch = vi.fn().mockResolvedValue(undefined)
  const read = vi.fn().mockResolvedValue({ content: 'baseline', isBinary: false })
  const exists = vi
    .fn()
    .mockImplementation(({ filePaths }: { filePaths: string[] }) =>
      Promise.resolve(filePaths.map(() => ({ exists: true })))
    )
  const mutation = vi
    .fn()
    .mockImplementation((fileId: string, value: OpenFile['externalMutation'] | null) => {
      const state = currentState()
      state.openFiles = state.openFiles.map((file) =>
        file.id === fileId ? { ...file, externalMutation: value ?? undefined } : file
      )
    })
  const listener = (event: Event): void => {
    if (event instanceof CustomEvent) {
      const detail: EditorPathMutationTarget = event.detail
      reloads.push(
        ...getOpenFilesForExternalFileChange(currentState().openFiles, detail).map((f) => f.id)
      )
    }
  }
  async function render(): Promise<void> {
    await act(async () => root.render(createElement(WatchProbe)))
  }
  async function advance(): Promise<void> {
    await act(async () => vi.advanceTimersByTimeAsync(300))
  }
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.useFakeTimers()
    vi.clearAllMocks()
    reloads = []
    harness.state.current = {
      ...createTestStore().getState(),
      activeWorktreeId: 'a',
      activeWorkspaceExecutionHostId: 'local',
      activeFileId: 'external',
      repos: [
        {
          ...TEST_REPO,
          id: 'repo',
          path: '/container/a',
          executionHostId: 'local',
          connectionId: null
        }
      ],
      worktreesByRepo: {
        repo: [makeWorktree({ id: 'a', repoId: 'repo', path: '/container/a', hostId: 'local' })]
      },
      folderWorkspaces: [
        makeFolderWorkspace({ id: 'b', folderPath: '/container', executionHostId: 'local' })
      ],
      projectGroups: [],
      openFiles: [tab('external')],
      rightSidebarOpen: false,
      lastVisitedAtByWorktreeId: {},
      setExternalMutation: mutation
    }
    vi.stubGlobal('api', {
      fs: {
        watchWorktree: watch,
        unwatchWorktree: unwatch,
        readFile: read,
        pathsExist: exists,
        onFsChanged: (callback: typeof emit) => {
          emit = callback
          return vi.fn()
        }
      },
      telemetry: { track: vi.fn() }
    })
    window.addEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, listener)
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    window.removeEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, listener)
    container.remove()
    __clearSelfWriteRegistryForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reloads the clean external tab without touching a source file/diff with the same relative name', async () => {
    currentState().openFiles.push(
      tab('inside', '/container/a/report.txt', { relativePath: 'report.txt' }),
      tab('diff', '/container/a/report.txt', {
        relativePath: 'report.txt',
        mode: 'diff',
        diffSource: 'unstaged'
      }),
      tab('combined', '/container/a', {
        relativePath: '',
        mode: 'diff',
        diffSource: 'combined-uncommitted'
      })
    )
    await render()
    expect(watch.mock.calls.map(([args]) => args.worktreePath).sort()).toEqual([
      '/container',
      '/container/a'
    ])
    emit({
      worktreePath: '/container',
      events: [{ kind: 'update', absolutePath: '/container/report.txt' }]
    })
    await advance()
    expect(reloads).toEqual(['external'])
    emit({ worktreePath: '/container', events: [{ kind: 'overflow', absolutePath: '/container' }] })
    await advance()
    expect(reloads).toEqual(['external', 'external'])
  })

  it('marks a dirty external tab, coalesces deletion/recreation, and never mutates a same-id remote owner', async () => {
    currentState().openFiles = [
      tab('external', undefined, {
        isDirty: true,
        lastKnownDiskSignature: getDiskBaselineSignature('baseline')
      }),
      tab('remote', undefined, { runtimeEnvironmentId: 'remote', externalMutation: 'deleted' })
    ]
    await render()
    emit({
      worktreePath: '/container',
      events: [{ kind: 'update', absolutePath: '/container/report.txt' }]
    })
    await advance()
    expect(mutation).toHaveBeenCalledWith('external', 'changed')
    expect(mutation).not.toHaveBeenCalledWith('remote', expect.anything())
    currentState().openFiles = [
      tab('external'),
      tab('remote', undefined, { runtimeEnvironmentId: 'remote', externalMutation: 'deleted' })
    ]
    emit({
      worktreePath: '/container',
      events: [{ kind: 'delete', absolutePath: '/container/report.txt' }]
    })
    await advance()
    expect(currentState().openFiles.find((f) => f.id === 'external')?.externalMutation).toBe(
      'deleted'
    )
    emit({
      worktreePath: '/container',
      events: [{ kind: 'create', absolutePath: '/container/report.txt' }]
    })
    await advance()
    expect(
      currentState().openFiles.find((f) => f.id === 'external')?.externalMutation
    ).toBeUndefined()
    expect(currentState().openFiles.find((f) => f.id === 'remote')?.externalMutation).toBe(
      'deleted'
    )
    expect(reloads).toEqual(['external'])
  })

  it('keeps simultaneous same-relative-name updates and overflows distinct across source and supplemental roots', async () => {
    currentState().openFiles = [
      tab('inside', '/container/a/report.txt', { relativePath: 'report.txt' }),
      tab('first', '/first/report.txt'),
      tab('second', '/second/report.txt')
    ]
    currentState().folderWorkspaces = ['first', 'second'].map((id) =>
      makeFolderWorkspace({ id, folderPath: `/${id}`, executionHostId: 'local' })
    )
    await render()
    for (const worktreePath of ['/container/a', '/first', '/second']) {
      emit({
        worktreePath,
        events: [{ kind: 'update', absolutePath: `${worktreePath}/report.txt` }]
      })
    }
    await advance()
    expect(reloads.sort()).toEqual(['first', 'inside', 'second'])
    reloads = []
    for (const worktreePath of ['/container/a', '/first', '/second']) {
      emit({ worktreePath, events: [{ kind: 'overflow', absolutePath: worktreePath }] })
    }
    await advance()
    expect(reloads.sort()).toEqual(['first', 'inside', 'second'])
  })

  it('catches up a trimmed external root on selection using the correct physical path and per-file scope', async () => {
    const files = Array.from({ length: WARM_RECURSIVE_WATCH_WORKSPACE_COUNT + 2 }, (_, i) =>
      tab(`file-${i}`, `/external-${i}/report.txt`)
    )
    currentState().openFiles = [
      ...files,
      tab('diff', '/container/a/report.txt', {
        relativePath: 'report.txt',
        mode: 'diff',
        diffSource: 'unstaged'
      })
    ]
    currentState().folderWorkspaces = files.map((_, i) =>
      makeFolderWorkspace({ id: `b-${i}`, folderPath: `/external-${i}`, executionHostId: 'local' })
    )
    currentState().activeFileId = 'file-0'
    await render()
    expect(watch).toHaveBeenCalledTimes(WARM_RECURSIVE_WATCH_WORKSPACE_COUNT + 1)
    expect(selectEditorExternalWatchTargets(currentState()).unwatchedTargetKeys.size).toBe(2)
    currentState().activeFileId = 'file-1'
    await render()
    await advance()
    expect(reloads).toEqual(['file-1'])
    expect(exists).toHaveBeenCalledWith({
      filePaths: ['/external-1/report.txt'],
      connectionId: undefined
    })
    expect(unwatch).toHaveBeenCalledTimes(1)
  })

  it('resyncs dirty external files against their absolute paths without reloading unrelated diff tabs', async () => {
    const files = Array.from({ length: WARM_RECURSIVE_WATCH_WORKSPACE_COUNT + 2 }, (_, i) =>
      tab(`file-${i}`, `/external-${i}/report.txt`)
    )
    currentState().openFiles = files
    currentState().folderWorkspaces = files.map((_, i) =>
      makeFolderWorkspace({ id: `b-${i}`, folderPath: `/external-${i}`, executionHostId: 'local' })
    )
    currentState().activeFileId = 'file-0'
    await render()
    currentState().openFiles = currentState().openFiles.map((f) =>
      f.id === 'file-1'
        ? { ...f, isDirty: true, lastKnownDiskSignature: getDiskBaselineSignature('baseline') }
        : f
    )
    currentState().activeFileId = 'file-1'
    await render()
    await advance()
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/external-1/report.txt' })
    )
    expect(mutation).not.toHaveBeenCalledWith('file-1', 'changed')
    expect(reloads).toEqual([])
  })

  it('shares physical roots and releases only after the final consumer closes or unmounts', async () => {
    currentState().openFiles.push(
      tab('owned', '/container/report.txt', { worktreeId: 'folder:b', relativePath: 'report.txt' })
    )
    currentState().lastVisitedAtByWorktreeId = { 'folder:b': 1 }
    await render()
    expect(watch.mock.calls.filter(([args]) => args.worktreePath === '/container')).toHaveLength(1)
    currentState().openFiles = currentState().openFiles.filter((f) => f.id !== 'external')
    await render()
    expect(unwatch.mock.calls.some(([args]) => args.worktreePath === '/container')).toBe(false)
    currentState().openFiles = []
    await render()
    expect(unwatch.mock.calls.filter(([args]) => args.worktreePath === '/container')).toHaveLength(
      1
    )
    currentState().openFiles = [tab('again')]
    await render()
    await act(async () => root.unmount())
    expect(watch.mock.calls.filter(([args]) => args.worktreePath === '/container')).toHaveLength(2)
    expect(unwatch.mock.calls.filter(([args]) => args.worktreePath === '/container')).toHaveLength(
      2
    )
    root = createRoot(container)
  })
})
