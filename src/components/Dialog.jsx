import { useEffect, useRef, useState } from 'react'

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

// A modal dialog (F7). It takes focus when it opens (on the field marked
// data-autofocus, else the first control), keeps Tab and Shift+Tab inside, closes on Esc or a click on the
// backdrop, and gives focus back to whatever had it before.
//
// Name the dialog with `label` (aria-label) or `labelledBy` (an element id).
// closeOnBackdrop=false keeps it open on a stray click outside (unsaved text).
export default function Dialog({ onClose, label, labelledBy, className = '', overlayClassName = '', closeOnBackdrop = true, children }) {
  const ref = useRef(null)
  // Read during the first render, before an autoFocus field inside takes focus.
  const [opener] = useState(() => document.activeElement)

  useEffect(() => {
    const node = ref.current
    if (node && !node.contains(document.activeElement)) {
      const first = node.querySelector('[data-autofocus]') || node.querySelector(FOCUSABLE)
      ;(first || node).focus()
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [opener])

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose?.()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...ref.current.querySelectorAll(FOCUSABLE)]
    if (!items.length) { e.preventDefault(); return }
    const first = items[0]
    const last = items[items.length - 1]
    const onDialog = document.activeElement === ref.current
    if (e.shiftKey && (onDialog || document.activeElement === first)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && (onDialog || document.activeElement === last)) { e.preventDefault(); first.focus() }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center p-4 ${overlayClassName || 'items-center bg-black/40 backdrop-blur-sm'}`}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose?.() }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
