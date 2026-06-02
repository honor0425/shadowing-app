export const metadata = {
  title: '跟讀練習 · Shadowing Player',
  description: '分句播放、重複練習、錄音對比的英文跟讀工具',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-TW">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  )
}
