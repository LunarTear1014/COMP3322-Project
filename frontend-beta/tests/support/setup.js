import { configure } from '@testing-library/react'

// Several UI test files run in parallel; a loaded machine can make a page take
// longer than the 1 s default to settle.
configure({ asyncUtilTimeout: 4000 })

// The request wizard keeps typed details in sessionStorage across reloads
// (EVT-05); each test starts with an empty tab.
import { beforeEach } from 'vitest'
beforeEach(() => { try { sessionStorage.clear() } catch { /* no storage */ } })
