// Vitest setup for the dashboard: jsdom lacks a few browser APIs App uses.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Theme detection reads prefers-color-scheme.
window.matchMedia ||= (query) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
})

// Records every live-update socket the app opens; never connects anywhere.
export class FakeWebSocket {
  static instances = []
  constructor(url) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send() {}
  close() {
    this.closed = true
  }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  FakeWebSocket.instances = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
