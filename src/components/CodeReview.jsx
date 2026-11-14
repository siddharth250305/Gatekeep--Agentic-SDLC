import { useState, useMemo, useEffect } from 'react'
import CodeReviewBar from './code-review/CodeReviewBar'
import OpenTabs from './code-review/OpenTabs'
import DiffView from './code-review/DiffView'
import RequirementsColumn from './code-review/RequirementsColumn'
import DesignColumn from './code-review/DesignColumn'
import { FullFileDialog, QuickOpenDialog } from './code-review/CodeReviewDialogs'
import { downloadText, normalizeRunDiff, patchText } from '../lib/diff'

// Placeholder lines are not code, so they get no comment button.
const NO_CHANGES = [{ n1: null, n2: null, type: 'ctx', text: 'No code changes recorded for this run yet.', placeholder: true }]

// The Code Review page (Gate 3). Three columns (F5 part 1): the approved
// requirements and test results, the code changes, and the approved design
// with the changed files. Approve and Request changes live in the gate banner.
export default function CodeReview({ run, reviewerRole = 'Engineer', onAddComment }) {
  const [copied, setCopied] = useState(false)
  const [fullFileOpen, setFullFileOpen] = useState(false)
  const [quickOpenOpen, setQuickOpenOpen] = useState(false)

  const runDiff = useMemo(() => normalizeRunDiff(run), [run])
  const realFiles = runDiff.files

  // Only the files this run actually changed.
  const files = useMemo(() => {
    const registry = {}
    realFiles.forEach((rf) => {
      const lines = runDiff.linesByFile[rf.path]
      registry[rf.path] = {
        path: rf.path,
        name: rf.path.split('/').pop(),
        folder: rf.path.split('/').slice(0, -1).join('/'),
        modified: true,
        status: rf.status || 'M',
        add: rf.add || 0,
        rem: rf.rem || 0,
        header: rf.status === 'A' ? 'new file' : null,
        diffLines: lines?.length ? lines : [{ n1: null, n2: null, type: 'ctx', text: 'No diff recorded for this file.', placeholder: true }],
      }
    })
    return registry
  }, [realFiles, runDiff])
  const fileList = useMemo(() => Object.values(files), [files])

  const [selectedPath, setSelectedPath] = useState(() => realFiles[0]?.path || '')
  const [openTabs, setOpenTabs] = useState(() => realFiles.slice(0, 4).map((f) => f.path))

  // Open the run's own files when the run, or the set of files it changed, changes.
  const pathKey = realFiles.map((f) => f.path).join('\n')
  useEffect(() => {
    const paths = realFiles.map((f) => f.path)
    setSelectedPath((prev) => (paths.includes(prev) ? prev : paths[0] || ''))
    setOpenTabs((prev) => {
      const kept = prev.filter((p) => paths.includes(p))
      return kept.length > 0 ? kept : paths.slice(0, 4)
    })
  }, [run?.id, pathKey]) // eslint-disable-line react-hooks/exhaustive-deps -- realFiles is derived from pathKey

  // ⌘P / Ctrl+P toggles the quick file finder.
  useEffect(() => {
    const onKey = (e) => {
      // Not while another dialog is open: the finder would open behind it.
      const otherDialog = document.querySelector('[aria-modal="true"]:not([aria-label="Open a changed file"])')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p' && !otherDialog) {
        e.preventDefault()
        setQuickOpenOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeFile = files[selectedPath] || fileList[0] || { path: '', name: '', folder: '', status: 'clean', diffLines: NO_CHANGES }
  const diffLines = activeFile.diffLines || []

  const openFile = (path) => {
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
    setSelectedPath(path)
    setQuickOpenOpen(false)
  }

  const closeTab = (path) => {
    const remaining = openTabs.filter((t) => t !== path)
    if (!remaining.length) return
    setOpenTabs(remaining)
    if (selectedPath === path) setSelectedPath(remaining[remaining.length - 1])
  }

  const copyCode = () => {
    navigator.clipboard.writeText(diffLines.map((l) => l.text).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadPatch = () => downloadText(
    `${run?.id || 'RUN'}-${(activeFile.name || 'code').replace(/[/.]/g, '_')}.patch`,
    patchText(activeFile.path, diffLines),
    'text/x-diff',
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white font-sans dark:bg-[#000000]">
      <CodeReviewBar
        run={run}
        activeFile={activeFile}
        fileList={fileList}
        modifiedFiles={fileList}
        onOpenFile={openFile}
        onQuickOpen={() => setQuickOpenOpen(true)}
        onDownloadPatch={downloadPatch}
        onCopyCode={copyCode}
        copied={copied}
      />

      <div className="flex flex-1 min-w-0 overflow-hidden bg-white dark:bg-[#000000]">
        <RequirementsColumn run={run} />

        <section aria-label="Code changes" className="flex flex-1 min-w-0 flex-col overflow-hidden bg-white dark:bg-[#000000]">
          <OpenTabs
            openTabs={openTabs}
            files={files}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            onClose={closeTab}
            onQuickOpen={() => setQuickOpenOpen(true)}
          />
          <DiffView
            key={activeFile.path}
            activeFile={activeFile}
            diffLines={diffLines}
            onAddComment={onAddComment}
            reviewerRole={reviewerRole}
            onFullView={() => setFullFileOpen(true)}
          />
        </section>

        <DesignColumn run={run} changedFiles={fileList} selectedPath={activeFile.path} onOpenFile={openFile} />
      </div>

      {quickOpenOpen && (
        <QuickOpenDialog fileList={fileList} selectedPath={selectedPath} onOpenFile={openFile} onClose={() => setQuickOpenOpen(false)} />
      )}
      {fullFileOpen && (
        <FullFileDialog path={activeFile.path} diffLines={diffLines} onClose={() => setFullFileOpen(false)} />
      )}
    </div>
  )
}
