import { ShieldCheck, Play, Lock, BadgeCheck, FileText, Package } from 'lucide-react'
import { NAV, REVIEWER } from '../data/runs'

const ICONS = { Play, BadgeCheck, FileText, Package }

export default function Sidebar({ active, onSelect, badges = {}, reviewerRole = 'Engineer' }) {
  return (
    <aside className="flex w-[170px] shrink-0 flex-col border-r border-black/[0.08] bg-[#f5f5f7] select-none">
      {/* macOS Window Traffic Lights */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        <button
          type="button"
          aria-label="Close"
          className="h-3 w-3 rounded-full bg-[#ff5f56] border border-[#e0443e]/70 shadow-xs hover:opacity-85 transition-opacity"
        />
        <button
          type="button"
          aria-label="Minimize"
          className="h-3 w-3 rounded-full bg-[#ffbd2e] border border-[#dea123]/70 shadow-xs hover:opacity-85 transition-opacity"
        />
        <button
          type="button"
          aria-label="Zoom"
          className="h-3 w-3 rounded-full bg-[#27c93f] border border-[#1aab29]/70 shadow-xs hover:opacity-85 transition-opacity"
        />
      </div>

      {/* Brand Icon: Blue squircle emblem */}
      <div className="px-4 pt-1.5 pb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-[0_2px_8px_rgba(0,113,227,0.35)] transition-transform hover:scale-105 cursor-pointer">
          <ShieldCheck size={20} strokeWidth={2.2} />
        </span>
      </div>

      {/* Navigation Section */}
      <div className="px-2.5 pt-1 pb-2">
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const Icon = ICONS[item.icon]
            const isActive = item.key === active
            const badge = badges[item.key] ?? item.badge

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect?.(item.key)}
                className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-all duration-150 ${
                  isActive
                    ? 'bg-black/[0.08] text-ink font-semibold shadow-xs'
                    : 'text-muted hover:bg-black/[0.035] hover:text-ink'
                }`}
              >
                <Icon
                  size={15}
                  className={`shrink-0 ${isActive ? 'text-accent' : 'text-faint group-hover:text-ink'}`}
                />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {badge ? (
                  <span
                    className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 font-mono text-[9.5px] font-semibold ${
                      isActive ? 'bg-accent text-white' : 'bg-black/[0.08] text-muted'
                    }`}
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
      </div>

      <div className="flex-1" />

      {/* Reviewer / User Identity */}
      <div className="border-t border-black/[0.06] bg-black/[0.015] p-3 flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-b from-[#e5e5ea] to-[#d1d1d6] font-bold text-ink text-[10.5px] shadow-xs shrink-0">
          {REVIEWER.initials}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[11.5px] font-semibold text-ink">{REVIEWER.name}</div>
          <div className="truncate text-[10px] text-faint">{reviewerRole || REVIEWER.role}</div>
        </div>
      </div>
    </aside>
  )
}
