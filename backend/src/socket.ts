// backend/src/socket.ts
//
// 🔌 KDS Realtime (Roadmap "HoReCa Open Items - 06.09.2026.md", #4) —
// Socket.IO ცვლის 4-წამიან HTTP polling-ს (KitchenDisplay.tsx) push-based
// event-ებით. Design: socket "signal only" event-ს აგზავნის
// (`kds:changed`, { station }), არა სრულ ticket-payload-ს — client
// მიღებისთანავე GET /kitchen/tickets-ს იძახებს (უკვე არსებული,
// გატესტილი endpoint, RLS/org-scoping ხელუხლებელი რჩება). ეს გვარიდებს
// ticket-shape-ის ორ ადგილას (REST + socket) დუბლირებას/სინქრონიზაციის
// რისკს.
//
// Path: `/api/socket.io` (არა default `/socket.io`) — განზრახ, რომ
// dev-ში frontend/vite.config.ts-ის უკვე არსებულმა `/api` proxy-rule-მა
// დაფაროს (ცალკე proxy entry არ სჭირდება).
//
// Auth: handshake-ზე იგივე JWT, რასაც REST-ის authenticateToken
// ამოწმებს (routes/auth.ts) — `socket.handshake.auth.token`-ში.
// წარმატებული handshake-ის შემდეგ socket-ი უერთდება `org:<organizationId>`
// room-ს — ნებისმიერი emit ორგანიზაციის ფარგლებში რჩება (არასდროს
// გაჟონავს სხვა org-ის KDS ეკრანამდე).

import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import jwt from 'jsonwebtoken';
import { Station } from './types';

interface SocketUser {
  id: string;
  role: string;
  username: string;
  organizationId: string;
}

interface ServerToClientEvents {
  'kds:changed': (payload: { station: Station }) => void;
}

// ეს ვერსია client → server event-ს არ იყენებს (v1, one-directional push),
// მაგრამ Socket.IO-ს generic-ებს მაინც სჭირდება ტიპი "any"-ის თავიდან
// ასაცილებლად.
type ClientToServerEvents = Record<string, never>;
type InterServerEvents = Record<string, never>;

interface SocketData {
  user: SocketUser;
}

type KdsSocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type KdsSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

let io: KdsSocketServer | null = null;

export function initSocket(httpServer: HTTPServer, allowedOrigins: readonly string[]): KdsSocketServer {
  io = new SocketIOServer(httpServer, {
    path: '/api/socket.io',
    cors: {
      origin(origin, callback) {
        // იგივე origin-allowlist ლოგიკა, რასაც index.ts-ის REST CORS
        // იყენებს (curl/server-to-server-ს Origin header არ აქვს).
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS: origin "${origin}" დაშვებული არ არის`));
      },
    },
  });

  // 🛡️ Handshake-level auth middleware — REST-ის authenticateToken-ის
  // ანალოგიური, უბრალოდ Express middleware-ის ნაცვლად Socket.IO-ს
  // საკუთარი io.use() pattern-ით.
  io.use((socket: KdsSocket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('AUTH_REQUIRED'));
      return;
    }

    try {
      const secretKey = process.env.JWT_SECRET || 'super-secret-key';
      const decoded = jwt.verify(token, secretKey) as SocketUser;
      socket.data.user = decoded;
      next();
    } catch {
      next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', (socket: KdsSocket) => {
    const organizationId = socket.data.user?.organizationId;
    if (organizationId) {
      socket.join(`org:${organizationId}`);
    }
  });

  return io;
}

// 🔔 Routes (orders.ts/kitchen.ts) ამას იძახებენ REST-ის success-გზაზე
// (INSERT/UPDATE-ის შემდეგ) — io ჯერ არ არსებობდეს (init-ის თანმიმდევრობის
// ედჟ-ქეისი ტესტებში) ან station არ იყოს ცნობილი (pending item,
// KDS-ზე არასდროს გამოჩენილა) — noop-ია, არა შეცდომა.
export function emitKdsChanged(organizationId: string | undefined, station: Station | null | undefined): void {
  if (!io || !organizationId || !station) return;
  io.to(`org:${organizationId}`).emit('kds:changed', { station });
}
