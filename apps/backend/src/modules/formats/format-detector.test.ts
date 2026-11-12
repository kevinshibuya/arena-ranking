import { DEFAULT_FORMAT, detectFormat } from './format-detector';

/** One participant per entry, the entry being its subteam id. */
function lobby(subteamIds: Array<number | null | undefined>): Array<{ playerSubteamId?: number | null }> {
  return subteamIds.map((playerSubteamId) => ({ playerSubteamId }));
}

/** `teams` subteams of `size` players each, interleaved the way Riot lists them. */
function evenLobby(teams: number, size: number): Array<{ playerSubteamId: number }> {
  const participants: Array<{ playerSubteamId: number }> = [];
  for (let seat = 0; seat < size; seat++) {
    for (let team = 1; team <= teams; team++) participants.push({ playerSubteamId: team });
  }
  return participants;
}

describe('format detector', () => {
  it('names six teams of three 6x3', () => {
    expect(detectFormat(evenLobby(6, 3))).toBe('6x3');
  });

  it('names eight teams of two 8x2', () => {
    expect(detectFormat(evenLobby(8, 2))).toBe('8x2');
  });

  it('names any other even shape by team count and size', () => {
    expect(detectFormat(evenLobby(4, 4))).toBe('4x4');
  });

  it('calls a lobby with uneven team sizes irregular', () => {
    expect(detectFormat(lobby([1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 6]))).toBe('irregular');
  });

  it('calls a lobby with a missing subteam id irregular', () => {
    const participants = evenLobby(6, 3);
    participants[4] = { playerSubteamId: undefined as unknown as number };

    expect(detectFormat(participants)).toBe('irregular');
  });

  it('calls a lobby with a null or zero subteam id irregular', () => {
    expect(detectFormat(lobby([1, 1, 2, 2, null, null]))).toBe('irregular');
    expect(detectFormat(lobby([1, 1, 2, 2, 0, 0]))).toBe('irregular');
  });

  it('calls an empty lobby irregular', () => {
    expect(detectFormat([])).toBe('irregular');
  });

  it('defaults the ladder to 6x3, labelled six teams of three', () => {
    expect(DEFAULT_FORMAT).toEqual({ id: '6x3', label: '6 teams of 3' });
  });
});
