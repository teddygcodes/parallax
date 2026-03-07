import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PARALLAX',
  description: 'Where reality and narrative diverge.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#0a0a0e' }}>
      <body style={{ width: '100%', height: '100%', overflow: 'hidden', margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  )
}
