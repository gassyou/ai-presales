/**
 * CORS 中间件 —— 仅在 dev 模式允许 vite 跨域；生产同源
 */

export function corsMiddleware(allowDevOrigin: boolean) {
  return async (req: Request, next: () => Promise<Response>): Promise<Response> => {
    // 处理预检
    if (req.method === "OPTIONS" && allowDevOrigin) {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": req.headers.get("origin") ?? "*",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type,x-trace-id",
          "access-control-max-age": "600",
        },
      });
    }

    const res = await next();

    if (allowDevOrigin) {
      const origin = req.headers.get("origin");
      if (origin) {
        res.headers.set("access-control-allow-origin", origin);
        res.headers.set("access-control-allow-credentials", "true");
      }
    }
    return res;
  };
}