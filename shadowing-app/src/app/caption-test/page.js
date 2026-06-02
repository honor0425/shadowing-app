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
      <h2 style={{marginBottom:'1rem'}}>YouTube Caption 內容抓取測試</h2>
      <input id="url" defaultValue="https://www.youtube.com/watch?v=arj7oStGLkU"
        style={{width:'100%',padding:'8px',background:'#222',color:'#eee',border:'1px solid #444',borderRadius:'6px',marginBottom:'8px',boxSizing:'border-box'}}/>
      <button id="load-btn" style={{padding:'8px 18px',background:'#4ade80',color:'#000',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',marginBottom:'1rem',display:'block'}}>
        載入並測試
      </button>
      <div id="player" style={{marginBottom:'1rem'}}/>
      <pre id="log" style={{background:'#1a1a1a',padding:'1rem',borderRadius:'6px',fontSize:'11px',maxHeight:'500px',overflow:'auto',whiteSpace:'pre-wrap',border:'1px solid #333'}}>等待...</pre>
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
          if (!window.YT || !window.YT.Player) { log('YT API 尚未就緒', false); return; }
          player = new YT.Player('player', {
            height:'200', width:'100%', videoId: id,
            playerVars: { cc_load_policy:1, cc_lang_pref:'en' },
            events: {
              onReady: function(e) {
                log('播放器就緒！開始測試...', true);
                const p = e.target;
                try { p.loadModule('captions'); } catch(err){}

                // Step 1: play to trigger caption load
                p.playVideo();
                setTimeout(function() {
                  p.pauseVideo();

                  // Step 2: get tracklist
                  const tl = p.getOption('captions','tracklist');
                  if (!tl || !tl.length) { log('❌ 沒有字幕', false); return; }

                  const en = tl.find(t => t.languageCode === 'en') || tl.find(t => t.languageCode.startsWith('en')) || tl[0];
                  log('使用字幕: ' + en.languageCode + ' vss_id=' + en.vss_id, true);

                  // Step 3: set the track
                  try {
                    p.setOption('captions', 'track', {languageCode: en.languageCode});
                    log('設定字幕軌道: ' + en.languageCode);
                  } catch(err) { log('setOption 錯誤: ' + err.message, false); }

                  // Step 4: try to get caption data via internal API
                  log('\\n--- 嘗試抓取字幕內容 ---');

                  // Try method A: getOption fontSize/reload
                  setTimeout(function() {
                    try {
                      const track = p.getOption('captions','track');
                      log('目前 track: ' + JSON.stringify(track));
                    } catch(err) { log('getOption track 錯誤: ' + err.message, false); }

                    // Method B: use fetch with the vss_id to construct URL
                    log('\\n--- 嘗試用 vss_id 建構字幕 URL ---');
                    const vssId = en.vss_id; // e.g. ".en" or "asr.en"
                    const videoId = id;
                    // YouTube timedtext URL pattern
                    const urls = [
                      'https://www.youtube.com/api/timedtext?v='+videoId+'&lang='+en.languageCode+'&fmt=json3',
                      'https://www.youtube.com/api/timedtext?v='+videoId+'&lang='+en.languageCode+'&kind=asr&fmt=json3',
                      'https://www.youtube.com/api/timedtext?v='+videoId+'&tlang=en&lang='+en.languageCode+'&fmt=json3',
                    ];
                    let tried = 0;
                    urls.forEach(function(u) {
                      fetch(u, {credentials:'include'}).then(function(r) {
                        return r.text();
                      }).then(function(txt) {
                        log('URL: ' + u.slice(0,70));
                        log('狀態長度: ' + txt.length);
                        if (txt.length > 10) {
                          log('✅ 有內容！前100字: ' + txt.slice(0,100), true);
                          try {
                            const data = JSON.parse(txt);
                            const events = data.events ? data.events.filter(function(e){return e.segs}) : [];
                            log('句子數: ' + events.length, events.length>0);
                            if (events[0]) log('第一句: ' + events[0].segs.map(function(s){return s.utf8}).join(''));
                          } catch(pe) { log('JSON 解析失敗: ' + txt.slice(0,50)); }
                        } else {
                          log('❌ 空回應', false);
                        }
                      }).catch(function(err) { log('fetch 錯誤: ' + err.message, false); });
                    });

                    // Method C: try with credentials (logged in user)
                    log('\\n--- 嘗試帶 cookie 請求 ---');
                    fetch('https://www.youtube.com/api/timedtext?v='+id+'&lang=en&fmt=json3', {
                      credentials: 'include',
                      headers: { 'Accept': 'application/json' }
                    }).then(function(r){ return r.text(); })
                    .then(function(txt){
                      log('帶 cookie 長度: ' + txt.length);
                      if(txt.length > 10) log('✅ 有內容: ' + txt.slice(0,100), true);
                      else log('❌ 仍然空的', false);
                    }).catch(function(e){ log('cookie 請求錯誤: ' + e.message, false); });

                  }, 1000);
                }, 3000);
              },
              onError: function(e) { log('播放器錯誤: ' + e.data, false); }
            }
          });
        };
      `}}/>
    </div>
  )
}
