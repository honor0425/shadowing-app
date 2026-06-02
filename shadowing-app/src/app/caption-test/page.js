'use client'
import { useEffect } from 'react'

export default function CaptionTestPage() {
  useEffect(() => {
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  }, [])

  return (
    <div style={{background:'#111',color:'#eee',fontFamily:'monospace',padding:'1.5rem',minHeight:'100vh'}}>
      <h2 style={{marginBottom:'1rem'}}>YouTube Caption API 測試</h2>
      <input id="url" defaultValue="https://www.youtube.com/watch?v=arj7oStGLkU"
        style={{width:'100%',padding:'8px',background:'#222',color:'#eee',border:'1px solid #444',borderRadius:'6px',marginBottom:'8px',boxSizing:'border-box'}}/>
      <br/>
      <button id="load-btn" style={{padding:'8px 18px',background:'#4ade80',color:'#000',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',marginBottom:'1rem'}}>
        載入並測試
      </button>
      <div id="player" style={{marginBottom:'1rem'}}/>
      <pre id="log" style={{background:'#1a1a1a',padding:'1rem',borderRadius:'6px',fontSize:'11px',maxHeight:'400px',overflow:'auto',whiteSpace:'pre-wrap',border:'1px solid #333'}}>
        等待...
      </pre>
      <script dangerouslySetInnerHTML={{__html:`
        let player = null;
        function log(msg, ok) {
          const el = document.getElementById('log');
          const color = ok===true?'#4ade80':ok===false?'#f87171':'#eee';
          el.innerHTML += '<span style="color:'+color+'">'+msg+'</span>\\n';
          el.scrollTop = el.scrollHeight;
        }
        window.onYouTubeIframeAPIReady = function() { log('YT API 就緒'); }
        document.getElementById('load-btn').onclick = function() {
          document.getElementById('log').innerHTML = '';
          const url = document.getElementById('url').value.trim();
          const m = url.match(/(?:v=|youtu\\.be\\/)([A-Za-z0-9_-]{11})/);
          if (!m) { log('無效網址', false); return; }
          const id = m[1]; log('載入: ' + id);
          if (player) { try { player.destroy(); } catch(e){} }
          if (!window.YT || !window.YT.Player) { log('YT API 尚未就緒，請稍後再試', false); return; }
          player = new YT.Player('player', {
            height:'240', width:'100%', videoId: id,
            playerVars: { cc_load_policy:1, cc_lang_pref:'en' },
            events: {
              onReady: function(e) {
                log('播放器就緒！', true);
                const p = e.target;
                try { p.loadModule('captions'); } catch(err){}
                setTimeout(function() {
                  log('--- getOption captions ---');
                  try {
                    const tl = p.getOption('captions','tracklist');
                    log('tracklist: ' + JSON.stringify(tl));
                    if (tl && tl.length) { log('✅ 找到 '+tl.length+' 個字幕！', true); }
                    else { log('❌ 沒有字幕軌道', false); }
                    const track = p.getOption('captions','track');
                    log('track: ' + JSON.stringify(track));
                  } catch(err){ log('錯誤: '+err.message, false); }
                  p.playVideo();
                  setTimeout(function() {
                    p.pauseVideo();
                    try {
                      const tl2 = p.getOption('captions','tracklist');
                      log('播放後 tracklist: ' + JSON.stringify(tl2));
                      if (tl2 && tl2.length) { log('✅ 播放後找到字幕！', true); }
                    } catch(err){ log('播放後錯誤: '+err.message, false); }
                  }, 3000);
                }, 2000);
              },
              onError: function(e) { log('播放器錯誤: ' + e.data, false); }
            }
          });
        };
      `}}/>
    </div>
  )
}
