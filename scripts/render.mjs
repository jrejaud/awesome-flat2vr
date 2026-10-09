// README table: one row per (game, port), sorted by game.
const PLATFORM = { pcvr: 'PCVR', standalone: 'Standalone', both: 'PCVR + Standalone' };
const STATUS = { alpha: '🧪 alpha', beta: '🚧 beta', stable: '✅ stable', abandoned: '💀 abandoned' };

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const attr = (s) => cell(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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

// Four columns, not seven: GitHub caps images at the cell width, so every extra column
// shrinks the game art. Port, version and author share one cell; platform, status and
// known bugs share another.
export function render(ports) {
  const lines = rows(ports).map(({ game, port: p, image }) =>
    [
      `${image ? `<img src="${image.file}" width="300" alt="${attr(game)}"><br>` : ''}**${cell(game)}**`,
      `[${cell(p.name)}](${p.source_url})<br>by ${authors(p)}<br>Latest: [${cell(p.version)}](${p.download_url}) (${p.version_date})`,
      [
        PLATFORM[p.platform],
        STATUS[p.status],
        p.known_bugs?.length ? `${p.known_bugs.length} known bug${p.known_bugs.length > 1 ? 's' : ''}` : '',
      ]
        .filter(Boolean)
        .join('<br>'),
      reviews(p),
    ].join(' | '),
  );
  return ['| Game | Port | Platform | Reviews |', '|---|---|---|---|', ...lines.map((l) => `| ${l} |`)].join('\n');
}
