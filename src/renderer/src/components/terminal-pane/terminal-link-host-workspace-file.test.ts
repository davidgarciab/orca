import { describe, expect, it, vi } from 'vitest'
import { openDetectedFilePath } from './terminal-link-handlers'
import { activateAndRevealWorkspace, activateAndRevealWorktree } from '@/lib/worktree-activation'
import { downloadAndOpenRemoteTerminalFile } from './terminal-remote-file-download-open'
import { createTerminalLinkTestDoubles } from './terminal-link-handlers-test-fixtures'
import {
  flushDoubleRaf,
  installTerminalLinkTestEnvironment
} from './terminal-link-handlers-test-harness'

const doubles = createTerminalLinkTestDoubles()
const {
  storeState,
  statMock,
  openFileMock,
  openFilePathMock,
  createBrowserTabMock,
  runtimeEnvironmentCallMock
} = doubles

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => storeState
  }
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: vi.fn(),
  activateAndRevealWorktree: vi.fn()
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionId: vi.fn(() => null)
}))

vi.mock('./terminal-remote-file-download-open', () => ({
  downloadAndOpenRemoteTerminalFile: vi.fn()
}))

installTerminalLinkTestEnvironment(doubles)

const featureWorktree = {
  worktreeId: 'wt-feat',
  worktreePath: '/repo/.orca/worktrees/feat-x',
  runtimeEnvironmentId: 'env-1'
}

function hostAnswers(result: unknown): void {
  runtimeEnvironmentCallMock.mockResolvedValueOnce({
    id: 'rpc-1',
    ok: true,
    result,
    _meta: { runtimeId: 'remote-runtime' }
  })
}

describe('a paired-server link outside its own workspace', () => {
  it('opens a host-owned sibling file in the terminal workspace that was clicked', async () => {
    hostAnswers({
      worktree: 'wt-main',
      relativePath: 'src/index.ts',
      absolutePath: '/repo/src/index.ts',
      exists: true,
      isDirectory: false
    })

    openDetectedFilePath('/repo/src/index.ts', 3, null, featureWorktree)
    await flushDoubleRaf()

    expect(runtimeEnvironmentCallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: 'env-1',
        method: 'files.resolveTerminalPath',
        params: { worktree: 'id:wt-feat', pathText: '/repo/src/index.ts', crossWorkspace: true }
      })
    )
    expect(statMock).not.toHaveBeenCalled()
    expect(activateAndRevealWorkspace).toHaveBeenCalledWith('wt-feat', {
      providesInitialSurface: true,
      executionHostId: 'runtime:env-1'
    })
    expect(openFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/repo/src/index.ts',
        relativePath: '/repo/src/index.ts',
        worktreeId: 'wt-feat',
        runtimeEnvironmentId: 'env-1'
      }),
      { forceContentReload: true }
    )
  })

  it("opens the host's spelling of the path without leaving the terminal workspace", async () => {
    hostAnswers({
      worktree: 'wt-main',
      relativePath: 'src/index.ts',
      absolutePath: '/repo/src/index.ts',
      exists: true,
      isDirectory: false
    })

    openDetectedFilePath('/repo/lib/../src/index.ts', null, null, featureWorktree)
    await flushDoubleRaf()

    expect(openFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/repo/src/index.ts',
        relativePath: '/repo/src/index.ts',
        worktreeId: 'wt-feat'
      }),
      { forceContentReload: true }
    )
  })

  it('keeps a home-folder HTML report in the terminal that printed it', async () => {
    hostAnswers({
      worktree: 'folder:home',
      relativePath: 'report.html',
      absolutePath: '/Users/me/report.html',
      exists: true,
      isDirectory: false
    })

    openDetectedFilePath('/Users/me/report.html', null, null, {
      worktreeId: 'wt-app',
      worktreePath: '/Users/me/code/app',
      runtimeEnvironmentId: 'env-1'
    })
    await flushDoubleRaf()

    expect(activateAndRevealWorkspace).not.toHaveBeenCalledWith('folder:home', expect.anything())
    expect(activateAndRevealWorktree).not.toHaveBeenCalledWith('folder:home', expect.anything())
    expect(createBrowserTabMock).not.toHaveBeenCalledWith(
      'folder:home',
      expect.anything(),
      expect.anything()
    )
    expect(openFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/Users/me/report.html',
        relativePath: '/Users/me/report.html',
        worktreeId: 'wt-app'
      }),
      { forceContentReload: true }
    )
  })

  it('downloads a Shift-clicked host file instead of opening the same path on this computer', async () => {
    hostAnswers({
      worktree: 'wt-main',
      relativePath: 'src/index.ts',
      absolutePath: '/repo/src/index.ts',
      exists: true,
      isDirectory: false
    })

    openDetectedFilePath('/repo/src/index.ts', null, null, {
      ...featureWorktree,
      openWithSystemDefault: true
    })
    await flushDoubleRaf()

    expect(openFilePathMock).not.toHaveBeenCalled()
    expect(downloadAndOpenRemoteTerminalFile).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-main', worktreePath: '/repo' }),
      '/repo/src/index.ts'
    )
  })

  it('never opens a host directory on this computer', async () => {
    hostAnswers({
      worktree: 'wt-main',
      relativePath: 'docs',
      absolutePath: '/repo/docs',
      exists: true,
      isDirectory: true
    })

    openDetectedFilePath('/repo/docs', null, null, featureWorktree)
    await flushDoubleRaf()

    expect(openFilePathMock).not.toHaveBeenCalled()
    expect(openFileMock).not.toHaveBeenCalled()
  })

  it('says the host has no workspace for a path outside all of them and this computer', async () => {
    statMock.mockRejectedValueOnce(new Error('ENOENT: no such file'))
    hostAnswers({
      worktree: 'wt-feat',
      relativePath: null,
      absolutePath: '/etc/hosts',
      exists: false,
      isDirectory: false
    })
    const onOpenFailure = vi.fn()

    openDetectedFilePath('/etc/hosts', null, null, { ...featureWorktree, onOpenFailure })
    await flushDoubleRaf()

    expect(openFileMock).not.toHaveBeenCalled()
    expect(onOpenFailure).toHaveBeenCalledWith({
      verdict: 'unverifiable',
      error: new Error('/etc/hosts is outside every workspace on its host')
    })
  })

  it('reports a sibling-workspace file the host verified absent as missing', async () => {
    hostAnswers({
      worktree: 'wt-y',
      relativePath: 'src/gone.ts',
      absolutePath: '/repo/.orca/worktrees/feat-y/src/gone.ts',
      exists: false,
      isDirectory: false
    })
    const onOpenFailure = vi.fn()

    openDetectedFilePath('/repo/.orca/worktrees/feat-y/src/gone.ts', null, null, {
      ...featureWorktree,
      onOpenFailure
    })
    await flushDoubleRaf()

    expect(openFileMock).not.toHaveBeenCalled()
    expect(onOpenFailure).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'missing' }))
  })

  it('keeps a file inside its own workspace on the plain stat path', async () => {
    hostAnswers({ size: 1, isDirectory: false, mtime: 1 })

    openDetectedFilePath('/repo/.orca/worktrees/feat-x/a.ts', null, null, featureWorktree)
    await flushDoubleRaf()

    expect(runtimeEnvironmentCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'files.stat' })
    )
    expect(runtimeEnvironmentCallMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'files.resolveTerminalPath' })
    )
    expect(openFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'a.ts', worktreeId: 'wt-feat' }),
      { forceContentReload: true }
    )
  })
})
