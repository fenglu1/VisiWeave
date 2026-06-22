import {
  canonicalPathForPathname,
  pathForRoute,
  routeFromPathname
} from "../features/canvas/app-routing";

expect(routeFromPathname("/grok-imagine") === "creative-video", "old Grok URL remains a creative video compatibility route");
expect(canonicalPathForPathname("/grok-imagine") === "/creative-video", "old Grok URL is canonicalized into the creative video workspace");
expect(canonicalPathForPathname("/creative-video") === undefined, "canonical creative video URL does not rewrite itself");
expect(pathForRoute("creative-video") === "/creative-video", "creative video route owns the public video workspace path");
expect(routeFromPathname("/request-logs") === "request-logs", "request logs route is hidden but routable");
expect(pathForRoute("request-logs") === "/request-logs", "request logs route owns the request log path");

console.log("app routing smoke checks passed");

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
