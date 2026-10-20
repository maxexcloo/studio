type Slot = { id: string; kind?: string; label?: string; role?: string; follows?: string };
export function chainReferenceSlots<T extends Slot>(inputs: T[]): T[];
export function withReferenceChains<T extends { mediaInputs?: Slot[] }>(profile: T): T;
