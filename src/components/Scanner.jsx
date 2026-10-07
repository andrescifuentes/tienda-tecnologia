import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'

// Escáner con la cámara (BarcodeDetector del navegador/WebView). Si no está disponible, se digita el código.
export default function Scanner({ onClose, onScan }) {
  const videoRef = useRef(null)
  const [manual, setManual] = useState('')
  const [camOk, setCamOk] = useState(true)
  const done = useRef(false)

  useEffect(() => {
    let stream, timer, vivo = true
    async function iniciar() {
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { setCamOk(false); return }
      try {
        const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!vivo) return stream.getTracks().forEach((t) => t.stop())
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        timer = setInterval(async () => {
          try {
            const r = await det.detect(videoRef.current)
            if (r[0] && !done.current) { done.current = true; onScan(r[0].rawValue) }
          } catch { /* ignore */ }
        }, 350)
      } catch { setCamOk(false) }
    }
    iniciar()
    return () => { vivo = false; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, [onScan])

  const enviar = () => { const c = manual.trim(); if (c && !done.current) { done.current = true; onScan(c) } }

  return (
    <Modal title="Escanear código" onClose={onClose}>
      {camOk
        ? <video ref={videoRef} playsInline muted className="w-full rounded-2xl bg-black mb-3" style={{ maxHeight: 280 }} />
        : <p className="text-muted text-sm mb-3">La cámara no está disponible aquí. Digita el código.</p>}
      <label className="lbl">…o digita el código</label>
      <div className="flex gap-2">
        <input className="inp" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enviar()} placeholder="Código de barras o serial" />
        <button className="btn" onClick={enviar}>OK</button>
      </div>
    </Modal>
  )
}
