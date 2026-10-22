// One JSON row per settings section in the settings table.
export interface SettingsRows {
  all(): Promise<Record<string, Record<string, unknown>>>;
  save(section: string, value: Record<string, unknown>): Promise<void>;
}
