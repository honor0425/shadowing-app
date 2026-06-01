export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const videoId = searchParams.get('id')
  if (!videoId) return Response.json({ error: '缺少 video id' }, { status: 400 })

  // Try multiple language/kind combos
  const attempts = [
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&kind=asr&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-US&fmt=json3`,
    `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en-GB&fmt=json3`,
  ]

  for (const url of attempts) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.youtube.com/',
        }
      })
      if (!res.ok) continue
      const data = await res.json()
      if (!data?.events?.length) continue

      // parse json3 format
      const transcript = data.events
        .filter(e => e.segs && e.tStartMs !== undefined)
        .map(e => ({
          offset: e.tStartMs,
          duration: e.dDurationMs || 3000,
          text: e.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim()
        }))
        .filter(e => e.text && e.text !== ' ')

      if (transcript.length > 0) {
        return Response.json({ transcript, source: url })
      }
    } catch(e) {
      continue
    }
  }

  // Last resort: try to get caption list from watch page
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    })
    if (pageRes.ok) {
      const html = await pageRes.text()
      const match = html.match(/"captionTracks":(\[.*?\])/)
      if (match) {
        const tracks = JSON.parse(match[1])
        const enTrack = tracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en'))
        if (enTrack?.baseUrl) {
          const capRes = await fetch(enTrack.baseUrl + '&fmt=json3')
          if (capRes.ok) {
            const data = await capRes.json()
            const transcript = data.events
              ?.filter(e => e.segs && e.tStartMs !== undefined)
              .map(e => ({
                offset: e.tStartMs,
                duration: e.dDurationMs || 3000,
                text: e.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim()
              }))
              .filter(e => e.text && e.text !== ' ')
            if (transcript?.length > 0) {
              return Response.json({ transcript })
            }
          }
        }
      }
    }
  } catch(e) {}

  return Response.json(
    { error: '無法自動取得字幕，請使用 Downsub.com 下載 SRT 後手動上傳' },
    { status: 404 }
  )
}
