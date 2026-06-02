export type AppRoute = "home" | "canvas" | "gallery" | "creative-video" | "video-library";

export function routeFromPathname(pathname: string): AppRoute {
  if (pathname === "/canvas") {
    return "canvas";
  }

  if (pathname === "/gallery") {
    return "gallery";
  }

  if (pathname === "/creative-video" || pathname === "/grok-imagine") {
    return "creative-video";
  }

  return pathname === "/video-library" ? "video-library" : "home";
}

export function pathForRoute(route: AppRoute): string {
  if (route === "canvas") {
    return "/canvas";
  }

  if (route === "gallery") {
    return "/gallery";
  }

  if (route === "creative-video") {
    return "/creative-video";
  }

  return route === "video-library" ? "/video-library" : "/";
}

export function canonicalPathForPathname(pathname: string): string | undefined {
  return pathname === "/grok-imagine" ? "/creative-video" : undefined;
}
