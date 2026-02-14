import "./globals.css";

export const metadata = {
  title: "Site Intel POC",
  description: "Construction site intelligence proof of concept"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
