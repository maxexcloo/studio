// Preloaded (`--import`) into a forked Studio so the Service addresses it derives from the fake
// Kubernetes API (`<service>.<namespace>.svc.cluster.local`) reach the fixtures on this machine.
import dns from "node:dns";

const lookup = dns.lookup;
dns.lookup = ((host: string, ...rest: unknown[]) =>
  (lookup as (...args: unknown[]) => void)(
    host.endsWith(".svc.cluster.local") ? "127.0.0.1" : host,
    ...rest,
  )) as typeof dns.lookup;
