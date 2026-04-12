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
          bg: "rgb(var(--color-wave-bg) / <alpha-value>)",
          surface: "rgb(var(--color-wave-surface) / <alpha-value>)",
          primary: "rgb(var(--color-wave-primary) / <alpha-value>)",
          accent: "rgb(var(--color-wave-accent) / <alpha-value>)",
          text: "rgb(var(--color-wave-text) / <alpha-value>)",
          muted: "rgb(var(--color-wave-muted) / <alpha-value>)",
          danger: "rgb(var(--color-wave-danger) / <alpha-value>)",
          wave: "rgb(var(--color-wave-wave) / <alpha-value>)",
          match: "rgb(var(--color-wave-match) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};
