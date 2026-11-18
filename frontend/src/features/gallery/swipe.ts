export type SwipeDirection = "left" | "right" | "up" | "down";

/** A touch swipe's direction from how far it travelled; short or diagonal moves are not swipes. */
export function swipeDirection(dx: number, dy: number): SwipeDirection | undefined {
  if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.3) return dx < 0 ? "left" : "right";
  if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx) * 1.3) return dy < 0 ? "up" : "down";
}

/** The axis a touch drag follows once it has moved further than a tap's wobble. */
export function dragAxis(dx: number, dy: number): "x" | "y" | undefined {
  if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) return "x";
  if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return "y";
}

/** The viewer's media following a finger: `move` as it drags, `release` once it lifts. */
export type SwipeGesture = {
  move(dx: number, dy: number): void;
  release(direction?: SwipeDirection): void;
};
