import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

// Escáner con la cámara (BarcodeDetector del navegador/WebView). Si no está disponible, se digita el código.
export default function Scanner({ onClose, onScan }) {
  const videoRef = useRef(null)
  const [manual, setManual] = useState('')
  const [camOk, setCamOk] = useState(true)
  const [camActive, setCamActive] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    let stream, timer, vivo = true
    async function iniciar() {
      setCamActive(false)
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { setCamOk(false); return }
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats?.()
        const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'].filter(f => !supported || supported.includes(f))
        if (!formats.length) { setCamOk(false); return }
        const det = new window.BarcodeDetector({ formats })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!vivo) return stream.getTracks().forEach((t) => t.stop())
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        if (!vivo) return
        setCamActive(true)
        timer = setInterval(async () => {
          try {
            const r = await det.detect(videoRef.current)
            if (r[0] && vivo && !done.current) { done.current = true; onScan(r[0].rawValue) }
          } catch { /* ignore */ }
        }, 350)
      } catch { stream?.getTracks().forEach(t => t.stop()); if (vivo) { setCamOk(false); setCamActive(false) } }
    }
    iniciar()
    return () => { vivo = false; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, [onScan])

  const enviar = () => { const c = manual.trim(); if (c && !done.current) { done.current = true; onScan(c) } }

  return (
    <Modal title="Escanear código" onClose={onClose}>
      {camOk
        ? <><div className="scanner-frame">
            <video ref={videoRef} playsInline muted />
            <div className="scanner-corners" aria-hidden="true" />
            {camActive ? <span className="scanner-line" aria-hidden="true" /> : <div className="scanner-wait" role="status">Preparando cámara…</div>}
          </div>{camActive && <p className="scanner-status" role="status">Cámara activa · centra el código</p>}</>
        : <p className="text-muted text-sm mb-3">La cámara no está disponible aquí. Digita el código.</p>}
      <label className="lbl" htmlFor="scanner-code">…o digita el código</label>
      <div className="flex gap-2">
        <input id="scanner-code" className="inp" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviar()} placeholder="Código de barras o serial" />
        <button className="btn" onClick={enviar}>OK</button>
      </div>
    </Modal>
  )
}
