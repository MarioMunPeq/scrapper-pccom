export interface Milestone {
  date: string
  label: string
}

/** Hitos comerciales fijos de la temporada. */
export const MILESTONES: Milestone[] = [
  { date: '2026-11-27', label: 'Black Friday' },
  { date: '2026-11-30', label: 'Cyber Monday' },
  { date: '2026-12-25', label: 'Navidad' },
  { date: '2027-01-06', label: 'Reyes' },
  { date: '2027-01-07', label: 'Rebajas' },
]
