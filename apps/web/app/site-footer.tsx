import Link from 'next/link';

// Riot's legal boilerplate, required by the developer policies: the short form
// in every page's footer, the full text on the about page.
export const RIOT_DISCLAIMER =
  "arena-ranking isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";

export const RIOT_DISCLAIMER_SHORT =
  "arena-ranking isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games.";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-neutral-200 px-4 py-6 text-xs leading-relaxed text-neutral-500 sm:px-6">
      <p className="mx-auto max-w-3xl">
        {RIOT_DISCLAIMER_SHORT}{' '}
        <Link href="/about" className="underline underline-offset-2">
          About and legal
        </Link>
      </p>
    </footer>
  );
}
