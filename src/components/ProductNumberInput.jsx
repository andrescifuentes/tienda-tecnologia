import { useLayoutEffect, useRef, useState } from 'react'
import { Input } from './ui'
import { monetaryError } from '../lib/money'

export function formatProductPrice(value) {
  if (value === '') return ''
  return String(value).replace(/\D/g, '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function ProductPriceInput({ value, onValueChange, onFocus, ...props }) {
  const input = useRef(null)
  const caret = useRef(null)
  const [, refresh] = useState(0)
  const update = (raw, position) => {
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
    const formatted = formatProductPrice(digits)
    const before = raw.slice(0, position).replace(/\D/g, '').length
    let count = 0, offset = 0
    while (offset < formatted.length && count < before) {
      if (/\d/.test(formatted[offset])) count++
      offset++
    }
    caret.current = digits === '0' ? 1 : offset
    onValueChange(digits)
    refresh(n => n + 1)
  }
  useLayoutEffect(() => {
    if (caret.current !== null && document.activeElement === input.current) {
      input.current.setSelectionRange(caret.current, caret.current)
    }
    caret.current = null
  })
  return <Input {...props} type="text" inputMode="numeric" autoComplete="off"
    aria-invalid={value !== '' && !!monetaryError(value)}
    pattern="(?:[0-9]+|[0-9]{1,3}(?:[.][0-9]{3})+)" data-cop-input
    inputRef={input} value={formatProductPrice(value)} placeholder="0"
    onFocus={event => {
      if (Number(value) === 0) { event.currentTarget.value = ''; onValueChange('') }
      onFocus?.(event)
    }}
    onChange={event => {
      const raw = event.target.value, position = event.target.selectionStart ?? raw.length
      const previous = formatProductPrice(value)
      // iOS numeric keyboards can emit input without a keyboard keydown event.
      if (raw.length === previous.length - 1 && previous[position] === '.' && raw.replace(/\D/g, '') === previous.replace(/\D/g, '')) {
        const forward = event.nativeEvent.inputType === 'deleteContentForward'
        const index = forward ? position : position - 1
        update(raw.slice(0, index) + raw.slice(index + 1), index)
      } else update(raw, position)
    }}
    onKeyDown={event => {
      const el = event.currentTarget, pos = el.selectionStart
      if (el.selectionEnd !== pos) return
      // Deleting a grouping separator must still delete a digit.
      if (event.key === 'Backspace' && el.value[pos - 1] === '.') {
        event.preventDefault(); update(el.value.slice(0, pos - 2) + el.value.slice(pos), pos - 2)
      } else if (event.key === 'Delete' && el.value[pos] === '.') {
        event.preventDefault(); update(el.value.slice(0, pos) + el.value.slice(pos + 2), pos)
      }
    }}
    onBlur={() => { if (value === '') onValueChange('0') }} />
}

export function ProductQuantityInput({ value, onChange, ...props }) {
  return <Input {...props} type="number" inputMode="numeric" min="0" step="1" value={value}
    onChange={onChange} onFocus={event => {
      if (Number(value) === 0) { event.currentTarget.value = ''; onChange(event) }
    }} onBlur={event => {
      if (event.currentTarget.value === '') { event.currentTarget.value = '0'; onChange(event) }
    }} />
}
