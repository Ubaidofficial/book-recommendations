export function HomepageVisual() {
  return (
    <div className="relative w-full max-w-xs mx-auto mt-6 md:mt-0" aria-hidden="true">
      <svg viewBox="0 0 280 180" className="w-full" xmlns="http://www.w3.org/2000/svg">
        {/* Person 1 */}
        <circle cx="60" cy="40" r="14" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.5" className="text-accent" />
        {/* Person 2 */}
        <circle cx="220" cy="40" r="14" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.5" className="text-accent" />
        {/* Person 3 (center top) */}
        <circle cx="140" cy="20" r="14" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" className="text-accent" />

        {/* Books */}
        <rect x="80" y="90" width="40" height="55" rx="3" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" className="text-accent" />
        <rect x="110" y="95" width="40" height="50" rx="3" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" className="text-accent" />
        <rect x="140" y="100" width="40" height="45" rx="3" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" className="text-accent" />

        {/* Connecting lines from people to books */}
        <line x1="64" y1="50" x2="100" y2="100" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="4 4" className="text-accent" />
        <line x1="145" y1="34" x2="160" y2="100" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="4 4" className="text-accent" />
        <line x1="216" y1="50" x2="170" y2="100" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="4 4" className="text-accent" />

        {/* Small rank badge on top book */}
        <rect x="143" y="103" width="16" height="14" rx="7" fill="currentColor" className="text-accent" />
        <text x="151" y="113" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">2</text>

        {/* Recommendation label */}
        <text x="140" y="175" textAnchor="middle" fill="currentColor" fillOpacity="0.4" fontSize="10" className="text-muted">recommendations → books</text>
      </svg>
    </div>
  );
}
