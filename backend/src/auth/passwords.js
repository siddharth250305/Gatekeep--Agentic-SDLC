// Password hashing with scrypt (built into Node, no extra dependency).
// Stored format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)
const PARAMS = { N: 16384, r: 8, p: 1 }
const KEYLEN = 64

export const MIN_PASSWORD_LENGTH = 10

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEYLEN, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt' || typeof password !== 'string') return false
  const [, N, r, p, saltB64, hashB64] = parts
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// A real hash of a random password, used to spend the same time on unknown
// usernames as on wrong passwords (so login timing does not reveal accounts).
let dummyHash
export async function dummyVerify(password) {
  dummyHash ||= await hashPassword(randomBytes(18).toString('base64'))
  await verifyPassword(String(password ?? ''), dummyHash)
  return false
}
