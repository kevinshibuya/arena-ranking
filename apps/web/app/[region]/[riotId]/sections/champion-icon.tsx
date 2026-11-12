import type { ChampionRef } from '@arena/shared';

export function championName(champion: ChampionRef): string {
  return champion.name ?? `Champion ${champion.id}`;
}

/**
 * A champion's square icon, straight from Data Dragon. The grey tile stays when
 * the image does not load, so a row keeps its shape without it.
 */
export function ChampionIcon({ champion, size = 24 }: { champion: ChampionRef; size?: number }) {
  if (!champion.iconUrl) {
    return <span aria-hidden="true" className="inline-block shrink-0 rounded bg-neutral-200" style={{ width: size, height: size }} />;
  }
  return (
    // Data Dragon serves the icons ready to use; the Next image optimiser would only refetch them server-side.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={champion.iconUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className="shrink-0 rounded bg-neutral-200"
    />
  );
}
