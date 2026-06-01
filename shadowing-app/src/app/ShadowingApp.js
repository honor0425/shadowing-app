'use client'
import { useState } from 'react'

export default function ShadowingApp() {
  const [count, setCount] = useState(0)
  return (
    <div style={{padding:'2rem',fontFamily:'sans-serif'}}>
      <h1>跟讀練習</h1>
      <p>測試中... {count}</p>
      <button onClick={()=>setCount(c=>c+1)}>點我</button>
    </div>
  )
}
