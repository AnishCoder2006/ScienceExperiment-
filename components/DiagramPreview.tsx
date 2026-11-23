import { svgDataUri } from "@/lib/format";
import { ExpandIcon, Spinner } from "./icons";

interface Props {
  svg: string | undefined;
  alt: string;
  busyMessage?: string;
  onOpen?: () => void;
}

/**
 * Shows an AI-made SVG through an <img> tag. Inside <img> the browser runs SMIL and CSS
 * animations but never scripts or external requests, so a bad SVG cannot touch the page.
 */
export function DiagramPreview({ svg, alt, busyMessage, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!svg || !onOpen}
      aria-label={svg ? `Open details for ${alt}` : alt}
      className="group relative block aspect-[8/5] w-full overflow-hidden rounded-2xl bg-paper shadow-subtle ring-1 ring-border transition hover:shadow-card hover:ring-border-strong enabled:cursor-zoom-in"
    >
      {svg ? (
        // next/image adds nothing for an inline data URI, and must not rasterise the animation.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={svgDataUri(svg)} alt={alt} className="h-full w-full object-contain p-2" />
      ) : (
        <span className="grid h-full place-items-center text-sm text-slate-500">No diagram yet. Press Generate to draw one.</span>
      )}

      {svg && onOpen && !busyMessage && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-slate-900/75 px-2.5 py-1 text-xs font-medium text-white opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <ExpandIcon width={13} height={13} /> Enlarge &amp; details
        </span>
      )}

      {busyMessage && (
        <span className="absolute inset-0 grid place-items-center bg-white/80 p-4 backdrop-blur-[2px]">
          <span className="flex max-w-[90%] items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-left text-sm text-white shadow-lg">
            <Spinner width={14} height={14} className="shrink-0" />
            <span className="line-clamp-2">{busyMessage}</span>
          </span>
        </span>
      )}
    </button>
  );
}
