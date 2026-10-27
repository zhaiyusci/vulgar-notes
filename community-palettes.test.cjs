const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PALETTES = {
  light: 'light', paper: 'light', slate: 'light', dark: 'dark',
  'catppuccin-latte': 'light', 'catppuccin-frappe': 'dark',
  'catppuccin-macchiato': 'dark', 'catppuccin-mocha': 'dark',
  nord: 'dark', 'tokyo-night': 'dark', dracula: 'dark',
  'solarized-light': 'light', 'solarized-dark': 'dark',
};

const sources = ['src/themes.css', 'src/themes-catppuccin.css', 'src/themes-community.css'];

// Palette definitions deliberately use flat custom-property declarations. Read
// their actual colors so contrast checks remain independent of the UI renderer.
function readPalettes() {
  const styles = sources.map(path => fs.readFileSync(path, 'utf8')).join('\n');
  const readDeclarations = block => Object.fromEntries([...block.matchAll(/(--app-[\w-]+|color-scheme)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.trim()]));
  const base = readDeclarations(styles.match(/:root\[data-color-scheme\]\s*\{([^}]+)\}/)[1]);
  return Object.fromEntries(Object.keys(PALETTES).map(scheme => {
    const block = styles.match(new RegExp(`:root\\[data-color-scheme=["']?${scheme}["']?\\]\\s*\\{([^}]+)\\}`));
    assert.ok(scheme === 'light' || block, `${scheme} has a stylesheet definition`);
    return [scheme, {...base, ...readDeclarations(block?.[1] ?? '')}];
  }));
}

function luminance(hex) {
  const match = hex.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  assert.ok(match, `text contrast requires an opaque hex color, received ${hex}`);
  const value = match[1].length === 3 ? [...match[1]].map(channel => channel + channel).join('') : match[1];
  const channels = [0, 2, 4].map(start => parseInt(value.slice(start, start + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('each palette declares the correct native control color mode', () => {
  const palettes = readPalettes();
  for (const [scheme, mode] of Object.entries(PALETTES)) {
    assert.equal(palettes[scheme]['color-scheme'], mode, scheme);
  }
});

test('all palettes keep prose, formulas, tool labels, references and status text readable', () => {
  const pairs = [
    ...['canvas', 'surface', 'sidebar', 'panel', 'soft', 'hover', 'selection'].map(background => ['ink', background]),
    ...['sidebar', 'surface', 'panel'].map(background => ['muted', background]),
    ...['canvas', 'surface'].map(background => ['link', background]),
    ['error', 'canvas'], ['error', 'surface'], ['selection-ink', 'selection'],
    ['warning', 'warning-surface'], ['warning', 'canvas'],
    ['action-ink', 'action'], ['primary-ink', 'primary'],
  ];
  const failures = [];
  for (const [scheme, palette] of Object.entries(readPalettes())) {
    for (const [foreground, background] of pairs) {
      const ratio = contrast(palette[`--app-${foreground}`], palette[`--app-${background}`]);
      if (ratio < 4.5) failures.push(`${scheme}: ${foreground} / ${background} = ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], 'normal-sized application text needs at least 4.5:1 contrast');
});
