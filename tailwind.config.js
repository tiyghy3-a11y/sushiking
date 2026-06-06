/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#E63946',
          50: '#FEF2F3',
          100: '#FDE4E6',
          500: '#E63946',
          600: '#CF2F3C',
          700: '#A82531',
        },
        surface: '#FFFFFF',
        background: '#F4F5F7',
        ink: {
          DEFAULT: '#1D3557',
          light: '#457B9D',
          muted: '#8899AA',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Hiragino Sans"', '"Noto Sans JP"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
