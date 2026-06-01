import dynamic from 'next/dynamic'

const ShadowingApp = dynamic(() => import('./ShadowingApp'), { ssr: false })

export default function Page() {
  return <ShadowingApp />
}
