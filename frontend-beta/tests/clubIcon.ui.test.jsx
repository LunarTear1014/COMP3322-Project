// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let size = { width: 400, height: 400 }
vi.mock('../src/lib/cover.js', async importOriginal => ({ ...(await importOriginal()), readImageSize: vi.fn(async () => size) }))
const { ClubIconEditor } = await import('../src/components/ClubIconEditor.jsx')
const { ClubIcon } = await import('../src/components/ClubIcon.jsx')
const { iconForm, iconProblem } = await import('../src/lib/clubIcon.js')

afterEach(() => { cleanup(); size = { width: 400, height: 400 } })
URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => {}

const file = (name = 'icon.png', type = 'image/png', bytes = 1000) => new File([new Uint8Array(bytes)], name, { type })
const pick = f => fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [f] } })

describe('club icon rules', () => {
  it('checks type, size and dimensions before upload', () => {
    expect(iconProblem(file(), { width: 128, height: 128 })).toBe('')
    expect(iconProblem(file('a.jpg', 'image/jpeg'), { width: 500, height: 300 })).toBe('')
    expect(iconProblem(file('a.gif', 'image/gif'), { width: 500, height: 500 })).toMatch(/JPEG, PNG or WebP/)
    expect(iconProblem(file('a.png', 'image/png', 2 * 1024 * 1024 + 1), { width: 500, height: 500 })).toMatch(/2 MB/)
    expect(iconProblem(file(), { width: 100, height: 500 })).toBe('Club icons need at least 128×128 pixels.')
    expect(iconProblem(file(), null)).toMatch(/could not be read/)
  })

  it('builds the multipart body the API expects', () => {
    const chosen = file()
    expect(iconForm(chosen).get('file').name).toBe('icon.png')
  })
})

describe('ClubIcon', () => {
  it('shows the saved icon, or the first letter when there is none', () => {
    const { container, rerender } = render(<ClubIcon name="Photo Club" icon={{ url: '/api/v1/clubs/1/icon?v=abc' }} />)
    expect(container.querySelector('img').getAttribute('src')).toBe('/api/v1/clubs/1/icon?v=abc')
    rerender(<ClubIcon name="Photo Club" icon={null} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('P')
  })
})

describe('ClubIconEditor', () => {
  it('states the rules, rejects a too-small image beside the control and stages nothing', async () => {
    size = { width: 64, height: 64 }
    render(<ClubIconEditor clubName="Photo" onSave={vi.fn()} />)
    expect(screen.getByText(/at least 128×128/)).toBeTruthy()
    pick(file())
    expect((await screen.findByRole('alert')).textContent).toBe('Club icons need at least 128×128 pixels.')
    expect(screen.queryByRole('button', { name: 'Upload icon' })).toBeNull()
  })

  it('stages a valid file, previews it and uploads on request', async () => {
    const onSave = vi.fn(async () => true)
    const { container } = render(<ClubIconEditor clubName="Photo" onSave={onSave} />)
    const chosen = file()
    pick(chosen)
    fireEvent.click(await screen.findByRole('button', { name: 'Upload icon' }))
    expect(onSave).toHaveBeenCalledWith(chosen)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Upload icon' })).toBeNull())
    expect(container.querySelector('input[type=file]').value).toBe('')
  })

  it('keeps the staged file when the upload fails', async () => {
    const onSave = vi.fn(async () => false)
    render(<ClubIconEditor clubName="Photo" serverError="Club icons can be at most 2 MB." onSave={onSave} />)
    pick(file())
    fireEvent.click(await screen.findByRole('button', { name: 'Upload icon' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Upload icon' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Club icons can be at most 2 MB.')
  })

  it('offers Replace and Remove for a saved icon', async () => {
    const onRemove = vi.fn()
    render(<ClubIconEditor clubName="Photo" current={{ url: '/i.webp' }} onSave={vi.fn()} onRemove={onRemove} />)
    expect(screen.getByText(/Replace icon/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Remove icon/ }))
    await waitFor(() => expect(onRemove).toHaveBeenCalled())
  })
})
