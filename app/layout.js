import './globals.css';

export const metadata = {
  title:'태양광 발전 · SMP 수익 대시보드',
  description:'Google Drive 발전보고서 기반 태양광 발전량 및 SMP 수익 대시보드'
};

export default function RootLayout({children}) {
  return <html lang="ko"><body>{children}</body></html>;
}
