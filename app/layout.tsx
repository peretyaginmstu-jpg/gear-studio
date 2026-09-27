import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Зацепление — генератор зубчатых колёс",
  description: "Постройте зубчатое колесо по параметрам или фотографии. Расчёт эвольвенты, 3D-модель, STL и оценка печати.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/favicon.svg`,
    shortcut: `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/favicon.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
