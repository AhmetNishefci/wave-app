/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        wave: {
          bg: "var(--color-wave-bg)",
          surface: "var(--color-wave-surface)",
          primary: "var(--color-wave-primary)",
          accent: "var(--color-wave-accent)",
          text: "var(--color-wave-text)",
          muted: "var(--color-wave-muted)",
          danger: "var(--color-wave-danger)",
          wave: "var(--color-wave-wave)",
          match: "var(--color-wave-match)",
        },
      },
    },
  },
  plugins: [],
};
