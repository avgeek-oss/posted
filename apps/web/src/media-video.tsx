import { useRef } from "react";

export function MediaVideo({
  src,
  label,
  className,
}: {
  src: string;
  label: string;
  className: string;
}) {
  const activeSource = useRef("");
  const position = useRef(0);
  const playing = useRef(false);
  return (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      className={className}
      onTimeUpdate={(event) => {
        if (activeSource.current === src)
          position.current = event.currentTarget.currentTime;
      }}
      onPlay={() => {
        if (activeSource.current === src) playing.current = true;
      }}
      onPause={() => {
        if (activeSource.current === src) playing.current = false;
      }}
      onEnded={() => {
        playing.current = false;
      }}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (video.currentSrc !== src) return;
        activeSource.current = src;
        video.currentTime = Math.min(position.current, video.duration);
        if (playing.current)
          void video.play().catch(() => {
            playing.current = false;
          });
      }}
    />
  );
}
