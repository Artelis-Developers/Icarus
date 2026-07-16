import { AuthGate } from '@/client/components/auth-gate';
import ChatPage from '@/client/pages/chatpage';

export default function Page() {
  return (
    <AuthGate>
      <ChatPage />
    </AuthGate>
  );
}
