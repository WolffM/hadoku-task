/**
 * Stylelint config — catches `var(--name)` references to custom properties
 * that aren't defined anywhere. @wolffm/themes (workspace:themes) is the
 * source of truth for tokens; this gate prevents typos like `--color-acccent`
 * from silently falling back to unset across themes.
 *
 * Local `src/styles/base.css` adds a few non-themed vars on top of the
 * theme tokens — included so refs to those don't flag as unknown.
 */
module.exports = {
  plugins: ['stylelint-value-no-unknown-custom-properties'],
  rules: {
    'csstools/value-no-unknown-custom-properties': [
      true,
      {
        importFrom: [
          require.resolve('@wolffm/themes/style.css'),
          require.resolve('./src/styles/base.css'),
        ],
      },
    ],
  },
}
