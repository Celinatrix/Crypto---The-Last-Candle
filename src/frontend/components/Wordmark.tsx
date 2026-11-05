/** The brand name with its flame. Size and colour come from the surrounding element. */
export default function Wordmark() {
  return (
    <span className="wordmark" lang="en">
      <svg viewBox="0 0 14 22" aria-hidden="true">
        <path d="M7 0c3 5 7 8 7 14a7 7 0 0 1-14 0C0 8 4 5 7 0Z" fill="#f0b259" />
      </svg>
      The Last Candle
    </span>
  );
}
