type TurnstileVerifyResponse = {
  success: boolean;
  "error-codes"?: string[];
};

export function getRequestIp(req: Request) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim();

  const realIp = req.headers.get("x-real-ip");
  return realIp?.trim() || undefined;
}

export async function verifyTurnstileToken(token: string, remoteIp?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim() ?? "";

  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not configured");
    return false;
  }

  if (!token || token.length > 2048) {
    return false;
  }

  const params = new URLSearchParams();
  params.append("secret", secret);
  params.append("response", token);
  if (remoteIp) {
    params.append("remoteip", remoteIp);
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      cache: "no-store",
    });

    if (!response.ok) return false;

    const data = (await response.json()) as TurnstileVerifyResponse;
    return data.success === true;
  } catch {
    return false;
  }
}
