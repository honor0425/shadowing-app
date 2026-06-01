import { YoutubeTranscript } from 'youtube-transcript'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const videoId = searchParams.get('id')

  if (!videoId) {
    return Response.json({ error: '缺少 video id' }, { status: 400 })
  }

  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: 'en',
    })

    if (!transcript || transcript.length === 0) {
      // fallback: try without lang
      const fallback = await YoutubeTranscript.fetchTranscript(videoId)
      if (!fallback || fallback.length === 0) {
        return Response.json({ error: '此影片沒有可用的字幕' }, { status: 404 })
      }
      return Response.json({ transcript: fallback })
    }

    return Response.json({ transcript })
  } catch (e) {
    return Response.json(
      { error: '無法取得字幕，此影片可能未開放 CC 字幕：' + e.message },
      { status: 500 }
    )
  }
}
