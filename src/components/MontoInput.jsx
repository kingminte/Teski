import { useState } from 'react'
import { parsearMonto, formatearMonto } from '../lib/montos'

// Input que acepta montos en cualquier formato y los normaliza al guardar
export default function MontoInput({ value, onChange, placeholder = '0', style = {} }) {
  const [displayValue, setDisplayValue] = useState(value ? formatearMonto(value) : '')

  const handleChange = (e) => {
    const raw = e.target.value
    setDisplayValue(raw)
    const numero = parsearMonto(raw)
    onChange(numero)
  }

  const handleBlur = () => {
    const numero = parsearMonto(displayValue)
    if (numero > 0) {
      setDisplayValue(formatearMonto(numero))
    }
  }

  const handleFocus = () => {
    // Al enfocar, quitar puntos para facilitar edición
    const numero = parsearMonto(displayValue)
    if (numero > 0) setDisplayValue(String(numero))
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      placeholder={placeholder}
      style={style}
    />
  )
}
