'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

function ts2s(t) {
  const p = t.replace(',', '.').split(':')
  return p.length === 3 ? +p[0]*3600 + +p[1]*60 + parseFloat(p[2]) : +p[0]*60 + parseFloat(p[1])
}
function fmt(s) {
  const m = Math.floor(s/60), sec = Math.floor(s%60)
  return m + ':' + (sec < 10 ? '0' : '') + sec
}
function parseSRT(txt) {
  return txt.trim().split(/\n\n+/).map(b => {
    const lines = b.split('\n'), tl = lines.find(l => /-->/.test(l))
    if (!tl) return null
    const [s, e] = tl.split('-->').map(x => ts2s(x.trim()))
    const text = lines.slice(lines.indexOf(tl)+1).join(' ')
      .replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").trim()
    return text ? {s, e, text} : null
  }).filter(Boolean)
}
function parseVTT(txt) {
  return parseSRT(txt.replace(/^WEBVTT[^\n]*\n/,'').replace(/NOTE[^\n]*\n[^\n]*/g,''))
}

// ── Fetch YouTube captions directly from browser (bypasses server IP block) ──
async function fetchYTCaptions(videoId) {
  // Step 1: get the watch page to extract caption track URLs
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
  const pageRes = await fetch(proxyUrl)
  if (!pageRes.ok) throw new Error('無法取得影片頁面')
  const { contents: html } = await pageRes.json()

  const match = html.match(/"captionTracks":(\[.*?\])/)
  if (!match) throw new Error('此影片沒有字幕資料')

  const tracks = JSON.parse(match[1])
  // prefer manual English, fallback to auto-generated English
  const enTrack = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
    || tracks.find(t => t.languageCode?.startsWith('en'))
    || tracks[0]

  if (!enTrack?.baseUrl) throw new Error('找不到英文字幕')

  // Step 2: fetch the caption XML via proxy
  const capUrl = enTrack.baseUrl + '&fmt=json3'
  const capRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(capUrl)}`)
  if (!capRes.ok) throw new Error('無法取得字幕內容')
  const { contents } = await capRes.json()
  const data = JSON.parse(contents)

  if (!data?.events?.length) throw new Error('字幕內容為空')

  return data.events
    .filter(e => e.segs && e.tStartMs !== undefined)
    .map(e => ({
      s: e.tStartMs / 1000,
      e: (e.tStartMs + (e.dDurationMs || 3000)) / 1000,
      text: e.segs.map(s => s.utf8 || '').join('').replace(/\n/g,' ').trim()
    }))
    .filter(e => e.text && e.text !== ' ')
}

export default function ShadowingApp() {
  const [tab, setTab] = useState('local')
  const [subs, setSubs] = useState([])
  const [curIdx, setCurIdx] = useState(-1)
  const [repN, setRepN] = useState(2)
  const [pauseSec, setPauseSec] = useState(3)
  const [speed, setSpeed] = useState(1)
  const [shadowMode, setShadowMode] = useState(true)
  const [autoRec, setAutoRec] = useState(false)
  const [status, setStatus] = useState({dot:'', msg:'等待載入...'})
  const [badge, setBadge] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [curTime, setCurTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [vidFile, setVidFile] = useState(null)
  const [subFileName, setSubFileName] = useState('')
  const [ytUrl, setYtUrl] = useState('')
  const [ytId, setYtId] = useState('')
  const [ytLoading, setYtLoading] = useState(false)
  const [ytError, setYtError] = useState('')
  const [ytReady, setYtReady] = useState(false)
  const [recActive, setRecActive] = useState(false)
  const [recSec, setRecSec] = useState(0)
  const [lastBlobUrl, setLastBlobUrl] = useState(null)
  const [savedRecs, setSavedRecs] = useState([])
  const [waveBars, setWaveBars] = useState([])
  const [showPlayer, setShowPlayer] = useState(false)

  const vidRef = useRef(null)
  const ytPlayerRef = useRef(null)
  const ytPollRef = useRef(null)
  const timerRef = useRef(null)
  const repDoneRef = useRef(0)
  const subsRef = useRef([])
  const curIdxRef = useRef(-1)
  const repNRef = useRef(2)
  const pauseSecRef = useRef(3)
  const shadowRef = useRef(true)
  const speedRef = useRef(1)
  const autoRecRef = useRef(false)
  const mediaRecRef = useRef(null)
  const recChunksRef = useRef([])
  const recTimerRef = useRef(null)
  const analyserRef = useRef(null)
  const audioCtxRef = useRef(null)
  const animRef = useRef(null)
  const lastBlobRef = useRef(null)
  const playingRef = useRef(false)
  const waitingRef = useRef(false)
  const onSentEndRef = useRef(null)
  const playSentenceRef = useRef(null)
  const startRecRef = useRef(null)
  const tabRef = useRef('local')

  useEffect(() => { subsRef.current = subs }, [subs])
  useEffect(() => { tabRef.current = tab }, [tab])
  useEffect(() => { repNRef.current = repN }, [repN])
  useEffect(() => { pauseSecRef.current = pauseSec }, [pauseSec])
  useEffect(() => { shadowRef.current = shadowMode }, [shadowMode])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { autoRecRef.current = autoRec }, [autoRec])

  useEffect(() => {
    if (curIdx < 0) return
    const el = document.getElementById('si'+curIdx)
    if (el) el.scrollIntoView({block:'nearest', behavior:'smooth'})
  }, [curIdx])

  // Load YT IFrame API once
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!document.getElementById('yt-api-script')) {
      const s = document.createElement('script')
      s.id = 'yt-api-script'
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  }, [])

  const initYTPlayer = useCallback((videoId) => {
    if (ytPlayerRef.current) { try { ytPlayerRef.current.destroy() } catch(e) {} ytPlayerRef.current = null }
    setYtReady(false)
    const create = () => {
      if (!window.YT?.Player) { setTimeout(create, 200); return }
      ytPlayerRef.current = new window.YT.Player('yt-player-div', {
        videoId,
        playerVars: { rel: 0 },
        events: {
          onReady: () => { setYtReady(true); setStatus({dot:'', msg:'就緒，點播放開始'}) }
        }
      })
    }
    create()
  }, [])

  const stopAll = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (ytPollRef.current) { clearInterval(ytPollRef.current); ytPollRef.current = null }
    if (vidRef.current) vidRef.current.pause()
    if (ytPlayerRef.current) try { ytPlayerRef.current.pauseVideo() } catch(e) {}
    playingRef.current = false; waitingRef.current = false
    setPlaying(false); setWaiting(false); setBadge(null)
  }, [])

  const nextSubInternal = useCallback(() => {
    const next = curIdxRef.current + 1
    if (next < subsRef.current.length) { repDoneRef.current = 0; playSentenceRef.current(next) }
    else { setStatus({dot:'', msg:'播放完畢 🎉'}); playingRef.current = false; setPlaying(false); setBadge(null) }
  }, [])

  const onSentEnd = useCallback(() => {
    if (ytPollRef.current) { clearInterval(ytPollRef.current); ytPollRef.current = null }
    if (repDoneRef.current < repNRef.current) { setTimeout(() => playSentenceRef.current(curIdxRef.current), 300); return }
    setBadge(null)
    if (shadowRef.current) {
      waitingRef.current = true; playingRef.current = false
      setPlaying(false); setWaiting(true)
      setBadge({type:'wait', txt:'⏸ 跟讀中'})
      setStatus({dot:'wait', msg:'等待跟讀（'+pauseSecRef.current+' 秒）'})
      if (autoRecRef.current) startRecRef.current?.()
      timerRef.current = setTimeout(() => {
        waitingRef.current = false; setWaiting(false); setBadge(null)
        nextSubInternal()
      }, pauseSecRef.current * 1000)
    } else { nextSubInternal() }
  }, [nextSubInternal])

  useEffect(() => { onSentEndRef.current = onSentEnd }, [onSentEnd])

  const playSentence = useCallback((i) => {
    const s = subsRef.current[i]
    if (!s) return
    repDoneRef.current++; curIdxRef.current = i; setCurIdx(i)
    setBadge({type:'play', txt:'▶ '+repDoneRef.current+'/'+repNRef.current})
    setStatus({dot:'play', msg:'播放第 '+repDoneRef.current+'/'+repNRef.current+' 次'})

    if (tabRef.current === 'yt') {
      const yt = ytPlayerRef.current; if (!yt) return
      try {
        yt.setPlaybackRate(speedRef.current)
        yt.seekTo(s.s, true); yt.playVideo()
        playingRef.current = true; setPlaying(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        if (ytPollRef.current) clearInterval(ytPollRef.current)
        ytPollRef.current = setInterval(() => {
          try {
            const ct = yt.getCurrentTime(), state = yt.getPlayerState()
            if (ct >= s.e - 0.15 || state === 0) {
              clearInterval(ytPollRef.current); ytPollRef.current = null
              yt.pauseVideo(); onSentEndRef.current()
            }
          } catch(e) {}
        }, 100)
      } catch(e) {}
    } else {
      const vid = vidRef.current; if (!vid) return
      vid.playbackRate = speedRef.current; vid.currentTime = s.s; vid.play()
      playingRef.current = true; setPlaying(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => { vid.pause(); onSentEndRef.current() }, (s.e - s.s) / speedRef.current * 1000 + 150)
    }
  }, [tab])

  useEffect(() => { playSentenceRef.current = playSentence }, [playSentence])

  const togglePlay = () => {
    if (!subs.length) { alert('請先載入字幕'); return }
    if (tabRef.current === 'yt' && !ytReady) { alert('播放器尚未就緒，請稍候'); return }
    if (playingRef.current || waitingRef.current) { stopAll(); setStatus({dot:'', msg:'暫停'}) }
    else { const idx = curIdxRef.current < 0 ? 0 : curIdxRef.current; repDoneRef.current = 0; playSentence(idx) }
  }
  const prevSub = () => { stopAll(); if (curIdxRef.current > 0) { repDoneRef.current = 0; playSentence(curIdxRef.current-1) } }
  const nextSub = () => { stopAll(); if (curIdxRef.current+1 < subs.length) { repDoneRef.current = 0; playSentence(curIdxRef.current+1) } }
  const replayCur = () => { stopAll(); if (curIdxRef.current >= 0) { repDoneRef.current = 0; playSentence(curIdxRef.current) } }
  const jumpTo = (i) => { stopAll(); repDoneRef.current = 0; playSentence(i) }

  const onTimeUpdate = () => {
    const vid = vidRef.current; if (!vid) return
    setCurTime(vid.currentTime)
    if (dur > 0) setProgress(vid.currentTime/dur*100)
  }
  const onVidReady = () => { setDur(vidRef.current?.duration||0); setStatus({dot:'', msg:'就緒，點播放開始'}) }
  const seekClick = (e) => {
    if (!dur || !vidRef.current) return
    const r = e.currentTarget.getBoundingClientRect()
    vidRef.current.currentTime = ((e.clientX-r.left)/r.width)*dur
  }

  useEffect(() => {
    if (tab !== 'yt') return
    const iv = setInterval(() => {
      if (!ytPlayerRef.current) return
      try {
        const ct = ytPlayerRef.current.getCurrentTime()||0
        const d = ytPlayerRef.current.getDuration()||0
        setCurTime(ct); if (d > 0) { setDur(d); setProgress(ct/d*100) }
      } catch(e) {}
    }, 500)
    return () => clearInterval(iv)
  }, [tab])

  const loadVideo = (f) => {
    if (!f) return
    setVidFile(URL.createObjectURL(f)); setShowPlayer(true); setYtId('')
    setStatus({dot:'', msg:'影片已載入：'+f.name})
  }
  const loadSubtitle = (f) => {
    if (!f) return
    const r = new FileReader()
    r.onload = (e) => {
      const txt = e.target.result
      const parsed = f.name.endsWith('.vtt') ? parseVTT(txt) : parseSRT(txt)
      setSubs(parsed); subsRef.current = parsed; setSubFileName(f.name)
      setCurIdx(-1); curIdxRef.current = -1
      setStatus({dot:'', msg:'字幕已載入，共 '+parsed.length+' 句'})
    }
    r.readAsText(f)
  }

  const loadYT = async () => {
    const m = ytUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
    if (!m) { setYtError('請輸入有效的 YouTube 網址'); return }
    const id = m[1]
    setYtId(id); setShowPlayer(true); setYtError(''); setYtLoading(true)
    setStatus({dot:'', msg:'載入字幕中...'})
    stopAll(); initYTPlayer(id)
    try {
      const parsed = await fetchYTCaptions(id)
      setSubs(parsed); subsRef.current = parsed; setSubFileName('YouTube 字幕')
      setCurIdx(-1); curIdxRef.current = -1
      setStatus({dot:'', msg:'字幕已載入，共 '+parsed.length+' 句'})
    } catch(e) {
      setYtError(e.message + '（可手動上傳 SRT）')
      setStatus({dot:'', msg:'字幕載入失敗，請手動上傳 SRT'})
    } finally { setYtLoading(false) }
  }

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true})
      audioCtxRef.current = new (window.AudioContext||window.webkitAudioContext)()
      const src = audioCtxRef.current.createMediaStreamSource(stream)
      analyserRef.current = audioCtxRef.current.createAnalyser()
      analyserRef.current.fftSize = 256; src.connect(analyserRef.current)
      mediaRecRef.current = new MediaRecorder(stream); recChunksRef.current = []
      mediaRecRef.current.ondataavailable = e => recChunksRef.current.push(e.data)
      mediaRecRef.current.onstop = () => {
        const blob = new Blob(recChunksRef.current, {type:'audio/webm'})
        lastBlobRef.current = blob
        const url = URL.createObjectURL(blob); setLastBlobUrl(url)
        stream.getTracks().forEach(t => t.stop())
        if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null }
        cancelAnimationFrame(animRef.current)
        setWaveBars(Array.from({length:40}, () => Math.random()*28+4))
      }
      mediaRecRef.current.start(); setRecActive(true); setRecSec(0)
      recTimerRef.current = setInterval(() => setRecSec(s => s+1), 1000)
      setBadge({type:'rec', txt:'🔴 錄音中'}); setStatus({dot:'rec', msg:'錄音中...'})
      const data = new Uint8Array(analyserRef.current.frequencyBinCount)
      const step = Math.floor(data.length/40)
      const tick = () => {
        analyserRef.current?.getByteFrequencyData(data)
        setWaveBars(Array.from({length:40}, (_,i) => Math.max(4,(data[i*step]/255)*40)))
        animRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch(e) { alert('無法取得麥克風：'+e.message) }
  }
  useEffect(() => { startRecRef.current = startRec }, [startRec])

  const stopRec = () => {
    if (mediaRecRef.current?.state !== 'inactive') mediaRecRef.current?.stop()
    setRecActive(false); clearInterval(recTimerRef.current)
    setBadge(null); setStatus({dot:'', msg:'錄音完成'})
  }

  const saveRec = () => {
    if (!lastBlobRef.current) return
    const label = subs[curIdx] ? `[${curIdx+1}] ${subs[curIdx].text.slice(0,32)}...` : '錄音 '+(savedRecs.length+1)
    setSavedRecs(r => [...r, {label, url:lastBlobUrl}])
  }

  const handleDrop = (e, type) => {
    e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return
    type === 'vid' ? loadVideo(f) : loadSubtitle(f)
  }

  const curSub = subs[curIdx]

  return (
    <>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        :root{--bg:#f8f7f4;--bg2:#fff;--bg3:#f0eeea;--border:#e0ddd7;--border2:#ccc9c1;--text:#1a1916;--text2:#6b6860;--text3:#9e9b93;--accent:#2d6a4f;--accent-bg:#e8f5ee;--accent-text:#1a4731;--warn-bg:#fef3c7;--warn:#92400e;--blue:#1e4d8c;--blue-bg:#eff6ff;--red:#991b1b;--red-bg:#fee2e2;--r:10px;--rl:14px}
        @media(prefers-color-scheme:dark){:root{--bg:#18181a;--bg2:#242427;--bg3:#2e2e32;--border:#38383d;--border2:#4a4a51;--text:#f0eff0;--text2:#9b9aa0;--text3:#5e5d64;--accent:#4ade80;--accent-bg:#14291e;--accent-text:#86efac;--warn-bg:#292105;--warn:#fbbf24;--blue:#60a5fa;--blue-bg:#0d1f36;--red:#f87171;--red-bg:#2d1010}}
        body{background:var(--bg);color:var(--text);font-family:'Helvetica Neue',Arial,sans-serif;min-height:100vh}
        .shell{display:grid;grid-template-columns:272px 1fr;min-height:100vh}
        .sb{background:var(--bg2);border-right:1px solid var(--border);padding:1.25rem 1rem;display:flex;flex-direction:column;gap:1rem;position:sticky;top:0;height:100vh;overflow-y:auto}
        .main{padding:1.75rem 2rem;max-width:780px}
        .logo{display:flex;align-items:center;gap:.5rem}
        .logo-icon{width:30px;height:30px;background:var(--accent);border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .logo-icon svg{width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round}
        .lbl{font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin-bottom:.4rem}
        .divider{border-top:1px solid var(--border);padding-top:1rem}
        .src-tabs{display:flex;background:var(--bg3);border-radius:8px;padding:3px;gap:2px}
        .src-tab{flex:1;padding:5px 4px;font-size:12px;font-weight:500;border:none;background:transparent;color:var(--text2);cursor:pointer;border-radius:6px;transition:all .15s;text-align:center}
        .src-tab.on{background:var(--bg2);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.08)}
        .dz{border:1.5px dashed var(--border2);border-radius:var(--r);padding:.9rem;text-align:center;cursor:pointer;transition:all .2s}
        .dz:hover,.dz.has{border-style:solid;border-color:var(--accent);background:var(--accent-bg)}
        .dz p{font-size:12px;color:var(--text2);margin-top:2px}.dz small{font-size:11px;color:var(--text3)}
        .dz .fn{font-size:11px;font-weight:500;color:var(--accent-text);margin-top:4px;word-break:break-all}
        .yt-row{display:flex;gap:.35rem}
        .yt-row input{flex:1;font-size:12px;padding:6px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg3);color:var(--text);outline:none;min-width:0}
        .yt-row input:focus{border-color:var(--accent)}
        .yt-btn{padding:6px 11px;font-size:12px;border:1px solid var(--border);border-radius:7px;background:var(--bg3);color:var(--text);cursor:pointer;white-space:nowrap;transition:all .15s}
        .yt-btn:hover{background:var(--accent-bg);border-color:var(--accent);color:var(--accent-text)}
        .yt-btn:disabled{opacity:.5;cursor:not-allowed}
        .ctrl-row{display:flex;align-items:center;justify-content:space-between}
        .ctrl-lbl{font-size:12px;color:var(--text2)}
        .stepper{display:flex;align-items:center;gap:4px}
        .step-btn{width:22px;height:22px;border:1px solid var(--border);border-radius:5px;background:var(--bg3);color:var(--text);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;line-height:1;transition:all .15s}
        .step-btn:hover{background:var(--accent-bg);border-color:var(--accent)}
        .step-val{font-size:13px;font-weight:600;min-width:18px;text-align:center}
        .sp-chips{display:flex;gap:3px}
        .sp-chip{padding:3px 7px;font-size:11px;border:1px solid var(--border);border-radius:5px;cursor:pointer;background:var(--bg3);color:var(--text2);transition:all .15s}
        .sp-chip.on{background:var(--accent-bg);border-color:var(--accent);color:var(--accent-text);font-weight:600}
        .tog-row{display:flex;align-items:center;justify-content:space-between}
        .tog-lbl{font-size:12px;color:var(--text2)}
        .tog-wrap{position:relative;display:inline-block;width:34px;height:19px}
        .tog-wrap input{opacity:0;width:0;height:0}
        .sl{position:absolute;inset:0;background:var(--border2);border-radius:19px;cursor:pointer;transition:.2s}
        .sl:before{content:'';position:absolute;width:13px;height:13px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
        input:checked+.sl{background:var(--accent)}
        input:checked+.sl:before{transform:translateX(15px)}
        h1{font-size:21px;font-weight:700;letter-spacing:-.02em;margin-bottom:.2rem;font-family:Georgia,serif}
        .sub-tag{font-size:13px;color:var(--text2);margin-bottom:1.5rem}
        .player-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);overflow:hidden;margin-bottom:1rem}
        .player-card video{width:100%;display:block;max-height:340px;background:#000;object-fit:contain}
        .yt-wrap{aspect-ratio:16/9;background:#000}
        .yt-wrap #yt-player-div{width:100%;height:100%}
        .player-ph{height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.6rem;color:var(--text3);text-align:center}
        .player-ph svg{width:36px;height:36px;opacity:.2}
        .player-ph p{font-size:13px;line-height:1.5}
        .stat-bar{display:flex;align-items:center;gap:.45rem;font-size:12px;color:var(--text2);margin-bottom:.9rem}
        .dot{width:7px;height:7px;border-radius:50%;background:var(--border2);flex-shrink:0;transition:background .3s}
        .dot.play{background:#22c55e;box-shadow:0 0 5px #22c55e55}
        .dot.wait{background:#f59e0b;box-shadow:0 0 5px #f59e0b55}
        .dot.rec{background:#ef4444;box-shadow:0 0 5px #ef444455;animation:pulse .8s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .sub-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:1.1rem 1.4rem;margin-bottom:.9rem;min-height:88px}
        .sub-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem}
        .sub-ctr{font-size:11px;color:var(--text3)}
        .bdg{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px}
        .bdg-play{background:var(--blue-bg);color:var(--blue)}
        .bdg-wait{background:var(--warn-bg);color:var(--warn)}
        .bdg-rec{background:var(--red-bg);color:var(--red)}
        .sub-txt{font-size:1.2rem;line-height:1.55;font-family:Georgia,serif;min-height:1.9rem}
        .sub-txt.empty{color:var(--text3);font-size:1rem;font-family:inherit}
        .prog-wrap{margin-bottom:.9rem}
        .prog-times{display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:.25rem}
        .prog-track{width:100%;height:5px;background:var(--bg3);border-radius:3px;cursor:pointer}
        .prog-fill{height:100%;background:var(--accent);border-radius:3px;transition:width .1s linear;pointer-events:none}
        .playbar{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin-bottom:1.1rem}
        .btn{padding:7px 16px;font-size:13px;font-weight:500;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text);cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:.3rem}
        .btn:hover{background:var(--bg3)}
        .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
        .btn.primary:hover{opacity:.9}
        .btn.danger{background:var(--red-bg);border-color:var(--red);color:var(--red)}
        .btn.sm{padding:5px 11px;font-size:12px}
        .btn.icon{padding:7px 10px}
        .btn:disabled{opacity:.4;cursor:not-allowed}
        .rec-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);padding:1.1rem 1.4rem;margin-bottom:1rem}
        .rec-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem}
        .rec-title{font-size:14px;font-weight:600}
        .wf{height:52px;background:var(--bg3);border-radius:8px;margin-bottom:.65rem;display:flex;align-items:center;justify-content:center;overflow:hidden}
        .wf-bars{display:flex;align-items:center;gap:2px;height:100%;padding:6px 10px}
        .wf-bar{width:3px;background:var(--accent);border-radius:2px;transition:height .05s;opacity:.75}
        .wf-idle{font-size:12px;color:var(--text3)}
        .rec-ctrl{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}
        .rec-timer{font-size:13px;font-weight:600;color:var(--red);min-width:36px;font-variant-numeric:tabular-nums}
        .sub-list-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--rl);overflow:hidden;margin-bottom:1rem}
        .list-hd{padding:.65rem 1rem;font-size:12px;font-weight:600;color:var(--text2);border-bottom:1px solid var(--border);background:var(--bg3)}
        .sub-list{max-height:260px;overflow-y:auto}
        .si{display:flex;gap:.65rem;padding:.55rem 1rem;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s;align-items:flex-start}
        .si:last-child{border-bottom:none}
        .si:hover{background:var(--bg3)}
        .si.cur{background:var(--accent-bg)}
        .si .ts{font-size:11px;color:var(--text3);min-width:40px;padding-top:1px;font-variant-numeric:tabular-nums}
        .si .st{font-size:13px;color:var(--text);line-height:1.4}
        .si.cur .st{font-weight:600;color:var(--accent-text)}
        .rec-item{display:flex;align-items:center;gap:.6rem;padding:.55rem .75rem;background:var(--bg3);border-radius:7px;border:1px solid var(--border);margin:.35rem .75rem}
        .rec-lbl{flex:1;font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .rec-item audio{height:26px;width:140px;min-width:0;accent-color:var(--accent)}
        .del-btn{border:none;background:transparent;color:var(--text3);cursor:pointer;font-size:14px;padding:2px 5px;border-radius:4px;transition:color .15s}
        .del-btn:hover{color:var(--red)}
        .tip{font-size:11px;color:var(--text3);background:var(--bg3);border-radius:7px;padding:.5rem .7rem;line-height:1.6;border-left:2px solid var(--border2)}
        .err{font-size:12px;color:var(--red);padding:.4rem .6rem;background:var(--red-bg);border-radius:6px;margin-top:.4rem}
        .ok{font-size:11px;color:var(--accent-text);padding:.3rem .5rem;background:var(--accent-bg);border-radius:5px;margin-top:.35rem}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
        @media(max-width:640px){.shell{grid-template-columns:1fr}.sb{height:auto;position:static}.main{padding:1rem}}
      `}</style>

      <div className="shell">
        <aside className="sb">
          <div className="logo">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </div>
            <div>
              <div style={{fontSize:14,fontWeight:600}}>跟讀練習</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>Shadowing Player</div>
            </div>
          </div>

          <div>
            <div className="lbl">來源</div>
            <div className="src-tabs">
              <button className={'src-tab'+(tab==='local'?' on':'')} onClick={() => {setTab('local');stopAll()}}>影片 + 字幕</button>
              <button className={'src-tab'+(tab==='yt'?' on':'')} onClick={() => {setTab('yt');stopAll()}}>YouTube</button>
            </div>
          </div>

          {tab==='local' && <>
            <div>
              <div className="lbl">影片檔</div>
              <div className={'dz'+(vidFile?' has':'')} onClick={() => document.getElementById('vid-file').click()} onDrop={e=>handleDrop(e,'vid')} onDragOver={e=>e.preventDefault()}>
                <div style={{fontSize:20}}>🎬</div><p>點擊或拖曳影片</p><small>MP4 · WebM · MOV</small>
                {vidFile && <div className="fn">✓ 已載入</div>}
              </div>
              <input id="vid-file" type="file" accept="video/*" style={{display:'none'}} onChange={e=>loadVideo(e.target.files[0])}/>
            </div>
            <div>
              <div className="lbl">字幕檔</div>
              <div className={'dz'+(subFileName?' has':'')} onClick={() => document.getElementById('sub-file').click()} onDrop={e=>handleDrop(e,'sub')} onDragOver={e=>e.preventDefault()}>
                <div style={{fontSize:20}}>💬</div><p>點擊或拖曳字幕</p><small>SRT · VTT</small>
                {subFileName && <div className="fn">✓ {subFileName.length>24?subFileName.slice(0,22)+'…':subFileName}</div>}
              </div>
              <input id="sub-file" type="file" accept=".srt,.vtt,.txt" style={{display:'none'}} onChange={e=>loadSubtitle(e.target.files[0])}/>
            </div>
          </>}

          {tab==='yt' && <>
            <div>
              <div className="lbl">YouTube 網址</div>
              <div className="yt-row">
                <input type="text" placeholder="https://youtube.com/watch?v=..." value={ytUrl} onChange={e=>setYtUrl(e.target.value)} onKeyDown={e=>e.key==='Enter'&&loadYT()}/>
                <button className="yt-btn" onClick={loadYT} disabled={ytLoading}>{ytLoading?'載入中...':'載入'}</button>
              </div>
              {ytError && <div className="err">{ytError}</div>}
              {!ytError && subs.length>0 && <div className="ok">✓ 字幕已載入 {subs.length} 句</div>}
              {ytId && !ytReady && <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>播放器載入中...</div>}
              {ytId && ytReady && <div style={{fontSize:11,color:'var(--accent-text)',marginTop:4}}>✓ 播放器就緒</div>}
              <div style={{height:'.5rem'}}/>
              <div className="tip">字幕抓取失敗時，可至 <a href="https://downsub.com" target="_blank" style={{color:'var(--accent)'}}>Downsub.com</a> 下載 SRT 後手動上傳</div>
            </div>
            <div>
              <div className="lbl">手動上傳字幕（選用）</div>
              <div className={'dz'+(subFileName&&tab==='yt'?' has':'')} onClick={() => document.getElementById('yt-sub-file').click()}>
                <div style={{fontSize:18}}>💬</div><p>SRT · VTT</p>
                {subFileName&&tab==='yt' && <div className="fn">✓ {subFileName}</div>}
              </div>
              <input id="yt-sub-file" type="file" accept=".srt,.vtt,.txt" style={{display:'none'}} onChange={e=>loadSubtitle(e.target.files[0])}/>
            </div>
          </>}

          <div className="divider">
            <div className="lbl">跟讀設定</div>
            <div style={{display:'flex',flexDirection:'column',gap:'.6rem'}}>
              <div className="ctrl-row">
                <span className="ctrl-lbl">每句重複次數</span>
                <div className="stepper">
                  <button className="step-btn" onClick={()=>setRepN(n=>Math.max(1,n-1))}>−</button>
                  <span className="step-val">{repN}</span>
                  <button className="step-btn" onClick={()=>setRepN(n=>Math.min(9,n+1))}>+</button>
                </div>
              </div>
              <div className="ctrl-row">
                <span className="ctrl-lbl">跟讀暫停（秒）</span>
                <div className="stepper">
                  <button className="step-btn" onClick={()=>setPauseSec(n=>Math.max(1,n-1))}>−</button>
                  <span className="step-val">{pauseSec}</span>
                  <button className="step-btn" onClick={()=>setPauseSec(n=>Math.min(20,n+1))}>+</button>
                </div>
              </div>
              <div className="ctrl-row">
                <span className="ctrl-lbl">播放速度</span>
                <div className="sp-chips">
                  {[0.75,1,1.25].map(s=>(
                    <span key={s} className={'sp-chip'+(speed===s?' on':'')} onClick={()=>{
                      setSpeed(s);speedRef.current=s
                      if(vidRef.current)vidRef.current.playbackRate=s
                      if(ytPlayerRef.current)try{ytPlayerRef.current.setPlaybackRate(s)}catch(e){}
                    }}>×{s}</span>
                  ))}
                </div>
              </div>
              <div className="tog-row">
                <span className="tog-lbl">🎙 跟讀暫停模式</span>
                <label className="tog-wrap"><input type="checkbox" checked={shadowMode} onChange={e=>setShadowMode(e.target.checked)}/><span className="sl"/></label>
              </div>
              <div className="tog-row">
                <span className="tog-lbl">🔴 暫停時自動錄音</span>
                <label className="tog-wrap"><input type="checkbox" checked={autoRec} onChange={e=>setAutoRec(e.target.checked)}/><span className="sl"/></label>
              </div>
            </div>
          </div>
        </aside>

        <main className="main">
          <h1>跟讀練習</h1>
          <p className="sub-tag">分句播放 · 重複練習 · 錄音對比</p>

          <div className="player-card">
            {showPlayer&&tab==='local'&&vidFile
              ? <video ref={vidRef} src={vidFile} onTimeUpdate={onTimeUpdate} onLoadedMetadata={onVidReady}/>
              : showPlayer&&tab==='yt'&&ytId
              ? <div className="yt-wrap"><div id="yt-player-div"/></div>
              : <div className="player-ph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><rect x="2" y="2" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                  <p>{tab==='yt'?'輸入 YouTube 網址並點載入':'從左側載入影片與字幕'}</p>
                </div>}
          </div>

          <div className="stat-bar">
            <div className={'dot'+(status.dot?' '+status.dot:'')}/>
            <span>{status.msg}</span>
          </div>

          <div className="sub-card">
            <div className="sub-meta">
              <span className="sub-ctr">{curIdx>=0?(curIdx+1)+' / '+subs.length:'— / —'}</span>
              <div>{badge&&<span className={'bdg bdg-'+badge.type}>{badge.txt}</span>}</div>
            </div>
            <div className={'sub-txt'+(curSub?'':' empty')}>{curSub?curSub.text:'載入影片與字幕後點播放...'}</div>
          </div>

          {dur>0&&<div className="prog-wrap">
            <div className="prog-times"><span>{fmt(curTime)}</span><span>{fmt(dur)}</span></div>
            <div className="prog-track" onClick={tab==='local'?seekClick:undefined}>
              <div className="prog-fill" style={{width:progress+'%'}}/>
            </div>
          </div>}

          <div className="playbar">
            <button className="btn icon" onClick={prevSub}>⏮</button>
            <button className="btn primary" onClick={togglePlay}>{(playing||waiting)?'⏸ 暫停':'▶ 播放'}</button>
            <button className="btn icon" onClick={nextSub}>⏭</button>
            <button className="btn sm" onClick={replayCur}>↺ 重播本句</button>
          </div>

          <div className="rec-card">
            <div className="rec-hd"><span className="rec-title">🎙 錄音</span><span style={{fontSize:12,color:'var(--text3)'}}>跟著朗讀後播放比對</span></div>
            <div className="wf">
              {waveBars.length>0
                ?<div className="wf-bars">{waveBars.map((h,i)=><div key={i} className="wf-bar" style={{height:h+'px',opacity:recActive?.75:.4}}/>)}</div>
                :<span className="wf-idle">尚未錄音</span>}
            </div>
            <div className="rec-ctrl">
              <button className={'btn sm'+(recActive?' danger':'')} onClick={()=>recActive?stopRec():startRec()}>{recActive?'■ 停止錄音':'● 開始錄音'}</button>
              {recActive&&<span className="rec-timer">{fmt(recSec)}</span>}
              <button className="btn sm" onClick={()=>lastBlobUrl&&new Audio(lastBlobUrl).play()} disabled={!lastBlobUrl}>▷ 播放錄音</button>
              <button className="btn sm" onClick={saveRec} disabled={!lastBlobUrl}>💾 保存</button>
            </div>
          </div>

          {savedRecs.length>0&&<div className="sub-list-card" style={{marginBottom:'1rem'}}>
            <div className="list-hd">已儲存錄音 <span style={{fontWeight:400,color:'var(--text3)'}}>共 {savedRecs.length} 筆</span></div>
            {savedRecs.map((r,i)=>(
              <div key={i} className="rec-item">
                <span className="rec-lbl">{r.label}</span>
                <audio controls src={r.url}/>
                <a href={r.url} download={`rec-${i+1}.webm`}><button className="btn sm icon">⬇</button></a>
                <button className="del-btn" onClick={()=>setSavedRecs(rs=>rs.filter((_,j)=>j!==i))}>✕</button>
              </div>
            ))}
          </div>}

          {subs.length>0&&<div className="sub-list-card">
            <div className="list-hd">字幕清單 <span style={{fontWeight:400,color:'var(--text3)'}}>共 {subs.length} 句</span></div>
            <div className="sub-list">
              {subs.map((s,i)=>(
                <div key={i} id={'si'+i} className={'si'+(i===curIdx?' cur':'')} onClick={()=>jumpTo(i)}>
                  <span className="ts">{fmt(s.s)}</span>
                  <span className="st">{s.text}</span>
                </div>
              ))}
            </div>
          </div>}
        </main>
      </div>
    </>
  )
}
