// Sits outside any scroll container — an absolutely positioned child would
// scroll away.
export function Footer({ onLegal }: { onLegal?: () => void }) {
  return (
    <footer className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 py-3 text-xs text-neutral-600">
      <span>© {new Date().getFullYear()} Super Chameleon</span>
      {onLegal && (
        <>
          <span aria-hidden>·</span>
          <button
            onClick={onLegal}
            className="underline underline-offset-4 transition hover:text-neutral-300"
          >
            Legal
          </button>
        </>
      )}
    </footer>
  );
}
