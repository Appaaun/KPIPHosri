import './globals.css';
export const metadata = {
  title: 'ระบบติดตามตัวชี้วัดโรงพยาบาล',
  description: 'Hospital KPI Management System',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
