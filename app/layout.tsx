import type { Metadata } from 'next';
import '@/client/styles/globals.css';

export const metadata: Metadata = {
  title: 'AgentCore Chat',
  description: 'Chat with AWS Bedrock AgentCore Harness',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
