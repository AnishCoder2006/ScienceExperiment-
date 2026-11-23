"use client";

// Shown if anything on the page throws while rendering, instead of a blank screen.
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md rounded-2xl bg-surface p-6 text-center shadow-card ring-1 ring-border">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">{error.message || "The page could not be shown."}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
