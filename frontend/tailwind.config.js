/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F4F8F5', // 浅灰绿全局背景 (12)
        card: '#FFFFFF', // 纯白卡片 (12)
        brandDark: '#064E3B', // 深墨绿 (12)
        brand: '#10B981', // 主色绿 (12)
        brandLight: '#A7F3D0', // 浅绿 (12)
        brandFaint: '#D1FAE5', // 极浅绿 (12)
        danger: '#FEE2E2', // 浅红底 (12)
        dangerText: '#B91C1C', // 红字（我的答案卡片文字） (12)
        purple: '#8B5CF6', // 紫色 (12)
      },
      borderRadius: {
        card: '40px', // 大圆角 (12)
      },
      boxShadow: {
        card: '0 4px 24px rgba(6,78,59,0.05)', // 极浅墨绿阴影 (12)
      },
      fontFamily: {
        display: ['Kanit', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
