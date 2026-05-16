import { useState, useCallback } from 'react'

export function useToast() {
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const ToastComponent = toast ? (
    <div className={`toast ${toast.type}`}>
      <i className={`ti ${toast.type === 'success' ? 'ti-check' : 'ti-alert-circle'}`} style={{ fontSize: 18 }}></i>
      {toast.message}
    </div>
  ) : null

  return { showToast, ToastComponent }
}
