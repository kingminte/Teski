import { useState } from 'react'
import { validarRut, formatearRut } from '../lib/rut'

export default function RutInput({ value, onChange, onValidChange, required = false }) {
  const [touched, setTouched] = useState(false)

  const resultado = value ? validarRut(value) : null
  const mostrarError = touched && value && resultado && !resultado.valido
  const mostrarOk = touched && value && resultado?.valido

  const handleChange = (e) => {
    const raw = e.target.value
    onChange(raw)
    if (raw) {
      const r = validarRut(raw)
      onValidChange?.(r.valido, r.formateado)
    } else {
      onValidChange?.(false, '')
    }
  }

  const handleBlur = () => {
    setTouched(true)
    if (value && resultado?.valido) {
      onChange(resultado.formateado)
    }
  }

  const borderColor = mostrarError
    ? 'rgba(226,75,74,0.7)'
    : mostrarOk
    ? 'rgba(29,158,117,0.7)'
    : 'var(--border)'

  const bg = mostrarError
    ? 'rgba(226,75,74,0.06)'
    : mostrarOk
    ? 'rgba(29,158,117,0.06)'
    : 'var(--navy-mid)'

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="Ej: 12.345.678-9"
          required={required}
          style={{
            width: '100%',
            background: bg,
            border: `0.5px solid ${borderColor}`,
            borderRadius: 6,
            color: '#e8e4d9',
            padding: '8px 32px 8px 12px',
            fontSize: 13,
            fontFamily: 'sans-serif',
            outline: 'none',
            transition: 'border-color 0.2s, background 0.2s',
          }}
        />
        {touched && value && (
          <i
            className={`ti ${mostrarOk ? 'ti-check' : 'ti-x'}`}
            style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 15, pointerEvents: 'none',
              color: mostrarOk ? '#5dcaa5' : '#f09595',
            }}
          ></i>
        )}
      </div>
      {mostrarError && (
        <div style={{ fontSize: 11, color: '#f09595', marginTop: 4 }}>
          {resultado.error}
        </div>
      )}
      {mostrarOk && (
        <div style={{ fontSize: 11, color: '#5dcaa5', marginTop: 4 }}>
          RUT válido — se guardará como: {resultado.formateado}
        </div>
      )}
    </div>
  )
}
