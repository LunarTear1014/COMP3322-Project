// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let size = { width: 1600, height: 1067 }
vi.mock('../src/lib/cover.js', async importOriginal => ({ ...(await importOriginal()), readImageSize: vi.fn(async () => size) }))
const { CoverUploader } = await import('../src/components/CoverUploader.jsx')
const { coverForm, coverProblem } = await import('../src/lib/cover.js')

afterEach(() => { cleanup(); size = { width: 1600, height: 1067 } })
URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => {}

const file = (name = 'cover.jpg', type = 'image/jpeg', bytes = 1000) => new File([new Uint8Array(bytes)], name, { type })
const pick = (f) => fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [f] } })

describe('cover rules', () => {
  it('checks type, size and dimensions before upload', () => {
    expect(coverProblem(file(), { width: 1200, height: 800 })).toBe('')
    expect(coverProblem(file('a.png', 'image/png'), { width: 2000, height: 2000 })).toMatch(/JPEG or WebP/)
    expect(coverProblem(file('a.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1), { width: 2000, height: 2000 })).toMatch(/5 MB/)
    expect(coverProblem(file(), { width: 800, height: 600 })).toBe('Covers need at least 1200×800 pixels.')
    expect(coverProblem(file(), null)).toMatch(/could not be read/)
  })

  it('builds the multipart body the API expects', () => {
    const form = coverForm({ file: file(), alt: ' A hall ', expectedVersion: 3 })
    expect([form.get('alt'), form.get('expected_version'), form.get('file').name]).toEqual(['A hall', '3', 'cover.jpg'])
  })
})

describe('CoverUploader', () => {
  it('states the image rules before upload', () => {
    render(<CoverUploader title="Photo walk" />)
    expect(screen.getByText(/at least 1200×800/)).toBeTruthy()
    expect(screen.getByText(/Choose image/)).toBeTruthy()
  })

  it('rejects an 800×600 image with the rule next to the uploader', async () => {
    size = { width: 800, height: 600 }
    const onChange = vi.fn()
    render(<CoverUploader title="Photo walk" onChange={onChange} />)
    pick(file())
    expect((await screen.findByRole('alert')).textContent).toBe('Covers need at least 1200×800 pixels.')
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByLabelText('Describe the image')).toBeNull()
  })

  it('stages a valid file with the title as alt text, then uploads on request', async () => {
    const onChange = vi.fn()
    const onSave = vi.fn()
    render(<CoverUploader title="Photo walk" onChange={onChange} onSave={onSave} />)
    const chosen = file()
    pick(chosen)
    const alt = await screen.findByLabelText('Describe the image')
    expect(alt.value).toBe('Photo walk')
    expect(onChange).toHaveBeenLastCalledWith({ file: chosen, alt: 'Photo walk' })
    fireEvent.change(alt, { target: { value: 'Students on a walk' } })
    expect(onChange).toHaveBeenLastCalledWith({ file: chosen, alt: 'Students on a walk' })
    fireEvent.click(screen.getByRole('button', { name: 'Upload cover' }))
    expect(onSave).toHaveBeenCalledWith({ file: chosen, alt: 'Students on a walk' })
  })

  it('shows the saved cover with Replace and Remove, and server errors beside it', async () => {
    const onRemove = vi.fn()
    render(<CoverUploader title="Photo walk" current={{ card_url: '/c.webp', alt: 'A hall' }} serverError="Covers can be at most 5 MB." onRemove={onRemove} />)
    expect(screen.getByRole('img', { name: 'A hall' }).getAttribute('width')).toBe('600')
    expect(screen.getByText(/Replace image/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Covers can be at most 5 MB.')
    fireEvent.click(screen.getByRole('button', { name: /Remove cover/ }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
    expect(within(document.body).queryByText('Clear choice')).toBeNull()
  })
})
