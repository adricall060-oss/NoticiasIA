import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret");
const cookieName = process.env.AUTH_COOKIE_NAME ?? "iacc_session";

export type Session = {

  uid: number;
  codigo_cliente: string;
  email: string;
  dni: string;
  nombre?: string | null;
  apellidos?: string | null;
  displayName?: string | null;
  
};

export async function createToken(session: Session) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();           
  const token = store.get(cookieName)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as Session;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}