/** A lobby shape: team count by team size (`6x3`, `8x2`), or `irregular` for uneven teams. */
export type FormatId = `${number}x${number}` | 'irregular';

export interface FormatSummary {
  id: FormatId;
  /** For selectors, e.g. "6 teams of 3". */
  label: string;
  /** Whether the format has a ladder; irregular lobbies never do. */
  ladder: boolean;
  /** The format a selector starts on. Exactly one format is the default. */
  default: boolean;
}

export interface FormatsResponse {
  formats: FormatSummary[];
}
