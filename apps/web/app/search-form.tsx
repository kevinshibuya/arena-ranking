'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { DEFAULT_REGION, REGIONS } from '../lib/regions';
import { parseRiotId, profilePath } from '../lib/riot-id';

/**
 * Riot ID search. With JavaScript it checks the input and navigates in place;
 * before hydration it submits as a GET to the home page, which does the same
 * on the server (`initialRiotId` and `initialProblem` are what it got).
 */
export function SearchForm({
  initialRiotId = '',
  initialProblem = null,
}: {
  initialRiotId?: string;
  initialProblem?: string | null;
}) {
  const router = useRouter();
  const [region, setRegion] = useState<string>(DEFAULT_REGION);
  const [problem, setProblem] = useState<string | null>(initialProblem);
  const problemId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get('riotId');
    const parsed = parseRiotId(typeof input === 'string' ? input : '');
    if (!parsed.ok) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    router.push(profilePath(region, parsed.riotId));
  }

  return (
    <form action="/" method="get" onSubmit={submit} noValidate className="mt-8">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="region">
          Region
        </label>
        <select
          id="region"
          name="region"
          value={region}
          onChange={(event) => setRegion(event.target.value)}
          className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm"
        >
          {REGIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="riotId">
          Riot ID
        </label>
        <input
          id="riotId"
          name="riotId"
          type="text"
          placeholder="Name#TAG"
          defaultValue={initialRiotId}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem !== null}
          aria-describedby={problem ? problemId : undefined}
          onChange={() => setProblem(null)}
          className="h-11 min-w-0 flex-1 rounded-md border border-neutral-300 px-3 text-base"
        />
        <button type="submit" className="h-11 rounded-md bg-neutral-900 px-5 text-sm font-medium text-white">
          Search
        </button>
      </div>
      {problem && (
        <p id={problemId} role="alert" className="mt-2 text-sm text-red-700">
          {problem}
        </p>
      )}
    </form>
  );
}
