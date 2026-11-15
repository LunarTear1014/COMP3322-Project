import { configure } from '@testing-library/react'

// Several UI test files run in parallel; a loaded machine can make a page take
// longer than the 1 s default to settle.
configure({ asyncUtilTimeout: 4000 })
