// README table: one row per (game, port), sorted by game.
const PLATFORM = { pcvr: 'PCVR', standalone: 'Standalone', both: 'PCVR + Standalone' };
const STATUS = { alpha: '🧪 alpha', beta: '🚧 beta', stable: '✅ stable', abandoned: '💀 abandoned' };

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const authors = (p) => p.authors.map((a) => (a.url ? `[${cell(a.name)}](${a.url})` : cell(a.name))).join(', ');
const reviews = (p) => (p.reviews ?? []).map((r) => `[▶ ${cell(r.channel)}](${r.url})`).join('<br>') || '—';

// One row per (game, port): a port covering several games appears under each of them.
export function rows(ports) {
  const out = [];
  for (const p of ports) {
    for (const game of p.games) out.push({ game, port: p, image: (p.images ?? []).find((i) => i.game === game) });
  }
  const key = (s) => s.toLowerCase().replace(/^the /, '');
  return out.sort((a, b) => key(a.game).localeCompare(key(b.game)) || a.port.name.localeCompare(b.port.name));
}

export function render(ports) {
  const lines = rows(ports).map(({ game, port: p, image }) =>
    [
      `${image ? `<img src="${image.file}" width="160" alt="${cell(game)}"><br>` : ''}**${cell(game)}**`,
      `[${cell(p.name)}](${p.source_url})`,
      PLATFORM[p.platform],
      STATUS[p.status],
      `[${cell(p.version)}](${p.download_url})<br>${p.version_date}`,
      authors(p),
      reviews(p),
    ].join(' | '),
  );
  return [
    '| Game | Port | Platform | Status | Latest | Author | Reviews |',
    '|---|---|---|---|---|---|---|',
    ...lines.map((l) => `| ${l} |`),
  ].join('\n');
}
