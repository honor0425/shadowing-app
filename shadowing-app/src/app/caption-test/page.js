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
      <h2 style={{marginBottom:'1rem'}}>字幕完整內容測試</h2>
      <input id="url" defaultValue="https://www.youtube.com/watch?v=arj7oStGLkU"
        style={{width:'100%',padding:'8px',background:'#222',color:'#eee',border:'1px solid #444',borderRadius:'6px',marginBottom:'8px',boxSizing:'border-box'}}/>
      <button id="load-btn" style={{padding:'8px 18px',background:'#4ade80',color:'#000',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',marginBottom:'1rem',display:'block'}}>
        載入並測試
      </button>
      <div id="player" style={{marginBottom:'1rem'}}/>
      <pre id="log" style={{background:'#1a1a1a',padding:'1rem',borderRadius:'6px',fontSize:'11px',maxHeight:'600px',overflow:'auto',whiteSpace:'pre-wrap',border:'1px solid #333'}}>等待...</pre>
      <script dangerouslySetInnerHTML={{__html:`
        let player = null;
        function log(msg, ok) {
          const el = document.getElementById('log');
          const color = ok===true?'#4ade80':ok===false?'#f87171':'#eee';
          el.innerHTML += '<span style="color:'+color+'">'+msg+'</span>\\n';
          el.scrollTop = el.scrollHeight;
        }

        function parseXML(xml) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, 'text/xml');
          const texts = doc.querySelectorAll('text');
          const result = [];
          texts.forEach(function(t) {
            const start = parseFloat(t.getAttribute('start'));
            const dur = parseFloat(t.getAttribute('dur') || '2');
            const text = t.textContent
              .replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim();
            if (text) result.push({ s: start, e: start+dur, text: text });
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
                  if (!tl || !tl.length) { log('❌ 沒有字幕', false); return; }
                  const en = tl.find(function(t){return t.languageCode==='en'}) || tl[0];
                  log('語言: ' + en.languageCode, true);

                  const u = 'https://www.youtube.com/api/timedtext?v='+id+'&tlang=en&lang='+en.languageCode;
                  log('抓取: ' + u);
                  fetch(u, {credentials:'include'})
                    .then(function(r){ return r.text(); })
                    .then(function(txt) {
                      log('長度: ' + txt.length);
                      log('前300字 (含空白): [' + txt.slice(0,300) + ']');
                      log('trimmed後前300字: [' + txt.trim().slice(0,300) + ']');
                      log('包含<text: ' + txt.includes('<text'));
                      log('包含transcript: ' + txt.includes('transcript'));
                      log('所有內容 (hex前50): ' + Array.from(txt.slice(0,50)).map(function(c){return c.charCodeAt(0).toString(16)}).join(' '));

                      if (txt.includes('<text')) {
                        const subs = parseXML(txt);
                        log('\\n✅ 解析成功！共 ' + subs.length + ' 句', true);
                        subs.slice(0,5).forEach(function(s,i){
                          log((i+1)+'. ['+s.s.toFixed(1)+'s] '+s.text, true);
                        });
                      } else {
                        log('\\n沒有 <text 標籤，原始內容:', false);
                        log(txt);
                      }
                    }).catch(function(err){ log('fetch 錯誤: '+err.message, false); });
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
