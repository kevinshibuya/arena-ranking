export interface ProcessHealth {
  status: 'ok';
  uptimeSeconds: number;
}

export interface ProcessHealthSection {
  process: ProcessHealth;
}
