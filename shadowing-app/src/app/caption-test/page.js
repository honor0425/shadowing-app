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
      <h2 style={{marginBottom:'1rem'}}>字幕 XML 解析測試</h2>
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

        function parseXMLCaptions(xml) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, 'text/xml');
          const texts = doc.querySelectorAll('text');
          const result = [];
          texts.forEach(function(t) {
            const start = parseFloat(t.getAttribute('start'));
            const dur = parseFloat(t.getAttribute('dur') || '2');
            const text = t.textContent
              .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
              .replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();
            if (text) result.push({ s: start, e: start + dur, text: text });
          });
          return result;
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
                log('播放器就緒！', true);
                const p = e.target;
                try { p.loadModule('captions'); } catch(err){}
                p.playVideo();
                setTimeout(function() {
                  p.pauseVideo();
                  const tl = p.getOption('captions','tracklist');
                  if (!tl || !tl.length) { log('❌ 沒有字幕軌道', false); return; }
                  const en = tl.find(function(t){return t.languageCode==='en'})
                    || tl.find(function(t){return t.languageCode.startsWith('en')})
                    || tl[0];
                  log('字幕語言: ' + en.languageCode + ' vss_id=' + en.vss_id, true);

                  // Try all working URL patterns with XML parsing
                  const urlsToTry = [
                    'https://www.youtube.com/api/timedtext?v='+id+'&lang='+en.languageCode,
                    'https://www.youtube.com/api/timedtext?v='+id+'&tlang=en&lang='+en.languageCode,
                    'https://www.youtube.com/api/timedtext?v='+id+'&lang=en',
                    'https://www.youtube.com/api/timedtext?v='+id+'&lang=en&kind=asr',
                    'https://www.youtube.com/api/timedtext?v='+id+'&lang=a.en',
                  ];

                  urlsToTry.forEach(function(u) {
                    fetch(u, {credentials:'include'}).then(function(r){ return r.text(); })
                    .then(function(txt) {
                      log('\\nURL: ' + u.slice(u.indexOf('?')));
                      log('長度: ' + txt.length);
                      if (txt.length > 50) {
                        log('原始內容前150字: ' + txt.slice(0,150));
                        if (txt.includes('<text')) {
                          const subs = parseXMLCaptions(txt);
                          log('✅ XML 解析成功！共 ' + subs.length + ' 句', true);
                          if (subs[0]) log('第1句: ['+subs[0].s.toFixed(1)+'s] ' + subs[0].text, true);
                          if (subs[1]) log('第2句: ['+subs[1].s.toFixed(1)+'s] ' + subs[1].text, true);
                          if (subs[2]) log('第3句: ['+subs[2].s.toFixed(1)+'s] ' + subs[2].text, true);
                        } else if (txt.includes('events')) {
                          log('JSON 格式！', true);
                          try {
                            const data = JSON.parse(txt);
                            const events = data.events.filter(function(e){return e.segs});
                            log('✅ 共 ' + events.length + ' 句', true);
                          } catch(pe){}
                        }
                      } else {
                        log('❌ 空或太短', false);
                      }
                    }).catch(function(err){ log('錯誤: '+err.message, false); });
                  });
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
