// frontend/src/lib/socket.ts
//
// 🔌 KDS Realtime (Roadmap "HoReCa Open Items - 06.09.2026.md", #4) —
// ერთი გაზიარებული Socket.IO client-connection (singleton), რომ
// გვერდის ხელახალი render-ის/tab-გადართვის დროს ახალი TCP connection
// ყოველ ჯერზე არ გაიხსნას. auth token იგივეა, რასაც axios interceptor-იც
// იყენებს (App.tsx) — localStorage-ის 'token' key.
//
// Path/base-URL ლოგიკა პირდაპირ App.tsx-ის axios.defaults.baseURL-ის
// ანარეკლია: dev-ში VITE_API_URL ცარიელია → იმავე origin-ზე (relative),
// vite.config.ts-ის '/api' proxy-rule-ი (ws: true-ით) აბრუნებს
// localhost:5000-ზე. production-ში VITE_API_URL absolute Render URL-ია.

import { io, Socket } from 'socket.io-client';

interface ServerToClientEvents {
  'kds:changed': (payload: { station: 'kitchen' | 'bar' }) => void;
}

// v1 — client → server event არ გვაქვს (one-directional push).
type ClientToServerEvents = Record<string, never>;

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (socket) return socket;

  const baseUrl = import.meta.env.VITE_API_URL || undefined;
  const token = localStorage.getItem('token') ?? '';

  socket = io(baseUrl, {
    path: '/api/socket.io',
    auth: { token },
    // ⚠️ ხელახალი დაკავშირება ავტომატურია (socket.io-client-ის default),
    // რაც ზუსტად ის fallback-ია, რაც polling-ს ცვლის — connection
    // ხანმოკლედ ჩავარდეს (wifi-ის ღილაკის ციმციმი), client თავად
    // reconnect-ავს, დამატებითი კოდის გარეშე.
    reconnection: true,
  });

  return socket;
}

// ⚠️ Logout-ზე (App.tsx-ის handleLogout) — token-ი localStorage-იდან
// იშლება, ამიტომ ძველი (ახლა არავალიდური token-ით ავთენტიფიცირებული)
// socket-connection-იც უნდა დაიხუროს, თორემ შემდეგი login-ის შემდეგ
// ახალი token ვერასდროს "ჩაენაცვლება" უკვე დამყარებულ connection-ში.
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
