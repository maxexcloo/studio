export type SwipeDirection = "left" | "right" | "up" | "down";

/** A touch swipe's direction from how far it travelled; short or diagonal moves are not swipes. */
export function swipeDirection(dx: number, dy: number): SwipeDirection | undefined {
  if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.3) return dx < 0 ? "left" : "right";
  if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx) * 1.3) return dy < 0 ? "up" : "down";
}
