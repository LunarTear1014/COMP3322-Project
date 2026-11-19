// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { BottomSheet, Button, ButtonLink, EmptyState, StatusChip, TextField, ToastProvider, isAlmostFull, useToast } from '../src/components/ui'

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Button', () => {
  it('announces busy and ignores clicks while a request runs', () => {
    const onClick = vi.fn()
    render(<Button variant="primary" busy onClick={onClick}>Joining…</Button>)
    const button = screen.getByRole('button', { name: 'Joining…' })
    expect(button).toHaveProperty('className', expect.stringContaining('cs-btn-primary'))
    expect(button.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('stays clickable when idle and renders links with the button classes', () => {
    const onClick = vi.fn()
    render(<MemoryRouter><Button onClick={onClick}>Leave event</Button><ButtonLink to="/events" variant="ghost">Explore events</ButtonLink></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Leave event' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Explore events' }).className).toContain('cs-btn-ghost')
  })
})

describe('StatusChip', () => {
  it('always shows the state as words, with the queue position for the waitlist', () => {
    render(<><StatusChip state="joined" /><StatusChip state="waitlisted" position={2} /><StatusChip state="members_only" /><StatusChip state="cancelled" /><StatusChip state="draft" /><StatusChip state="bogus" /></>)
    for (const text of ['Joined', 'Waitlisted · #2', 'Members only', 'Cancelled', 'Draft']) expect(screen.getByText(text)).toBeTruthy()
    expect(document.querySelectorAll('.cs-chip').length).toBe(5)
    expect(document.querySelector('.cs-chip-members svg').getAttribute('aria-hidden')).toBe('true')
  })

  it('almost full starts at 85% and not once full', () => {
    expect(isAlmostFull(17, 20)).toBe(true)
    expect(isAlmostFull(16, 20)).toBe(false)
    expect(isAlmostFull(20, 20)).toBe(false)
  })
})

describe('TextField', () => {
  it('links the label, hint and error to the control', () => {
    render(<TextField label="Capacity" hint="Up to 80." error="Enter 80 or fewer." type="number" name="capacity" />)
    const input = screen.getByLabelText('Capacity')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = input.getAttribute('aria-describedby').split(' ')
    expect(described.map(id => document.getElementById(id).textContent)).toEqual(['Up to 80.', 'Enter 80 or fewer.'])
    expect(input.closest('.cs-field').className).toContain('is-invalid')
  })

  it('marks optional fields and renders selects and textareas', () => {
    render(<><TextField label="Notes" optional as="textarea" /><TextField label="Club" as="select"><option>Film</option></TextField></>)
    expect(screen.getByText('(optional)')).toBeTruthy()
    expect(screen.getByLabelText(/^Notes/).tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Club').tagName).toBe('SELECT')
  })
})

describe('EmptyState', () => {
  it('shows a headline, a sentence and a way forward, with decorative art', () => {
    render(<EmptyState title="Nothing on this week" actions={<button>Clear filters</button>}>No events match.</EmptyState>)
    expect(screen.getByRole('heading', { name: 'Nothing on this week' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
    expect(document.querySelector('.cs-empty-art').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Toast', () => {
  function Trigger({ options }) {
    const toast = useToast()
    return <button onClick={() => toast.show(options)}>fire</button>
  }

  beforeEach(() => vi.useFakeTimers())

  it('announces in one polite live region and disappears after 5 seconds', () => {
    render(<ToastProvider><Trigger options={{ message: "You're going!" }} /></ToastProvider>)
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByRole('status').textContent).toContain("You're going!")
    act(() => { vi.advanceTimersByTime(4900) })
    expect(screen.queryByText("You're going!")).toBeTruthy()
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.queryByText("You're going!")).toBeNull()
  })

  it('Undo cancels the pending request; expiry sends it', () => {
    const onExpire = vi.fn()
    const onUndo = vi.fn()
    render(<ToastProvider><Trigger options={{ message: 'You left the event.', action: { label: 'Undo', onClick: onUndo }, onExpire }} /></ToastProvider>)
    fireEvent.click(screen.getByText('fire'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    act(() => { vi.advanceTimersByTime(6000) })
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onExpire).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('fire'))
    act(() => { vi.advanceTimersByTime(5100) })
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('a passive live notice never cuts an Undo window short', () => {
    const onExpire = vi.fn()
    function Both() {
      const toast = useToast()
      return <>
        <button onClick={() => toast.show({ message: 'Leaving soon.', action: { label: 'Undo', onClick: () => {} }, onExpire })}>undoable</button>
        <button onClick={() => toast.show({ message: 'New message', passive: true })}>notice</button>
      </>
    }
    render(<ToastProvider><Both /></ToastProvider>)
    fireEvent.click(screen.getByText('undoable'))
    fireEvent.click(screen.getByText('notice'))
    expect(onExpire).not.toHaveBeenCalled()
    expect(screen.getByText('Leaving soon.')).toBeTruthy()
    expect(screen.queryByText('New message')).toBeNull()
  })

  it('pauses while hovered and a new toast ends the previous undo window', () => {
    const first = vi.fn()
    render(<ToastProvider><Trigger options={{ message: 'One', onExpire: first }} /></ToastProvider>)
    fireEvent.click(screen.getByText('fire'))
    const toast = screen.getByText('One').closest('.cs-toast')
    fireEvent.mouseEnter(toast)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(screen.queryByText('One')).toBeTruthy()
    fireEvent.mouseLeave(toast)
    act(() => { vi.advanceTimersByTime(5100) })
    expect(screen.queryByText('One')).toBeNull()
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('error toasts use the error style', () => {
    render(<ToastProvider><Trigger options={{ message: "Couldn't join.", tone: 'error' }} /></ToastProvider>)
    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText("Couldn't join.").closest('.cs-toast').className).toContain('cs-toast-error')
  })
})

describe('BottomSheet', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return <>
      <button onClick={() => setOpen(true)}>Filters</button>
      <BottomSheet open={open} title="Filters" onClose={() => setOpen(false)} footer={<button>Show 12 events</button>}>
        <label>Club<select><option>All clubs</option></select></label>
      </BottomSheet>
    </>
  }

  it('is a labelled modal dialog that moves focus in and returns it on close', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Filters' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('')
  })

  it('closes from the close button and the scrim, and traps Tab', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close filters' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(document.querySelector('.cs-scrim'))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const last = screen.getByRole('button', { name: 'Show 12 events' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close filters' }))
  })
})
