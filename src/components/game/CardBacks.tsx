/**
 * Purely decorative card backs. They represent the physical cards a player
 * holds — no state, no interaction, no real card data.
 */
export function CardBacks({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none flex items-end justify-center ${className}`}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-9 w-6 rounded-[4px] border border-gold/60 shadow-[0_4px_12px_-4px_oklch(0.1_0.03_165_/_0.9)] sm:h-12 sm:w-8"
          style={{
            marginLeft: i === 0 ? 0 : "-0.5rem",
            transform: `rotate(${(i - 1) * 8}deg) translateY(${i === 1 ? "-3px" : "0"})`,
            backgroundImage:
              "repeating-linear-gradient(45deg, var(--ember) 0 4px, var(--card) 4px 8px)",
          }}
        />
      ))}
    </div>
  );
}
