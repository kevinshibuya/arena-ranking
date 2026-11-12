import type { FormatSummary, SeasonSummary } from '@arena/shared';
import Link from 'next/link';

interface Option {
  key: string;
  label: string;
  href: string;
  current: boolean;
}

function Choices({ label, options }: { label: string; options: Option[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="w-16 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      {options.map((option) => (
        <Link
          key={option.key}
          href={option.href}
          aria-current={option.current ? 'page' : undefined}
          scroll={false}
          className={
            option.current
              ? 'rounded-full bg-neutral-900 px-3 py-1 text-sm text-white'
              : 'rounded-full border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:border-neutral-500'
          }
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Format and season choices, from the formats and seasons endpoints; each
 * choice is a link built by `href`, so the selection lives in the URL.
 */
export function ScopeChoices({
  formats,
  seasons,
  current,
  href,
}: {
  formats: FormatSummary[];
  seasons: SeasonSummary[];
  current: { format: string; season: string };
  href: (format: string, season: string) => string;
}) {
  const formatOptions = formats.map((format) => ({
    key: format.id,
    label: format.label,
    href: href(format.id, current.season),
    current: format.id === current.format,
  }));
  const seasonOptions = [
    ...[...seasons].reverse().map((season) => ({
      key: String(season.id),
      label: season.name,
      href: href(current.format, String(season.id)),
      current: String(season.id) === current.season,
    })),
    { key: 'all', label: 'All-time', href: href(current.format, 'all'), current: current.season === 'all' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Choices label="Format" options={formatOptions} />
      <Choices label="Season" options={seasonOptions} />
    </div>
  );
}
