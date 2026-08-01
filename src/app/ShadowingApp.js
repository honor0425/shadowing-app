'use client'
import { useState, useRef, useEffect } from 'react'

// Google Drive Picker 憑證
const GOOGLE_CLIENT_ID = '78814562371-ubnt67md4eu3kobg4pkldkhauaqj3fuq.apps.googleusercontent.com'
const GOOGLE_API_KEY = 'AIzaSyDvChyMtpPIj-_7diRK6rvx5OkU37cvt-g'
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

// Google Drive Picker 全域 loader（保留 token 免重複登入）
let __gapiLoaded = false
let __gisLoaded = false
let __pickerLoaded = false
let __accessToken = null
let __tokenClient = null

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="'+src+'"]')) { resolve(); return }
    const s = document.createElement('script')
    s.src = src; s.async = true; s.defer = true
    s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

async function ensureGoogleReady() {
  if (!__gapiLoaded) {
    await loadScript('https://apis.google.com/js/api.js')
    await new Promise(r => window.gapi.load('picker', r))
    __gapiLoaded = true
    __pickerLoaded = true
  }
  if (!__gisLoaded) {
    await loadScript('https://accounts.google.com/gsi/client')
    __gisLoaded = true
  }
  if (!__tokenClient) {
    __tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPE,
      callback: () => {} // 每次呼叫時覆寫
    })
  }
}

function getAccessToken() {
  return new Promise((resolve, reject) => {
    if (__accessToken) { resolve(__accessToken); return }
    __tokenClient.callback = (res) => {
      if (res.error) { reject(new Error(res.error)); return }
      __accessToken = res.access_token
      resolve(__accessToken)
    }
    __tokenClient.requestAccessToken({ prompt: '' })
  })
}

// 開啟 Google Drive Picker
// kind='media' → 回傳 {name, fileId, token}（用串流 URL 播放，不整個下載）
// kind='subtitle' → 回傳 {name, blob}（字幕小檔，直接下載內容解析）
async function pickFromDrive(kind) {
  await ensureGoogleReady()
  const token = await getAccessToken()

  return new Promise((resolve, reject) => {
    const myDrive = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setParent('root')

    const shared = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setOwnedByMe(false)

    const picker = new window.google.picker.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_CLIENT_ID.split('-')[0])
      .addView(myDrive)
      .addView(shared)
      .setCallback(async (data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const file = data.docs[0]
          try {
            if (kind === 'media') {
              // 影片/音訊：不整個下載，改用串流 URL（大檔也能秒開）
              resolve({ name: file.name, fileId: file.id, token })
            } else {
              // 字幕：小檔，下載內容
              const doFetch = (tk) => fetch(
                'https://www.googleapis.com/drive/v3/files/' + file.id + '?alt=media&supportsAllDrives=true',
                { headers: { Authorization: 'Bearer ' + tk } }
              )
              let res = await doFetch(token)
              if (!res.ok && res.status === 401) {
                __accessToken = null
                const newToken = await getAccessToken()
                res = await doFetch(newToken)
              }
              if (!res.ok) throw new Error('下載失敗: ' + res.status)
              const blob = await res.blob()
              resolve({ name: file.name, blob })
            }
          } catch(e) { reject(e) }
        } else if (data.action === window.google.picker.Action.CANCEL) {
          reject(new Error('CANCELLED'))
        }
      })
      .build()
    picker.setVisible(true)
  })
}

// 取得可播放的 Drive 串流 URL（帶 access token）
async function getDriveStreamUrl(fileId, token) {
  // 用 fetch 取得 blob URL（video 標籤無法直接帶 Authorization header，
  // 但可先抓成 blob 再播；為避免大檔記憶體問題，這裡用 Range 由瀏覽器串流）
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + token } }
  )
  if (!res.ok) throw new Error('串流失敗: ' + res.status)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

function ts2s(t) {
  const p = t.replace(',', '.').split(':')
  return p.length === 3 ? +p[0]*3600 + +p[1]*60 + parseFloat(p[2]) : +p[0]*60 + parseFloat(p[1])
}
function fmt(s) {
  const m = Math.floor(s/60), sec = Math.floor(s%60)
  return m + ':' + (sec < 10 ? '0' : '') + sec
}
function parseSRT(txt) {
  // 1. 先將 Windows (\r\n) 或舊版 Mac (\r) 的換行符號統一轉為 Linux (\n) 格式
  const normalizedTxt = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // 2. 再進行區塊切割
  return normalizedTxt.trim().split(/\n\n+/).map(b => {
    const lines = b.split('\n'), tl = lines.find(l => /-->/.test(l))
    if (!tl) return null
    const [s, e] = tl.split('-->').map(x => ts2s(x.trim()))
    const text = lines.slice(lines.indexOf(tl)+1).join(' ')
      .replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").trim()
    return text ? {s,e,text} : null
  }).filter(Boolean)
}
const LOCAL_SERVER = 'http://localhost:7788'
// Chrome Extension ID - update this after installing the extension
const EXT_ID = localStorage && localStorage.getItem('shadowing-ext-id') || ''

export default function ShadowingApp() {
  const S = useRef({
    subs:[], curIdx:-1, repDone:0,
    repN:2, pauseSec:3, speed:1,
    shadowMode:true, playing:false, waiting:false,
    tab:'local', ytReady:false,
    timer:null, pollTimer:null,
  })

  const [ui, setUI] = useState({
    subs:[], curIdx:-1, repN:2, pauseSec:3, speed:1,
    shadowMode:true,showSubtitle:true,playing:false, waiting:false,
    tab:'local', ytReady:false,
    badge:null, status:{dot:'', msg:'等待載入...'},
    mediaSrc:null, ytId:'', ytLoading:false, ytError:'',
    subFileName:'', showPlayer:false,
    progress:0, curTime:0, dur:0,
    recActive:false, recSec:0, lastBlobUrl:null,
    savedRecs:[], history:[],
    localServerOk:false, localServerChecked:false, extAvailable:false, extId:'',
  })

  const upUI = (patch) => setUI(u => ({...u, ...(typeof patch==='function'?patch(u):patch)}))

  const vidRef = useRef(null)
  const ytRef = useRef(null)
  const mediaRecRef = useRef(null)
  const recChunksRef = useRef([])
  const recTimerRef = useRef(null)
  const analyserRef = useRef(null)
  const audioCtxRef = useRef(null)
  const animRef = useRef(null)
  const lastBlobRef = useRef(null)
  const lastBlobUrlRef = useRef(null)
  const pendingYTId = useRef(null)

  // Check local server and extension on mount
  useEffect(() => {
    fetch(LOCAL_SERVER + '/transcript?id=test', {signal: AbortSignal.timeout(2000)})
      .then(() => upUI({localServerOk:true, localServerChecked:true}))
      .catch(() => upUI({localServerOk:false, localServerChecked:true}))

    // Listen for extension connection via postMessage
    const extPingListener = (event) => {
      if (event.source !== window) return
      if (event.data.type === 'YT_TRANSCRIPT_RESULT') {
        upUI({extAvailable:true})
      }
    }
    window.addEventListener('message', extPingListener)
    // Ping extension to check if available
    setTimeout(() => {
      window.postMessage({ type: 'FETCH_YT_TRANSCRIPT', videoId: 'test' }, '*')
    }, 1000)
  }, [])

  // Load history from localStorage
  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem('shadowing-history') || '[]')
      upUI({history:h})
    } catch(e) {}
  }, [])

  // YT IFrame API
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!document.getElementById('yt-api-script')) {
      const sc = document.createElement('script')
      sc.id = 'yt-api-script'
      sc.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(sc)
    }
  }, [])

  const initYT = (videoId) => {
    if (ytRef.current) { try { ytRef.current.destroy() } catch(e) {} ytRef.current = null }
    S.current.ytReady = false
    upUI({ytReady:false})
    const tryCreate = () => {
      if (!window.YT?.Player) { setTimeout(tryCreate, 200); return }
      ytRef.current = new window.YT.Player('yt-div', {
        videoId,
        playerVars:{rel:0},
        events:{
          onReady:() => { S.current.ytReady=true; upUI({ytReady:true, status:{dot:'', msg:'就緒，點播放開始'}}) },
          onError:(e) => upUI({status:{dot:'', msg:'YouTube 錯誤：'+e.data}})
        }
      })
    }
    tryCreate()
  }

  useEffect(() => {
    if (!pendingYTId.current) return
    const id = pendingYTId.current
    pendingYTId.current = null
    initYT(id)
  }, [ui.ytId])

  // YT progress
  useEffect(() => {
    if (ui.tab !== 'yt') return
    const iv = setInterval(() => {
      if (!ytRef.current) return
      try {
        const ct = ytRef.current.getCurrentTime()||0
        const d = ytRef.current.getDuration()||0
        upUI({curTime:ct, dur:d, progress:d>0?ct/d*100:0})
      } catch(e) {}
    }, 500)
    return () => clearInterval(iv)
  }, [ui.tab])

  // Sub scroll
  useEffect(() => {
    if (ui.curIdx < 0) return
    document.getElementById('si'+ui.curIdx)?.scrollIntoView({block:'nearest', behavior:'smooth'})
  }, [ui.curIdx])

  const stopAll = () => {
    if (S.current.timer) { clearTimeout(S.current.timer); S.current.timer=null }
    if (S.current.pollTimer) { clearInterval(S.current.pollTimer); S.current.pollTimer=null }
    if (vidRef.current?.src) try { vidRef.current.pause() } catch(e) {}
    if (ytRef.current) try { ytRef.current.pauseVideo() } catch(e) {}
    S.current.playing=false; S.current.waiting=false
    upUI({playing:false, waiting:false, badge:null})
  }

  const onSentEnd = () => {
    if (S.current.pollTimer) { clearInterval(S.current.pollTimer); S.current.pollTimer=null }
    if (S.current.repDone < S.current.repN) { setTimeout(() => playSentence(S.current.curIdx), 300); return }
    upUI({badge:null})
    if (S.current.shadowMode) {
      S.current.waiting=true; S.current.playing=false
      upUI({waiting:true, playing:false, badge:{type:'wait',txt:'⏸ 跟讀中'}, status:{dot:'wait', msg:'等待跟讀（'+S.current.pauseSec+' 秒）'}})
      S.current.timer = setTimeout(() => { S.current.waiting=false; upUI({waiting:false, badge:null}); nextSub() }, S.current.pauseSec*1000)
    } else { nextSub() }
  }

  const nextSub = () => {
    const next = S.current.curIdx+1
    if (next < S.current.subs.length) { S.current.repDone=0; playSentence(next) }
    else { upUI({status:{dot:'', msg:'播放完畢 🎉'}, playing:false, badge:null}); S.current.playing=false }
  }

  const playSentence = (i) => {
    const sub = S.current.subs[i]; if (!sub) return
    S.current.repDone++; S.current.curIdx=i
    upUI({curIdx:i, badge:{type:'play',txt:'▶ '+S.current.repDone+'/'+S.current.repN}, status:{dot:'play',msg:'播放第 '+S.current.repDone+'/'+S.current.repN+' 次'}})
    if (S.current.tab==='yt') {
      const yt = ytRef.current; if (!yt||!S.current.ytReady) return
      try {
        yt.setPlaybackRate(S.current.speed); yt.seekTo(sub.s,true); yt.playVideo()
        S.current.playing=true; upUI({playing:true})
        if (S.current.timer) clearTimeout(S.current.timer)
        if (S.current.pollTimer) clearInterval(S.current.pollTimer)
        S.current.pollTimer = setInterval(() => {
          try { const ct=yt.getCurrentTime(); if(ct>=sub.e-0.15||yt.getPlayerState()===0){clearInterval(S.current.pollTimer);S.current.pollTimer=null;yt.pauseVideo();onSentEnd()} } catch(e){}
        }, 100)
      } catch(e) {}
    } else {
      const vid = vidRef.current; if (!vid) return
      vid.playbackRate=S.current.speed; vid.currentTime=sub.s
      vid.play().catch(()=>{})
      S.current.playing=true; upUI({playing:true})
      if (S.current.timer) clearTimeout(S.current.timer)
      S.current.timer = setTimeout(() => { vid.pause(); onSentEnd() }, (sub.e-sub.s)/S.current.speed*1000+150)
    }
  }

  const togglePlay = () => {
    if (!S.current.subs.length) { alert('請先載入字幕'); return }
    if (S.current.tab==='yt'&&!S.current.ytReady) { alert('播放器尚未就緒'); return }
    if (S.current.playing||S.current.waiting) { stopAll(); upUI({status:{dot:'', msg:'暫停'}}) }
    else { S.current.repDone=0; playSentence(S.current.curIdx<0?0:S.current.curIdx) }
  }

  const loadMedia = (f) => {
    if (!f) return
    upUI({mediaSrc:URL.createObjectURL(f), showPlayer:true, ytId:'', status:{dot:'', msg:'已載入：'+f.name}})
  }

  const loadSubtitle = (f) => {
    if (!f) return
    const r = new FileReader()
    r.onload = (e) => {
      const txt = e.target.result
      const parsed = f.name.endsWith('.vtt') ? parseVTT(txt) : parseSRT(txt)
      S.current.subs=parsed; S.current.curIdx=-1
      upUI({subs:parsed, subFileName:f.name, curIdx:-1, status:{dot:'', msg:'字幕已載入，共 '+parsed.length+' 句'}})
    }
    r.readAsText(f)
  }

  const pickMediaFromDrive = async () => {
    try {
      upUI({status:{dot:'', msg:'請在雲端硬碟視窗中選擇檔案...'}})
      const { name, fileId, token } = await pickFromDrive('media')
      upUI({status:{dot:'', msg:'載入中：'+name+'...'}})
      const url = await getDriveStreamUrl(fileId, token)
      upUI({mediaSrc:url, showPlayer:true, ytId:'', status:{dot:'', msg:'已載入：'+name}})
    } catch(e) {
      if (e.message !== 'CANCELLED') {
        alert('從雲端硬碟載入失敗：'+e.message)
      }
      upUI({status:{dot:'', msg:'等待載入...'}})
    }
  }

  const pickSubtitleFromDrive = async () => {
    try {
      upUI({status:{dot:'', msg:'請在雲端硬碟視窗中選擇字幕檔...'}})
      const { name, blob } = await pickFromDrive('subtitle')
      const file = new File([blob], name, { type: blob.type })
      loadSubtitle(file)
    } catch(e) {
      if (e.message !== 'CANCELLED') {
        alert('從雲端硬碟載入失敗：'+e.message)
      }
      upUI({status:{dot:'', msg:'等待載入...'}})
    }
  }

  const addHistory = (id) => {
    // Try to get video title from YouTube oEmbed
    fetch('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v='+id+'&format=json')
      .then(r=>r.json())
      .then(data=>{
        upUI(u => {
          const existing = u.history.filter(h => h.id !== id)
          const h = [{id, title:data.title||id, time:Date.now()}, ...existing].slice(0,20)
          try { localStorage.setItem('shadowing-history', JSON.stringify(h)) } catch(e) {}
          return {history:h}
        })
      })
      .catch(()=>{
        upUI(u => {
          const existing = u.history.filter(h => h.id !== id)
          const h = [{id, title:id, time:Date.now()}, ...existing].slice(0,20)
          try { localStorage.setItem('shadowing-history', JSON.stringify(h)) } catch(e) {}
          return {history:h}
        })
      })
  }

  // 刪除歷史紀錄的函數
  const delHistory = (id) => {
    upUI(u => {
      const newHistory = u.history.filter(h => h.id !== id)
      try { localStorage.setItem('shadowing-history', JSON.stringify(newHistory)) } catch(e) {}
      return {history: newHistory}
    })
  }

  const loadYT = async () => {
    const input = document.getElementById('yt-url-input'); if (!input) return
    const url = input.value.trim()
    const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
    if (!m) { upUI({ytError:'請輸入有效的 YouTube 網址'}); return }
    const id = m[1]
    pendingYTId.current = id
    S.current.tab='yt'; S.current.curIdx=-1
    stopAll()
    upUI({ytId:id, showPlayer:true, ytError:'', ytLoading:true, tab:'yt', curIdx:-1, status:{dot:'', msg:'載入中...'}})

    const processTranscript = (data) => {
      if (data.error) {
        upUI({ytError:'字幕抓取失敗，請手動上傳 SRT', ytLoading:false})
        return false
      }
      // Support both formats: transcript array or direct array
      const items = data.transcript || data
      if (!items || !items.length) return false
      const parsed = items.map(item => ({
        s: item.offset/1000,
        e: (item.offset + (item.duration || 3000))/1000,
        text: (item.text||'').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/\n/g,' ').trim()
      })).filter(item => item.text)
      if (!parsed.length) return false
      S.current.subs=parsed; S.current.curIdx=-1
      upUI({subs:parsed, subFileName:'YouTube CC', curIdx:-1, ytLoading:false, status:{dot:'', msg:'字幕已載入，共 '+parsed.length+' 句'}})
      addHistory(id)
      return true
    }

    // Try extension first via postMessage
    try {
      const extData = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Extension 逾時，嘗試其他方式')), 35000)
        const listener = (event) => {
          if (event.source !== window) return
          if (event.data.type === 'YT_TRANSCRIPT_RESULT' && event.data.videoId === id) {
            clearTimeout(timeout)
            window.removeEventListener('message', listener)
            if (event.data.error) reject(new Error(event.data.error))
            else resolve(event.data.data)
          }
        }
        window.addEventListener('message', listener)
        window.postMessage({ type: 'FETCH_YT_TRANSCRIPT', videoId: id }, '*')
        upUI({status:{dot:'', msg:'字幕擷取中，請稍候...'}})
      })
      if (processTranscript(extData)) return
    } catch(e) { console.log('Extension:', e.message) }

    // Try local server
    if (ui.localServerOk) {
      try {
        const res = await fetch(`${LOCAL_SERVER}/transcript?id=${id}`)
        const data = await res.json()
        if (processTranscript(data)) return
      } catch(e) {}
    }

    // Fallback to Vercel API
    try {
      const res = await fetch(`/api/transcript?id=${id}`)
      const data = await res.json()
      if (!processTranscript(data)) {
        upUI({ytError:'字幕抓取失敗，請手動上傳 SRT', ytLoading:false})
      }
    } catch(e) {
      upUI({ytError:'字幕抓取失敗，請手動上傳 SRT', ytLoading:false})
    }
  }

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true})
      audioCtxRef.current = new (window.AudioContext||window.webkitAudioContext)()
      const src = audioCtxRef.current.createMediaStreamSource(stream)
      analyserRef.current = audioCtxRef.current.createAnalyser()
      analyserRef.current.fftSize=256; src.connect(analyserRef.current)
      mediaRecRef.current = new MediaRecorder(stream); recChunksRef.current=[]
      mediaRecRef.current.ondataavailable = e => recChunksRef.current.push(e.data)
      mediaRecRef.current.onstop = () => {
        const blob = new Blob(recChunksRef.current,{type:'audio/webm'})
        lastBlobRef.current=blob
        const burl=URL.createObjectURL(blob); lastBlobUrlRef.current=burl
        stream.getTracks().forEach(t=>t.stop())
        if(audioCtxRef.current){audioCtxRef.current.close();audioCtxRef.current=null}
        cancelAnimationFrame(animRef.current)
        upUI({lastBlobUrl:burl})
      }
      mediaRecRef.current.start(); upUI({recActive:true, recSec:0})
      recTimerRef.current = setInterval(()=>upUI(u=>({recSec:u.recSec+1})),1000)
    } catch(e) { alert('無法取得麥克風：'+e.message) }
  }

  const stopRec = () => {
    if(mediaRecRef.current?.state!=='inactive')mediaRecRef.current?.stop()
    clearInterval(recTimerRef.current)
    upUI({recActive:false, status:{dot:'', msg:'錄音完成'}})
  }

  const saveRec = () => {
    if(!lastBlobRef.current) return
    const label = S.current.subs[S.current.curIdx]?.text?.slice(0,32)||'錄音'
    upUI(u=>({savedRecs:[...u.savedRecs,{label,url:lastBlobUrlRef.current}]}))
  }

  const seekClick = (e) => {
    if(!ui.dur||!vidRef.current) return
    const r=e.currentTarget.getBoundingClientRect()
    vidRef.current.currentTime=((e.clientX-r.left)/r.width)*ui.dur
  }

  const handleDrop = (e,type) => {
    e.preventDefault(); const f=e.dataTransfer.files[0]; if(!f) return
    type==='media'?loadMedia(f):loadSubtitle(f)
  }

  const isAudio = ui.mediaSrc && ui.tab==='local' && ui.mediaSrc.includes('blob:')

  const {subs,curIdx,tab,ytId,ytReady,ytLoading,ytError,mediaSrc,showPlayer,
    subFileName,badge,status,playing,waiting,progress,curTime,dur,
    repN,pauseSec,speed,shadowMode,recActive,recSec,showSubtitle,
    lastBlobUrl,savedRecs,history,localServerOk,localServerChecked} = ui
  const curSub = subs[curIdx]

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        :root{
          --bg:#0f0f0f;--bg2:#1a1a1a;--bg3:#242424;--bg4:#2e2e2e;
          --border:#333;--border2:#444;
          --text:#f0f0f0;--text2:#aaa;--text3:#666;
          --accent:#4ade80;--accent-bg:#0d2818;--accent-text:#4ade80;
          --warn-bg:#2a1f00;--warn:#f59e0b;
          --blue:#60a5fa;--blue-bg:#0d1f36;
          --red:#f87171;--red-bg:#2d1010;
          --r:8px;--rl:12px;
        }
        body{background:var(--bg);color:var(--text);font-family:'Helvetica Neue',Arial,sans-serif;min-height:100vh}
        .shell{display:grid;grid-template-columns:260px 1fr 256px;height:100vh;overflow:hidden}
        .sb{background:var(--bg2);border-right:1px solid var(--border);padding:1rem;display:flex;flex-direction:column;gap:.85rem;height:100vh;overflow-y:auto}
        .main{padding:.75rem 1.25rem;height:100vh;display:flex;flex-direction:column;gap:.5rem;overflow:hidden}
        .right{background:var(--bg2);border-left:1px solid var(--border);display:flex;flex-direction:column;height:100vh;overflow:hidden}
        .logo{display:flex;align-items:center;gap:.5rem}
        .logo-icon{width:28px;height:28px;background:var(--accent);border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .logo-icon svg{width:14px;height:14px;fill:none;stroke:#000;stroke-width:2.5;stroke-linecap:round}
        .lbl{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin-bottom:.35rem}
        .divider{border-top:1px solid var(--border);padding-top:.85rem}
        .src-tabs{display:flex;background:var(--bg3);border-radius:6px;padding:2px;gap:2px}
        .src-tab{flex:1;padding:5px 4px;font-size:12px;font-weight:500;border:none;background:transparent;color:var(--text2);cursor:pointer;border-radius:5px;transition:all .15s;text-align:center}
        .src-tab.on{background:var(--bg4);color:var(--text)}
        .dz{border:1.5px dashed var(--border2);border-radius:var(--r);padding:.8rem;text-align:center;cursor:pointer;transition:all .2s}
        .drv-btn{width:100%;margin-top:6px;padding:6px 8px;font-size:11px;background:var(--bg3);color:var(--text2);border:1px solid var(--border);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;transition:all .15s}
        .drv-btn:hover{background:var(--accent-bg);color:var(--accent-text);border-color:var(--accent)}
        .dz:hover,.dz.has{border-style:solid;border-color:var(--accent);background:var(--accent-bg)}
        .dz p{font-size:12px;color:var(--text2);margin-top:2px}.dz small{font-size:11px;color:var(--text3)}
        .dz .fn{font-size:11px;font-weight:500;color:var(--accent-text);margin-top:3px;word-break:break-all}
        .yt-row{display:flex;gap:.35rem}
        .yt-row input{flex:1;font-size:12px;padding:6px 9px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);color:var(--text);outline:none;min-width:0}
        .yt-row input:focus{border-color:var(--accent)}
        .yt-btn{padding:6px 11px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);color:var(--text);cursor:pointer;white-space:nowrap;transition:all .15s}
        .yt-btn:hover{background:var(--accent-bg);border-color:var(--accent);color:var(--accent-text)}
        .yt-btn:disabled{opacity:.4;cursor:not-allowed}
        .ctrl-row{display:flex;align-items:center;justify-content:space-between}
        .ctrl-lbl{font-size:12px;color:var(--text2)}
        .stepper{display:flex;align-items:center;gap:4px}
        .step-btn{width:20px;height:20px;border:1px solid var(--border);border-radius:4px;background:var(--bg3);color:var(--text);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;line-height:1;transition:all .15s}
        .step-btn:hover{background:var(--accent-bg);border-color:var(--accent)}
        .step-val{font-size:13px;font-weight:600;min-width:16px;text-align:center}
        .sp-chips{display:flex;gap:3px}
        .sp-chip{padding:3px 7px;font-size:11px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:var(--bg3);color:var(--text2);transition:all .15s}
        .sp-chip.on{background:var(--accent-bg);border-color:var(--accent);color:var(--accent-text);font-weight:600}
        .tog-row{display:flex;align-items:center;justify-content:space-between}
        .tog-lbl{font-size:12px;color:var(--text2)}
        .tog-wrap{position:relative;display:inline-block;width:32px;height:18px}
        .tog-wrap input{opacity:0;width:0;height:0}
        .sl{position:absolute;inset:0;background:var(--border2);border-radius:18px;cursor:pointer;transition:.2s}
        .sl:before{content:'';position:absolute;width:12px;height:12px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
        input:checked+.sl{background:var(--accent)}input:checked+.sl:before{transform:translateX(14px)}
        .player-card{background:#000;border-radius:var(--rl);overflow:hidden;flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
        .player-card video,.player-card audio{width:100%;height:100%;display:block;background:#000;object-fit:contain}
        .player-card audio{height:60px;accent-color:var(--accent)}
        .yt-wrap{width:100%;height:100%;background:#000}
        .yt-wrap #yt-div{width:100%;height:100%;display:block}
        .player-ph{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;color:var(--text3);text-align:center;background:var(--bg2);border-radius:var(--rl)}
        .player-ph svg{width:32px;height:32px;opacity:.2}.player-ph p{font-size:12px;line-height:1.5}
        .stat-bar{display:flex;align-items:center;gap:.4rem;font-size:11px;color:var(--text2)}
        .dot{width:6px;height:6px;border-radius:50%;background:var(--border2);flex-shrink:0;transition:background .3s}
        .dot.play{background:#4ade80;box-shadow:0 0 5px #4ade8066}
        .dot.wait{background:#f59e0b;box-shadow:0 0 5px #f59e0b66}
        .dot.rec{background:#f87171;box-shadow:0 0 5px #f8717166;animation:pulse .8s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .sub-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:.6rem 1rem;min-height:60px}
        .sub-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:.3rem}
        .sub-ctr{font-size:11px;color:var(--text3)}
        .bdg{font-size:11px;font-weight:600;padding:2px 7px;border-radius:20px}
        .bdg-play{background:var(--blue-bg);color:var(--blue)}.bdg-wait{background:var(--warn-bg);color:var(--warn)}
        .sub-txt{font-size:1rem;line-height:1.4;font-family:Georgia,serif}
        .sub-txt.empty{color:var(--text3);font-size:.9rem;font-family:inherit}
        .prog-wrap{}.prog-times{display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:.2rem}
        .prog-track{width:100%;height:4px;background:var(--bg3);border-radius:2px;cursor:pointer}
        .prog-fill{height:100%;background:var(--accent);border-radius:2px;transition:width .1s linear;pointer-events:none}
        .playbar{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}
        .btn{padding:6px 14px;font-size:12px;font-weight:500;border:1px solid var(--border);border-radius:7px;background:var(--bg2);color:var(--text);cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:.3rem}
        .btn:hover{background:var(--bg3)}.btn.primary{background:var(--accent);border-color:var(--accent);color:#000;font-weight:600}.btn.primary:hover{opacity:.9}
        .btn.danger{background:var(--red-bg);border-color:var(--red);color:var(--red)}.btn.sm{padding:4px 10px;font-size:11px}.btn.icon{padding:6px 9px}
        .btn:disabled{opacity:.35;cursor:not-allowed}
        .rec-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:.6rem 1rem}
        .rec-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem}
        .rec-title{font-size:13px;font-weight:600}
        .rec-ctrl{display:flex;gap:.35rem;align-items:center;flex-wrap:wrap}
        .rec-timer{font-size:12px;font-weight:600;color:var(--red);min-width:32px;font-variant-numeric:tabular-nums}
        .right-tabs{display:flex;background:var(--bg3);border-bottom:1px solid var(--border)}
        .right-tab{flex:1;padding:.5rem;font-size:11px;font-weight:500;border:none;background:transparent;color:var(--text2);cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}
        .right-tab.on{color:var(--accent);border-bottom-color:var(--accent)}
        .right-content{flex:1;overflow-y:auto;min-height:0}
        .si{display:flex;gap:.6rem;padding:.5rem .85rem;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s;align-items:flex-start}
        .si:last-child{border-bottom:none}.si:hover{background:var(--bg3)}.si.cur{background:var(--accent-bg)}
        .si .ts{font-size:10px;color:var(--text3);min-width:36px;padding-top:1px;font-variant-numeric:tabular-nums}
        .si .st{font-size:12px;color:var(--text);line-height:1.4}.si.cur .st{font-weight:600;color:var(--accent-text)}
        .hi{display:flex;gap:.6rem;padding:.6rem .85rem;cursor:pointer;border-bottom:1px solid var(--border);align-items:center;transition:background .1s}
        .hi:hover{background:var(--bg3)}
        .hi .ht{font-size:12px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .hi .hd{font-size:10px;color:var(--text3)}
        .rec-item{display:flex;align-items:center;gap:.5rem;padding:.45rem .75rem;border-bottom:1px solid var(--border)}
        .rec-lbl{flex:1;font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .rec-item audio{height:24px;width:120px;min-width:0;accent-color:var(--accent)}
        .del-btn{border:none;background:transparent;color:var(--text3);cursor:pointer;font-size:13px;padding:2px 4px;transition:color .15s}
        .del-btn:hover{color:var(--red)}
        .tip{font-size:11px;color:var(--text3);background:var(--bg3);border-radius:6px;padding:.45rem .65rem;line-height:1.6;border-left:2px solid var(--border2)}
        .err{font-size:11px;color:var(--red);padding:.35rem .55rem;background:var(--red-bg);border-radius:5px;margin-top:.35rem}
        .ok{font-size:11px;color:var(--accent-text);padding:.25rem .45rem;background:var(--accent-bg);border-radius:4px;margin-top:.3rem}
        .server-badge{font-size:10px;padding:2px 8px;border-radius:20px;display:inline-flex;align-items:center;gap:4px}
        .server-on{background:var(--accent-bg);color:var(--accent-text)}
        .server-off{background:var(--bg3);color:var(--text3)}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
        @media(max-width:900px){.shell{grid-template-columns:240px 1fr}.right{display:none}}
        @media(max-width:600px){.shell{grid-template-columns:1fr;height:auto;overflow:auto}.sb{height:auto;position:static}.main{height:auto}}
      `}</style>

      <div className="shell">
        {/* ── SIDEBAR ── */}
        <aside className="sb">
          <div className="logo">
            <div className="logo-icon"><svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
            <div><div style={{fontSize:13,fontWeight:600}}>跟讀練習</div><div style={{fontSize:10,color:'var(--text3)'}}>Shadowing Player</div></div>
          </div>

          <div>
            <div className="lbl">來源</div>
            <div className="src-tabs">
              <button className={'src-tab'+(tab==='local'?' on':'')} onClick={()=>{S.current.tab='local';stopAll();upUI({tab:'local'})}}>影片 / 音訊</button>
              <button className={'src-tab'+(tab==='yt'?' on':'')} onClick={()=>{S.current.tab='yt';stopAll();upUI({tab:'yt'})}}>YouTube</button>
            </div>
          </div>

          {tab==='local'&&<>
            <div>
              <div className="lbl">媒體檔案</div>
              <div className={'dz'+(mediaSrc?' has':'')} onClick={()=>document.getElementById('media-file').click()} onDrop={e=>handleDrop(e,'media')} onDragOver={e=>e.preventDefault()}>
                <div style={{fontSize:18}}>{mediaSrc?'✓':'🎬'}</div>
                <p>影片或音訊檔</p>
                <small>MP4 · WebM · MOV · MP3 · M4A · WAV</small>
                {mediaSrc&&<div className="fn">已載入</div>}
              </div>
              <input id="media-file" type="file" accept="video/*,audio/*" style={{display:'none'}} onChange={e=>loadMedia(e.target.files[0])}/>
              <button className="drv-btn" onClick={pickMediaFromDrive}>☁ 從 Google 雲端硬碟選擇</button>
            </div>
            <div>
              <div className="lbl">字幕檔</div>
              <div className={'dz'+(subFileName&&tab==='local'?' has':'')} onClick={()=>document.getElementById('sub-file').click()} onDrop={e=>handleDrop(e,'sub')} onDragOver={e=>e.preventDefault()}>
                <div style={{fontSize:18}}>💬</div><p>字幕檔</p><small>SRT · VTT</small>
                {subFileName&&tab==='local'&&<div className="fn">✓ {subFileName.length>22?subFileName.slice(0,20)+'…':subFileName}</div>}
              </div>
              <input id="sub-file" type="file" accept=".srt,.vtt,.txt" style={{display:'none'}} onChange={e=>loadSubtitle(e.target.files[0])}/>
              <button className="drv-btn" onClick={pickSubtitleFromDrive}>☁ 從 Google 雲端硬碟選擇</button>
            </div>
          </>}

          {tab==='yt'&&<>
            <div>
              <div className="lbl" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span>YouTube 網址</span>
  
              </div>
              <div className="yt-row">
                <input id="yt-url-input" type="text" placeholder="https://youtube.com/watch?v=..." onKeyDown={e=>e.key==='Enter'&&loadYT()}/>
                <button className="yt-btn" onClick={loadYT} disabled={ytLoading}>{ytLoading?'載入中...':'載入'}</button>
              </div>
              {ytError&&<div className="err">{ytError}</div>}
              {!ytError&&subs.length>0&&tab==='yt'&&<div className="ok">✓ 字幕已載入 {subs.length} 句</div>}
              {ytId&&!ytReady&&<div style={{fontSize:10,color:'var(--text3)',marginTop:3}}>播放器載入中...</div>}
              {ytId&&ytReady&&<div style={{fontSize:10,color:'var(--accent-text)',marginTop:3}}>✓ 播放器就緒</div>}

            </div>
            <div>
              <div className="lbl">手動上傳字幕</div>
              <div className={'dz'+(subFileName&&tab==='yt'?' has':'')} onClick={()=>document.getElementById('yt-sub-file').click()}>
                <div style={{fontSize:16}}>💬</div><p>SRT · VTT</p>
                {subFileName&&tab==='yt'&&<div className="fn">✓ {subFileName}</div>}
              </div>
              <input id="yt-sub-file" type="file" accept=".srt,.vtt,.txt" style={{display:'none'}} onChange={e=>loadSubtitle(e.target.files[0])}/>
              <button className="drv-btn" onClick={pickSubtitleFromDrive}>☁ 從 Google 雲端硬碟選擇</button>
            </div>
          </>}

          <div className="divider">
            <div className="lbl">跟讀設定</div>
            <div style={{display:'flex',flexDirection:'column',gap:'.55rem'}}>
              <div className="ctrl-row">
                <span className="ctrl-lbl">每句重複次數</span>
                <div className="stepper">
                  <button className="step-btn" onClick={()=>{S.current.repN=Math.max(1,S.current.repN-1);upUI({repN:S.current.repN})}}>−</button>
                  <span className="step-val">{repN}</span>
                  <button className="step-btn" onClick={()=>{S.current.repN=Math.min(9,S.current.repN+1);upUI({repN:S.current.repN})}}>+</button>
                </div>
              </div>
              <div className="ctrl-row">
                <span className="ctrl-lbl">跟讀暫停（秒）</span>
                <div className="stepper">
                  <button className="step-btn" onClick={()=>{S.current.pauseSec=Math.max(1,S.current.pauseSec-1);upUI({pauseSec:S.current.pauseSec})}}>−</button>
                  <span className="step-val">{pauseSec}</span>
                  <button className="step-btn" onClick={()=>{S.current.pauseSec=Math.min(20,S.current.pauseSec+1);upUI({pauseSec:S.current.pauseSec})}}>+</button>
                </div>
              </div>
              <div className="ctrl-row">
                <span className="ctrl-lbl">播放速度</span>
                <div className="sp-chips">
                  {[0.75,1,1.25].map(s=>(
                    <span key={s} className={'sp-chip'+(speed===s?' on':'')} onClick={()=>{
                      S.current.speed=s;upUI({speed:s})
                      if(vidRef.current)vidRef.current.playbackRate=s
                      if(ytRef.current)try{ytRef.current.setPlaybackRate(s)}catch(e){}
                    }}>×{s}</span>
                  ))}
                </div>
              </div>
              <div className="tog-row">
                <span className="tog-lbl">🎙 跟讀暫停模式</span>
                <label className="tog-wrap"><input type="checkbox" checked={shadowMode} onChange={e=>{S.current.shadowMode=e.target.checked;upUI({shadowMode:e.target.checked})}}/><span className="sl"/></label>
              </div>
			  <div className="tog-row">
                <span className="tog-lbl">👁️ 顯示字幕</span>
                <label className="tog-wrap">
                  <input type="checkbox" checked={showSubtitle} onChange={e=>upUI({showSubtitle:e.target.checked})} />
                  <span className="sl"/>
                </label>
              </div>
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <main className="main">
          <div className="player-card">
            {showPlayer&&tab==='local'&&mediaSrc
              ? (() => {
                  const ext = mediaSrc
                  // detect if audio by checking file type stored in name
                  const audioExts = ['mp3','m4a','wav','ogg','aac','flac']
                  const isAud = ui.subFileName && audioExts.some(e => ui.mediaSrc?.includes(e))
                  return <video ref={vidRef} src={mediaSrc} controls={false}
                    onTimeUpdate={()=>{const v=vidRef.current;if(!v)return;const d=v.duration||0;upUI({curTime:v.currentTime,dur:d,progress:d>0?v.currentTime/d*100:0})}}
                    onLoadedMetadata={()=>{const d=vidRef.current?.duration||0;upUI({dur:d,status:{dot:'',msg:'就緒，點播放開始'}})}}/>
                })()
              : showPlayer&&tab==='yt'&&ytId
              ? <div className="yt-wrap"><div id="yt-div"/></div>
              : <div className="player-ph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><rect x="2" y="2" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                  <p>{tab==='yt'?'輸入 YouTube 網址並點載入':'從左側載入影片、音訊與字幕'}</p>
                </div>}
          </div>

          <div className="stat-bar"><div className={'dot'+(status.dot?' '+status.dot:'')}/><span>{status.msg}</span></div>

          <div className="sub-card">
            <div className="sub-meta">
              <span className="sub-ctr">{curIdx>=0?(curIdx+1)+' / '+subs.length:'— / —'}</span>
              <div>{badge&&<span className={'bdg bdg-'+badge.type}>{badge.txt}</span>}</div>
            </div>
            <div 
              className={'sub-txt'+(curSub?'':' empty')}
              style={{
                filter: (curSub && !showSubtitle) ? 'blur(6px)' : 'none',
                opacity: (curSub && !showSubtitle) ? 0.6 : 1,
                transition: 'all 0.3s ease',
                userSelect: (curSub && !showSubtitle) ? 'none' : 'auto'
              }}
            >
              {curSub ? curSub.text : '載入影片與字幕後點播放...'}
            </div>
          </div>

          {dur>0&&<div className="prog-wrap">
            <div className="prog-times"><span>{fmt(curTime)}</span><span>{fmt(dur)}</span></div>
            <div className="prog-track" onClick={tab==='local'?seekClick:undefined}><div className="prog-fill" style={{width:progress+'%'}}/></div>
          </div>}

          <div className="playbar">
            <button className="btn icon" onClick={()=>{const i=S.current.curIdx;if(i>0){stopAll();S.current.repDone=0;playSentence(i-1)}}}>⏮</button>
            <button className="btn primary" onClick={togglePlay}>{(playing||waiting)?'⏸ 暫停':'▶ 播放'}</button>
            <button className="btn icon" onClick={()=>{const i=S.current.curIdx;if(i+1<S.current.subs.length){stopAll();S.current.repDone=0;playSentence(i+1)}}}>⏭</button>
            <button className="btn sm" onClick={()=>{if(S.current.curIdx>=0){stopAll();S.current.repDone=0;playSentence(S.current.curIdx)}}}>↺ 重播本句</button>
          </div>

          <div className="rec-card">
            <div className="rec-hd"><span className="rec-title">🎙 錄音</span></div>
            <div className="rec-ctrl">
              <button className={'btn sm'+(recActive?' danger':'')} onClick={()=>recActive?stopRec():startRec()}>{recActive?'■ 停止':'● 開始錄音'}</button>
              {recActive&&<span className="rec-timer">{fmt(recSec)}</span>}
              <button className="btn sm" onClick={()=>lastBlobUrl&&new Audio(lastBlobUrl).play()} disabled={!lastBlobUrl}>▷ 播放</button>
              <button className="btn sm" onClick={saveRec} disabled={!lastBlobUrl}>💾 保存</button>
            </div>
          </div>
        </main>

        {/* ── RIGHT PANEL ── */}
        <RightPanel
          subs={subs} curIdx={curIdx} savedRecs={savedRecs} history={history}
          playSentence={(i)=>{stopAll();S.current.repDone=0;playSentence(i)}}
          loadYTFromHistory={(id)=>{
            S.current.tab='yt';
            upUI({tab:'yt', ytUrlInput:'https://www.youtube.com/watch?v='+id})
            setTimeout(()=>{
              const input=document.getElementById('yt-url-input')
              if(input){
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
                nativeInputValueSetter.call(input, 'https://www.youtube.com/watch?v='+id)
                input.dispatchEvent(new Event('input', {bubbles:true}))
              }
              loadYT()
            }, 150)
          }}
          delRec={(i)=>upUI(u=>({savedRecs:u.savedRecs.filter((_,j)=>j!==i)}))}
          delHistory={delHistory}
        />
      </div>
    </>
  )
}

function RightPanel({subs, curIdx, savedRecs, history, playSentence, loadYTFromHistory, delRec, delHistory}) {
  const [tab, setTab] = useState('subs')
  return (
    <div className="right">
      <div className="right-tabs">
        <button className={'right-tab'+(tab==='subs'?' on':'')} onClick={()=>setTab('subs')}>字幕 {subs.length>0&&`(${subs.length})`}</button>
        <button className={'right-tab'+(tab==='recs'?' on':'')} onClick={()=>setTab('recs')}>錄音 {savedRecs.length>0&&`(${savedRecs.length})`}</button>
        <button className={'right-tab'+(tab==='hist'?' on':'')} onClick={()=>setTab('hist')}>紀錄 {history.length>0&&`(${history.length})`}</button>
      </div>
      <div className="right-content">
        {tab==='subs'&&subs.map((s,i)=>(
          <div key={i} id={'si'+i} className={'si'+(i===curIdx?' cur':'')} onClick={()=>playSentence(i)}>
            <span className="ts">{Math.floor(s.s/60)+':'+(Math.floor(s.s%60)<10?'0':'')+Math.floor(s.s%60)}</span>
            <span className="st">{s.text}</span>
          </div>
        ))}
        {tab==='subs'&&subs.length===0&&<div style={{padding:'2rem',textAlign:'center',color:'var(--text3)',fontSize:12}}>尚未載入字幕</div>}

        {tab==='recs'&&savedRecs.map((r,i)=>(
          <div key={i} className="rec-item">
            <span className="rec-lbl">{r.label}</span>
            <audio controls src={r.url}/>
            <a href={r.url} download={`rec-${i+1}.webm`}><button className="btn sm icon" style={{padding:'2px 6px'}}>⬇</button></a>
            <button className="del-btn" onClick={()=>delRec(i)}>✕</button>
          </div>
        ))}
        {tab==='recs'&&savedRecs.length===0&&<div style={{padding:'2rem',textAlign:'center',color:'var(--text3)',fontSize:12}}>尚未有錄音</div>}

        {tab==='hist'&&history.map((h,i)=>(
          <div key={i} className="hi" onClick={()=>loadYTFromHistory(h.id)}>
            <img src={'https://img.youtube.com/vi/'+h.id+'/mqdefault.jpg'} 
              style={{width:72,height:48,objectFit:'cover',borderRadius:4,flexShrink:0,background:'#000'}}
              onError={e=>{e.target.style.display='none'}}/>
            <div style={{flex:1,minWidth:0}}>
              <div className="ht">{h.title||h.id}</div>
              <div className="hd">{new Date(h.time).toLocaleDateString('zh-TW')}</div>
            </div>
            <button 
              className="del-btn" 
              onClick={(e)=>{
                e.stopPropagation();
                delHistory(h.id);
              }}
            >✕</button>
          </div>
        ))}
        {tab==='hist'&&history.length===0&&<div style={{padding:'2rem',textAlign:'center',color:'var(--text3)',fontSize:12}}>尚未有播放紀錄</div>}
      </div>
    </div>
  )
}