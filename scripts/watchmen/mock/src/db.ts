export interface Record {
  id: string;
  data: unknown;
}

export function insert(record: Record): void {}
export function findById(id: string): Record | null { return null; }
export function deleteById(id: string): boolean { return false; }
