// Milestone 1 review finding #7 (UI part): the server only lets a comment's
// author or an Admin delete it, so the dashboard shows the delete button only
// to them instead of offering a button that always answers 403.
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import run0427 from '../../test/fixtures/run-0427.json'
import SpecsDesignView from './SpecsDesignView'

const COMMENTS = [
  { id: 'c1', phase: 'requirements', text: 'mine', author: 'adrt25', authorId: 1, role: 'Engineer', createdAt: '2026-11-13T10:00:00Z' },
  { id: 'c2', phase: 'requirements', text: 'theirs', author: 'pat', authorId: 2, role: 'Planner', createdAt: '2026-11-13T10:01:00Z' },
  { id: 'c3', phase: 'req', text: 'from before logins', author: 'Reviewer', role: 'Engineer', createdAt: '2026-11-13T10:02:00Z' },
]

function renderAs(user) {
  return render(
    <SpecsDesignView
      run={{ ...run0427, comments: COMMENTS }}
      reviewerRole={user.role}
      currentUser={user}
      onAddComment={vi.fn()}
      onDeleteComment={vi.fn()}
    />,
  )
}

test('a reviewer sees the delete button only on their own comment', () => {
  renderAs({ id: 1, username: 'adrt25', role: 'Engineer' })
  expect(screen.getByText('mine')).toBeInTheDocument()
  expect(screen.getByText('theirs')).toBeInTheDocument()
  expect(screen.getAllByTitle('Delete note')).toHaveLength(1)
})

test('an Admin sees the delete button on every comment, including ones with no author id', () => {
  renderAs({ id: 9, username: 'boss', role: 'Admin' })
  expect(screen.getAllByTitle('Delete note')).toHaveLength(3)
})

test('without a known user no delete button is shown', () => {
  render(<SpecsDesignView run={{ ...run0427, comments: COMMENTS }} onDeleteComment={vi.fn()} />)
  expect(screen.queryByTitle('Delete note')).toBeNull()
})
