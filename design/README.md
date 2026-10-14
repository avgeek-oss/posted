# Posted brand artwork

`Posted.sketch` is the source for the refined logo and Open Graph image. Keep artwork refinements in this document and export through Sketch so its layout, materials and typography are preserved.

`exports/` contains all seven symbol variants in PNG and SVG, plus `OpenGraph@1x.png` at 1200 × 630. The SVG exports contain the source bitmap artwork; the application uses PNG assets.

| App asset                                     | Sketch source              | Size       |
| --------------------------------------------- | -------------------------- | ---------- |
| `apps/web/public/brand/posted-mark.png`       | `posted_light_transparent` | 256 × 256  |
| `apps/web/public/brand/posted-favicon.png`    | `posted_favicon`           | 64 × 64    |
| `apps/web/public/brand/posted-touch-icon.png` | `posted_favicon`           | 180 × 180  |
| `apps/web/public/brand/posted-social.png`     | `OpenGraph`                | 1200 × 630 |

The light and dark transparent marks currently have identical pixels. The app uses the same transparent mark in both themes.

## Export

Run from the repository root on a Mac with Sketch installed:

```sh
/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool export slices design/Posted.sketch --output=design/exports --save-for-web=YES --overwriting=YES
/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool export layers design/Posted.sketch --item=posted_light_transparent --formats=png --scales=0.64 --output=design/exports/app-mark --save-for-web=YES --overwriting=YES
/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool export layers design/Posted.sketch --item=posted_favicon --formats=png --scales=0.16,0.45 --output=design/exports/app-icons --save-for-web=YES --overwriting=YES
cp design/exports/app-mark/posted_light_transparent@0.6x.png apps/web/public/brand/posted-mark.png
cp design/exports/app-icons/posted_favicon@0.2x.png apps/web/public/brand/posted-favicon.png
cp design/exports/app-icons/posted_favicon@0.5x.png apps/web/public/brand/posted-touch-icon.png
cp design/exports/OpenGraph@1x.png apps/web/public/brand/posted-social.png
```

Sketch rounds scale suffixes in filenames: `@0.6x`, `@0.2x`, and `@0.5x` above are exported at the exact requested scales and produce 256, 64, and 180 pixel images.

## Social provider logos

The `Social Icons` page in `Posted.sketch` owns the X, LinkedIn, Bluesky and Threads logos. Export their complete 256 × 256 frames to preserve the supplied colours and padding. `design/exports/social/` holds SVG exports and PNG references; the app serves the vectors from `apps/web/public/providers/` through its shared `ProviderIcon` component. Account-avatar badges clip these tiles to a circle.

```sh
/Applications/Sketch.app/Contents/MacOS/sketchtool export layers design/Posted.sketch --items=AF201F7B-2FEF-4DB5-BFA5-DDB80E181AF6,C55D0A11-35B6-4851-BFAD-E128874676C5,44F93A81-7EC1-4D6C-8114-C964D63E3025,54AAFD4C-9043-42E3-8878-B79B7CE4E8CF --formats=svg,png --output=design/exports/social --save-for-web=YES --overwriting=YES --without-activating=YES
cp design/exports/social/*.svg apps/web/public/providers/
```
