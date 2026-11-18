# Sample videos

front.html draws the sample project's three videos (Nova Crew, Chorus 1, six eights at 98 BPM, front view).

1. node build.js, copy front.html into dist/, serve dist/ (it loads /fonts and /app/vendor/mediabunny-card-1.61.3.js).
2. Open front.html?take=1 (or 2, or choreo) in Chrome and run await window.render() in the console: it returns the MP4 as base64.
3. Shrink: ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 23 -profile:v high -pix_fmt yuv420p -g 30 -movflags +faststart -an out.mp4
4. Save as public/samples/nova-take-1.mp4, nova-take-2.mp4, nova-choreo.mp4 (+ a .jpg still of each).
