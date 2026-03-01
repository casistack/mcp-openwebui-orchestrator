// Simple table formatting for CLI output

export function table(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log('(no results)');
    return;
  }

  const cols = columns ?? Object.keys(rows[0]);
  const widths = cols.map(col => {
    const maxDataWidth = rows.reduce((max, row) => {
      const val = String(row[col] ?? '');
      return Math.max(max, val.length);
    }, 0);
    return Math.max(col.length, Math.min(maxDataWidth, 50));
  });

  // Header
  const header = cols.map((col, i) => col.toUpperCase().padEnd(widths[i])).join('  ');
  console.log(header);
  console.log(widths.map(w => '-'.repeat(w)).join('  '));

  // Rows
  for (const row of rows) {
    const line = cols.map((col, i) => {
      const val = String(row[col] ?? '');
      return val.length > 50 ? val.slice(0, 47) + '...' : val.padEnd(widths[i]);
    }).join('  ');
    console.log(line);
  }
}

export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function success(msg: string): void {
  console.log(`OK: ${msg}`);
}

export function error(msg: string): void {
  console.error(`Error: ${msg}`);
}
