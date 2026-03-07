'use client'

import { useEffect, useRef, useState } from 'react'
import type { GlobeHandle } from './Globe'

interface RecordButtonProps {
  globeHandle?: React.RefObject<GlobeHandle | null>
}

export default function RecordButton({ globeHandle }: RecordButtonProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [countdown, setCountdown] = useState(30)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Evaluate support — SSR-safe
  const [supported, setSupported] = useState<boolean | null>(null)
  const [mimeType, setMimeType] = useState<string | null>(null)

  useEffect(() => {
    if (typeof MediaRecorder === 'undefined') {
      setSupported(false)
      setMimeType(null)
      return
    }
    const mt = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : null
    setMimeType(mt)
    setSupported(mt !== null)
  }, [])

  function finishRecording() {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  function startRecording() {
    if (isRecording || !mimeType) return

    const canvas = document.querySelector('canvas')
    if (!canvas) return

    let stream: MediaStream
    try {
      stream = (canvas as any).captureStream(30)
    } catch {
      return
    }

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder
    chunksRef.current = []

    const handleData = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data)
      }
    }

    const handleStop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType! })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `parallax-${Date.now()}.${mimeType!.includes('mp4') ? 'mp4' : 'webm'}`
      a.click()
      URL.revokeObjectURL(url)

      // Resume auto-refresh
      globeHandle?.current?.resumeRefresh()

      setIsRecording(false)
      setCountdown(30)
    }

    recorder.addEventListener('dataavailable', handleData)
    recorder.addEventListener('stop', handleStop)

    recorder.start(100)

    // Suppress auto-refresh during recording
    globeHandle?.current?.pauseRefresh()

    setIsRecording(true)
    setCountdown(30)

    // Countdown timer
    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current)
            countdownTimerRef.current = null
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    // Auto-stop after 30 seconds
    stopTimerRef.current = setTimeout(() => {
      finishRecording()
    }, 30_000)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current)
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
      const recorder = mediaRecorderRef.current
      if (recorder) {
        try {
          if (recorder.state !== 'inactive') recorder.stop()
        } catch {
          // ignore
        }
      }
      // Always resume refresh on unmount
      globeHandle?.current?.resumeRefresh()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const formattedCountdown = `00:${String(countdown).padStart(2, '0')}`

  // Still evaluating support
  if (supported === null) return null

  if (!supported || mimeType === null) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: '32px',
          right: '32px',
          zIndex: 200,
          width: '88px',
          height: '88px',
          borderRadius: '50%',
          background: 'rgba(10,10,14,0.75)',
          border: '1px solid rgba(255,255,255,0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '8px',
        }}
      >
        <span
          style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: '7px',
            letterSpacing: '0.10em',
            color: '#8a8a8a',
            lineHeight: '1.6',
            whiteSpace: 'pre-line',
          }}
        >
          {'RECORDING\nUNSUPPORTED'}
        </span>
      </div>
    )
  }

  return (
    <button
      onClick={isRecording ? undefined : startRecording}
      style={{
        position: 'fixed',
        bottom: '32px',
        right: '32px',
        zIndex: 200,
        width: '88px',
        height: '88px',
        borderRadius: '50%',
        background: 'rgba(10,10,14,0.75)',
        border: isRecording
          ? '1px solid #c0392b'
          : '1px solid rgba(255,255,255,0.15)',
        cursor: isRecording ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: isRecording ? 'recPulse 1.5s ease-in-out infinite' : 'none',
        transition: 'border-color 300ms ease',
        padding: 0,
        outline: 'none',
      }}
    >
      <span
        style={{
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: '11px',
          letterSpacing: '0.14em',
          color: isRecording ? '#e8e6e0' : '#8a8a8a',
          transition: 'color 300ms ease',
        }}
      >
        {isRecording ? formattedCountdown : 'REC'}
      </span>
      <style>{`
        @keyframes recPulse {
          0%, 100% { border-color: #c0392b; box-shadow: 0 0 0 0 rgba(192,57,43,0.4); }
          50% { border-color: rgba(192,57,43,0.5); box-shadow: 0 0 0 6px rgba(192,57,43,0); }
        }
      `}</style>
    </button>
  )
}
