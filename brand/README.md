# Brand assets

- `../logo.svg` is the master logo. `icon-192.png`, `icon-512.png` and `apple-touch-icon.png` are renders of it.
- `build_loader.py` builds the loading animation in Blender 5.1 (vortex of light streaks, logo twists in, shock ring).

Re-render `loader.mp4`:

```sh
Blender -b --factory-startup --python brand/build_loader.py -- /tmp/loader.blend /tmp/loader-frames/
Blender -b /tmp/loader.blend -a
ffmpeg -framerate 24 -i /tmp/loader-frames/%04d.png -vf "scale=320:320:flags=lanczos,tpad=stop_mode=clone:stop_duration=0.5" -c:v libx264 -crf 28 -preset veryslow -pix_fmt yuv420p -movflags +faststart -an loader.mp4
```
