// Review findings on the F6 rework window: which comments belong to a gate's round.
import { expect, test } from 'vitest'
import { gateComments, gateView } from './gate'

const at = (iso) => new Date(iso).toISOString()
const note = (id, phase, iso) => ({ id, phase, text: id, file: 'f', line: null, role: 'Engineer', createdAt: iso && at(iso) })

test('a gate revisited after being approved does not re-send the notes of the round it approved (F6)', () => {
  // Gate 2 approved at 10:00 with an old design note; Gate 3 later sent the
  // work back to Design, and the run is at Gate 2 again.
  const run = {
    step: 'g2',
    auditChain: [
      { event: 'g2.approved', createdAt: at('2026-11-13T10:00:00Z') },
      { event: 'g3.rejected', createdAt: at('2026-11-13T11:00:00Z') },
    ],
    comments: [note('old-design', 'design', '2026-11-13T09:50:00Z'), note('new-design', 'design', '2026-11-13T11:30:00Z')],
  }
  expect(gateComments(run).map((c) => c.id)).toEqual(['new-design'])
})

test('a comment without a readable time is kept and shown, never silently dropped (F6)', () => {
  const run = {
    step: 'g3',
    auditChain: [{ event: 'g3.rejected', createdAt: at('2026-11-13T10:00:00Z') }],
    comments: [note('no-time', 'code', null)],
  }
  expect(gateComments(run).map((c) => c.id)).toEqual(['no-time'])
})

test('Gate 1: a Planner may decide, an Engineer may not (F4)', () => {
  const run = { step: 'g1' }
  expect(gateView(run, { role: 'Planner', username: 'p' })).toMatchObject({ canApprove: true, canReject: true })
  expect(gateView(run, { role: 'Engineer', username: 'e' })).toMatchObject({
    canApprove: false, canReject: false, approveBlock: 'Only a Planner can decide Gate 1. You are signed in as Engineer',
  })
})

test('an Admin who asked for the work still cannot give the final approval (F4, mirrors machine.js)', () => {
  const run = { step: 'g3', createdBy: 'boss', review: { approvable: true } }
  expect(gateView(run, { role: 'Admin', username: 'boss' })).toMatchObject({ canApprove: false, canReject: true })
})
