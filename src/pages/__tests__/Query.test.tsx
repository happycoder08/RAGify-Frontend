import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import * as sse from '../../sse'
import * as api from '../../api'
import { MemoryRouter } from 'react-router-dom'

// Mock import.meta.env before importing Query
vi.mock('import.meta.env', () => ({
  VITE_DEMO_MODE: 'true',
  VITE_SHOW_DEVTOOLS: 'true'
}), { virtual: true })

// Mock listDocuments to avoid network calls
vi.mock('../../api')

// Enable dev tools for tests
;(globalThis as any).__TEST_SHOW_DEVTOOLS__ = true

import Query from '../Query'

// Mock import.meta.env for SHOW_DEVTOOLS
vi.mock('import.meta.env', () => ({
  VITE_DEMO_MODE: 'true',
  VITE_SHOW_DEVTOOLS: 'true'
}), { virtual: true })

describe('Query SSE behavior', () => {
  beforeEach(() => {
    // @ts-ignore
    api.listDocuments = vi.fn().mockResolvedValue({ documents: [] })
  })

  test('final overwrites streamed tokens and refusal clears evidence', async () => {
    // Prepare a mock implementation of queryWithSSE that calls handlers
    const mockQuery = vi.fn((request, handlers) => {
      // stream tokens
      setTimeout(() => handlers.onToken?.('ARRIVE '), 10)
      setTimeout(() => handlers.onToken?.('AT '), 20)
      setTimeout(() => handlers.onToken?.('8:00 '), 30)
      // then final (refused=true)
      setTimeout(() => handlers.onFinal?.({
        answer: 'The document does not specify this.',
        refused: true,
        refusal_reason: 'No matching info',
        evidence: [],
        sources: []
      }), 50)

      return { abort: () => {}, done: Promise.resolve() }
    })

    // @ts-ignore
    vi.spyOn(sse, 'queryWithSSE').mockImplementation(mockQuery)

    render(
      <MemoryRouter>
        <Query />
      </MemoryRouter>
    )

    // Enter a question and submit
    const textarea = screen.getByPlaceholderText(/What is the company vacation policy/i)
    await userEvent.type(textarea, 'What time do we arrive?')
    const ask = screen.getByRole('button', { name: /Ask|Asking/i })
    await userEvent.click(ask)

    // After final arrives, the answer must be the canonical refusal message
    await waitFor(() => {
      expect(screen.getByText('The document does not specify this.')).toBeInTheDocument()
    })

    // Evidence panel should NOT be present when refused
    expect(screen.queryByText(/Employee_Onboarding_Guide_1.txt/)).not.toBeInTheDocument()
  })

  test('dev invariant shows when final missing evidence/sources', async () => {
    const mockQuery = vi.fn((request, handlers) => {
      setTimeout(() => handlers.onFinal?.({
        answer: 'Some answer',
        refused: false,
        evidence: [],
        sources: [],
      }), 10)
      return { abort: () => {}, done: Promise.resolve() }
    })

    // @ts-ignore
    vi.spyOn(sse, 'queryWithSSE').mockImplementation(mockQuery)

    render(
      <MemoryRouter>
        <Query />
      </MemoryRouter>
    )

    const textarea = screen.getByPlaceholderText(/What is the company vacation policy/i)
    await userEvent.type(textarea, 'Check invariant')
    const ask = screen.getByRole('button', { name: /Ask|Asking/i })
    await userEvent.click(ask)

    await waitFor(() => {
      expect(screen.getByText(/DEV ERROR: final payload missing evidence or sources/)).toBeInTheDocument()
    })
  })

  test('dev mismatch detected when answer time not in evidence', async () => {
    const mockQuery = vi.fn((request, handlers) => {
      setTimeout(() => handlers.onFinal?.({
        answer: 'Please arrive at 8:00 AM',
        refused: false,
        evidence: [{ chunk_id: 'c1', snippet: 'No time here' }],
        sources: [{ filename: 'doc.txt' }],
      }), 10)
      return { abort: () => {}, done: Promise.resolve() }
    })

    // @ts-ignore
    vi.spyOn(sse, 'queryWithSSE').mockImplementation(mockQuery)

    render(
      <MemoryRouter>
        <Query />
      </MemoryRouter>
    )

    const textarea = screen.getByPlaceholderText(/What is the company vacation policy/i)
    await userEvent.type(textarea, 'Check mismatch')
    const ask = screen.getByRole('button', { name: /Ask|Asking/i })
    await userEvent.click(ask)

    await waitFor(() => {
      expect(screen.getByText('Answer/Evidence mismatch')).toBeInTheDocument()
    })
  })

  test('dev flags canonical refusal text when refused=false', async () => {
    const mockQuery = vi.fn((request, handlers) => {
      setTimeout(() => handlers.onFinal?.({
        answer: 'The document does not specify this.',
        refused: false,
        evidence: [{ chunk_id: 'c1', snippet: 'some snippet' }],
        sources: [{ filename: 'doc.txt' }],
      }), 10)
      return { abort: () => {}, done: Promise.resolve() }
    })

    // @ts-ignore
    vi.spyOn(sse, 'queryWithSSE').mockImplementation(mockQuery)

    render(
      <MemoryRouter>
        <Query />
      </MemoryRouter>
    )

    const textarea = screen.getByPlaceholderText(/What is the company vacation policy/i)
    await userEvent.type(textarea, 'Check canonical refusal')
    const ask = screen.getByRole('button', { name: /Ask|Asking/i })
    await userEvent.click(ask)

    await waitFor(() => {
      expect(screen.getByText(/DEV ERROR: final.answer equals canonical refusal while refused=false/)).toBeInTheDocument()
    })
  })
})
