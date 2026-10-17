import { memo, useEffect, useRef, useState } from "react";

export const MediaVideo = memo(function MediaVideo({
  src,
  label,
  className,
  controls = true,
}: {
  src: string;
  label: string;
  className: string;
  controls?: boolean;
}) {
  const element = useRef<HTMLVideoElement>(null);
  const [load, setLoad] = useState(false);
  const activeSource = useRef("");
  const position = useRef(0);
  const playing = useRef(false);
  useEffect(() => {
    const video = element.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) video.pause();
        setLoad(entry.isIntersecting);
      },
      { rootMargin: "160px" },
    );
    observer.observe(video);
    const pauseHidden = () => {
      if (document.visibilityState === "hidden") video.pause();
    };
    document.addEventListener("visibilitychange", pauseHidden);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", pauseHidden);
    };
  }, []);
  return (
    <video
      ref={element}
      src={load ? src : undefined}
      controls={controls}
      playsInline
      preload="metadata"
      aria-label={label}
      className={className}
      onTimeUpdate={(event) => {
        if (
          event.currentTarget.currentSrc === src &&
          event.currentTarget.readyState > 0
        )
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
        if (position.current > 0)
          video.currentTime = Math.min(position.current, video.duration);
        if (playing.current)
          void video.play().catch(() => {
            playing.current = false;
          });
      }}
    />
  );
});
