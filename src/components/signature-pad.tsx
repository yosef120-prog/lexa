import { useEffect, useRef, useState } from "react";

/**
 * Signing with a finger.
 *
 * On a phone this is the only signature anybody will actually produce, so it
 * is built for a thumb first: pointer events cover touch, pen and mouse in one
 * path, and the canvas swallows the scroll gesture while a stroke is in
 * progress — otherwise the page slides away mid-signature and the line ends up
 * somewhere the person did not put it.
 */
export function SignaturePad({
  onChange,
}: {
  /** Null while empty; a PNG blob once anything has been drawn. */
  onChange: (png: Blob | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // Sized to its own box in device pixels, or the line is a soft grey smear on
  // any phone made in the last decade.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      const box = canvas.getBoundingClientRect();
      canvas.width = box.width * ratio;
      canvas.height = box.height * ratio;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#15222a";
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  function at(e: React.PointerEvent<HTMLCanvasElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => onChange(blob), "image/png");
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-md border border-dashed border-rule bg-surface"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const { x, y } = at(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          drawing.current = true;
          setHasInk(true);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const { x, y } = at(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          emit();
        }}
        onPointerLeave={() => {
          if (!drawing.current) return;
          drawing.current = false;
          emit();
        }}
        aria-label="חתום כאן באצבע או בעכבר"
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {hasInk ? "אפשר לנקות ולחתום שוב" : "חתום כאן באצבע או בעכבר"}
        </span>
        <button
          type="button"
          onClick={clear}
          className="rounded px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-rule/50"
        >
          נקה חתימה
        </button>
      </div>
    </div>
  );
}
