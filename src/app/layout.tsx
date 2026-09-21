import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Renderline · Plan to 3D Studio',
  description: 'Convert floor-plan PDFs and images into editable interactive 3D wall geometry.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
